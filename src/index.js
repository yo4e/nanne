import { DurableObject } from "cloudflare:workers";
import {
  MAX_CONNECTIONS,
  MIN_MESSAGE_INTERVAL_MS,
  ROOM_TTL_MS,
  isValidRoomId,
  parseClientMessage,
  trimHistory,
} from "./core.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!sameOrigin(request, url)) {
        return json({ error: "forbidden_origin" }, 403);
      }

      const id = crypto.randomUUID().replaceAll("-", "");
      const room = env.ROOMS.getByName(id);
      const initialized = await room.fetch("https://room.internal/init", {
        method: "POST",
      });

      if (!initialized.ok) {
        return json({ error: "room_init_failed" }, 500);
      }

      return json({ id, path: `/r/${id}` }, 201);
    }

    const statusMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{32})\/status$/);
    if (statusMatch && request.method === "GET") {
      const roomId = statusMatch[1];
      if (!isValidRoomId(roomId)) {
        return json({ error: "invalid_room" }, 400);
      }
      return env.ROOMS.getByName(roomId).fetch("https://room.internal/status");
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{32})\/ws$/);
    if (roomMatch && request.method === "GET") {
      const roomId = roomMatch[1];
      if (!isValidRoomId(roomId)) {
        return json({ error: "invalid_room" }, 400);
      }
      if (!sameOrigin(request, url)) {
        return json({ error: "forbidden_origin" }, 403);
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "websocket_required" }, 426);
      }

      return env.ROOMS.getByName(roomId).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, 404);
    }

    return new Response("Not found", { status: 404 });
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const status = await this.ctx.storage.get("status");
      if (status === "active") return new Response(null, { status: 204 });
      if (status === "expired") return new Response(null, { status: 410 });

      const createdAt = Date.now();
      const expiresAt = createdAt + ROOM_TTL_MS;
      await this.ctx.storage.put({
        status: "active",
        createdAt,
        expiresAt,
        messages: [],
      });
      await this.ctx.storage.setAlarm(expiresAt);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const status = await this.ctx.storage.get("status");
      const expiresAt = await this.ctx.storage.get("expiresAt");

      if (status === "active" && typeof expiresAt === "number") {
        if (Date.now() >= expiresAt) {
          await this.expire(expiresAt);
          return json({ status: "expired", expiresAt }, 410);
        }
        return json({ status: "active", expiresAt });
      }
      if (status === "expired") {
        return json({ status: "expired", expiresAt: expiresAt ?? null }, 410);
      }
      return json({ status: "missing" }, 404);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const status = await this.ctx.storage.get("status");
    const expiresAt = await this.ctx.storage.get("expiresAt");
    if (status !== "active" || typeof expiresAt !== "number") {
      return new Response("Room not found", { status: status === "expired" ? 410 : 404 });
    }
    if (Date.now() >= expiresAt) {
      await this.expire(expiresAt);
      return new Response("Room expired", { status: 410 });
    }
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return new Response("Room is full", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const clientId = crypto.randomUUID();

    server.serializeAttachment({ clientId, lastSentAt: 0 });
    this.ctx.acceptWebSocket(server);

    const messages = (await this.ctx.storage.get("messages")) ?? [];
    server.send(
      JSON.stringify({
        type: "hello",
        clientId,
        expiresAt,
        messages,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    const expiresAt = await this.ctx.storage.get("expiresAt");
    if (typeof expiresAt !== "number" || Date.now() >= expiresAt) {
      await this.expire(typeof expiresAt === "number" ? expiresAt : Date.now());
      return;
    }

    const attachment = ws.deserializeAttachment() ?? {
      clientId: crypto.randomUUID(),
      lastSentAt: 0,
    };
    const now = Date.now();

    if (now - attachment.lastSentAt < MIN_MESSAGE_INTERVAL_MS) {
      ws.send(JSON.stringify({ type: "error", error: "too_fast" }));
      return;
    }

    const parsed = parseClientMessage(rawMessage);
    if (!parsed.ok) {
      ws.send(JSON.stringify({ type: "error", error: parsed.error }));
      return;
    }

    attachment.lastSentAt = now;
    ws.serializeAttachment(attachment);

    const message = {
      id: crypto.randomUUID(),
      senderId: attachment.clientId,
      text: parsed.text,
      sentAt: now,
    };

    const currentMessages = (await this.ctx.storage.get("messages")) ?? [];
    const messages = trimHistory([...currentMessages, message]);
    await this.ctx.storage.put("messages", messages);

    const payload = JSON.stringify({ type: "message", message });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {}
    }
  }

  async webSocketClose(ws) {
    try {
      ws.close();
    } catch {}
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, "WebSocket error");
    } catch {}
  }

  async alarm() {
    const expiresAt = await this.ctx.storage.get("expiresAt");
    await this.expire(typeof expiresAt === "number" ? expiresAt : Date.now());
  }

  async expire(expiresAt) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(4000, "Room expired");
      } catch {}
    }

    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put({
      status: "expired",
      expiresAt,
    });
  }
}
