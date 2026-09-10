export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_HISTORY_MESSAGES = 100;
export const MAX_CONNECTIONS = 8;
export const MIN_MESSAGE_INTERVAL_MS = 300;

const ROOM_ID_RE = /^[a-f0-9]{32}$/;

export function isValidRoomId(value) {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

export function parseClientMessage(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "text_only" };
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  if (!value || value.type !== "message" || typeof value.text !== "string") {
    return { ok: false, error: "invalid_message" };
  }

  const text = value.text.trim();
  if (!text) {
    return { ok: false, error: "empty_message" };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: "message_too_long" };
  }

  return { ok: true, text };
}

export function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
}
