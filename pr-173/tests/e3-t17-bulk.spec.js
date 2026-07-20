import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = path.resolve(WEB, "../evidence/e3-t17");

const CONTROL_URL = process.env.E3_T17_CONTROL_URL ?? "";
const AUTH_KEY = process.env.E3_T17_AUTH_KEY ?? "";
const PEER_IP = process.env.E3_T17_PEER_IP ?? "";
const BULK_PORT = Number(process.env.E3_T17_BULK_PORT ?? 0);
const HTTP_PORT = Number(process.env.E3_T17_PEER_PORT ?? 0);
const GIB = 1024 * 1024 * 1024;
const BULK_BYTES = Number(process.env.E3_T17_BULK_BYTES ?? GIB);
const EXPECTED_SHA256 = process.env.E3_T17_BULK_SHA256 ??
  "2c06ade942ee3f17a048dd1064b2fab046a4bb95386d8bb41b68dc6711ac2af3";

test("E3-T17 carries a SHA-exact 1 GiB stream while a stalled reader stays bounded", async ({ page }) => {
  test.skip(!CONTROL_URL || !AUTH_KEY || !PEER_IP || !BULK_PORT || !HTTP_PORT,
    "set the live Headscale fixture environment");
  test.setTimeout(2_700_000);
  await page.goto("/");

  const result = await page.evaluate(async ({
    controlUrl, authKey, peerIp, bulkPort, httpPort, gib,
  }) => {
    const worker = new Worker("./tailscale-worker.js", { type: "module", name: "e3-t17-bulk" });
    const flows = new Map();
    let running = false;
    let hello = false;
    let fatal = null;
    const wake = (flow) => {
      for (const notify of flow.waiters.splice(0)) notify();
    };
    const until = async (predicate, timeoutMs = 30_000) => {
      const started = performance.now();
      while (!predicate()) {
        if (fatal) throw new Error(fatal);
        if (performance.now() - started > timeoutMs) throw new Error("bulk flow timed out");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const frame = (stream, opcode, payload = new Uint8Array()) => {
      const bytes = new Uint8Array(5 + payload.byteLength);
      new DataView(bytes.buffer).setUint32(0, stream, false);
      bytes[4] = opcode;
      bytes.set(payload, 5);
      return bytes;
    };
    const openFrame = (stream, host, port) => {
      const name = new TextEncoder().encode(host);
      const payload = new Uint8Array(3 + name.byteLength);
      payload[0] = name.byteLength;
      payload.set(name, 1);
      new DataView(payload.buffer).setUint16(1 + name.byteLength, port, false);
      return frame(stream, 1, payload);
    };
    const grantFrame = (stream, credit) => {
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, credit, false);
      return frame(stream, 8, payload);
    };
    const post = (bytes) => worker.postMessage({ type: "frame", bytes: bytes.buffer });
    const flow = (stream) => {
      const value = {
        opened: false, failed: false, reset: false, remoteDone: false,
        credit: 0, rxBytes: 0, chunks: [], waiters: [],
      };
      flows.set(stream, value);
      return value;
    };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "failed") fatal = JSON.stringify(message.error);
      if (message?.type === "flowError") fatal = JSON.stringify(message);
      if (message?.type === "status" && message.status?.state === "Running") running = true;
      if (message?.type !== "frame") return;
      const bytes = new Uint8Array(message.bytes);
      const stream = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
      const opcode = bytes[4];
      if (stream === 0 && opcode === 0) {
        hello = true;
        return;
      }
      const current = flows.get(stream);
      if (!current) return;
      if (opcode === 2) current.opened = true;
      if (opcode === 3) current.failed = true;
      if (opcode === 4) {
        const payload = bytes.slice(5);
        current.rxBytes += payload.byteLength;
        current.chunks.push(payload);
      }
      if (opcode === 5 || opcode === 6) current.remoteDone = true;
      if (opcode === 7) current.reset = true;
      if (opcode === 8) current.credit += new DataView(bytes.buffer, bytes.byteOffset).getUint32(5, false);
      wake(current);
    };
    worker.onerror = (event) => { fatal = event.message; };

    try {
      worker.postMessage({
        type: "configure",
        config: {
          wasmUrl: "./tailscale-connect/main.wasm", controlUrl,
          hostname: "wasm-vm-browser-bulk", authKey, state: {}, acceptDns: true,
        },
      });
      await until(() => running, 180_000);
      post(frame(0, 0, Uint8Array.of(1)));
      await until(() => hello);

      const upload = flow(1);
      post(openFrame(1, peerIp, bulkPort));
      await until(() => upload.opened || upload.failed);
      if (upload.failed) throw new Error("bulk upload open failed");
      post(grantFrame(1, 4096));
      const command = new TextEncoder().encode(`UPLOAD ${gib}\n`);
      await until(() => upload.credit >= command.byteLength);
      upload.credit -= command.byteLength;
      post(frame(1, 4, command));

      const block = new Uint8Array(64 * 1024);
      for (let index = 0; index < block.length; index += 1) block[index] = index & 255;
      const started = performance.now();
      let sent = 0;
      while (sent < gib) {
        await until(() => upload.credit >= block.byteLength, 120_000);
        upload.credit -= block.byteLength;
        post(frame(1, 4, block));
        sent += block.byteLength;
      }
      post(frame(1, 5));
      await until(() => upload.remoteDone || upload.reset, 120_000);
      const uploadReply = new TextDecoder().decode(Uint8Array.from(
        upload.chunks.flatMap((chunk) => Array.from(chunk)),
      ));
      const uploadMs = performance.now() - started;

      const stalled = flow(2);
      post(openFrame(2, peerIp, bulkPort));
      await until(() => stalled.opened || stalled.failed);
      post(grantFrame(2, 256 * 1024));
      const download = new TextEncoder().encode("DOWNLOAD 1048576\n");
      await until(() => stalled.credit >= download.byteLength);
      stalled.credit -= download.byteLength;
      post(frame(2, 4, download));
      await until(() => stalled.rxBytes === 256 * 1024, 120_000);
      const stalledBytes = stalled.rxBytes;

      const sibling = flow(3);
      post(openFrame(3, peerIp, httpPort));
      await until(() => sibling.opened || sibling.failed);
      post(grantFrame(3, 64 * 1024));
      const request = new TextEncoder().encode("GET /sibling HTTP/1.1\r\nHost: peer\r\nConnection: close\r\n\r\n");
      await until(() => sibling.credit >= request.byteLength);
      sibling.credit -= request.byteLength;
      post(frame(3, 4, request));
      post(frame(3, 5));
      await until(() => sibling.remoteDone || sibling.reset, 30_000);
      const siblingReply = new TextDecoder().decode(Uint8Array.from(
        sibling.chunks.flatMap((chunk) => Array.from(chunk)),
      ));
      post(frame(2, 7));

      const halfClose = flow(4);
      post(openFrame(4, peerIp, bulkPort));
      await until(() => halfClose.opened || halfClose.failed);
      post(grantFrame(4, 4096));
      const halfPayload = new TextEncoder().encode("HALFCLOSE\nproof-after-fin");
      await until(() => halfClose.credit >= halfPayload.byteLength);
      halfClose.credit -= halfPayload.byteLength;
      post(frame(4, 4, halfPayload));
      post(frame(4, 5));
      await until(() => halfClose.remoteDone || halfClose.reset, 30_000);
      const halfCloseReply = new TextDecoder().decode(Uint8Array.from(
        halfClose.chunks.flatMap((chunk) => Array.from(chunk)),
      ));

      return { uploadReply, uploadMs, sent, stalledBytes, siblingReply, halfCloseReply };
    } finally {
      worker.terminate();
    }
  }, {
    controlUrl: CONTROL_URL, authKey: AUTH_KEY, peerIp: PEER_IP,
    bulkPort: BULK_PORT, httpPort: HTTP_PORT, gib: BULK_BYTES,
  });

  expect(result.sent).toBe(BULK_BYTES);
  expect(result.uploadReply.trim()).toBe(`OK ${BULK_BYTES} ${EXPECTED_SHA256}`);
  expect(result.stalledBytes).toBe(256 * 1024);
  expect(result.siblingReply).toContain("wasm-vm-tailnet-fixture");
  expect(result.halfCloseReply).toMatch(/^HALFCLOSE 15 [0-9a-f]{64}\n$/);
  if (BULK_BYTES === GIB) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, "bulk-summary.json"), `${JSON.stringify({
      peerIp: PEER_IP,
      bytes: result.sent,
      sha256: EXPECTED_SHA256,
      uploadMs: result.uploadMs,
      stalledReaderBytes: result.stalledBytes,
      siblingCompleted: result.siblingReply.includes("wasm-vm-tailnet-fixture"),
      halfCloseReply: result.halfCloseReply.trim(),
    }, null, 2)}\n`);
  }
});
