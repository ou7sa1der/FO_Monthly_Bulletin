import { randomUUID, sign } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ID = "fo-bulletin";
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C0AFA7FR5EZ";
const PUBLIC_SITE_BASE_URL = (process.env.PUBLIC_SITE_BASE_URL ||
  "https://ou7sa1der.github.io/FO_Monthly_Bulletin").replace(/\/+$/, "");
const ARCHIVE_ROOT = "bulletins";
const PLAN_PATH = ".slack-publish-plan.json";
const MAX_SENDS = 3;
const MAX_PDF_BYTES = 520 * 1024;
const MAX_PREVIEW_BYTES = 140 * 1024;
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

function slackToken() {
  const token = requiredEnv("SLACK_BOT_TOKEN");
  if (!token.startsWith("xoxb-")) {
    throw new Error("SLACK_BOT_TOKEN must be a bot token beginning with xoxb-.");
  }
  return token;
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

  async decoded(documentPath) {
    const document = await this.get(documentPath);
    return document ? { path: documentPath, ...decodeFields(document.fields) } : null;
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

  async jobs() {
    const result = await this.list("bulletin/current/slackQueue");
    return (result.documents || [])
      .map((document) => ({
        path: document.name.split("/documents/")[1],
        ...decodeFields(document.fields)
      }))
      .filter((job) => job.status === "queued" || job.status === "prepared")
      .sort((a, b) => {
        const statusOrder = Number(b.status === "prepared") - Number(a.status === "prepared");
        return statusOrder || String(a.createdAt).localeCompare(String(b.createdAt));
      });
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

  async markPrepared(documentPath, archive) {
    await this.patch(documentPath, {
      status: "prepared",
      preparedAt: new Date().toISOString(),
      archiveVersion: archive.version,
      pdfFilename: archive.pdfFilename,
      previewFilenamePublished: archive.previewFilename,
      pdfUrl: archive.pdfUrl,
      previewUrl: archive.previewUrl
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

async function slackApi(method, payload, token) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(`Slack ${method} failed: ${result.error || `HTTP ${response.status}`}`);
    error.slackCode = result.error;
    throw error;
  }
  return result;
}

function archiveFor(job, version) {
  if (!Number.isInteger(version) || version < 1 || version > MAX_SENDS) {
    throw new Error("Invalid bulletin archive version.");
  }
  const stem = `fo-monthly-bulletin-${job.periodKey}-v${version}`;
  const relativeDir = path.posix.join(ARCHIVE_ROOT, job.periodKey, `v${version}`);
  const pdfFilename = `${stem}.pdf`;
  const previewFilename = `${stem}-preview.jpg`;
  const pdfRelativePath = path.posix.join(relativeDir, pdfFilename);
  const previewRelativePath = path.posix.join(relativeDir, previewFilename);
  return {
    version,
    pdfFilename,
    previewFilename,
    pdfRelativePath,
    previewRelativePath,
    pdfUrl: `${PUBLIC_SITE_BASE_URL}/${pdfRelativePath}`,
    previewUrl: `${PUBLIC_SITE_BASE_URL}/${previewRelativePath}`
  };
}

function validateJob(job) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(job.periodKey || "")) throw new Error("Invalid bulletin period.");
  if (!String(job.periodLabel || "").trim() || String(job.periodLabel).length > 40) throw new Error("Invalid bulletin period label.");
  if (job.action === "delete") return { action: "delete" };
  if (job.action !== "send") throw new Error("Invalid Slack action.");
  if (!/^fo-monthly-bulletin-[0-9]{4}-(0[1-9]|1[0-2])\.pdf$/.test(job.filename || "")) {
    throw new Error("Invalid PDF filename.");
  }
  if (!/^fo-monthly-bulletin-[0-9]{4}-(0[1-9]|1[0-2])-preview\.jpg$/.test(job.previewFilename || "")) {
    throw new Error("Invalid preview filename.");
  }
  const pdf = Buffer.from(job.pdfBase64 || "", "base64");
  if (!pdf.length || pdf.length > MAX_PDF_BYTES || pdf.length !== Number(job.pdfBytes) ||
      pdf.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("The queued attachment is not a valid PDF.");
  }
  const preview = Buffer.from(job.previewBase64 || "", "base64");
  if (!preview.length || preview.length > MAX_PREVIEW_BYTES || preview.length !== Number(job.previewBytes) ||
      preview[0] !== 0xff || preview[1] !== 0xd8 || preview[2] !== 0xff) {
    throw new Error("The queued bulletin preview is not a valid JPEG image.");
  }
  return { action: "send", pdf, preview };
}

async function writeArchiveAssets(archive, assets) {
  const pdfPath = path.resolve(archive.pdfRelativePath);
  const previewPath = path.resolve(archive.previewRelativePath);
  const archiveRootPath = `${path.resolve(ARCHIVE_ROOT)}${path.sep}`;
  if (!pdfPath.startsWith(archiveRootPath) || !previewPath.startsWith(archiveRootPath)) {
    throw new Error("Invalid archive destination.");
  }
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, assets.pdf);
  await writeFile(previewPath, assets.preview);
}

function buildSlackPayload(job, archive) {
  const pdfLink = `📄 *PDF:* <${archive.pdfUrl}|${archive.pdfFilename}>`;
  return {
    channel: CHANNEL_ID,
    text: `${MESSAGE.replaceAll("*", "")}\n\nPDF: ${archive.pdfUrl}`,
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${MESSAGE}\n\n${pdfLink}` }
      },
      {
        type: "image",
        image_url: archive.previewUrl,
        alt_text: `FO Monthly Bulletin for ${job.periodLabel}`,
        title: { type: "plain_text", text: archive.pdfFilename, emoji: true }
      }
    ]
  };
}

async function postArchiveMessage(job, archive, token) {
  const result = await slackApi("chat.postMessage", buildSlackPayload(job, archive), token);
  if (!result.ts) throw new Error("Slack did not return a message timestamp.");
  return { messageTs: result.ts };
}

async function deleteDelivery(delivery, token) {
  if (!delivery.messageTs) throw new Error("The stored Slack post has no message timestamp.");
  try {
    await slackApi("chat.delete", { channel: CHANNEL_ID, ts: delivery.messageTs }, token);
  } catch (error) {
    if (error.slackCode !== "message_not_found") throw error;
  }
}

async function waitForPublicAsset(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { cache: "no-store" }).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`The published archive is not reachable yet: ${url}`);
}

async function processDelete(store, job) {
  const state = await store.periodState(job.periodKey);
  const delivery = state.deliveries
    .filter((item) => item.status === "success")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!delivery) {
    await store.finish(job.path, "rejected", { message: "There is no Slack post to delete for this month." });
    return;
  }
  await deleteDelivery(delivery, slackToken());
  await store.markDeleted(delivery);
  await store.finish(job.path, "succeeded", { message: "Last Slack post deleted; its public archive was kept." });
}

async function prepareJob(store, listedJob) {
  let job = listedJob;
  if (job.status === "queued") {
    job = await store.claim(job.path);
    if (!job) return;
  }

  try {
    const assets = validateJob(job);
    if (job.action === "delete") {
      await processDelete(store, job);
      return;
    }

    const state = await store.periodState(job.periodKey);
    const existingDelivery = state.deliveries.find((delivery) => delivery.jobPath === job.path && delivery.status === "success");
    if (existingDelivery) {
      await store.finish(job.path, "succeeded", {
        successfulSends: state.successfulSends,
        message: "Sent to Slack."
      });
      return;
    }
    if (state.successfulSends >= MAX_SENDS) {
      await store.finish(job.path, "rejected", { message: "The monthly Slack limit of 3 successful sends has been reached." });
      return;
    }

    const version = job.status === "prepared" ? Number(job.archiveVersion) : state.successfulSends + 1;
    if (version !== state.successfulSends + 1) {
      throw new Error("The prepared archive version is no longer available. Queue the bulletin again.");
    }
    const archive = archiveFor(job, version);
    await writeArchiveAssets(archive, assets);
    if (job.status !== "prepared") await store.markPrepared(job.path, archive);
    await writeFile(PLAN_PATH, `${JSON.stringify({ jobPath: job.path, version }, null, 2)}\n`, "utf8");
    console.log(`Prepared ${archive.pdfRelativePath} and ${archive.previewRelativePath}.`);
  } catch (error) {
    console.error(`Job ${job.path} failed during preparation: ${error.message}`);
    await store.finish(job.path, error.code === "MONTHLY_LIMIT" ? "rejected" : "failed", {
      message: error.message.slice(0, 300)
    });
  }
}

async function prepareMain() {
  await rm(PLAN_PATH, { force: true });
  const store = new Firestore(parseServiceAccount());
  const jobs = await store.jobs();
  console.log(`Found ${jobs.length} queued or prepared Slack request(s).`);
  if (jobs[0]) await prepareJob(store, jobs[0]);
}

async function finalizeMain() {
  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8"));
  const store = new Firestore(parseServiceAccount());
  const job = await store.decoded(plan.jobPath);
  if (!job || job.status !== "prepared") throw new Error("The prepared Slack job could not be found.");
  validateJob(job);
  const archive = archiveFor(job, Number(plan.version));
  await waitForPublicAsset(archive.pdfUrl);
  await waitForPublicAsset(archive.previewUrl);

  const state = await store.periodState(job.periodKey);
  const existingDelivery = state.deliveries.find((delivery) => delivery.jobPath === job.path && delivery.status === "success");
  if (existingDelivery) {
    await store.finish(job.path, "succeeded", { successfulSends: state.successfulSends, message: "Sent to Slack." });
    return;
  }
  if (state.successfulSends !== archive.version - 1) {
    await store.finish(job.path, "rejected", { message: "The monthly archive version changed before Slack delivery." });
    return;
  }

  let posted;
  try {
    posted = await postArchiveMessage(job, archive, slackToken());
    const delivery = {
      ...posted,
      jobPath: job.path,
      channelId: CHANNEL_ID,
      archiveVersion: archive.version,
      filename: archive.pdfFilename,
      pdfUrl: archive.pdfUrl,
      previewUrl: archive.previewUrl,
      periodLabel: job.periodLabel,
      status: "success",
      createdAt: new Date().toISOString()
    };
    const successfulSends = await store.recordDelivery(job.periodKey, delivery);
    await store.finish(job.path, "succeeded", {
      successfulSends,
      pdfUrl: archive.pdfUrl,
      previewUrl: archive.previewUrl,
      message: "Published and sent to Slack."
    });
  } catch (error) {
    if (posted?.messageTs) await deleteDelivery(posted, slackToken()).catch(() => {});
    console.error(`Job ${job.path} failed during Slack delivery: ${error.message}`);
    await store.finish(job.path, error.code === "MONTHLY_LIMIT" ? "rejected" : "failed", {
      message: error.message.slice(0, 300)
    });
  }
}

async function main() {
  const mode = process.argv[2] || "prepare";
  if (mode === "prepare") return prepareMain();
  if (mode === "finalize") return finalizeMain();
  throw new Error("Usage: node actions/process-slack-queue.mjs [prepare|finalize]");
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
  MAX_PREVIEW_BYTES,
  MESSAGE,
  archiveFor,
  buildSlackPayload,
  fromValue,
  toValue,
  validateJob
};
