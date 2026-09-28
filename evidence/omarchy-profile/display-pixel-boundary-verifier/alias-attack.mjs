import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { installDisplayPixelProbe, readDisplayPixelProbe } from "../../../tools/verify/omarchy-display-pixel-probe.mjs";
import { installWireEvidence } from "../../../tools/verify/omarchy-live-recording.mjs";
import { checkLiteralOracle, wireToVisibleRgba, compareRgba, sha256 } from "./independent-pixels.mjs";

function fixture() {
  class NativeWorker {
    listeners = new Map();
    calls = [];
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    postMessage(message, transfer) {
      this.calls.push({ message, transfer });
      if (message.transportFailure) throw Error("native transport failure");
      if (transfer) structuredClone(message, { transfer });
      return "unaltered return";
    }
    emit(data) { for (const callback of this.listeners.get("message") || []) callback({ data }); }
  }
  const original = NativeWorker.prototype.postMessage;
  const context = vm.createContext({ Worker: NativeWorker, Date, performance, Uint8Array, ArrayBuffer,
    TextDecoder, document: { activeElement: { id: "ide-display-canvas" } }, addEventListener: () => {},
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    __presentation: { state: () => ({ width: 2, height: 2 }),
      readPixels: () => new Uint8Array([1, 2, 3, 255, 11, 12, 13, 255, 31, 32, 33, 255, 41, 42, 43, 255]) } });
  const install = options => vm.runInContext(`(${installDisplayPixelProbe.toString()})(${JSON.stringify(options)})`, context);
  const read = () => vm.runInContext(`(${readDisplayPixelProbe.toString()})()`, context);
  return { context, NativeWorker, original, install, read };
}

const literal = checkLiteralOracle();
const wrapperOrders = [];
for (const order of ["wire-then-pixels", "pixels-then-wire"]) {
  const composed = fixture();
  const wire = () => vm.runInContext(`(${installWireEvidence.toString()})()`, composed.context);
  if (order === "wire-then-pixels") { wire(); composed.install({ enabled: true }); }
  else { composed.install({ enabled: true }); wire(); }
  const w = new composed.NativeWorker();
  const bytes = new Uint8Array([5, 9]);
  const message = { type: "input", bytes: bytes.buffer }, list = [bytes.buffer];
  assert.equal(w.postMessage(message, list), "unaltered return");
  assert.equal(bytes.byteLength, 0); assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].message, message); assert.equal(w.calls[0].transfer, list);
  assert.deepEqual([...composed.context.__omarchyWireEvidence.workerTraffic[0].bytes], [5, 9]);
  w.emit({ type: "display", frame: { scanout: 0, format: 2, rect: { x: 0, y: 0, width: 1, height: 1 },
    resourceWidth: 1, resourceHeight: 1, pixels: new Uint8Array([1, 2, 3, 99]).buffer } });
  assert.equal(composed.context.__omarchyDisplayPixels.framesSeen, 1);
  composed.context.__omarchyDisplayPixels.dispose();
  assert.equal(w.listeners.get("message").size, 1, "wire listener survives probe disposal");
  assert.equal(w.postMessage({ type: "input", bytes: new Uint8Array([7]).buffer }), "unaltered return");
  assert.equal(w.calls.length, 2);
  assert.equal(composed.context.__omarchyWireEvidence.workerTraffic.length, 2);
  wrapperOrders.push({ order, held: true, noForwardingDuplication: true, wireSurvivesDisposal: true });
}
const f = fixture();
f.install({});
assert.equal(f.context.__omarchyDisplayPixels, undefined);
assert.equal(f.NativeWorker.prototype.postMessage, f.original);
f.install({ enabled: true });
assert.throws(() => f.install({ enabled: true }), /already installed/);
const worker = new f.NativeWorker();
const outgoingBuffer = new Uint8Array([29, 31, 37]).buffer;
const outgoing = { type: "boot", buffer: outgoingBuffer }, transfer = [outgoingBuffer];
assert.equal(worker.postMessage(outgoing, transfer), "unaltered return");
assert.equal(worker.calls[0].message, outgoing); assert.equal(worker.calls[0].transfer, transfer);
assert.equal(worker.calls.length, 1); assert.equal(outgoingBuffer.byteLength, 0);
assert.throws(() => worker.postMessage({ transportFailure: true }), /native transport failure/);

const incoming = new Uint8Array([
  3, 2, 1, 0, 13, 12, 11, 99, 23, 22, 21, 0,
  33, 32, 31, 254, 43, 42, 41, 23, 53, 52, 51, 0,
  63, 62, 61, 0, 73, 72, 71, 0, 83, 82, 81, 0,
]);
const expectedRaw = Buffer.from(incoming);
const frame = { scanout: 7, format: 2, rect: { x: 1, y: 1, width: 1, height: 1 },
  resourceWidth: 3, resourceHeight: 3, pixels: incoming.buffer };
const message = { type: "display", frame };
let observedMessage = null;
worker.addEventListener("message", event => { observedMessage = event.data; });
worker.emit(message);
assert.equal(observedMessage, message); assert.equal(observedMessage.frame.pixels, incoming.buffer);
assert.deepEqual([...incoming], [...expectedRaw], "observer must not normalize the original X bytes");
incoming.fill(222); frame.rect.x = 42; frame.format = 1; frame.scanout = null; frame.resourceWidth = 999;
structuredClone(incoming.buffer, { transfer: [incoming.buffer] });
assert.equal(incoming.byteLength, 0);
const capture = f.read();
const retained = capture.frames[0], raw = Buffer.from(retained.base64, "base64");
assert.deepEqual(raw, expectedRaw);
assert.equal(retained.scanout, 7); assert.equal(retained.format, 2); assert.equal(retained.rect.x, 1);
assert.equal(retained.resourceWidth, 3); assert.equal(retained.resourceHeight, 3);
assert.equal(f.context.__omarchyDisplayPixels.frames.length, 0);
assert.equal(f.context.__omarchyDisplayPixels.disposed, true);
assert.equal(worker.listeners.get("message").size, 1, "only app listener remains");
assert.equal(f.NativeWorker.prototype.postMessage, f.original);
const visible = wireToVisibleRgba(raw, retained, 2, 2), canvas = Buffer.from(capture.canvas.base64, "base64");
const exact = compareRgba(visible, canvas, 2); assert.equal(exact.equal, true);
const mutation = Buffer.from(raw); mutation[2] ^= 1;
const mutated = compareRgba(wireToVisibleRgba(mutation, retained, 2, 2), canvas, 2);
assert.equal(mutated.equal, false); assert.equal(mutated.changedPixels, 1);

const bound = fixture(); bound.install({ enabled: true });
const bw = new bound.NativeWorker(); bw.postMessage({ type: "boot" });
for (let index = 0; index < 80; index++) bw.emit({ type: "display", frame: {
  scanout: index % 2 ? null : 0, format: 2, rect: { x: 0, y: 0, width: 1, height: 1 },
  resourceWidth: 1, resourceHeight: 1, pixels: new Uint8Array([index, 2, 3, 4]).buffer,
} });
const probe = bound.context.__omarchyDisplayPixels;
assert.equal(probe.sequence, 80); assert.equal(probe.framesSeen, 80); assert.equal(probe.evicted, 72);
assert.equal(probe.frames.length, 8); assert.equal(probe.events.length, 64);
assert.equal(probe.frames[0].bytes[0], 72); assert.equal(probe.frames.at(-1).bytes[0], 79);
bw.emit({ type: "display", frame: { type: "clear" } });
assert.equal(probe.events.at(-1).type, "clear"); assert.equal(probe.sequence, 81);
assert.equal(probe.frames.length, 8); assert.equal(probe.framesSeen, 80);
bw.emit({ type: "display", frame: { resourceWidth: 1281, resourceHeight: 832,
  pixels: new ArrayBuffer(0) } });
assert.equal(probe.frames.length, 8); assert.equal(probe.framesSeen, 80);
assert.match(probe.errors[0], /outside diagnostic byte bound/);
for (let index = 0; index < 20; index++) bw.emit({ type: "display", frame: {} });
assert.equal(probe.errors.length, 16, "diagnostic error list must also remain bounded");
const attachment = fixture(); attachment.install({ enabled: true });
const failingListener = new attachment.NativeWorker();
failingListener.addEventListener = () => { throw Error("listener attachment failed"); };
assert.equal(failingListener.postMessage({ type: "boot" }), "unaltered return");
assert.equal(failingListener.calls.length, 1);
assert.match(attachment.context.__omarchyDisplayPixels.errors[0], /listener attachment failed/);
assert.throws(() => fixture().read(), /display probe missing/);
const result = { held: true, fixtureOnly: true, literal,
  wrapperOrders,
  originalMessageAndTransferIdentity: true, originalTransferDetached: true,
  originalPixelMutationAndDetachIsolated: true, originalMetadataMutationIsolated: true,
  rawSha256: sha256(raw), exact, mutated,
  cap: { framesSeen: probe.framesSeen, retained: probe.frames.length, evicted: probe.evicted,
    events: probe.events.length, clearRecorded: true, errorCount: probe.errors.length, error: probe.errors[0] },
  observerAttachmentFailurePreservesTransport: true,
  cleanup: { listenersRemoved: true, originalTransportRestored: true, retainedFramesCleared: true } };
await fs.writeFile(new URL("./alias-attack.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
