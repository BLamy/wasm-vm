import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inputTrialOptions, inputTrialUrl, assertInputTrialSource, assertInputTrialRuntime,
  R3_IDENTITIES, remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";

const options = arm => inputTrialOptions({ urlArg: "local", pair: "pair", chunks: "chunks", arm, renderer: null, lp: null });
test("trial is local, explicit, fixed-budget and does not accept renderer/timeout tuning", () => {
  assert.deepEqual(options("candidate"), { arm: "candidate", recycling: true, startupMs: 300000,
    typingMs: 60000, readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 });
  const base = { urlArg: "local", pair: "pair", chunks: "chunks", arm: "control", renderer: null, lp: null };
  for (const mutation of [{ urlArg: "https://wasm-vm.pages.dev" }, { urlArg: "selftest" }, { pair: "" },
    { chunks: "" }, { arm: "" }, { arm: true }, { renderer: "llvmpipe" }, { lp: "1" }, { timeout: "300000" }]) {
    assert.throws(() => inputTrialOptions({ ...base, ...mutation }));
  }
});
test("arm URLs have exactly one policy difference and forbid inherited query tuning", () => {
  const base = "http://127.0.0.1:9876/app.html?guest=omarchy&desktop=1#ide";
  const control = inputTrialUrl(base, options("control"));
  const candidate = inputTrialUrl(base, options("candidate"));
  assert.equal(control.searchParams.get("jitColdCounterRecycling"), "0");
  assert.equal(candidate.searchParams.get("jitColdCounterRecycling"), "1");
  candidate.searchParams.set("jitColdCounterRecycling", "0");
  assert.equal(control.href, candidate.href);
  for (const input of [base.replace("127.0.0.1:9876", "wasm-vm.pages.dev"), base.replace("#ide", "&jitThreshold=1#ide")]) {
    assert.throws(() => inputTrialUrl(input, options("candidate")));
  }
});
test("all four R3 source bindings and image layout must match", () => {
  const source = { ...structuredClone(R3_IDENTITIES), image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } };
  assertInputTrialSource(source);
  for (const role of Object.keys(R3_IDENTITIES)) for (const field of ["size", "sha256"]) {
    const bad = structuredClone(source); bad[role][field] = field === "size" ? 0 : "0".repeat(64);
    assert.throws(() => assertInputTrialSource(bad));
  }
});
test("actual runtime must match the selected arm with observer/timing off", () => {
  const state = { jit: { hasExecutor: true, admissionProbe: false,
    coldCounterRecycling: { enabled: true, epochs: "1", discardedCounters: "65536", threshold: 512, capacity: 65536 },
    decodedCacheEntries: 4096, jitResidencyPolicy: "repack-off", jitResidencyCap: 24,
    entryCost: { timingEnabled: false } }, clock: { mode: "icount", clockDiv: 64 } };
  assertInputTrialRuntime(state, options("candidate"));
  assert.throws(() => assertInputTrialRuntime(state, options("control")));
  for (const [key, value] of [["hasExecutor", false], ["admissionProbe", { enabled: true }],
    ["decodedCacheEntries", 16384], ["jitResidencyCap", 256], ["entryCost", { timingEnabled: true }]]) {
    const bad = structuredClone(state); bad.jit[key] = value;
    assert.throws(() => assertInputTrialRuntime(bad, options("candidate")));
  }
  for (const value of [1, "-1", "1.0", "18446744073709551616"]) {
    const bad = structuredClone(state); bad.jit.coldCounterRecycling.epochs = value;
    assert.throws(() => assertInputTrialRuntime(bad, options("candidate")));
  }
});
test("deadline accounts for queue delay and rejects late completion without starting expired work", async () => {
  assert.equal(remainingTrialMs(101, 100), 1);
  assert.throws(() => remainingTrialMs(100, 100));
  let called = false;
  await assert.rejects(withinTrialDeadline(() => { called = true; }, Date.now() - 1, "expired"));
  assert.equal(called, false);
  assert.equal(await withinTrialDeadline(() => 7, Date.now() + 1000, "fast"), 7);
  await assert.rejects(withinTrialDeadline(() => new Promise(resolve => setTimeout(resolve, 30)),
    Date.now() + 5, "queued RPC"), /deadline exceeded/u);
});
test("real recorder retains physical-only writing, fixed deadlines, fresh presentation and owned shutdown", async () => {
  const source = await readFile(new URL("./omarchy-desktop-live.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('mode === "input-trial"'));
  assert.ok(source.includes('assertInputTrialSource(candidate.source)'));
  assert.ok(source.includes('assertInputTrialRuntime(beforeInput, trial)'));
  assert.ok(source.includes('physicalStroke(character)'));
  assert.ok(source.includes('timing.enteredAtMs : Date.now()'));
  assert.ok(source.includes('withinTrialDeadline(read, deadline'));
  assert.ok(source.includes('waitForFreshPresentation('));
  assert.ok(source.includes('browserServer.close()'));
  assert.ok(source.includes('browserServer.kill()'));
  assert.ok(source.indexOf('report.result = "input-trial-physical-nonce-and-fresh-presentation"')
    < source.indexOf('const calendarProof = await proveCalendar'));
  assert.doesNotMatch(source, /exec\(`printf '\$\{nonce\}/u);
});
