// Verifier probe (E5-T37b): drive the SHIPPED wasm (web/dist/pkg) from node through its JS API.
// Usage: node shipped-wasm-probe.mjs <repo>/web/dist/pkg [--fake-worker-scope]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const pkg = path.resolve(process.argv[2]);
const fake = process.argv.includes("--fake-worker-scope");
if (fake) {
  // JsHostTimer::new() accepts only a Window or a WorkerGlobalScope global. Make node's global
  // pass `instanceof WorkerGlobalScope`; node already has a monotonic globalThis.performance.
  globalThis.WorkerGlobalScope = class { static [Symbol.hasInstance](v) { return v === globalThis; } };
}
const mod = await import(pathToFileURL(path.join(pkg, "wasm_vm_wasm.js")).href);
mod.initSync({ module: readFileSync(path.join(pkg, "wasm_vm_wasm_bg.wasm")) });
const program = [0x544958b7, 0xd4588893, 0x00000813, 0x10000537, 0x00000073, 0x10500073, 0xffdff06f];
const bytes = new Uint8Array(new Uint32Array(program).buffer);
const make = () => new mod.WasmLinux(8, bytes, new Uint8Array(0), "", () => {}, false);
const out = { fakeWorkerScope: fake, node: process.version };
const attempt = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } };
const m = make();
out.methods = { setPacedIdlePolicy: typeof m.setPacedIdlePolicy, takeIdleWaitMs: typeof m.takeIdleWaitMs };
// Refusals (strict arguments), each must throw and leave nothing reported.
out.refusals = [[1, undefined], ["true", undefined], [null, 50], [undefined, 50], [true, -1], [true, NaN], [true, Infinity],
  [true, 3_600_000.5], [true, "50"], [true, true], [true, {}], [true, 3_600_001], [true, -0.0001], [true, 50n], [true, [50]], [0, 0], [new Boolean(true), 50]]
  .map(([y, lag]) => ({ args: [typeof y === "object" && y !== null ? `obj:${String(y)}` : String(y), typeof lag === "bigint" ? "50n" : JSON.stringify(lag) ?? String(lag)], ...attempt(() => m.setPacedIdlePolicy(y, lag)) }));
out.acceptedEdges = [[true, 0], [true, 3_600_000], [false, null], [true, undefined], [true, 1e-9], [true, -0]].map(([y, lag]) => ({ args: [y, lag === undefined ? "undefined" : lag], ...attempt(() => m.setPacedIdlePolicy(y, lag)) }));
out.waitBeforeAnything = attempt(() => m.takeIdleWaitMs());
out.clockBefore = attempt(() => m.guestClockState());
out.selectPaced = attempt(() => m.setGuestClock("paced-icount"));
out.clockAfter = attempt(() => m.guestClockState());
if (out.selectPaced.ok) {
  m.setPacedIdlePolicy(true, 50);
  const r1 = m.runChunk(100_000, undefined); const w1 = m.takeIdleWaitMs(); const w1again = m.takeIdleWaitMs();
  const r2 = m.runChunk(100_000, undefined); const w2 = m.takeIdleWaitMs();
  // A run call discards a wait nobody took.
  const r3 = m.runChunk(100_000, undefined); const r4 = m.runChunk(100_000, undefined); const w4 = m.takeIdleWaitMs();
  m.setPacedIdlePolicy(false, null);
  const r5 = m.runChunk(5_000, undefined); const w5 = m.takeIdleWaitMs();
  m.setGuestClock("icount"); m.setPacedIdlePolicy(true, 50);
  const r6 = m.runChunk(5_000, undefined); const w6 = m.takeIdleWaitMs();
  out.idleGuest = { first: { retired: Number(r1.retired), done: r1.done, waitMs: w1, takenAgain: w1again },
    second: { retired: Number(r2.retired), waitMs: w2 }, untakenThenRun: { retired3: Number(r3.retired), retired4: Number(r4.retired), waitMs: w4 },
    noOptIn: { retired: Number(r5.retired), waitMs: w5 }, pureICount: { retired: Number(r6.retired), waitMs: w6 } };
}
console.log(JSON.stringify(out, null, 1));
