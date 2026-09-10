const landing = document.querySelector("#landing");
const roomView = document.querySelector("#room");
const notFound = document.querySelector("#not-found");
const createButton = document.querySelector("#create-room");
const createError = document.querySelector("#create-error");
const statusEl = document.querySelector("#status");
const inviteUrl = document.querySelector("#invite-url");
const copyButton = document.querySelector("#copy-url");
const expiresEl = document.querySelector("#expires");
const messagesEl = document.querySelector("#messages");
const composer = document.querySelector("#composer");
const input = document.querySelector("#message-input");
const counter = document.querySelector("#counter");
const sendButton = document.querySelector("#send");
const roomError = document.querySelector("#room-error");

const ROOM_RE = /^\/r\/([a-f0-9]{32})\/?$/;
const roomMatch = location.pathname.match(ROOM_RE);
let socket = null;
let clientId = null;
let expiresAt = null;
let reconnectTimer = null;
let intentionallyClosed = false;

function show(element) {
  element.hidden = false;
}

function hide(element) {
  element.hidden = true;
}

function setError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function appendMessage(message) {
  if (!message || typeof message.text !== "string") return;

  const item = document.createElement("article");
  item.className = "message";
  if (message.senderId === clientId) item.classList.add("own");

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${message.senderId === clientId ? "あなた" : "だれか"} · ${formatTime(message.sentAt)}`;

  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = message.text;

  item.append(meta, body);
  messagesEl.append(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderHistory(messages) {
  messagesEl.replaceChildren();
  for (const message of messages ?? []) appendMessage(message);
}

function updateExpiry() {
  if (!expiresAt) {
    expiresEl.textContent = "";
    return;
  }
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    expiresEl.textContent = "この部屋は期限切れです。";
    return;
  }
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  expiresEl.textContent = `あと約 ${hours}時間${minutes}分 で消えます`;
}

function setConnectionState(state) {
  statusEl.dataset.state = state;
  const labels = {
    connecting: "接続しています…",
    open: "つながった",
    retrying: "再接続しています…",
    closed: "切断しました",
    expired: "期限切れ",
  };
  statusEl.textContent = labels[state] ?? state;
  const writable = state === "open";
  input.disabled = !writable;
  sendButton.disabled = !writable;
}

function websocketUrl(roomId) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/rooms/${roomId}/ws`;
}

function scheduleReconnect(roomId) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(roomId), 1500);
}

async function checkRoom(roomId) {
  const response = await fetch(`/api/rooms/${roomId}/status`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function connect(roomId) {
  clearTimeout(reconnectTimer);
  intentionallyClosed = false;
  setConnectionState("connecting");
  setError(roomError);

  try {
    const { response, data } = await checkRoom(roomId);
    if (response.status === 410) {
      intentionallyClosed = true;
      expiresAt = data.expiresAt ?? null;
      updateExpiry();
      setConnectionState("expired");
      setError(roomError, "この部屋は消えました。新しい部屋を作ってください。");
      return;
    }
    if (response.status === 404) {
      intentionallyClosed = true;
      setConnectionState("closed");
      setError(roomError, "この部屋は見つかりませんでした。URLを確認してください。");
      return;
    }
    if (!response.ok || data.status !== "active") {
      throw new Error("room status failed");
    }
    expiresAt = data.expiresAt;
    updateExpiry();
  } catch {
    if (document.visibilityState === "hidden") {
      setConnectionState("closed");
      return;
    }
    setConnectionState("retrying");
    setError(roomError, "接続がうまくいっていません。再接続を試します。");
    scheduleReconnect(roomId);
    return;
  }

  const ws = new WebSocket(websocketUrl(roomId));
  socket = ws;

  ws.addEventListener("open", () => {
    setConnectionState("open");
  });

  ws.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "hello") {
      clientId = payload.clientId;
      expiresAt = payload.expiresAt;
      renderHistory(payload.messages);
      updateExpiry();
      return;
    }

    if (payload.type === "message") {
      appendMessage(payload.message);
      return;
    }

    if (payload.type === "error") {
      const messages = {
        too_fast: "少し速すぎるみたい。ほんの一瞬あけて送ってください。",
        message_too_long: "メッセージは1000文字までです。",
        empty_message: "何か書いてから送ってください。",
      };
      setError(roomError, messages[payload.error] ?? "メッセージを送れませんでした。");
    }
  });

  ws.addEventListener("close", (event) => {
    if (socket === ws) socket = null;

    if (event.code === 4000) {
      intentionallyClosed = true;
      setConnectionState("expired");
      setError(roomError, "この部屋は消えました。新しい部屋を作ってください。");
      return;
    }

    if (intentionallyClosed || document.visibilityState === "hidden") {
      setConnectionState("closed");
      return;
    }

    setConnectionState("retrying");
    scheduleReconnect(roomId);
  });

  ws.addEventListener("error", () => {
    setError(roomError, "接続がうまくいっていません。再接続を試します。");
  });
}

async function createRoom() {
  createButton.disabled = true;
  setError(createError);

  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("create failed");
    const room = await response.json();
    location.assign(room.path);
  } catch {
    setError(createError, "部屋を作れませんでした。少ししてからもう一度どうぞ。");
    createButton.disabled = false;
  }
}

createButton?.addEventListener("click", createRoom);

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    copyButton.textContent = "コピーした";
    setTimeout(() => {
      copyButton.textContent = "コピー";
    }, 1500);
  } catch {
    inviteUrl.select();
    setError(roomError, "コピーできなかったので、URLを選択しました。");
  }
});

input?.addEventListener("input", () => {
  counter.textContent = `${input.value.length} / 1000`;
});

input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

composer?.addEventListener("submit", (event) => {
  event.preventDefault();
  setError(roomError);
  const text = input.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "message", text }));
  input.value = "";
  counter.textContent = "0 / 1000";
  input.focus();
});

if (location.pathname === "/" || location.pathname === "") {
  show(landing);
  hide(roomView);
  hide(notFound);
} else if (roomMatch) {
  hide(landing);
  show(roomView);
  hide(notFound);
  inviteUrl.value = location.href;
  setConnectionState("connecting");
  connect(roomMatch[1]);
  setInterval(updateExpiry, 60 * 1000);
} else {
  hide(landing);
  hide(roomView);
  show(notFound);
}

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    roomMatch &&
    !socket &&
    !intentionallyClosed
  ) {
    connect(roomMatch[1]);
  }
});

addEventListener("beforeunload", () => {
  intentionallyClosed = true;
  clearTimeout(reconnectTimer);
  socket?.close(1000, "Page closed");
});
