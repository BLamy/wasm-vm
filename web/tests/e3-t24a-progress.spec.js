// E3-T24a: deterministic adversarial verification of the boot-progress MODEL (web/progress.js),
// run headlessly (no page) so the monotonicity / no-fake-99 / stage-error invariants are proven
// without browser-timing flakiness. The live surface is exercised separately in
// e3-t24a-boot-progress.spec.js; both consume the same reducer.

import { expect, test } from "@playwright/test";
import {
  STAGES,
  applyProgress,
  initialProgress,
  percent,
  reduceProgress,
} from "../progress.js";

const ids = STAGES.map((s) => s.id); // wasm, manifest, kernel, chunk, login

// A realistic, in-order happy path: enter/bytes/complete per stage, then ready.
function happyPath() {
  return [
    { kind: "enter", stage: "wasm" },
    { kind: "complete", stage: "wasm" },
    { kind: "enter", stage: "manifest" },
    { kind: "complete", stage: "manifest" },
    { kind: "enter", stage: "kernel" },
    { kind: "bytes", stage: "kernel", loaded: 11_048_704, total: 22_097_408 },
    { kind: "bytes", stage: "kernel", loaded: 22_097_408, total: 22_097_408 },
    { kind: "complete", stage: "kernel" },
    { kind: "enter", stage: "chunk" },
    { kind: "bytes", stage: "chunk", loaded: 50_000_000, total: 200_000_000 },
    { kind: "bytes", stage: "chunk", loaded: 200_000_000, total: 200_000_000 },
    { kind: "complete", stage: "chunk" },
    { kind: "enter", stage: "login" },
    { kind: "ready" },
  ];
}

test("weights are a normalized partition and the login share is unfilled until ready", () => {
  const sum = STAGES.reduce((a, s) => a + s.weight, 0);
  expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  // wasm/manifest/login are the explicit indeterminate phases; kernel/chunk are byte-measurable.
  expect(STAGES.filter((s) => !s.measurable).map((s) => s.id)).toEqual([
    "wasm",
    "manifest",
    "login",
  ]);
});

test("overall never regresses under reordered, duplicated, and delayed events", () => {
  const events = happyPath();
  // Feed a shuffled + duplicated stream; assert monotonic non-decrease at every step.
  const scrambled = [
    ...events,
    ...events.slice(4, 10), // replay a middle burst late (duplicates + out of order)
    ...events.slice(0, 3), // stale early events arriving after the fact
  ];
  let state = initialProgress();
  let last = -1;
  for (const evt of scrambled) {
    state = applyProgress(state, evt);
    expect(state.overall).toBeGreaterThanOrEqual(last);
    last = state.overall;
  }
});

test("never fabricates a creeping 99%: the bar stays < 100% until the guest is usable", () => {
  let state = initialProgress();
  for (const evt of happyPath().slice(0, -1)) {
    // everything except `ready`
    state = applyProgress(state, evt);
    expect(state.overall).toBeLessThan(1);
    expect(percent(state)).toBeLessThanOrEqual(99);
  }
  // Only the ready (login prompt) event completes the bar.
  state = applyProgress(state, { kind: "ready" });
  expect(state.overall).toBe(1);
  expect(percent(state)).toBe(100);
  expect(state.ready).toBe(true);
  expect(state.indeterminate).toBe(false);
});

test("the long boot-to-login phase is explicitly indeterminate, not a moving number", () => {
  // After all fetches complete, entering `login` must hold the number and flag indeterminate — the
  // surface shows "working", not a percentage that appears frozen or a fake creep.
  let state = reduceProgress(happyPath().slice(0, -1)); // through enter:login, before ready
  expect(state.activeStage).toBe("login");
  expect(state.indeterminate).toBe(true);
  const held = state.overall;
  // Time passing (no events) cannot change the model — there is no clock input at all.
  state = applyProgress(state, { kind: "enter", stage: "login" }); // duplicate
  expect(state.overall).toBe(held);
});

test("indeterminate flag tracks measurability of the active stage", () => {
  // wasm + manifest are indeterminate while active.
  let s = applyProgress(initialProgress(), { kind: "enter", stage: "wasm" });
  expect(s.indeterminate).toBe(true);
  s = applyProgress(s, { kind: "enter", stage: "manifest" });
  expect(s.indeterminate).toBe(true);
  // kernel with a known total is determinate.
  s = applyProgress(s, { kind: "bytes", stage: "kernel", loaded: 1, total: 100 });
  expect(s.indeterminate).toBe(false);
  // kernel with an UNKNOWN total (no Content-Length) is honestly indeterminate.
  let t = applyProgress(initialProgress(), { kind: "bytes", stage: "kernel", loaded: 5, total: null });
  expect(t.indeterminate).toBe(true);
});

test("displayed byte-weighted progress tracks observed bytes within 15%", () => {
  // Drive the kernel + chunk (the measurable phases) to a known observed fraction and check the
  // model's contribution matches within the AC's 15% divergence bound.
  const kernelTotal = 22_097_408;
  const chunkTotal = 200_000_000;
  for (const obs of [0.1, 0.37, 0.5, 0.83, 1.0]) {
    let s = reduceProgress([
      { kind: "complete", stage: "wasm" },
      { kind: "complete", stage: "manifest" },
      { kind: "bytes", stage: "kernel", loaded: kernelTotal * obs, total: kernelTotal },
      { kind: "bytes", stage: "chunk", loaded: chunkTotal * obs, total: chunkTotal },
    ]);
    // Expected measurable contribution: wasm+manifest weight (done) + obs × (kernel+chunk weight).
    const wm = STAGES[0].weight + STAGES[1].weight;
    const meas = STAGES[2].weight + STAGES[3].weight;
    const expected = wm + obs * meas;
    const divergence = Math.abs(s.overall - expected) / Math.max(expected, 1e-6);
    expect(divergence).toBeLessThan(0.15);
  }
});

test("a failure at ANY stage boundary yields a stage-named error, never an endless spinner", () => {
  for (const stage of ids) {
    const s = applyProgress(initialProgress(), {
      kind: "error",
      stage,
      message: "boom",
    });
    expect(s.error).not.toBeNull();
    expect(s.error.stage).toBe(stage);
    expect(s.label).toContain("failed");
    expect(s.label).toContain("boom");
    // An error is a terminal, named state — explicitly NOT the indeterminate "working" spinner.
    expect(s.indeterminate).toBe(false);
    expect(s.ready).toBe(false);
  }
});

test("a dropped `complete` cannot strand the bar: entering a later stage fills earlier ones", () => {
  // Omit kernel's `complete`; jump straight to chunk. The kernel weight must still land.
  const s = reduceProgress([
    { kind: "enter", stage: "kernel" },
    { kind: "bytes", stage: "kernel", loaded: 1_000, total: 22_097_408 },
    { kind: "enter", stage: "chunk" }, // no kernel `complete` ever sent
  ]);
  expect(s.stages.kernel.state).toBe("complete");
  expect(s.stages.kernel.fraction).toBe(1);
  expect(s.stages.wasm.state).toBe("complete");
});

test("unknown event kinds and unknown stage ids are ignored, not corrupting", () => {
  const base = reduceProgress(happyPath().slice(0, 8));
  for (const junk of [
    null,
    {},
    { kind: "wat", stage: "kernel" },
    { kind: "enter", stage: "not-a-stage" },
    { kind: "bytes", stage: "kernel", loaded: -5, total: 10 },
    { kind: "bytes", stage: "kernel", loaded: 1, total: -10 },
  ]) {
    expect(applyProgress(base, junk)).toBe(base); // same reference: no-op
  }
});
