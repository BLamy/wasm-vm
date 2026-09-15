import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { servedIdentity, installWireEvidence } from "./omarchy-live-recording.mjs";

function fixture() {
  const listeners = new Map();
  class FakeWorker {
    calls = [];
    listeners = new Map();
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    postMessage(message, transfer) {
      if (message.fail) throw new Error("transport failed");
      this.calls.push(structuredClone(message, { transfer }));
      return "original-result";
    }
    emit(data) { this.listeners.get("message")?.({ data }); }
  }
  const context = vm.createContext({ Worker: FakeWorker, Date, performance, TextDecoder,
    ArrayBuffer, Uint8Array, document: { activeElement: { id: "ide-display-canvas" } },
    addEventListener: (type, handler) => listeners.set(type, handler) });
  vm.runInContext(`(${installWireEvidence.toString()})()`, context);
  return { Worker: FakeWorker, listeners, evidence: context.__omarchyWireEvidence };
}

test("wire observer preserves transferred serial bytes and original transport behavior", () => {
  const { Worker, evidence } = fixture();
  const worker = new Worker();
  const bytes = new TextEncoder().encode("read-only\r");
  assert.equal(worker.postMessage({ type: "input", bytes: bytes.buffer }, [bytes.buffer]), "original-result");
  assert.equal(bytes.byteLength, 0, "real transferable semantics preserved");
  assert.equal(worker.calls.length, 1);
  assert.equal(new TextDecoder().decode(worker.calls[0].bytes), "read-only\r");
  assert.deepEqual(Array.from(evidence.workerTraffic[0].bytes), Array.from(new TextEncoder().encode("read-only\r")));
  assert.equal(evidence.workerTraffic[0].sent, true);
  worker.emit({ type: "output", buffer: new TextEncoder().encode("quiet RPC output").buffer });
  assert.equal(evidence.workerTraffic[1].text, "quiet RPC output");
  assert.equal(evidence.workerTraffic[1].worker, 1);
  assert.throws(() => worker.postMessage({ type: "input", bytes: new ArrayBuffer(0), fail: true }), /transport failed/u);
  assert.equal(evidence.workerTraffic.at(-1).sent, false);
});

test("wire observer distinguishes workers, physical events and actual input acknowledgements", () => {
  const { Worker, listeners, evidence } = fixture();
  const first = new Worker(), second = new Worker();
  const call = { type: "call", id: 8, method: "sendKeyboardEvent", args: [1, 30, 1] };
  first.postMessage(call);
  second.postMessage({ ...call, args: [1, 30, 0] });
  first.emit({ type: "result", id: 8, result: true });
  second.emit({ type: "result", id: 8, result: false });
  const results = evidence.workerTraffic.filter(row => row.type === "input-result");
  assert.deepEqual(Array.from(results, row => [row.worker, row.result]), [[1, true], [2, false]]);
  assert.equal(first.calls.length, 1); assert.equal(second.calls.length, 1);
  listeners.get("keydown")({ code: "KeyA", key: "a", isTrusted: true, repeat: false, target: { id: "ide-display-canvas" } });
  listeners.get("keyup")({ code: "KeyA", key: "a", isTrusted: false, repeat: false, target: { id: "other" } });
  assert.deepEqual(Array.from(evidence.inputEvents, row => [row.type, row.code, row.trusted, row.target]),
    [["keydown", "KeyA", true, "ide-display-canvas"], ["keyup", "KeyA", false, "other"]]);
});

test("server identities bind exactly the bytes served and their repository path", () => {
  const bytes = Buffer.from("worker source");
  const row = servedIdentity({ pathname: "/linux-worker.js", method: "GET", filename: "/repo/web/dist/linux-worker.js", bytes, repoRoot: "/repo" });
  assert.equal(row.repoPath, "web/dist/linux-worker.js");
  assert.equal(row.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(row.size, bytes.length);
  assert.notEqual(row.sha256, servedIdentity({ pathname: row.pathname, method: "GET", filename: null, bytes: Buffer.from("different"), repoRoot: "/repo" }).sha256);
});
