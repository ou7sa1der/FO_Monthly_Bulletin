import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_ID,
  MAX_PDF_BYTES,
  MAX_PREVIEW_BYTES,
  MESSAGE,
  archiveFor,
  buildSlackPayload,
  fromValue,
  toValue,
  validateJob
} from "./process-slack-queue.mjs";

function validSendJob() {
  const pdf = Buffer.from("%PDF-1.7\nexample");
  const preview = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  return {
    action: "send",
    periodKey: "2026-08",
    periodLabel: "August 2026",
    filename: "fo-monthly-bulletin-2026-08.pdf",
    pdfBytes: pdf.length,
    pdfBase64: pdf.toString("base64"),
    previewFilename: "fo-monthly-bulletin-2026-08-preview.jpg",
    previewBytes: preview.length,
    previewBase64: preview.toString("base64")
  };
}

test("uses the fixed test channel and exact bulletin message", () => {
  assert.equal(CHANNEL_ID, "C0AFA7FR5EZ");
  assert.equal(MESSAGE,
    "📋 *Fixtures Operations Monthly Bulletin* is ready!\n\n" +
    "This month's compiled update from every FO team is live — check it out here:\n\n" +
    "Thanks to everyone who contributed this month! 🙌");
});

test("accepts a valid queued PDF and JPEG preview", () => {
  const result = validateJob(validSendJob());
  assert.equal(result.pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.deepEqual([...result.preview.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test("rejects invalid or oversized archive files", () => {
  assert.throws(() => validateJob({ ...validSendJob(), filename: "wrong.pdf" }), /filename/i);
  assert.throws(() => validateJob({
    ...validSendJob(),
    pdfBytes: MAX_PDF_BYTES + 1,
    pdfBase64: Buffer.alloc(MAX_PDF_BYTES + 1, 1).toString("base64")
  }), /valid PDF/i);
  assert.throws(() => validateJob({
    ...validSendJob(),
    previewBytes: MAX_PREVIEW_BYTES + 1,
    previewBase64: Buffer.alloc(MAX_PREVIEW_BYTES + 1, 1).toString("base64")
  }), /valid JPEG/i);
});

test("accepts a delete job without archive files", () => {
  assert.deepEqual(validateJob({
    action: "delete",
    periodKey: "2026-08",
    periodLabel: "August 2026"
  }), { action: "delete" });
});

test("builds stable versioned public archive URLs", () => {
  const archive = archiveFor(validSendJob(), 2);
  assert.equal(archive.pdfRelativePath,
    "bulletins/2026-08/v2/fo-monthly-bulletin-2026-08-v2.pdf");
  assert.equal(archive.previewRelativePath,
    "bulletins/2026-08/v2/fo-monthly-bulletin-2026-08-v2-preview.jpg");
  assert.match(archive.pdfUrl, /FO_Monthly_Bulletin\/bulletins\/2026-08\/v2\/.*\.pdf$/);
});

test("builds a Slack message with a public PDF link and explicit image block", () => {
  const job = validSendJob();
  const archive = archiveFor(job, 1);
  const payload = buildSlackPayload(job, archive);
  assert.equal(payload.channel, CHANNEL_ID);
  assert.equal(payload.unfurl_links, false);
  assert.equal(payload.blocks[1].type, "image");
  assert.equal(payload.blocks[1].image_url, archive.previewUrl);
  assert.match(payload.blocks[0].text.text, new RegExp(archive.pdfFilename));
  assert.match(payload.blocks[0].text.text, new RegExp(archive.pdfUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("round-trips Firestore REST values", () => {
  const value = { count: 3, ok: true, labels: ["one", "two"] };
  assert.deepEqual(fromValue(toValue(value)), value);
});
