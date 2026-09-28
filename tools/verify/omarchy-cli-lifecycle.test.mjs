// Synthetic recorder lifecycle tests only: no Chrome, server process, or guest is launched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { finishCliRecording, stopCliServerGroup } from "./omarchy-cli-lifecycle.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const never = () => new Promise(() => {});
function fixture(overrides = {}) {
  const report = { result: "running" }, written = [], order = [];
  const options = { report, deadlineAt: 100, now: () => 0,
    run: async () => { order.push("run"); },
    captureFailure: async () => { order.push("screenshot"); return true; },
    closeBrowser: async () => { order.push("browser"); return true; },
    closeServer: async () => { order.push("server"); return true; },
    writeReport: async value => { order.push("write"); written.push(JSON.parse(JSON.stringify(value))); },
    cleanupTimeoutMs: 10, serverTimeoutMs: 10, ...overrides };
  return { report, written, order, options };
}

test("normal PASS is published only after both owned cleanup steps confirm", async () => {
  const f = fixture();
  f.options.closeServer = async () => {
    f.order.push("server"); assert.equal(f.report.result, "running"); return true;
  };
  await finishCliRecording(f.options);
  assert.deepEqual(f.order, ["run", "browser", "server", "write"]);
  assert.equal(f.written[0].result, "PASS");
  assert.equal(f.written[0].cleanup.serverGroup.confirmed, true);
});

test("deadline failure is irreversible when late run completes during failure PNG", async () => {
  const run = deferred(), captureStarted = deferred(), finishCapture = deferred();
  const f = fixture({ deadlineAt: 10,
    run: () => run.promise,
    captureFailure: async () => { captureStarted.resolve(); await finishCapture.promise; return true; },
  });
  const completion = assert.rejects(finishCliRecording(f.options), /deadline.*timed out/);
  await captureStarted.promise;
  assert.equal(f.report.result, "FAIL");
  run.resolve();
  await run.promise;
  f.report.result = "PASS"; // Reproduce the original run() continuation's write, too.
  assert.equal(f.report.result, "FAIL");
  finishCapture.resolve();
  await completion;
  assert.equal(f.written[0].result, "FAIL");
  f.report.result = "PASS"; // Even a still-later completion cannot rearm publication.
  assert.equal(f.report.result, "FAIL");
  assert.deepEqual(f.order, ["browser", "server", "write"]);
});

test("completion after absolute deadline fails even before the timer callback executes", async () => {
  let now = 0;
  const f = fixture({ now: () => now, run: async () => { now = 100; } });
  await assert.rejects(finishCliRecording(f.options), /five-minute deadline/);
  assert.equal(f.written[0].result, "FAIL");
});

test("hung failure PNG and browser close cannot block server cleanup or FAIL receipt", async () => {
  const f = fixture({ run: async () => { throw new Error("original boot failure"); },
    captureFailure: never, closeBrowser: never });
  await assert.rejects(finishCliRecording(f.options), /original boot failure/);
  assert.deepEqual(f.order, ["server", "write"]);
  const report = f.written[0];
  assert.equal(report.result, "FAIL");
  assert.match(report.cleanup.failureScreenshot.error, /timed out/);
  assert.match(report.cleanup.browser.error, /timed out/);
  assert.equal(report.cleanup.serverGroup.confirmed, true);
});

test("unconfirmed or hung cleanup turns successful observations into FAIL", async () => {
  for (const closeServer of [async () => false, never, async () => { throw new Error("denied"); }]) {
    const f = fixture({ closeServer });
    await assert.rejects(finishCliRecording(f.options), /unconfirmed|not confirmed|timed out|denied/);
    assert.equal(f.written[0].result, "FAIL");
    assert.equal(f.written[0].cleanup.serverGroup.confirmed, false);
  }
  const f = fixture({ closeBrowser: never });
  await assert.rejects(finishCliRecording(f.options), /browser.*timed out/);
  assert.ok(f.order.includes("server"));
  assert.equal(f.written[0].result, "FAIL");
});

function serverFixture() {
  const closed = deferred(), signals = [], disposal = [];
  let exists = true;
  const child = { pid: 12345, exitCode: 0, killed: true,
    stdout: { destroy: () => disposal.push("stdout") },
    stderr: { destroy: () => disposal.push("stderr") }, unref: () => disposal.push("unref") };
  function signal(pid, kind) {
    assert.equal(pid, -12345, "must address only the owned process group");
    signals.push(kind);
    if (!exists) throw Object.assign(new Error("gone"), { code: "ESRCH" });
  }
  return { child, closed, signals, disposal, signal, disappear: () => { exists = false; } };
}
test("server cleanup kills surviving child group even if shell already exited/killed", async () => {
  const f = serverFixture();
  f.closed.resolve();
  const confirmed = await stopCliServerGroup(f.child, f.closed.promise, {
    signal(pid, kind) { f.signal(pid, kind); if (kind === "SIGTERM") f.disappear(); },
    timeoutMs: 10, killTimeoutMs: 10, pollMs: 1,
  });
  assert.equal(confirmed, true);
  assert.equal(f.signals[0], "SIGTERM");
  assert.deepEqual(f.disposal, []);
});

test("server group surviving TERM receives KILL and must confirm gone plus child close", async () => {
  const f = serverFixture();
  assert.equal(await stopCliServerGroup(f.child, f.closed.promise, {
    signal(pid, kind) {
      f.signal(pid, kind);
      if (kind === "SIGKILL") { f.disappear(); f.closed.resolve(); }
    }, timeoutMs: 5, killTimeoutMs: 10, pollMs: 1,
  }), true);
  assert.ok(f.signals.includes("SIGKILL"));
  for (const absentWithoutClose of [false, true]) {
    const stuck = serverFixture();
    if (absentWithoutClose) stuck.disappear(); else stuck.closed.resolve();
    await assert.rejects(stopCliServerGroup(stuck.child, stuck.closed.promise, {
      signal: stuck.signal, timeoutMs: 5, killTimeoutMs: 5, pollMs: 1,
    }), /unconfirmed/);
    assert.deepEqual(stuck.disposal, ["stdout", "stderr", "unref"]);
  }
});

test("pre-existing server is not signaled; invalid group identity fails closed", async () => {
  assert.equal(await stopCliServerGroup(null, null, { signal() { assert.fail("not owned"); } }), true);
  await assert.rejects(stopCliServerGroup({ pid: 0 }, Promise.resolve(), {
    signal() { assert.fail("invalid group"); },
  }), /process-group ID/);
});

test("actual recorder retains public URL/five-minute deadline and delegates final verdict", () => {
  const source = readFileSync(new URL("./omarchy-cli-regression.mjs", import.meta.url), "utf8");
  assert.match(source, /const baseUrl = "http:\/\/127\.0\.0\.1:8000\/\?noAutoBoot=1#ide"/);
  assert.match(source, /const deadlineAt = Date\.now\(\) \+ 5 \* 60_000/);
  assert.doesNotMatch(source, /report\.result\s*=/);
  assert.match(source, /await finishCliRecording\(\{/);
  assert.match(source, /closeServer: \(\) => stopCliServerGroup\(ownedServer, ownedServerClosed\)/);
  assert.ok(source.indexOf("await finishCliRecording(") < source.indexOf("console.log(`OMARCHY_CLI_REGRESSION_PASS"));
});
