import assert from "node:assert/strict";
import { test } from "node:test";
import { bindNames, summarize } from "./e5-t22c-symbolize-cpu.mjs";
const module = (...bytes) => Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, ...bytes]);
// Function-name section naming index 0 "x", plus an identical code section.
const nameSection = [0, 11, 4, 110, 97, 109, 101, 1, 4, 1, 0, 1, 120];
test("offline names cannot be applied to different executable bytes", () => {
  const release = module(10, 1, 0), named = module(10, 1, 0, ...nameSection);
  assert.equal(bindNames(release, named).names.get(0), "x");
  assert.throws(() => bindNames(module(10, 1, 1), named), /executable sections differ/);
  assert.throws(() => bindNames(release, module(10, 3, 0)), /bounded Wasm section/);
  assert.throws(() => bindNames(release, release), /function names required/);
});
test("time-weighted samples resolve only the bound module, retaining unrelated JIT names", () => {
  const frame = (functionName, url = "") => ({ functionName, url });
  const recording = { url: "http://127.0.0.1:123/linux-worker.js", profile: {
    nodes: [
      { id: 1, callFrame: frame("root"), children: [2, 3] },
      { id: 2, callFrame: frame("wasm-function[0]", "http://127.0.0.1:123/pkg/wasm_vm_wasm_bg.wasm") },
      { id: 3, callFrame: frame("wasm-function[0]", "wasm://other") },
    ], samples: [2, 3], timeDeltas: [3000, 1000],
  } };
  const result = summarize(recording, new Map([[0, "named"]]));
  assert.deepEqual(result.self, [
    { name: "named", us: 3000, percent: 75 },
    { name: "wasm-function[0] wasm://other", us: 1000, percent: 25 },
  ]);
  assert.deepEqual(result.inclusive[0], { name: "root", us: 4000, percent: 100 });
  recording.profile.timeDeltas.pop();
  assert.throws(() => summarize(recording, new Map()));
});
