// Post-verdict diagnostics of one owned browser. Never advances the paused guest.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";

export const FAILURE_CHECKPOINT_MS = 180000;
const LIMIT = 2 * 1024 ** 3;
const CHUNK_BYTES = 8 * 1024 ** 2;
export function chunkLength(rawOffset, received, total) {
  assert.equal(rawOffset, String(received), "duplicate or out-of-order RAM chunk");
  assert.ok(received < total, "RAM already complete");
  return Math.min(CHUNK_BYTES, total - received);
}
export function assertFailedInput(report, now = Date.now()) {
  assert.equal(report.mode, "input-trial");
  assert.equal(report.result, "failed");
  assert.equal(report.trial.outcome, "nonce-readback-failed");
  assert.equal(report.trial.readbackMs, 120000);
  assert.ok(report.keyboard.typedAt && !report.keyboard.verified);
  assert.equal(Date.parse(report.keyboard.deadlineAt) - report.keyboard.enteredAtMs, 120000);
  assert.ok(now >= Date.parse(report.keyboard.deadlineAt), "capture cannot precede the input deadline");
  return JSON.stringify({ result: report.result, outcome: report.trial.outcome, keyboard: report.keyboard });
}

export const selectMachineExpression = `function () {
  if (this.length !== 1 || !this[0].__wbg_ptr) throw Error("ambiguous live WasmLinux instances");
  globalThis.__omarchyFailureMachine = this[0];
  return this[0].stateDigest();
}`;

// Code-byte matches are only candidates. The live machine's RAM digest is the authority.
export async function findGuestRam(memory, anchor, anchorOffset, ramBytes, expectedDigest) {
  const bytes = new Uint8Array(memory.buffer), candidates = [];
  for (let index = bytes.indexOf(anchor[0], anchorOffset); index >= 0; index = bytes.indexOf(anchor[0], index + 1)) {
    const start = index - anchorOffset;
    if (start + ramBytes > bytes.length) break;
    if (anchor.every((value, at) => bytes[index + at] === value)) candidates.push(start);
    if (candidates.length > 16) throw Error("ambiguous kernel anchor candidates");
  }
  const matches = [];
  for (const start of candidates) {
    const view = new Uint8Array(memory.buffer, start, ramBytes);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", view)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest === expectedDigest) matches.push(start);
  }
  if (matches.length !== 1) throw Error("no unique RAM region matches live stateDigest");
  return { ramOffset: matches[0], bytes: ramBytes, linearMemoryBytes: memory.buffer.byteLength, candidates };
}

export function snapshotMeter(expected, hash) {
  let length = 0;
  assert.ok(Number.isSafeInteger(expected) && expected >= 1048576 && expected <= LIMIT);
  return new Transform({
    transform(chunk, _encoding, callback) {
      length += chunk.length;
      if (length > expected) { callback(Error("snapshot export exceeds declared size")); return; }
      hash.update(chunk); callback(null, chunk);
    },
    flush(callback) { callback(length === expected ? null : Error("truncated snapshot export")); },
  });
}

function workerCommands(cdp, sessionId) {
  let sequence = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const received = event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id !== id) return;
      cdp.off("Target.receivedMessageFromTarget", received);
      if (message.error) reject(Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) reject(Error(JSON.stringify(message.result.exceptionDetails)));
      else resolve(message.result);
    };
    cdp.on("Target.receivedMessageFromTarget", received);
    cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) })
      .catch(error => { cdp.off("Target.receivedMessageFromTarget", received); reject(error); });
  });
}

export async function pauseFailedInput(page, report) {
  const verdict = assertFailedInput(report);
  report.failureCheckpoint = { startedAt: new Date().toISOString(), timeoutMs: FAILURE_CHECKPOINT_MS,
    inputVerdict: JSON.parse(verdict), status: "capturing", reusablePair: false };
  const receipt = report.failureCheckpoint;
  receipt.deadlineAtMs = Date.now() + FAILURE_CHECKPOINT_MS;
  receipt.pauseRequestedAtMs = Date.now();
  await withinTrialDeadline(() => page.evaluate(() => window.__linux.pause()), receipt.deadlineAtMs, "endpoint pause");
  receipt.pauseAcknowledgedAtMs = Date.now();
  receipt.paused = await page.evaluate(() => window.__linux.isPaused());
  assert.equal(receipt.paused, true);
  assert.equal(assertFailedInput(report), verdict, "capture changed the input verdict");
}

export async function exportFailedInput(page, browser, out, report, { ramBytes = 1024 ** 3,
  anchorOffset = 0x200000, anchor = null } = {}) {
  const receipt = report.failureCheckpoint, verdict = JSON.stringify(receipt.inputVerdict);
  assert.equal(receipt.paused, true);
  let cdp, sessionId, server;
  const abort = new AbortController();
  try {
    await withinTrialDeadline(async () => {
      const origin = new URL(page.url()).origin;
      cdp = await page.context().newCDPSession(page);
      const attachedTargets = [];
      cdp.on("Target.attachedToTarget", event => attachedTargets.push(event));
      await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
      const targets = attachedTargets.filter(({ targetInfo: target }) => target.type === "worker" &&
        new URL(target.url).origin === origin && new URL(target.url).pathname === "/linux-worker.js");
      assert.equal(targets.length, 1, `ambiguous owned Linux worker: ${JSON.stringify(attachedTargets)}`);
      receipt.worker = targets[0].targetInfo;
      ({ sessionId } = targets[0]);
      const command = workerCommands(cdp, sessionId);
      const prototype = await command("Runtime.evaluate", {
        expression: "import('./pkg/wasm_vm_wasm.js').then(m => m.WasmLinux.prototype)", awaitPromise: true,
      });
      assert.ok(prototype.result.objectId, "missing live WasmLinux prototype");
      const objects = await command("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId });
      const digest = await command("Runtime.callFunctionOn", {
        objectId: objects.objects.objectId, functionDeclaration: selectMachineExpression, returnByValue: true,
      });
      const expectedDigest = digest.result.value;
      receipt.digestComputedAt = new Date().toISOString();
      assert.match(expectedDigest, /^[0-9a-f]{64}$/u);
      if (!anchor) {
        const kernel = await fs.readFile(new URL("../../releases/kernel/6.6.63/Image", import.meta.url));
        assert.equal(createHash("sha256").update(kernel).digest("hex"), "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce");
        anchor = [...kernel.subarray(0, 64)];
      }
      const saved = await command("Runtime.evaluate", {
        expression: `(async()=>{const exports=await import('./pkg/wasm_vm_wasm.js').then(m=>m.default());
          const info=await (${findGuestRam.toString()})(exports.memory,${JSON.stringify(anchor)},${anchorOffset},${ramBytes},${JSON.stringify(expectedDigest)});
          globalThis.__omarchyFailureSnapshot=new Uint8Array(exports.memory.buffer,info.ramOffset,info.bytes);return info;})()`,
        awaitPromise: true, returnByValue: true,
      });
      receipt.snapshot = { ...saved.result.value, kind: "raw guest RAM; no current CPU registers or device snapshot",
        stateDigestBefore: expectedDigest, anchor, anchorOffset };
      receipt.regionSelectedAt = new Date().toISOString();
      await fs.writeFile(path.join(out, "checkpoint-progress.json"), JSON.stringify(receipt, null, 2) + "\n");
      const token = `/${randomBytes(24).toString("hex")}`, filename = path.join(out, "failed-input.ram.gz");
      const hash = createHash("sha256");
      let receivedBytes = 0, busy = false;
      const meter = snapshotMeter(receipt.snapshot.bytes, hash);
      const received = pipeline(meter, createGzip({ level: 1 }), createWriteStream(filename, { flags: "wx" }), { signal: abort.signal });
      received.catch(() => {}); // Error is awaited below; never an unhandled rejection.
      server = createServer((request, response) => {
        if (!request.url.startsWith(`${token}/`) || request.headers.origin !== origin) { response.writeHead(403).end(); return; }
        response.setHeader("Access-Control-Allow-Origin", origin);
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "POST");
          response.setHeader("Access-Control-Allow-Headers", "content-type");
          response.setHeader("Access-Control-Max-Age", "600");
          response.writeHead(204).end(); return;
        }
        if (request.method !== "POST" || busy) { response.writeHead(405).end(); return; }
        busy = true;
        (async () => {
          const expected = chunkLength(request.url.slice(token.length + 1), receivedBytes, receipt.snapshot.bytes);
          assert.equal(Number(request.headers["content-length"]), expected, "RAM chunk length header");
          let count = 0;
          for await (const bytes of request) {
            count += bytes.length; assert.ok(count <= expected, "oversized RAM chunk");
            if (!meter.write(bytes)) await once(meter, "drain");
          }
          assert.equal(count, expected, "truncated RAM chunk");
          receivedBytes += count;
          if (receivedBytes === receipt.snapshot.bytes) {
            meter.end(); await received; receipt.snapshot.sha256 = hash.digest("hex");
          }
          busy = false; response.writeHead(200).end("captured");
        })().catch(error => { meter.destroy(error); response.destroy(error); });
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const destination = `http://127.0.0.1:${server.address().port}${token}`;
      await command("Runtime.evaluate", {
        expression: `(async()=>{const bytes=globalThis.__omarchyFailureSnapshot;
          for(let offset=0;offset<bytes.length;offset+=${CHUNK_BYTES}){
            const r=await fetch(${JSON.stringify(destination)}+'/'+offset,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes.subarray(offset,offset+${CHUNK_BYTES})});
            if(!r.ok)throw Error('RAM chunk upload '+r.status);await r.text();
          }return bytes.length;})()`,
        awaitPromise: true, returnByValue: true,
      });
      await received;
      receipt.streamedAt = new Date().toISOString();
      const after = await command("Runtime.evaluate", { expression: "globalThis.__omarchyFailureMachine.stateDigest()", returnByValue: true });
      receipt.snapshot.stateDigestAfter = after.result.value;
      assert.equal(receipt.snapshot.sha256, expectedDigest);
      assert.equal(after.result.value, expectedDigest, "guest RAM changed during paused capture");
      await command("Runtime.evaluate", { expression: "delete globalThis.__omarchyFailureSnapshot" });
      assert.equal(await page.evaluate(() => window.__linux.isPaused()), true);
      assert.equal(assertFailedInput(report), verdict, "capture changed the input verdict");
      const compressed = await fs.readFile(filename);
      receipt.snapshot.file = filename;
      receipt.snapshot.compressedBytes = compressed.length;
      receipt.snapshot.compressedSha256 = createHash("sha256").update(compressed).digest("hex");
      receipt.status = "captured";
    }, receipt.deadlineAtMs, "endpoint snapshot export");
  } catch (error) { receipt.status = "failed"; receipt.error = String(error); throw error; }
  finally {
    abort.abort(); server?.closeAllConnections(); server?.close();
    // Closing the owned browser in the caller is the final cancellation boundary.
    if (sessionId) cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    if (cdp) cdp.detach().catch(() => {});
    receipt.finishedAt = new Date().toISOString();
  }
}
