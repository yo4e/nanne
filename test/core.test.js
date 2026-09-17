import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY_MESSAGES,
  PARTICIPANT_NAME_STEMS,
  isValidParticipantId,
  isValidRoomId,
  parseClientMessage,
  pickParticipantName,
  trimHistory,
} from "../src/core.js";

test("room id accepts only 32 lowercase hex characters", () => {
  assert.equal(isValidRoomId("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isValidRoomId("0123456789ABCDEF0123456789ABCDEF"), false);
  assert.equal(isValidRoomId("short"), false);
});

test("participant id accepts only 32 lowercase hex characters", () => {
  assert.equal(isValidParticipantId("abcdef0123456789abcdef0123456789"), true);
  assert.equal(isValidParticipantId("ABCDEF0123456789ABCDEF0123456789"), false);
  assert.equal(isValidParticipantId("short"), false);
});

test("participant names use ten animal names before numeric suffixes", () => {
  assert.equal(PARTICIPANT_NAME_STEMS.length, 10);

  const firstGeneration = PARTICIPANT_NAME_STEMS.map((stem) => `${stem}さん`);
  assert.equal(pickParticipantName([], () => 0), "いぬさん");
  assert.equal(pickParticipantName(firstGeneration, () => 0), "いぬ2さん");

  const firstAndSecond = [
    ...firstGeneration,
    ...PARTICIPANT_NAME_STEMS.map((stem) => `${stem}2さん`),
  ];
  assert.equal(pickParticipantName(firstAndSecond, () => 0), "いぬ3さん");
});

test("participant name selection skips names already used in a generation", () => {
  assert.equal(
    pickParticipantName(["いぬさん", "ねこさん"], () => 0),
    "かぴばらさん",
  );
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
