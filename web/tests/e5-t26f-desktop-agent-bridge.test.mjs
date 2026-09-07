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

test("desktop agent bridge owns controller bytes, negotiates, reconnects, and drains output", async () => {
  const sent = [];
  const decoder = new AgentFrameDecoder();
  let bridge = null;
  const controller = {
    sendAgentInput(bytes) {
      const owned = bytes.slice();
      sent.push(owned);
      decoder.push(owned, (frame) => {
        if (frame.type === TYPE_HELLO) queueMicrotask(() => bridge.receive(helloFrame()));
        if (frame.type === TYPE_PING) {
          const nonce = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
            .getBigUint64(0, true);
          queueMicrotask(() => bridge.receive(pingFrame(TYPE_PONG, nonce)));
        }
      });
      return bytes.byteLength;
    },
  };

  bridge = createDesktopAgentBridge(controller);
  const received = [];
  bridge.channel.subscribe(TYPE_CLIP_SET, (payload) => received.push(payload));
  bridge.start();
  await bridge.channel.ready;
  assert.equal(bridge.channel.state, "ready");
  assert.equal(bridge.stats().negotiatedVersion, 1);

  const callerBytes = Uint8Array.of(1, 2, 3);
  const sentPromise = bridge.channel.send(TYPE_CLIP_SET, callerBytes);
  callerBytes[0] = 99;
  await sentPromise;
  assert.deepEqual([...sent[1].subarray(8)], [1, 2, 3]);

  bridge.receive(encodeFrame(TYPE_CLIP_SET, Uint8Array.of(7, 8)));
  assert.deepEqual([...received[0].payload], [7, 8]);
  assert.equal(bridge.stats().bytesReceived, encodeFrame(TYPE_HELLO, new Uint8Array(10)).byteLength + 10, "received accounting is frame-byte based");

  await bridge.channel.ping(41n);
  const beforeReconnect = bridge.stats().transportGeneration;
  const handshake = await bridge.channel.rehandshake();
  assert.equal(handshake.generation, beforeReconnect + 1);
  assert.equal(bridge.stats().transportGeneration, beforeReconnect + 1);
  assert.equal(bridge.stats().bytesSent > 0, true);
  bridge.close();
});
