// E5-T26f — the live worker-safe controller seam feeds the T23d Channel without borrowed bytes.

import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentFrameDecoder,
  CAP_PING,
  encodeFrame,
  TYPE_CLIP_SET,
  TYPE_HELLO,
  TYPE_PING,
  TYPE_PONG,
} from "../agent-channel.js";
import { createDesktopAgentBridge } from "../desktop-agent-bridge.js";

function helloFrame() {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 1, true);
  view.setBigUint64(2, CAP_PING, true);
  return encodeFrame(TYPE_HELLO, payload);
}

function pingFrame(type, nonce) {
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setBigUint64(0, BigInt(nonce), true);
  return encodeFrame(type, payload);
}

test("desktop agent bridge owns queued guest bytes, negotiates, reconnects, and drains output", async () => {
  const retainedByController = [];
  const decoder = new AgentFrameDecoder();
  let bridge = null;
  const controller = {
    sendAgentInput(bytes) {
      // This fixture deliberately retains the exact view supplied by the bridge and only reads it
      // on a later task. The frame encoder owns Channel.send's caller payload; the bridge-specific
      // ownership boundary is exercised below by a guest frame queued before Channel.start().
      retainedByController.push(bytes);
      return new Promise((resolve) => queueMicrotask(() => {
        decoder.push(bytes, (frame) => {
          if (frame.type === TYPE_HELLO) queueMicrotask(() => bridge.receive(helloFrame()));
          if (frame.type === TYPE_PING) {
            const nonce = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
              .getBigUint64(0, true);
            queueMicrotask(() => bridge.receive(pingFrame(TYPE_PONG, nonce)));
          }
        });
        resolve(bytes.byteLength);
      }));
    },
  };

  bridge = createDesktopAgentBridge(controller);
  const received = [];
  const helloCapabilities = [];
  bridge.channel.subscribe(TYPE_HELLO, ({ payload }) => {
    helloCapabilities.push(new DataView(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    ).getBigUint64(2, true));
  });
  bridge.channel.subscribe(TYPE_CLIP_SET, (payload) => received.push(payload));
  const queuedHello = helloFrame();
  bridge.receive(queuedHello);
  new DataView(queuedHello.buffer, queuedHello.byteOffset, queuedHello.byteLength)
    .setBigUint64(10, 0n, true);
  bridge.start();
  await bridge.channel.ready;
  assert.equal(bridge.channel.state, "ready");
  assert.equal(bridge.stats().negotiatedVersion, 1);
  assert.equal(helloCapabilities[0], CAP_PING,
    "queued guest HELLO was borrowed instead of copied before Channel.start");

  await bridge.channel.send(TYPE_CLIP_SET, Uint8Array.of(1, 2, 3));
  assert.deepEqual([...retainedByController[1].subarray(8)], [1, 2, 3]);

  const directClip = encodeFrame(TYPE_CLIP_SET, Uint8Array.of(7, 8));
  bridge.receive(directClip);
  assert.deepEqual([...received[0].payload], [7, 8]);
  assert.equal(
    bridge.stats().bytesReceived,
    queuedHello.byteLength + helloFrame().byteLength + directClip.byteLength,
    "received accounting is frame-byte based",
  );

  await bridge.channel.ping(41n);
  const beforeReconnect = bridge.stats().transportGeneration;
  const handshake = await bridge.channel.rehandshake();
  assert.equal(handshake.generation, beforeReconnect + 1);
  assert.equal(bridge.stats().transportGeneration, beforeReconnect + 1);
  assert.equal(bridge.stats().bytesSent > 0, true);
  bridge.close();
});
