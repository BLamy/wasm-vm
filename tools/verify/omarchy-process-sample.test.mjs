// Synthetic harness-only fixtures; these tests make no real guest or product claims.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { processSamplePlan, parseProcStat, parseProcessSample, processSampleDeltas,
  sampleProcesses } from "./omarchy-process-sample.mjs";

const boot = "670725d3-0d7b-4695-8f53-e2b2f6c2399c";
const request = { op: "process-sample", targets: [{ pid: 123, tids: [124] }], timeoutMs: 1000 };
const plan = processSamplePlan(request);
function stat(pid, { comm = "Hypr (a) b)", start = "50", utime = "100", stime = "20" } = {}) {
  const fields = Array(49).fill("0");
  for (const [number, value] of [[14, utime], [15, stime], [20, "2"], [22, start], [39, "0"]]) fields[number - 4] = value;
  return `${pid} (${comm}) R ${fields.join(" ")}`;
}
function fixture(overrides = {}, requestedPlan = plan) {
  return { exit: 0, stdout: requestedPlan.records.map(({ label }) => {
    let body;
    if (label.startsWith("boot-")) body = boot;
    else if (label.startsWith("uptime-")) body = "100.00 5.00";
    else if (label === "clock-ticks") body = "100";
    else if (label.endsWith("schedstat")) body = "100000 20000 3";
    else if (label.endsWith("wchan")) body = "futex_wait_queue";
    else body = stat(Number(label.startsWith("leader-") ? label.split("-")[1] : label.split("-")[2]));
    const replacement = overrides[label] ?? { body, status: 0 };
    return `WVMPS ${label}\n${replacement.body ? `${replacement.body}\n` : ""}WVMPS_END ${replacement.status}\n`;
  }).join("") };
}
const hostStats = (pending = 0, frames = 10) => ({ inputDevice: {
  pendingEvents: pending, pendingFrames: 0, droppedEvents: 0, droppedFrames: 0, rejectedEvents: 0,
}, display: { framesReceived: frames, successfulPresents: frames, replayedFrames: 0 },
scheduler: { retiredInstructions: 10000, slices: 3 } });
function sample(ms = 1000) {
  return { status: "sampled", finishedMs: ms, process: parseProcessSample(plan, fixture()),
    after: { values: hostStats() } };
}

test("harness-only: generated command is fixed, shell-valid and bounded to 32 tasks", () => {
  assert.equal(spawnSync("/bin/sh", ["-n"], { input: plan.command, encoding: "utf8" }).status, 0);
  assert.match(plan.command, /\/proc\/123\/task\/124\/schedstat/u);
  assert.match(plan.command, /getconf CLK_TCK/u);
  assert.doesNotMatch(plan.command, /\b(?:kill|renice|taskset|touch|tee|sleep|ps|awk|cat)\b|\/proc\/.*\*/u);
  const maximum = { ...request, targets: [{ pid: 1, tids: Array.from({ length: 31 }, (_, i) => i + 2) }] };
  assert.equal(processSamplePlan(maximum).targets[0].tids.length, 32);
  assert.throws(() => processSamplePlan({ ...maximum, targets: [...maximum.targets, { pid: 33 }] }), /32/u);
  assert.throws(() => processSamplePlan({ ...request, targets: Array.from({ length: 33 }, (_, i) => ({ pid: i + 1 })) }), /32/u);
});

test("harness-only: actual builtin reader runs against synthetic host proc files, including absent wchan", () => {
  const root = mkdtempSync(path.join(tmpdir(), "omarchy-process-fixture-"));
  try {
    for (const record of plan.records) {
      if (!record.filename || record.label.endsWith("wchan")) continue;
      const filename = path.join(root, record.filename);
      mkdirSync(path.dirname(filename), { recursive: true });
      let value = record.label.startsWith("boot-") ? boot : record.label.startsWith("uptime-") ? "100.00 5.00"
        : record.label.endsWith("schedstat") ? "100000 20000 3"
          : stat(Number(record.label.startsWith("leader-") ? record.label.split("-")[1] : record.label.split("-")[2]));
      writeFileSync(filename, `${value}\n`);
    }
    // Only replace fixed proc roots for this synthetic fixture; exercise the actual generated shell.
    const command = plan.command.replaceAll("'/proc/", `'${root}/proc/`);
    const run = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8", timeout: 1000 });
    assert.equal(run.status, 0, run.stderr);
    const result = parseProcessSample(plan, { exit: run.status, stdout: run.stdout });
    assert.equal(result.tasks[0].available, true);
    assert.equal(result.tasks[1].stat.comm, "Hypr (a) b)");
    assert.equal(result.tasks[1].wchan, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("harness-only: unsafe IDs, duplicate targets, wrong types and timeouts refuse before callbacks", async () => {
  const invalid = [
    { targets: [] }, { targets: [{ pid: "123; kill 1" }] }, { targets: [{ pid: "123" }] },
    { targets: [{ pid: 0 }] }, { targets: [{ pid: 2147483648 }] },
    { targets: [{ pid: 123, tids: ["$(id)"] }] }, { targets: [{ pid: 123, tids: [123] }] },
    { targets: [{ pid: 123, tids: [124] }, { pid: 124 }] }, { targets: [{ pid: 123, tids: {} }] },
    { timeoutMs: 999 }, { timeoutMs: 300001 }, { timeoutMs: "1000" },
  ];
  for (const change of invalid) {
    await assert.rejects(sampleProcesses({ request: { ...request, ...change },
      stats: () => assert.fail("stats called"), exec: () => assert.fail("RPC called") }));
  }
});

test("harness-only: stat parser accepts spaces/parens and preserves large counters exactly", () => {
  const parsed = parseProcStat(stat(123, { comm: "a ) S (b)", utime: "9007199254740993" }), 123);
  assert.equal(parsed.comm, "a ) S (b)");
  assert.equal(parsed.utime, "9007199254740993");
  assert.equal(parsed.starttime, "50");
  for (const text of ["123 (short) R 1 2", stat(124), stat(123).replace(" R ", " ! "),
    stat(123, { comm: "split\nname" }), stat(123, { start: "-1" }), stat(123).replace(/ 0$/u, " nope")]) {
    assert.throws(() => parseProcStat(text, 123));
  }
});

test("harness-only: real-shaped shell framing preserves raw fields; forged/missing/extra records refuse", () => {
  const result = parseProcessSample(plan, fixture());
  assert.equal(result.bootId, boot);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[1].stat.id, 124);
  assert.equal(result.tasks[1].schedstat.runqueueWaitNs, "20000");
  for (const rpc of [{ exit: 1, stdout: fixture().stdout }, { exit: 0 },
    { exit: 0, stdout: fixture().stdout.replace("WVMPS boot-before", "WVMPS wrong") },
    { exit: 0, stdout: fixture().stdout + "extra\n" },
    { exit: 0, stdout: fixture().stdout.replace("WVMPS_END 0", "WVMPS_END fake") }]) {
    assert.throws(() => parseProcessSample(plan, rpc));
  }
});

test("harness-only: missing process and optional fields remain explicitly unavailable", () => {
  const missing = { body: "", status: 1 };
  const result = parseProcessSample(plan, fixture({ "task-123-124-stat-after": missing,
    "task-123-123-schedstat": missing, "task-123-123-wchan": missing }));
  assert.equal(result.tasks[1].available, false);
  assert.equal(result.tasks[0].available, true);
  assert.equal(result.tasks[0].schedstat, null);
  assert.equal(result.tasks[0].wchan, null);
  assert.ok(result.tasks[0].optionalErrors.schedstat);
  const malformed = parseProcessSample(plan, fixture({ "task-123-123-schedstat": { body: "0 0", status: 0 } }));
  assert.equal(malformed.tasks[0].schedstat, null);
  assert.throws(() => parseProcessSample(plan, fixture({ "clock-ticks": missing })), /clock-ticks/u);
});

test("harness-only: PID/TID reuse within a probe prevents identity-bound results", () => {
  const leader = parseProcessSample(plan, fixture({ "leader-123-after": { body: stat(123, { start: "51" }), status: 0 } }));
  assert.ok(leader.tasks.every(task => !task.available));
  const thread = parseProcessSample(plan, fixture({ "task-123-124-stat-after": { body: stat(124, { start: "51" }), status: 0 } }));
  assert.equal(thread.tasks[1].available, false);
  assert.throws(() => parseProcessSample(plan, fixture({ "boot-after": { body: boot.replace("6707", "6708"), status: 0 } })), /boot ID changed/u);
});

test("harness-only: same-identity deltas separate CPU ticks, guest time and backlog change", () => {
  const before = sample(1000), after = sample(3000);
  before.after.values = hostStats(8, 10);
  after.after.values = hostStats(0, 14);
  after.process.uptimeAfter = "100.50";
  after.process.tasks[0].stat.utime = "105";
  after.process.tasks[0].stat.stime = "22";
  after.process.tasks[0].schedstat.runtimeNs = "110000";
  const delta = processSampleDeltas(before, after);
  assert.equal(delta.hostElapsedMs, 2000);
  assert.equal(delta.guestElapsedNs, "500000000");
  assert.equal(delta.tasks[0].cpuMs, 70);
  assert.equal(delta.tasks[0].schedstat.runtimeNs, "10000");
  assert.equal(delta.gpuFramesPerHostSecond, 2);
  assert.equal(delta.pendingEventsNetChangePerHostSecond, -4);
  assert.match(delta.limitation, /not guest-consumption/u);
  assert.equal(delta.activePc, undefined);
});

test("harness-only: reuse, boot changes, missing samples and counter resets never bridge identity", () => {
  const before = sample(), after = sample(2000);
  after.process.tasks[0].stat.starttime = "51";
  assert.equal(processSampleDeltas(before, after).tasks[0].available, false);
  after.process.tasks[1].leaderStarttime = "51";
  assert.equal(processSampleDeltas(before, after).tasks[1].available, false);
  after.process.bootId = boot.replace("6707", "6708");
  assert.deepEqual(processSampleDeltas(before, after), { available: false, reason: "boot ID changed" });
  assert.equal(processSampleDeltas(null, after).available, false);
  assert.equal(processSampleDeltas({ ...before, status: "timeout" }, after).available, false);
  const reset = sample(2000); reset.process.tasks[0].stat.utime = "1";
  reset.after.values.display.framesReceived = 0;
  assert.equal(processSampleDeltas(before, reset).tasks[0].available, false);
  assert.equal(processSampleDeltas(before, reset).counters.display.framesReceived, null);
});

test("harness-only: orchestration records before send and brackets actual raw RPC", async () => {
  const calls = [], raw = fixture(); let clock = 1000;
  const result = await sampleProcesses({ request, now: () => clock, stats: async () => {
    calls.push("stats"); clock += 10; return hostStats();
  }, beforeRpc: async record => { calls.push("record"); assert.equal(record.command, plan.command); clock += 10; },
  exec: async (command, timeoutMs) => { calls.push("exec"); assert.equal(command, plan.command);
    assert.equal(timeoutMs, 980); clock += 20; return raw; } });
  assert.deepEqual(calls, ["stats", "record", "exec", "stats"]);
  assert.equal(result.status, "sampled");
  assert.deepEqual(result.rpc.raw, raw);
  assert.equal(result.elapsedMs, 50);
  assert.ok(result.before.completedAt <= result.rpc.submittedAt);
  assert.ok(result.rpc.completedAt <= result.after.startedAt);
});

test("harness-only: RPC rejection, missing fields, and post-deadline success remain non-measurements", async () => {
  const args = { request, stats: async () => hostStats(), now: () => 1000 };
  const failed = await sampleProcesses({ ...args, exec: async () => { throw Error("RPC timed out"); } });
  assert.equal(failed.status, "timeout");
  assert.equal(failed.failedPhase, "rpc");
  assert.equal(failed.process, undefined);
  assert.equal(failed.deltas.available, false);
  const missing = await sampleProcesses({ ...args, exec: async () => ({ exit: 0, stdout: "" }) });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.rpc.raw.stdout, "");
  let clock = 1000;
  const late = await sampleProcesses({ ...args, now: () => clock, exec: async () => { clock = 2001; return fixture(); } });
  assert.equal(late.status, "timeout");
  assert.equal(late.process, undefined);
});

test("harness-only: stalled RPC has a bounded timer without launching a guest", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let sent;
  const sending = new Promise(resolve => { sent = resolve; });
  const pending = sampleProcesses({ request, stats: async () => hostStats(), exec: () => {
    sent(); return new Promise(() => {});
  } });
  await sending;
  t.mock.timers.tick(1001);
  const result = await pending;
  assert.equal(result.status, "timeout");
  assert.equal(result.failedPhase, "rpc");
  t.mock.timers.reset();
});

test("harness-only: diagnostic installs observers before navigation and keeps evidence in sidecars", () => {
  const source = readFileSync(new URL("./omarchy-input-diagnostic.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("await page.addInitScript(installWireEvidence)") < source.indexOf("await page.goto("));
  assert.match(source, /if \(request\.op === "stats"\) result = await readStats\(\)/u);
  assert.match(source, /if \(request\.op === "process-sample"\)/u);
  assert.match(source, /"wire.json"/u);
  assert.match(source, /"identities.json"/u);
  assert.match(source, /filename: null, bytes, repoRoot: repo/u);
  assert.match(source, /method: request.method, filename, bytes, repoRoot: repo/u);
  assert.match(source, /storedSnapshotRestoreEvidence: await window\.__linuxCtl/u);
  assert.match(source, /restoredFromBootSnapshot: window\.__linux/u);
  assert.match(source, /process-sample-rpc-before-submit/u);
});

test("harness-only: actual diagnostic submit guard blocks serial backlog but permits stats until settlement", async () => {
  const source = readFileSync(new URL("./omarchy-input-diagnostic.mjs", import.meta.url), "utf8");
  const submit = source.slice(source.indexOf("function submitProcessRpc("), source.indexOf("async function collectEvidence("));
  const guardStart = source.indexOf('      if (["exec", "process-sample"].includes(request.op)');
  const guard = source.slice(guardStart, source.indexOf('      if (request.op === "profile")', guardStart));
  let resolve, calls = 0;
  const page = { evaluate: () => { calls++; return new Promise(done => { resolve = done; }); } };
  const identities = {};
  const api = new Function("page", "identities", `let outstandingProcessRpc = null;\n${submit}\nreturn {
    submit: submitProcessRpc, guard(request) { ${guard} }
  };`)(page, identities);
  const pending = api.submit(plan.command, 1000);
  assert.equal(calls, 1);
  assert.throws(() => api.submit(plan.command, 1000), /still outstanding/u);
  for (const op of ["exec", "process-sample"]) assert.throws(() => api.guard({ op }), /serial ops blocked/u);
  for (const op of ["stats", "screenshot"]) assert.doesNotThrow(() => api.guard({ op }));
  assert.equal(calls, 1);
  resolve(fixture()); await pending;
  assert.equal(identities.processSampleRpc.pending, false);
  assert.deepEqual(identities.processSampleRpc.raw, fixture());
  assert.doesNotThrow(() => api.guard({ op: "exec" }));
});

test("harness-only: headed boolean changes only selected launch mode; default stays headless", async () => {
  const source = readFileSync(new URL("./omarchy-input-diagnostic.mjs", import.meta.url), "utf8");
  const parser = source.slice(source.indexOf("const positional = [];"), source.indexOf("const output ="));
  const parse = args => new Function("process", `${parser}\nreturn { options, positional };`)({ argv: ["node", "diagnostic", ...args] });
  const launch = source.slice(source.indexOf("const browser = await chromium.launch("), source.indexOf("const page = await browser.newPage("));
  for (const headed of [false, true]) {
    const parsed = parse([...(headed ? ["--headed"] : []), "output", "64", "1"]);
    assert.deepEqual(parsed.positional, ["output", "64", "1"]);
    let actual;
    await new Function("options", "chromium", `return (async () => { ${launch} })();`)(parsed.options,
      { launch: async options => { actual = options; return {}; } });
    assert.equal(actual.headless, !headed);
    assert.equal(actual.executablePath, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  }
  assert.equal((source.match(/headed: Boolean\(options.headed\)/gu) || []).length, 2);
});
