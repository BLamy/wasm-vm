// E5-T23d — deterministic host Channel lifecycle and reconnect proof.
// Run from the repository root with: node --test web/tests/agent-channel.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";

import {
  AgentFrameDecoder,
  BackpressureError,
  CAP_CLIPBOARD,
  CAP_DISPLAY,
  CAP_PING,
  CHANNEL_STATE,
  Channel,
  createMessageTransport,
  DisconnectedError,
  NegotiationError,
  NAK_UNKNOWN_TYPE,
  ProtocolError,
  TYPE_HELLO,
  TYPE_NAK,
  TYPE_PING,
  TYPE_PONG,
  encodeFrame,
} from "../agent-channel.js";

function helloFrame(version = 1, capabilities = CAP_PING) {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  view.setUint16(0, version, true);
  let value = BigInt(capabilities);
  for (let index = 0; index < 8; index += 1) {
    payload[2 + index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return encodeFrame(TYPE_HELLO, payload);
}

function pingFrame(type, nonce) {
  const payload = new Uint8Array(8);
  let value = BigInt(nonce);
  for (let index = 0; index < 8; index += 1) {
    payload[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return encodeFrame(type, payload);
}

function decodeOne(bytes) {
  const decoder = new AgentFrameDecoder();
  const frames = [];
  assert.equal(decoder.push(bytes, (frame) => frames.push(frame)), bytes.byteLength);
  assert.equal(decoder.idle, true);
  assert.equal(frames.length, 1);
  return frames[0];
}

class FakeTransport {
  constructor(name) {
    this.name = name;
    this.closed = false;
    this.sent = [];
    this.closeCalls = 0;
    this.handlers = new Set();
    this.onSend = null;
  }

  send(bytes) {
    if (this.closed) throw new Error(`${this.name} is closed`);
    const copy = bytes.slice();
    this.sent.push(copy);
    this.onSend?.(copy, this);
  }

  subscribe(handlers) {
    this.handlers.add(handlers);
    return () => this.handlers.delete(handlers);
  }

  emit(bytes) {
    for (const handlers of [...this.handlers]) handlers.data?.(bytes.slice());
  }

  remoteClose(reason = new Error(`${this.name} terminated`)) {
    if (this.closed) return;
    this.closed = true;
    for (const handlers of [...this.handlers]) handlers.close?.(reason);
  }

  close() {
    this.closed = true;
    this.closeCalls += 1;
  }

  listenerCount() {
    return this.handlers.size;
  }
}

function connector({ peerVersion = 1, peerCapabilities = CAP_PING, respondPing = null, autoHello = true } = {}) {
  const transports = [];
  const connect = () => {
    const transport = new FakeTransport(`transport-${transports.length + 1}`);
    transports.push(transport);
    transport.onSend = (bytes) => {
      const frame = decodeOne(bytes);
      if (frame.type === TYPE_HELLO && autoHello) {
        transport.emit(helloFrame(peerVersion, peerCapabilities));
      } else if (frame.type === TYPE_PING) {
        const nonce = new DataView(frame.payload.buffer, frame.payload.byteOffset).getBigUint64(0, true);
        respondPing?.(transport, nonce);
      }
    };
    return transport;
  };
  return { connect, transports };
}

async function eventually(predicate, message = "condition did not become true") {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("Channel is not ready until HELLO intersects, then correlates reverse-order PONGs", async () => {
  const h = connector({ peerCapabilities: CAP_PING | CAP_CLIPBOARD, autoHello: false });
  const channel = new Channel({
    connect: h.connect,
    version: 2,
    capabilities: CAP_PING | CAP_DISPLAY,
    reconnect: false,
  });
  channel.start();
  await eventually(() => channel.state === CHANNEL_STATE.HANDSHAKING);
  assert.equal(channel.negotiated, null);
  await assert.rejects(channel.send(0x400, new Uint8Array()), (error) => {
    assert.ok(error instanceof DisconnectedError);
    assert.equal(error.code, "DISCONNECTED");
    return true;
  });

  h.transports[0].emit(helloFrame(1, CAP_PING | CAP_CLIPBOARD));
  await channel.ready;
  assert.equal(channel.state, CHANNEL_STATE.READY);
  assert.equal(channel.negotiatedVersion, 1, "down-level peers use the lower common version");
  assert.equal(channel.negotiatedCapabilities, CAP_PING);
  assert.equal(channel.supports(CAP_PING), true);
  assert.equal(channel.supports(CAP_CLIPBOARD), false);

  const first = channel.ping(0x0102n);
  const second = channel.ping(0x0304n);
  await eventually(() => h.transports[0].sent.filter((bytes) => decodeOne(bytes).type === TYPE_PING).length === 2);
  h.transports[0].emit(pingFrame(TYPE_PONG, 0x0304n));
  h.transports[0].emit(pingFrame(TYPE_PONG, 0x0102n));
  assert.equal(await first, 0x0102n);
  assert.equal(await second, 0x0304n);
  assert.equal(channel.pendingCount, 0);
  channel.close();
});

test("unknown frames are NAKed without killing the session and subscriptions are typed", async () => {
  const h = connector();
  const channel = new Channel({ connect: h.connect, reconnect: false });
  const seen = [];
  const unsubscribe = channel.subscribe(0x900, (frame) => seen.push([...frame.payload]));
  channel.start();
  await channel.ready;

  h.transports[0].emit(encodeFrame(0x901, Uint8Array.of(7, 8)));
  await eventually(() => h.transports[0].sent.some((bytes) => decodeOne(bytes).type === TYPE_NAK));
  const nak = decodeOne(h.transports[0].sent.find((bytes) => decodeOne(bytes).type === TYPE_NAK));
  assert.deepEqual([...nak.payload], [0x01, 0x09, 0x01, 0x00], "NAK carries rejected type and unknown code in LE");

  h.transports[0].emit(encodeFrame(0x900, Uint8Array.of(1, 2, 3)));
  assert.deepEqual(seen, [[1, 2, 3]]);
  assert.equal(channel.listenerCount(0x900), 1);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(channel.listenerCount(), 0);
  assert.equal(channel.state, CHANNEL_STATE.READY, "unknown traffic is not a disconnect");
  channel.close();
});

test("termination rejects each in-flight PING once, exposes the gap, and reconnects cleanly", async () => {
  const h = connector();
  const channel = new Channel({
    connect: h.connect,
    reconnectMinDelayMs: 0,
    reconnectMaxDelayMs: 0,
    pingTimeoutMs: 0,
  });
  const delivered = [];
  channel.subscribe(0x910, (frame) => delivered.push([...frame.payload]));
  channel.start();
  await channel.ready;
  const first = channel.ping(11n);
  const second = channel.ping(22n);
  await eventually(() => h.transports[0].sent.filter((bytes) => decodeOne(bytes).type === TYPE_PING).length === 2);

  const observed = [first, second].map((promise) => promise.then(
    () => "resolved",
    (error) => error,
  ));
  const reconnectReady = (() => {
    h.transports[0].remoteClose();
    return channel.waitUntilReady();
  })();
  await assert.rejects(channel.send(0x910, Uint8Array.of(4)), (error) => error instanceof DisconnectedError);
  const errors = await Promise.all(observed);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error instanceof DisconnectedError));
  assert.equal(channel.pendingCount, 0);

  await reconnectReady;
  assert.equal(h.transports.length, 2);
  assert.equal(channel.state, CHANNEL_STATE.READY);
  assert.equal(h.transports[0].listenerCount(), 0, "old transport listener is removed");
  assert.equal(h.transports[1].listenerCount(), 1, "exactly one listener is installed after reconnect");
  assert.equal(channel.listenerCount(0x910), 1, "user subscription survives exactly once");
  h.transports[0].emit(encodeFrame(0x910, Uint8Array.of(99)));
  h.transports[1].emit(encodeFrame(0x910, Uint8Array.of(5)));
  assert.deepEqual(delivered, [[5]], "late data from a dead generation is ignored");
  channel.close();
});

test("a transport killed during HELLO is discarded and the next generation re-negotiates", async () => {
  const h = connector({ autoHello: false });
  const channel = new Channel({
    connect: h.connect,
    reconnectMinDelayMs: 0,
    reconnectMaxDelayMs: 0,
    handshakeTimeoutMs: 200,
  });
  channel.start();
  await eventually(() => channel.state === CHANNEL_STATE.HANDSHAKING);
  const first = h.transports[0];
  first.remoteClose(new Error("agent exited before HELLO"));
  await eventually(() => h.transports.length === 2, "reconnect attempt did not start");
  assert.equal(first.listenerCount(), 0);
  h.transports[1].emit(helloFrame(1, CAP_PING));
  await channel.ready;
  assert.equal(channel.state, CHANNEL_STATE.READY);
  assert.equal(h.transports[1].listenerCount(), 1);
  channel.close();
});

test("10,000 PING attempts are backpressured at the pending bound", async () => {
  const h = connector();
  const channel = new Channel({
    connect: h.connect,
    reconnect: false,
    maxPending: 64,
    pingTimeoutMs: 0,
  });
  channel.start();
  await channel.ready;
  const attempts = [];
  for (let nonce = 1n; nonce <= 10_000n; nonce += 1n) attempts.push(channel.ping(nonce));
  assert.equal(channel.pendingCount, 64);
  assert.ok(channel.pendingCount <= channel.maxPending);
  channel.close();
  const results = await Promise.allSettled(attempts);
  const backpressured = results.filter((result) => result.status === "rejected" && result.reason instanceof BackpressureError);
  const disconnected = results.filter((result) => result.status === "rejected" && result.reason instanceof DisconnectedError);
  assert.equal(backpressured.length, 9_936);
  assert.equal(disconnected.length, 64);
  assert.equal(channel.pendingCount, 0);
});

test("stale HELLO and no-common-version peers fail explicitly", async () => {
  const h = connector({ peerVersion: 0 });
  const channel = new Channel({ connect: h.connect, reconnect: false });
  channel.start();
  await eventually(() => channel.state === CHANNEL_STATE.DISCONNECTED);
  assert.ok(channel.lastError instanceof NegotiationError);
  assert.equal(channel.lastError.code, "NO_COMMON_VERSION");
  await assert.rejects(channel.ping(1n), (error) => error instanceof DisconnectedError);
  channel.close();

  const stable = connector();
  const second = new Channel({ connect: stable.connect, reconnect: false });
  second.start();
  await second.ready;
  stable.transports[0].emit(helloFrame(0, CAP_PING));
  await eventually(() => second.state === CHANNEL_STATE.DISCONNECTED);
  assert.ok(second.lastError instanceof ProtocolError);
  assert.equal(second.lastError.code, "STALE_HELLO");
  second.close();
});

test("100 reconnect cycles keep one transport listener and one user subscription", async () => {
  const h = connector();
  const channel = new Channel({
    connect: h.connect,
    reconnectMinDelayMs: 0,
    reconnectMaxDelayMs: 0,
    pingTimeoutMs: 0,
  });
  const unsubscribe = channel.subscribe(0x920, () => {});
  channel.start();
  await channel.ready;
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const old = h.transports.at(-1);
    old.remoteClose();
    const ready = channel.waitUntilReady();
    await ready;
    assert.equal(old.listenerCount(), 0, `old listener at cycle ${cycle}`);
    assert.equal(channel.transportListenerCount, 1, `active listener at cycle ${cycle}`);
    assert.equal(channel.listenerCount(0x920), 1, `user subscription at cycle ${cycle}`);
  }
  assert.equal(h.transports.length, 101);
  assert.equal(channel.state, CHANNEL_STATE.READY);
  assert.equal(unsubscribe(), true);
  channel.close();
});

test("decoder stays bounded across dribble/coalescing and rejects oversized lengths before allocation", () => {
  const one = encodeFrame(TYPE_PONG, Uint8Array.of(1, 2, 3));
  const two = encodeFrame(TYPE_PING, Uint8Array.of(4, 5, 6, 7, 8, 9, 10, 11));
  const decoder = new AgentFrameDecoder();
  const frames = [];
  const joined = new Uint8Array(one.byteLength + two.byteLength);
  joined.set(one);
  joined.set(two, one.byteLength);
  for (const byte of joined) decoder.push(Uint8Array.of(byte), (frame) => frames.push(frame));
  assert.deepEqual(frames.map((frame) => frame.type), [TYPE_PONG, TYPE_PING]);
  assert.equal(decoder.pendingBytes, 0);

  const oversized = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0);
  assert.throws(() => decoder.push(oversized), (error) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, "PAYLOAD_TOO_LARGE");
    return true;
  });
  assert.equal(decoder.payloadCapacity, 0);
  decoder.push(one, (frame) => frames.push(frame));
  assert.equal(frames.at(-1).type, TYPE_PONG);

  const truncated = new AgentFrameDecoder();
  truncated.push(one.subarray(0, one.byteLength - 1));
  assert.throws(() => truncated.finish(), (error) => error.code === "TRUNCATED");
  truncated.reset();
  assert.equal(truncated.idle, true);
});

test("malformed PING during a live session disconnects instead of guessing at framing", async () => {
  const h = connector();
  const channel = new Channel({ connect: h.connect, reconnect: false });
  channel.start();
  await channel.ready;
  h.transports[0].emit(encodeFrame(TYPE_PING, Uint8Array.of(1, 2, 3)));
  await eventually(() => channel.state === CHANNEL_STATE.DISCONNECTED);
  assert.ok(channel.lastError instanceof ProtocolError);
  assert.equal(channel.lastError.code, "PING_LENGTH");
  channel.close();
});

test("MessagePort transport adapter runs the same Channel in a worker-safe endpoint", async () => {
  const { port1, port2 } = new MessageChannel();
  port2.on("message", (bytes) => {
    const frame = decodeOne(bytes);
    if (frame.type === TYPE_HELLO) port2.postMessage(helloFrame(1, CAP_PING));
    if (frame.type === TYPE_PING) {
      const nonce = new DataView(frame.payload.buffer, frame.payload.byteOffset).getBigUint64(0, true);
      port2.postMessage(pingFrame(TYPE_PONG, nonce));
    }
  });
  const channel = new Channel({ transport: createMessageTransport(port1), reconnect: false });
  channel.start();
  await channel.ready;
  assert.equal(await channel.ping(0xfeedn), 0xfeedn);
  channel.close();
  port2.close();
});
