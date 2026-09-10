import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY_MESSAGES,
  isValidRoomId,
  parseClientMessage,
  trimHistory,
} from "../src/core.js";

test("room id accepts only 32 lowercase hex characters", () => {
  assert.equal(isValidRoomId("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isValidRoomId("0123456789ABCDEF0123456789ABCDEF"), false);
  assert.equal(isValidRoomId("short"), false);
});

test("client message is trimmed and validated", () => {
  assert.deepEqual(parseClientMessage('{"type":"message","text":"  hello  "}'), {
    ok: true,
    text: "hello",
  });
  assert.equal(parseClientMessage('{"type":"message","text":"   "}').ok, false);
  assert.equal(parseClientMessage("not json").ok, false);
});

test("history keeps only the newest messages", () => {
  const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, i) => ({ id: i }));
  const result = trimHistory(messages);
  assert.equal(result.length, MAX_HISTORY_MESSAGES);
  assert.equal(result[0].id, 5);
});
