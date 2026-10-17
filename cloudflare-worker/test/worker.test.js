import test from "node:test";
import assert from "node:assert/strict";

import {
  FILENAME_RE,
  MAX_PDF_BYTES,
  MAX_SENDS,
  MAX_SLACK_MESSAGE_CHARS,
  PERIOD_RE,
  corsHeaders,
  findMessageTs,
  validatePeriod,
  validateSlackMessage
} from "../src/index.js";

test("fixed bulletin constraints are configured", () => {
  assert.equal(MAX_SENDS, 3);
  assert.equal(MAX_PDF_BYTES, 5 * 1024 * 1024);
  assert.match("2026-09", PERIOD_RE);
  assert.doesNotMatch("September-2026", PERIOD_RE);
  assert.match("fo-monthly-bulletin-2026-09.pdf", FILENAME_RE);
  assert.doesNotMatch("other.pdf", FILENAME_RE);
});

test("Slack message is supplied by the frontend and validated", () => {
  assert.equal(validateSlackMessage("  Monthly bulletin 🚀\r\nReady  "), "Monthly bulletin 🚀\nReady");
  assert.throws(() => validateSlackMessage("   "), /required/);
  assert.throws(() => validateSlackMessage("x".repeat(MAX_SLACK_MESSAGE_CHARS + 1)), /under 3000/);
});

test("message timestamp is read from the fixed channel shares", () => {
  const file = { shares: { private: { C0AFA7FR5EZ: [{ ts: "123.456" }] } } };
  assert.equal(findMessageTs(file, "C0AFA7FR5EZ"), "123.456");
  assert.equal(findMessageTs(file, "OTHER"), null);
});

test("CORS headers use the configured GitHub Pages origin", () => {
  const headers = corsHeaders("https://ou7sa1der.github.io", "https://ou7sa1der.github.io");
  assert.equal(headers["Access-Control-Allow-Origin"], "https://ou7sa1der.github.io");
  assert.match(headers["Access-Control-Allow-Headers"], /X-Turnstile-Token/);
});

test("period validation rejects invalid values", () => {
  assert.doesNotThrow(() => validatePeriod("2026-09", "September 2026"));
  assert.throws(() => validatePeriod("2026-13", "September 2026"), /Invalid bulletin period/);
  assert.throws(() => validatePeriod("2026-09", ""), /Invalid bulletin period label/);
});
