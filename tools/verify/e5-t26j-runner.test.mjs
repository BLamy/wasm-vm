// Execute only the actual F option/observation helpers; importing the runner would launch Chromium.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing actual helper boundary: ${startMarker}`);
  return source.slice(start, end);
}
const options = vm.runInNewContext(`${between("function diagnosticOptions(", "const diagnostic =")}\ndiagnosticOptions`, { assert, path });
const reuse = { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/e5-t26j-runner-fixture",
  E5_T26F_DIAGNOSTIC_PORT: "61630", E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" };
const helper = between("async function recordDiagnosticICountDivider(", "async function recordDiagnosticJit(");
const clock = (clockDiv, mtime) => ({ mode: "icount", clockDiv, mtime, timebaseHz: 10_000_000 });
function fixture(divider = 10) {
  let now = 1_100;
  const calls = [], selection = { requested: divider, before: clock(10, "100"), after: clock(divider, "100") };
  const values = { state: clock(divider, "110"), selection, jit: { hasExecutor: true,
    jitResidencyPolicy: "repack-off", jitResidencyCap: 24, jitRegionChaining: true,
    jitDynamicChaining: true, guestRetired: 10, retiredViaJit: 5 } };
  const controller = Object.fromEntries([["guestClockState", "state"], ["jitStats", "jit"], ["icountDividerSelection", "selection"]]
    .map(([method, field]) => [method, async () => { calls.push(method); now += 10; return structuredClone(values[field]); }]));
  const sandbox = { assert, diagnostic: { icountDivider: divider }, milestones: {}, firstRestore: { completedAt: 1_000 },
    browserErrors: [], httpErrors: [],
    performance: { now: () => now }, window: { __desktopController: controller },
    page: { evaluate: async fn => fn() } };
  const context = vm.createContext(sandbox);
  const record = vm.runInContext(`${helper}\nrecordDiagnosticICountDivider`, context);
  return { sandbox, context, controller, values, calls, record, now: () => now, advance: value => { now = value; },
    next() { now = 3_500; values.state.mtime = "210"; values.jit.guestRetired = 30; values.jit.retiredViaJit = 15; } };
}

test("divider flag requires reuse and exact string 1 or 10, with no default/cold admission", () => {
  assert.equal(options({}), null);
  for (const mode of ["create", "reuse"]) {
    const env = { ...reuse, E5_T26F_DIAGNOSTIC: mode };
    if (mode === "create") delete env.E5_T26F_DIAGNOSTIC_KEY_DELAY_MS;
    assert.equal(options(env).icountDivider, null);
  }
  for (const value of ["1", "10"]) assert.equal(options({ ...reuse, E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: value }).icountDivider, Number(value));
  for (const value of ["", "0", "01", "010", "1 ", " 1", "1\n", "1.0", "1e1", "1024", 1, 10, null, false, {}]) {
    assert.throws(() => options({ ...reuse, E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: value }));
  }
  for (const mode of [undefined, "", "create"]) assert.throws(() => options({ ...reuse,
    E5_T26F_DIAGNOSTIC: mode, E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: "1" }), /reuse mode/);
});

test("every clock/JIT/residency/profiler/command conflict, even empty, refuses without changing pacing", () => {
  for (const [key, value] of Object.entries({ GUEST_CLOCK: "icount", JIT: "1", RESIDENCY: "repack-off",
    CPU: "1", LATENCY: "1", COMMAND: "sh /tmp/a", COMPLETE: "1" })) {
    for (const selected of [value, ""]) assert.throws(() => options({ ...reuse,
      E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: "1", [`E5_T26F_DIAGNOSTIC_${key}`]: selected }));
  }
  const selected = options({ ...reuse, E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: "1" });
  assert.equal(selected.keyDelayMs, 5);
  assert.equal(selected.command, null);
  assert.equal(selected.guestClock, null);
  assert.equal(selected.jit, null);
});

test("omission keeps jit=1 and adds no divider query or endpoint RPC", async () => {
  const querySource = between("  const query = new URLSearchParams({", "  let normalSnapshot =");
  for (const divider of [null, 1, 10]) {
    const urls = vm.runInNewContext(`(() => { ${querySource} return { coldUrl, restoreUrl }; })()`, {
      URLSearchParams, base: "http://fixture", diagnostic: divider === null ? null : { icountDivider: divider },
      imageSha256: "image", manifestSha256: "manifest",
    });
    for (const value of Object.values(urls)) {
      const query = new URL(value).searchParams;
      assert.equal(query.get("jit"), "1");
      assert.equal(query.get("icountDivider"), divider === null ? null : String(divider));
      assert.equal(query.has("guestClock"), false);
    }
  }
  const gates = [
    between('  if (diagnostic?.icountDivider != null) await recordDiagnosticICountDivider("icountDividerBefore");', '  if (diagnostic?.guestClock) {'),
    between('  if (diagnostic?.icountDivider != null) {', '  if (diagnostic?.guestClock) {'),
  ];
  assert.match(gates[1], /recordDiagnosticICountDivider\("icountDividerAfter"\)/);
  for (const diagnostic of [null, { mode: "create", icountDivider: null }, { mode: "reuse", icountDivider: null }]) {
    await vm.runInNewContext(`(async () => { ${gates.join("\n")} })()`, {
      diagnostic, recordDiagnosticICountDivider: () => assert.fail("omitted divider issued a diagnostic RPC"),
    });
  }
});

test("actual observer serializes state then JIT then selection; held RPCs cannot overlap", async () => {
  const f = fixture(1);
  let release;
  f.controller.guestClockState = () => { f.calls.push("held-state"); return new Promise(resolve => { release = resolve; }); };
  const pending = f.record("icountDividerBefore");
  await Promise.resolve();
  assert.deepEqual(f.calls, ["held-state"]);
  release(f.values.state);
  await pending;
  assert.deepEqual(f.calls, ["held-state", "jitStats", "icountDividerSelection"]);
  assert.equal(f.sandbox.milestones.icountDividerBefore.state.clockDiv, 1);
  assert.equal(f.sandbox.milestones.icountDividerBefore.jit.hasExecutor, true);
});

test("all actual receipt/clock/JIT mismatches refuse while retaining the raw endpoint", async () => {
  const mutations = [
    v => { v.selection = null; }, v => { v.selection.requested = 1; },
    v => { v.selection.before.clockDiv = 1; }, v => { v.selection.after.mtime = "101"; },
    v => { v.state.mtime = "99"; }, v => { v.state.mtime = "18446744073709551616"; },
    v => { v.state.mode = "wall"; }, v => { v.state.clockDiv = 1; }, v => { v.state.timebaseHz = 1; },
    v => { v.jit.hasExecutor = false; }, v => { v.jit.jitResidencyPolicy = "cap-256"; },
    v => { v.jit.jitResidencyCap = 256; }, v => { v.jit.jitRegionChaining = false; },
    v => { v.jit.jitDynamicChaining = false; },
    ...["guestRetired", "retiredViaJit"].flatMap(key => [undefined, null, "1", -1, 0.5, NaN, Infinity, 2 ** 53]
      .map(value => v => { v.jit[key] = value; })),
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.values);
    await assert.rejects(f.record("icountDividerBefore"));
    const raw = f.sandbox.milestones.icountDividerBefore;
    assert.deepEqual(raw.state, f.values.state);
    assert.deepEqual(raw.jit, f.values.jit);
    assert.deepEqual(raw.selection, f.values.selection);
  }
});

test("unavailable/throwing APIs refuse in sequence and retain a bounded error without fallback", async () => {
  for (const [index, method] of ["guestClockState", "jitStats", "icountDividerSelection"].entries()) {
    for (const missing of [true, false]) {
      const f = fixture(), failure = new Error("x".repeat(300));
      if (missing) delete f.controller[method];
      else f.controller[method] = () => { throw failure; };
      await assert.rejects(f.record("icountDividerBefore"), error => missing || error === failure);
      assert.ok(f.sandbox.milestones.icountDividerBefore.error.length <= 240);
      assert.equal(f.calls.length, index);
      assert.equal(f.sandbox.milestones.icountDividerBefore.state, undefined);
    }
  }
});

test("after requires the identical receipt, advancing mtime/JIT counters and nonoverlapping observation times", async () => {
  for (const mutate of [
    f => { f.values.selection.before.mtime = f.values.selection.after.mtime = "101"; },
    f => { f.values.state.mtime = "110"; }, f => { f.values.jit.guestRetired = 10; },
    f => { f.values.jit.retiredViaJit = 5; }, f => { f.advance(1_100); },
  ]) {
    const f = fixture(); await f.record("icountDividerBefore"); f.next(); mutate(f);
    await assert.rejects(f.record("icountDividerAfter"));
    assert.ok(f.sandbox.milestones.icountDividerAfter.state);
    assert.equal(f.sandbox.milestones.icountDividerBefore.state.mtime, "110");
  }
  const f = fixture(); await f.record("icountDividerBefore"); f.next(); await f.record("icountDividerAfter");
  assert.equal(f.sandbox.milestones.icountDividerAfter.state.mtime, "210");
});

test("before costs remain inside original restore T0; after reads follow frozen PCM/end and never waive the cap", async () => {
  const f = fixture();
  const before = between("  const postRestoreStart = firstRestore.completedAt;", "  const postBox =");
  await vm.runInContext(`(async () => { ${before} })()`, f.context);
  assert.equal(f.sandbox.milestones.postRestoreStart, 1_000);
  assert.equal(f.sandbox.milestones.icountDividerBefore.requestedAt, 1_100);
  assert.equal(f.sandbox.milestones.icountDividerBefore.receivedAt, 1_130);
  f.next();
  f.sandbox.browserErrors.push("observed browser error");
  f.sandbox.httpErrors.push("observed HTTP error");
  f.sandbox.milestones.postRestorePcmAtCompletion = { observedAt: 3_499, pcm: { nonSilentFrames: 960 } };
  const frozenEnd = between("  const postRestoreEnd = await page.evaluate(() => performance.now());", "  const postRestoreInteraction =");
  const after = between("  // Never delay the immediate PCM observation", "  // Stop only after the original interaction boundary");
  await vm.runInContext(`(async () => { ${frozenEnd}\n${after} })()`, f.context);
  assert.equal(f.sandbox.milestones.postRestoreEnd, 3_500);
  assert.equal(f.sandbox.milestones.icountDividerAfter.requestedAt, 3_500);
  assert.equal(f.sandbox.milestones.icountDividerAfter.receivedAt, 3_530);
  assert.equal(f.sandbox.milestones.postRestorePcmAtCompletion.observedAt, 3_499);
  const errors = f.sandbox.milestones.icountDividerErrors;
  assert.deepEqual([...errors.browser], ["observed browser error"]);
  assert.deepEqual([...errors.http], ["observed HTTP error"]);
  f.sandbox.browserErrors.push("later error");
  f.sandbox.httpErrors.length = 0;
  assert.deepEqual([...errors.browser], ["observed browser error"], "endpoint errors are a retained copy");
  assert.deepEqual([...errors.http], ["observed HTTP error"]);
  const cap = source.match(/assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/)?.[0];
  assert.ok(cap);
  assert.throws(() => vm.runInNewContext(cap, { assert, postRestoreStart: f.sandbox.milestones.postRestoreStart,
    postRestoreEnd: f.sandbox.milestones.postRestoreEnd }), /exceeded 2 seconds/);
});
