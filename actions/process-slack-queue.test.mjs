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

test("uses the fixed test channel and exact bulletin message", () => {
  assert.equal(CHANNEL_ID, "C0AFA7FR5EZ");
  assert.equal(MESSAGE,
    "📋 *Fixtures Operations Monthly Bulletin* is ready!\n\n" +
    "This month's compiled update from every FO team is live — check it out here:\n\n" +
    "Thanks to everyone who contributed this month! 🙌");
});

test("accepts only a valid queued bulletin PDF", () => {
  const pdf = Buffer.from("%PDF-1.7\nexample");
  const result = validateJob({
    action: "send",
    periodKey: "2026-08",
    periodLabel: "August 2026",
    filename: "fo-monthly-bulletin-2026-08.pdf",
    pdfBase64: pdf.toString("base64")
  });
  assert.deepEqual(result, pdf);
  assert.throws(() => validateJob({
    action: "send",
    periodKey: "2026-08",
    periodLabel: "August 2026",
    filename: "wrong.pdf",
    pdfBase64: pdf.toString("base64")
  }), /filename/i);
  assert.throws(() => validateJob({
    action: "send",
    periodKey: "2026-08",
    periodLabel: "August 2026",
    filename: "fo-monthly-bulletin-2026-08.pdf",
    pdfBase64: Buffer.alloc(MAX_PDF_BYTES + 1, 1).toString("base64")
  }), /valid PDF/i);
});

test("accepts a delete job without a PDF", () => {
  assert.equal(validateJob({
    action: "delete",
    periodKey: "2026-08",
    periodLabel: "August 2026"
  }), undefined);
});

test("finds the uploaded file message timestamp", () => {
  assert.equal(findMessageTs({
    shares: { private: { C0AFA7FR5EZ: [{ ts: "123.456" }] } }
  }), "123.456");
});

test("round-trips Firestore REST values", () => {
  const value = { count: 3, ok: true, labels: ["one", "two"] };
  assert.deepEqual(fromValue(toValue(value)), value);
});
