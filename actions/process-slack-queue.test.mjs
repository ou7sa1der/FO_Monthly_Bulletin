import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_ID,
  MAX_PDF_BYTES,
  MESSAGE,
  findMessageTs,
  fromValue,
  toValue,
  validateJob
} from "./process-slack-queue.mjs";

function validSendJob() {
  const pdf = Buffer.from("%PDF-1.7\nexample");
  return {
    action: "send",
    periodKey: "2026-08",
    periodLabel: "August 2026",
    filename: "fo-monthly-bulletin-2026-08.pdf",
    pdfBytes: pdf.length,
    pdfBase64: pdf.toString("base64")
  };
}

test("uses the fixed test channel and exact bulletin message", () => {
  assert.equal(CHANNEL_ID, "C0AFA7FR5EZ");
  assert.equal(MESSAGE,
    "📋 *Fixtures Operations Monthly Bulletin* is ready!\n\n" +
    "This month's compiled update from every FO team is live — check it out here:\n\n" +
    "Thanks to everyone who contributed this month! 🙌");
});

test("accepts only a valid queued bulletin PDF", () => {
  const job = validSendJob();
  const result = validateJob(job);
  assert.equal(result.subarray(0, 4).toString("ascii"), "%PDF");
  assert.throws(() => validateJob({ ...job, filename: "wrong.pdf" }), /filename/i);
  assert.throws(() => validateJob({
    ...job,
    pdfBytes: MAX_PDF_BYTES + 1,
    pdfBase64: Buffer.alloc(MAX_PDF_BYTES + 1, 1).toString("base64")
  }), /valid PDF/i);
  assert.throws(() => validateJob({ ...job, pdfBytes: job.pdfBytes + 1 }), /valid PDF/i);
});

test("accepts a delete job without a PDF", () => {
  assert.equal(validateJob({
    action: "delete",
    periodKey: "2026-08",
    periodLabel: "August 2026"
  }), undefined);
});

test("finds uploaded file message timestamps for public and private channels", () => {
  assert.equal(findMessageTs({
    shares: { private: { C0AFA7FR5EZ: [{ ts: "123.456" }] } }
  }), "123.456");
  assert.equal(findMessageTs({
    shares: { public: { C0AFA7FR5EZ: [{ ts: "789.012" }] } }
  }), "789.012");
});

test("round-trips Firestore REST values", () => {
  const value = { count: 3, ok: true, labels: ["one", "two"] };
  assert.deepEqual(fromValue(toValue(value)), value);
});
