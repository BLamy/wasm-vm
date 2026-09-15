// Post-verdict diagnostics of one owned browser. Never advances the paused guest.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";

export const FAILURE_CHECKPOINT_MS = 180000;
const LIMIT = 2 * 1024 ** 3;
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

export const saveMachineExpression = `function () {
  if (this.length !== 1 || !this[0].__wbg_ptr) throw Error("ambiguous live WasmLinux instances");
  globalThis.__omarchyFailureSnapshot = this[0].saveSnapshot();
  const bytes = globalThis.__omarchyFailureSnapshot;
  if (!(bytes instanceof Uint8Array) || bytes.length < 1048576 || bytes.length > 2147483648)
    throw Error("invalid snapshot size");
  return { bytes: bytes.length, header: Array.from(bytes.subarray(0, 84)) };
}`;

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

export async function exportFailedInput(page, browser, out, report) {
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
      const saved = await command("Runtime.callFunctionOn", {
        objectId: objects.objects.objectId, functionDeclaration: saveMachineExpression, returnByValue: true,
      });
      receipt.snapshot = saved.result.value;
      assert.equal(Buffer.from(receipt.snapshot.header).subarray(0, 8).toString(), "WVMRESU1");
      const token = `/${randomBytes(24).toString("hex")}`, filename = path.join(out, "failed-input.snap.gz");
      const hash = createHash("sha256");
      let accepted = false;
      let receiveResolve, receiveReject;
      const received = new Promise((resolve, reject) => { receiveResolve = resolve; receiveReject = reject; });
      // Attach immediately so an early network/stream failure cannot be unhandled.
      received.catch(() => {});
      server = createServer((request, response) => {
        if (request.url !== token || request.headers.origin !== origin) { response.writeHead(403).end(); return; }
        response.setHeader("Access-Control-Allow-Origin", origin);
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "POST");
          response.setHeader("Access-Control-Allow-Headers", "content-type");
          response.writeHead(204).end(); return;
        }
        if (request.method !== "POST" || accepted) { response.writeHead(405).end(); return; }
        accepted = true;
        pipeline(request, snapshotMeter(receipt.snapshot.bytes, hash), createGzip({ level: 1 }),
          createWriteStream(filename, { flags: "wx" }), { signal: abort.signal }).then(() => {
            receipt.snapshot.sha256 = hash.digest("hex");
            response.writeHead(200).end("captured"); receiveResolve();
          }, error => { response.destroy(error); receiveReject(error); });
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const destination = `http://127.0.0.1:${server.address().port}${token}`;
      await command("Runtime.evaluate", {
        expression: `fetch(${JSON.stringify(destination)}, {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:globalThis.__omarchyFailureSnapshot}).then(r=>{if(!r.ok)throw Error('snapshot upload '+r.status);return r.text();})`,
        awaitPromise: true, returnByValue: true,
      });
      await received;
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
