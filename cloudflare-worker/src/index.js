const MAX_SENDS = 3;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PDF_BYTES + 64 * 1024;
const MAX_SLACK_MESSAGE_CHARS = 3000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FILENAME_RE = /^fo-monthly-bulletin-\d{4}-(0[1-9]|1[0-2])\.pdf$/;

function corsHeaders(origin, allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Turnstile-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin, env.ALLOWED_ORIGIN)
    }
  });
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validateEnvironment(env) {
  if (!env.DB) fail("D1 binding DB is missing.", 500);
  if (!env.SLACK_BOT_TOKEN?.startsWith("xoxb-")) fail("SLACK_BOT_TOKEN secret is missing or invalid.", 500);
  if (!/^[A-Z0-9]+$/.test(env.SLACK_CHANNEL_ID || "")) fail("SLACK_CHANNEL_ID is missing or invalid.", 500);
  if (!env.ALLOWED_ORIGIN?.startsWith("https://")) fail("ALLOWED_ORIGIN is missing or invalid.", 500);
  if (!env.TURNSTILE_SECRET) fail("TURNSTILE_SECRET secret is missing.", 500);
}

function validatePeriod(periodKey, periodLabel) {
  if (!PERIOD_RE.test(periodKey)) fail("Invalid bulletin period.");
  if (!periodLabel || periodLabel.length > 40) fail("Invalid bulletin period label.");
}

function validateSlackMessage(value) {
  if (typeof value !== "string") fail("Slack message is required.");
  const message = value.replace(/\r\n/g, "\n").trim();
  if (!message) fail("Slack message is required.");
  if (message.length > MAX_SLACK_MESSAGE_CHARS) {
    fail(`Slack message must be under ${MAX_SLACK_MESSAGE_CHARS} characters.`);
  }
  return message;
}

async function verifyTurnstile(request, env) {
  const token = request.headers.get("X-Turnstile-Token") || "";
  if (!token) fail("Human verification is required.", 403);

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  form.set("remoteip", request.headers.get("CF-Connecting-IP") || "");
  form.set("idempotency_key", crypto.randomUUID());

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) fail("Human verification failed. Refresh and try again.", 403);
}

async function slackApi(method, payload, token, formEncoded = false) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": formEncoded
        ? "application/x-www-form-urlencoded"
        : "application/json; charset=utf-8"
    },
    body: formEncoded
      ? new URLSearchParams(payload).toString()
      : JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(`Slack ${method} failed: ${result.error || `HTTP ${response.status}`}`);
    error.status = 502;
    error.slackCode = result.error;
    throw error;
  }
  return result;
}

function findMessageTs(file, channelId) {
  for (const visibility of ["public", "private"]) {
    const messages = file?.shares?.[visibility]?.[channelId];
    if (messages?.[0]?.ts) return messages[0].ts;
  }
  return null;
}

async function uploadPdf(pdfBytes, filename, message, env) {
  const ticket = await slackApi(
    "files.getUploadURLExternal",
    { filename, length: String(pdfBytes.byteLength) },
    env.SLACK_BOT_TOKEN,
    true
  );

  const uploadResponse = await fetch(ticket.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdfBytes
  });
  if (!uploadResponse.ok) fail(`Slack PDF upload failed: HTTP ${uploadResponse.status}`, 502);

  const completed = await slackApi(
    "files.completeUploadExternal",
    {
      files: [{ id: ticket.file_id, title: filename }],
      channel_id: env.SLACK_CHANNEL_ID,
      initial_comment: message
    },
    env.SLACK_BOT_TOKEN
  );

  let messageTs = findMessageTs(completed.files?.[0], env.SLACK_CHANNEL_ID);
  for (let attempt = 0; attempt < 6 && !messageTs; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    const info = await slackApi(
      "files.info",
      { file: ticket.file_id },
      env.SLACK_BOT_TOKEN,
      true
    );
    messageTs = findMessageTs(info.file, env.SLACK_CHANNEL_ID);
  }

  return { fileId: ticket.file_id, messageTs };
}

async function deleteSlackDelivery(delivery, env) {
  if (delivery.message_ts) {
    try {
      await slackApi(
        "chat.delete",
        { channel: delivery.channel_id, ts: delivery.message_ts },
        env.SLACK_BOT_TOKEN
      );
    } catch (error) {
      if (error.slackCode !== "message_not_found") throw error;
    }
  }

  if (delivery.file_id) {
    try {
      await slackApi(
        "files.delete",
        { file: delivery.file_id },
        env.SLACK_BOT_TOKEN
      );
    } catch (error) {
      if (!["file_not_found", "file_deleted"].includes(error.slackCode)) throw error;
    }
  }
}

async function reserveSend(periodKey, env) {
  await env.DB.prepare(
    "INSERT INTO slack_periods (period_key, successful_sends, updated_at) VALUES (?, 0, ?) ON CONFLICT(period_key) DO NOTHING"
  ).bind(periodKey, new Date().toISOString()).run();

  const reservation = await env.DB.prepare(
    "UPDATE slack_periods SET successful_sends = successful_sends + 1, updated_at = ? WHERE period_key = ? AND successful_sends < ? RETURNING successful_sends"
  ).bind(new Date().toISOString(), periodKey, MAX_SENDS).first();

  if (!reservation) fail("The monthly Slack limit of 3 successful sends has been reached.", 409);
  return Number(reservation.successful_sends);
}

async function releaseSend(periodKey, env) {
  await env.DB.prepare(
    "UPDATE slack_periods SET successful_sends = MAX(successful_sends - 1, 0), updated_at = ? WHERE period_key = ?"
  ).bind(new Date().toISOString(), periodKey).run();
}

async function handleSend(request, url, env) {
  const periodKey = url.searchParams.get("periodKey") || "";
  const periodLabel = (url.searchParams.get("periodLabel") || "").trim();
  const filename = url.searchParams.get("filename") || "";
  validatePeriod(periodKey, periodLabel);
  if (!FILENAME_RE.test(filename)) fail("Invalid PDF filename.");

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) fail("The request is too large.", 413);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
    fail("Multipart form data is required.", 415);
  }

  const form = await request.formData().catch(() => fail("Invalid multipart request."));
  const message = validateSlackMessage(form.get("message"));
  const pdfFile = form.get("pdf");
  if (!pdfFile || typeof pdfFile === "string" || typeof pdfFile.arrayBuffer !== "function") {
    fail("PDF attachment is required.");
  }
  if (pdfFile.type?.toLowerCase() !== "application/pdf") fail("Only PDF uploads are accepted.", 415);
  if (!pdfFile.size || pdfFile.size > MAX_PDF_BYTES) fail("The PDF is empty or larger than 5 MB.", 413);

  const pdfBytes = await pdfFile.arrayBuffer();
  if (!pdfBytes.byteLength || pdfBytes.byteLength > MAX_PDF_BYTES) fail("The PDF is empty or larger than 5 MB.", 413);
  const signature = new TextDecoder("ascii").decode(pdfBytes.slice(0, 5));
  if (signature !== "%PDF-") fail("The uploaded attachment is not a valid PDF.", 415);

  const successfulSends = await reserveSend(periodKey, env);
  let uploaded;
  try {
    uploaded = await uploadPdf(pdfBytes, filename, message, env);
    await env.DB.prepare(
      "INSERT INTO slack_deliveries (id, period_key, period_label, filename, file_id, message_ts, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(),
      periodKey,
      periodLabel,
      filename,
      uploaded.fileId,
      uploaded.messageTs,
      env.SLACK_CHANNEL_ID,
      new Date().toISOString()
    ).run();
  } catch (error) {
    await releaseSend(periodKey, env).catch(() => {});
    if (uploaded?.fileId) {
      await deleteSlackDelivery({
        file_id: uploaded.fileId,
        message_ts: uploaded.messageTs,
        channel_id: env.SLACK_CHANNEL_ID
      }, env).catch(() => {});
    }
    throw error;
  }

  return { successfulSends, maxSends: MAX_SENDS };
}

async function handleDelete(request, env) {
  const body = await request.json().catch(() => fail("Invalid JSON body."));
  const periodKey = body?.periodKey || "";
  validatePeriod(periodKey, body?.periodLabel || periodKey);

  const delivery = await env.DB.prepare(
    "SELECT id, file_id, message_ts, channel_id FROM slack_deliveries WHERE period_key = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).bind(periodKey).first();
  if (!delivery) fail("There is no Slack post to delete for this period.", 404);

  await deleteSlackDelivery(delivery, env);
  await env.DB.prepare(
    "UPDATE slack_deliveries SET deleted_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), delivery.id).run();
  return { deleted: true };
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";

  if (request.method === "GET" && url.pathname === "/") {
    return jsonResponse({ ok: true, service: "fo-monthly-bulletin-slack" }, 200, origin, env);
  }

  if (request.method === "OPTIONS") {
    if (origin !== env.ALLOWED_ORIGIN) return jsonResponse({ ok: false, error: "Origin not allowed." }, 403, origin, env);
    return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGIN) });
  }

  try {
    validateEnvironment(env);
    if (origin !== env.ALLOWED_ORIGIN) fail("Origin not allowed.", 403);
    await verifyTurnstile(request, env);

    let result;
    if (request.method === "POST" && url.pathname === "/send") {
      result = await handleSend(request, url, env);
    } else if (request.method === "POST" && url.pathname === "/delete-last") {
      result = await handleDelete(request, env);
    } else {
      fail("Endpoint not found.", 404);
    }
    return jsonResponse({ ok: true, ...result }, 200, origin, env);
  } catch (error) {
    console.error(error.message);
    return jsonResponse(
      { ok: false, error: String(error.message || "Unexpected Worker error.").slice(0, 300) },
      Number(error.status) || 500,
      origin,
      env
    );
  }
}

export default { fetch: handleRequest };
export {
  FILENAME_RE,
  MAX_PDF_BYTES,
  MAX_SENDS,
  MAX_SLACK_MESSAGE_CHARS,
  PERIOD_RE,
  corsHeaders,
  findMessageTs,
  validatePeriod,
  validateSlackMessage
};
