import { randomUUID, sign } from "node:crypto";
import { pathToFileURL } from "node:url";

const PROJECT_ID = "fo-bulletin";
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C0AFA7FR5EZ";
const MAX_SENDS = 3;
const MAX_PDF_BYTES = 650 * 1024;
const MESSAGE = "📋 *Fixtures Operations Monthly Bulletin* is ready!\n\n" +
  "This month's compiled update from every FO team is live — check it out here:\n\n" +
  "Thanks to everyone who contributed this month! 🙌";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required GitHub Actions secret: ${name}`);
  return value;
}

function parseServiceAccount() {
  let account;
  try {
    account = JSON.parse(requiredEnv("FIREBASE_SERVICE_ACCOUNT_JSON"));
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!account.client_email || !account.private_key || account.project_id !== PROJECT_ID) {
    throw new Error(`The Firebase service account must belong to ${PROJECT_ID}.`);
  }
  return account;
}

function jwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  return { mapValue: { fields: encodeFields(value) } };
}

function fromValue(value = {}) {
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "nullValue")) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(fromValue);
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  return undefined;
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toValue(nested)]));
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));
}

class Firestore {
  constructor(account) {
    this.account = account;
    this.database = `projects/${PROJECT_ID}/databases/(default)`;
    this.base = `https://firestore.googleapis.com/v1/${this.database}/documents`;
    this.token = null;
  }

  async accessToken() {
    if (this.token?.expiresAt > Date.now()) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = this.account.token_uri || "https://oauth2.googleapis.com/token";
    const unsigned = `${jwtPart({ alg: "RS256", typ: "JWT" })}.${jwtPart({
      iss: this.account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    })}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), this.account.private_key).toString("base64url")}`;
    const response = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error(`Firebase authentication failed (${response.status}).`);
    this.token = { value: payload.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
    return this.token.value;
  }

  url(documentPath) {
    return `${this.base}/${documentPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  name(documentPath) {
    return `${this.database}/documents/${documentPath}`;
  }

  async request(url, options = {}, notFoundIsNull = false) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (notFoundIsNull && response.status === 404) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Firestore request failed (${response.status}).`);
      error.status = payload.error?.status;
      throw error;
    }
    return payload;
  }

  async get(documentPath, transaction = "") {
    const suffix = transaction ? `?transaction=${encodeURIComponent(transaction)}` : "";
    return this.request(`${this.url(documentPath)}${suffix}`, {}, true);
  }

  async list(documentPath) {
    return this.request(`${this.url(documentPath)}?pageSize=50&orderBy=createdAt%20desc`);
  }

  async begin() {
    return this.request(`${this.base}:beginTransaction`, { method: "POST", body: "{}" });
  }

  async rollback(transaction) {
    await this.request(`${this.base}:rollback`, {
      method: "POST",
      body: JSON.stringify({ transaction })
    }).catch(() => {});
  }

  async commit(writes, transaction = "") {
    return this.request(`${this.base}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) })
    });
  }

  async queuedJobs() {
    const result = await this.list("bulletin/current/slackQueue");
    return (result.documents || [])
      .map((document) => ({
        path: document.name.split("/documents/")[1],
        ...decodeFields(document.fields)
      }))
      .filter((job) => job.status === "queued")
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(0, 10);
  }

  async claim(documentPath) {
    const { transaction } = await this.begin();
    try {
      const document = await this.get(documentPath, transaction);
      if (!document || fromValue(document.fields?.status) !== "queued") {
        await this.rollback(transaction);
        return null;
      }
      await this.commit([{
        update: {
          name: this.name(documentPath),
          fields: {
            ...document.fields,
            status: toValue("processing"),
            processingAt: toValue(new Date().toISOString())
          }
        },
        currentDocument: { updateTime: document.updateTime }
      }], transaction);
      return { path: documentPath, ...decodeFields(document.fields), status: "processing" };
    } catch (error) {
      await this.rollback(transaction);
      if (error.status === "ABORTED" || error.status === "FAILED_PRECONDITION") return null;
      throw error;
    }
  }

  async patch(documentPath, values, removedFields = []) {
    const fieldNames = [...Object.keys(values), ...removedFields];
    const masks = fieldNames.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
    await this.request(`${this.url(documentPath)}?${masks}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFields(values) })
    });
  }

  async finish(documentPath, status, values = {}) {
    await this.patch(documentPath, {
      status,
      finishedAt: new Date().toISOString(),
      ...values
    }, ["pdfBase64", "previewBase64"]);
  }

  async periodState(periodKey) {
    const period = await this.get(`bulletin/current/slackPeriods/${periodKey}`);
    const deliveryResult = await this.list(`bulletin/current/slackPeriods/${periodKey}/deliveries`).catch((error) => {
      if (error.status === "NOT_FOUND") return { documents: [] };
      throw error;
    });
    const deliveries = (deliveryResult.documents || []).map((document) => ({
      path: document.name.split("/documents/")[1],
      ...decodeFields(document.fields)
    }));
    return {
      successfulSends: Number(fromValue(period?.fields?.successfulSends) || 0),
      deliveries
    };
  }

  async recordDelivery(periodKey, delivery) {
    const periodPath = `bulletin/current/slackPeriods/${periodKey}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { transaction } = await this.begin();
      try {
        const period = await this.get(periodPath, transaction);
        const current = Number(fromValue(period?.fields?.successfulSends) || 0);
        if (current >= MAX_SENDS) {
          await this.rollback(transaction);
          const error = new Error("The monthly Slack limit of 3 successful sends has been reached.");
          error.code = "MONTHLY_LIMIT";
          throw error;
        }
        const deliveryPath = `${periodPath}/deliveries/${Date.now()}-${randomUUID()}`;
        await this.commit([
          {
            update: {
              name: this.name(periodPath),
              fields: encodeFields({ successfulSends: current + 1, updatedAt: new Date().toISOString() })
            },
            currentDocument: period ? { updateTime: period.updateTime } : { exists: false }
          },
          {
            update: { name: this.name(deliveryPath), fields: encodeFields(delivery) },
            currentDocument: { exists: false }
          }
        ], transaction);
        return current + 1;
      } catch (error) {
        if (error.code === "MONTHLY_LIMIT") throw error;
        await this.rollback(transaction);
        if (error.status !== "ABORTED" || attempt === 2) throw error;
      }
    }
  }

  async markDeleted(delivery) {
    await this.patch(delivery.path, { status: "deleted", deletedAt: new Date().toISOString() });
  }
}

async function slackApi(method, payload, token, formEncoded = false) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": formEncoded ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8"
    },
    body: formEncoded ? new URLSearchParams(payload).toString() : JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(`Slack ${method} failed: ${result.error || `HTTP ${response.status}`}`);
    error.slackCode = result.error;
    throw error;
  }
  return result;
}

function findMessageTs(file) {
  for (const visibility of ["public", "private"]) {
    const messages = file?.shares?.[visibility]?.[CHANNEL_ID];
    if (messages?.[0]?.ts) return messages[0].ts;
  }
  return null;
}

async function uploadPdf(pdf, filename, token) {
  const ticket = await slackApi("files.getUploadURLExternal", {
    filename,
    length: String(pdf.length)
  }, token, true);

  const uploaded = await fetch(ticket.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdf
  });
  if (!uploaded.ok) throw new Error(`Slack file upload failed: HTTP ${uploaded.status}`);

  const completed = await slackApi("files.completeUploadExternal", {
    files: [{ id: ticket.file_id, title: filename }],
    channel_id: CHANNEL_ID,
    initial_comment: MESSAGE
  }, token);

  let messageTs = findMessageTs(completed.files?.[0]);
  for (let attempt = 0; attempt < 4 && !messageTs; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    const info = await slackApi("files.info", { file: ticket.file_id }, token, true);
    messageTs = findMessageTs(info.file);
  }
  return { fileId: ticket.file_id, messageTs };
}

function validateJob(job) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(job.periodKey || "")) throw new Error("Invalid bulletin period.");
  if (!String(job.periodLabel || "").trim() || String(job.periodLabel).length > 40) throw new Error("Invalid bulletin period label.");
  if (job.action === "delete") return undefined;
  if (job.action !== "send") throw new Error("Invalid Slack action.");
  if (!/^fo-monthly-bulletin-[0-9]{4}-(0[1-9]|1[0-2])\.pdf$/.test(job.filename || "")) throw new Error("Invalid PDF filename.");
  const pdf = Buffer.from(job.pdfBase64 || "", "base64");
  if (!pdf.length || pdf.length > MAX_PDF_BYTES || pdf.length !== Number(job.pdfBytes) || pdf.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("The queued attachment is not a valid PDF.");
  }
  return pdf;
}

async function deleteDelivery(delivery, token) {
  if (delivery.messageTs) {
    try {
      await slackApi("chat.delete", { channel: CHANNEL_ID, ts: delivery.messageTs }, token);
    } catch (error) {
      if (error.slackCode !== "message_not_found") throw error;
    }
  }
  if (delivery.fileId) {
    try {
      await slackApi("files.delete", { file: delivery.fileId }, token);
    } catch (error) {
      if (!["file_not_found", "file_deleted"].includes(error.slackCode)) throw error;
    }
  }
}

async function processJob(store, queuedJob, token) {
  const job = await store.claim(queuedJob.path);
  if (!job) return;
  try {
    const pdf = validateJob(job);
    const state = await store.periodState(job.periodKey);
    if (job.action === "delete") {
      const delivery = state.deliveries
        .filter((item) => item.status === "success")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (!delivery) {
        await store.finish(job.path, "rejected", { message: "There is no Slack post to delete for this month." });
        return;
      }
      await deleteDelivery(delivery, token);
      await store.markDeleted(delivery);
      await store.finish(job.path, "succeeded", { message: "Last Slack post and PDF deleted." });
      return;
    }
    if (state.successfulSends >= MAX_SENDS) {
      await store.finish(job.path, "rejected", { message: "The monthly Slack limit of 3 successful sends has been reached." });
      return;
    }
    const uploaded = await uploadPdf(pdf, job.filename, token);
    const delivery = {
      ...uploaded,
      jobPath: job.path,
      channelId: CHANNEL_ID,
      filename: job.filename,
      periodLabel: job.periodLabel,
      status: "success",
      createdAt: new Date().toISOString()
    };
    try {
      const successfulSends = await store.recordDelivery(job.periodKey, delivery);
      await store.finish(job.path, "succeeded", { successfulSends, message: "Sent to Slack." });
    } catch (error) {
      await deleteDelivery(delivery, token).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error(`Job ${job.path} failed: ${error.message}`);
    await store.finish(job.path, error.code === "MONTHLY_LIMIT" ? "rejected" : "failed", {
      message: error.message.slice(0, 300)
    });
  }
}

async function main() {
  const token = requiredEnv("SLACK_BOT_TOKEN");
  if (!token.startsWith("xoxb-")) throw new Error("SLACK_BOT_TOKEN must be a bot token beginning with xoxb-.");
  const store = new Firestore(parseServiceAccount());
  const jobs = await store.queuedJobs();
  console.log(`Found ${jobs.length} queued Slack request(s).`);
  for (const job of jobs) await processJob(store, job, token);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  CHANNEL_ID,
  MAX_PDF_BYTES,
  MESSAGE,
  findMessageTs,
  fromValue,
  toValue,
  validateJob
};
