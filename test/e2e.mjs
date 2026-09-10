import assert from "node:assert/strict";

const HTTP_BASE = process.env.NANNE_TEST_HTTP ?? "http://127.0.0.1:8787";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws");

function waitForOpen(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket open failed"));
    }, { once: true });
  });
}

function waitForType(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);

    function onMessage(event) {
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (payload.type !== type) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve(payload);
    }

    ws.addEventListener("message", onMessage);
  });
}

async function openClient(roomId) {
  const ws = new WebSocket(`${WS_BASE}/api/rooms/${roomId}/ws`);
  const helloPromise = waitForType(ws, "hello");
  await waitForOpen(ws);
  const hello = await helloPromise;
  return { ws, hello };
}

async function broadcastAndReceive(sender, receivers, text) {
  const pending = receivers.map((client) => waitForType(client.ws, "message"));
  sender.ws.send(JSON.stringify({ type: "message", text }));
  return Promise.all(pending);
}

const landing = await fetch(`${HTTP_BASE}/`);
assert.equal(landing.status, 200);
assert.match(await landing.text(), /なんね？/);

const createResponse = await fetch(`${HTTP_BASE}/api/rooms`, { method: "POST" });
assert.equal(createResponse.status, 201);
const room = await createResponse.json();
assert.match(room.id, /^[a-f0-9]{32}$/);
assert.equal(room.path, `/r/${room.id}`);

const roomPage = await fetch(`${HTTP_BASE}${room.path}`);
assert.equal(roomPage.status, 200);
assert.match(await roomPage.text(), /このURLを相手に渡す/);

const statusResponse = await fetch(`${HTTP_BASE}/api/rooms/${room.id}/status`);
assert.equal(statusResponse.status, 200);
const status = await statusResponse.json();
assert.equal(status.status, "active");
assert.equal(typeof status.expiresAt, "number");
assert.ok(status.expiresAt > Date.now());

const missingResponse = await fetch(`${HTTP_BASE}/api/rooms/${"f".repeat(32)}/status`);
assert.equal(missingResponse.status, 404);

const clientA = await openClient(room.id);
const clientB = await openClient(room.id);
assert.notEqual(clientA.hello.clientId, clientB.hello.clientId);
assert.deepEqual(clientA.hello.messages, []);
assert.deepEqual(clientB.hello.messages, []);

const firstDelivery = await broadcastAndReceive(clientA, [clientA, clientB], "なんね？");
assert.equal(firstDelivery[0].message.text, "なんね？");
assert.equal(firstDelivery[1].message.text, "なんね？");
assert.equal(firstDelivery[0].message.id, firstDelivery[1].message.id);
assert.equal(firstDelivery[0].message.senderId, clientA.hello.clientId);

const secondDelivery = await broadcastAndReceive(clientB, [clientA, clientB], "どうしたん？");
assert.equal(secondDelivery[0].message.text, "どうしたん？");
assert.equal(secondDelivery[1].message.text, "どうしたん？");
assert.equal(secondDelivery[0].message.id, secondDelivery[1].message.id);
assert.equal(secondDelivery[0].message.senderId, clientB.hello.clientId);

clientB.ws.close(1000, "reconnect test");
const clientC = await openClient(room.id);
assert.deepEqual(
  clientC.hello.messages.map((message) => message.text),
  ["なんね？", "どうしたん？"],
);

clientA.ws.close(1000, "test complete");
clientC.ws.close(1000, "test complete");

console.log("Local Worker integration test passed");
