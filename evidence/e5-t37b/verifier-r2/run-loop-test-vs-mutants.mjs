// E5-T37b verifier round 2: sabotage check of the promoted test web/tests/e5-t37b-run-loop.test.mjs.
// Round 1's ten loader/sleeper mutants plus six of mine (two of them would hang a harness that
// has no deadline of its own), each applied to a scratch copy of web/, never to the checkout.
//
//   node run-loop-test-vs-mutants.mjs REPO_ROOT SCRATCH_DIR > run-loop-test-vs-mutants.json
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [root, scratch] = process.argv.slice(2).map((p) => resolve(p));
const copy = join(scratch, "web-copy-run-loop");
const FILES = ["loader.js", "idle-sleep.js", "task-quiescence.js", "package.json", "tests/e5-t37b-run-loop.test.mjs"];
const M = [
  ["baseline", null],
  // round 1 (evidence/e5-t37b/verifier/harness-vs-mutants.mjs)
  ["L1 wrap does not wake", "loader.js", "controller[name] = (...args) => { wakeIdle(); return method.apply(controller, args); };", "controller[name] = (...args) => { return method.apply(controller, args); };"],
  ["L3 wakeIdle does not schedule", "loader.js", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;\n      schedule();", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;"],
  ["L4 sleepIdle leaves tickScheduled false", "loader.js", "      if (!idleSleeper.sleep(ms, tick, ticket)) return false;\n      tickScheduled = true;", "      if (!idleSleeper.sleep(ms, tick, ticket)) return false;"],
  ["L5 sleepIdle ignores paused/stopped/quota and a scheduled tick", "loader.js", "    const sleepIdle = (ms, ticket) => {\n      if (tickScheduled || stopped || paused || quotaPaused) return false;", "    const sleepIdle = (ms, ticket) => {"],
  ["L6 sleepIdle drops the ticket", "loader.js", "idleSleeper.sleep(ms, tick, ticket)", "idleSleeper.sleep(ms, tick)"],
  ["L7 sleep resumes into schedule, not tick", "loader.js", "idleSleeper.sleep(ms, tick, ticket)", "idleSleeper.sleep(ms, schedule, ticket)"],
  ["L13 wrap applied to every boot", "loader.js", "    if (guestClockLifecycle.idleYield) {\n      for (const [name, method] of Object.entries(controller)) {", "    if (true) {\n      for (const [name, method] of Object.entries(controller)) {"],
  ["L15 wakeIdle keeps tickScheduled set (no tick after a wake)", "loader.js", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;\n      schedule();", "      if (!idleSleeper.delivered()) return;\n      schedule();"],
  ["S4 stale-callback guard dropped", "idle-sleep.js", "if (!armed || mine !== generation) return;", "if (!armed) return;"],
  ["S5 wake does not clear the timer", "idle-sleep.js", "    clearTimer(handle);\n", ""],
  // round 2
  ["H1 stop() never finishes (whenDone stays pending)", "loader.js", "        await stopInputCapture();\n        finish(\"stopped\");", "        await stopInputCapture();"],
  ["H2 the sleeper resumes synchronously instead of arming a timer (runaway loop)", "idle-sleep.js", "      const mine = ++generation;\n      handle = setTimer(() => {", "      const mine = ++generation;\n      armed = false; resume(); return true;\n      handle = setTimer(() => {"],
  ["H3 a sleep AND the next tick (two pending)", "loader.js", "      if (!sleepIdle(idleMs, idleTicket)) schedule();", "      sleepIdle(idleMs, idleTicket); tickScheduled = false; schedule();"],
  ["H4 the tick never takes the machine's wait", "loader.js", "idleMs = machine.takeIdleWaitMs(); }", "machine.takeIdleWaitMs(); idleMs = 0; }"],
  ["H5 a host call always reschedules, sleeping or not (second loop)", "loader.js", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;\n      schedule();", "      idleSleeper.delivered();\n      tickScheduled = false;\n      schedule();"],
  ["H6 the sleep is not capped (the machine's 400 ms is slept whole)", "idle-sleep.js", "const duration = Math.min(ms, maxMs);", "const duration = ms;"],
];
const rows = [];
for (const [name, file, find, replace] of M) {
  rmSync(copy, { recursive: true, force: true }); mkdirSync(join(copy, "tests"), { recursive: true });
  for (const f of FILES) cpSync(join(root, "web", f), join(copy, f));
  if (file) {
    const p = join(copy, file), text = readFileSync(p, "utf8");
    if (text.split(find).length !== 2) { rows.push({ name, result: "NOT APPLIED" }); continue; }
    writeFileSync(p, text.replace(find, replace));
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--test", "tests/e5-t37b-run-loop.test.mjs"], { cwd: copy, encoding: "utf8", timeout: 180_000, env: { ...process.env, NODE_OPTIONS: "" } });
  const text = `${r.stdout}${r.stderr}`, seconds = +((Date.now() - t0) / 1000).toFixed(1);
  const num = (k) => Number((text.match(new RegExp(`^ℹ ${k} (\\d+)$`, "m")) ?? [])[1] ?? NaN);
  const failed = [...new Set([...text.matchAll(/^✖ (.*?) \([0-9.]+ms\)$/gm)].map((m) => m[1].slice(0, 60)))];
  const first = (text.match(/^\s+(?:error: |Error \[ERR_TEST_FAILURE\]: |AssertionError[^:]*: )?['"]?([^\n]*(?:pending|stalled|runaway|anchor|settled|slept|live timers|woken|delivery|sleep|tick|slice|wrapped|original)[^\n]*)/m) ?? [])[1];
  rows.push({ name, seconds, killedByProcessTimeout: r.error?.code === "ETIMEDOUT", tests: num("tests"), pass: num("pass"), fail: num("fail"),
    result: file === null ? (num("fail") === 0 && r.status === 0 ? "passes" : "BROKEN") : (r.error?.code === "ETIMEDOUT" ? "HUNG" : num("fail") > 0 || r.status !== 0 ? "noticed" : "NOT NOTICED"),
    failedTests: failed, firstMessage: first?.trim().slice(0, 200) });
}
rmSync(copy, { recursive: true, force: true });
console.log(JSON.stringify({ node: process.version, rows,
  noticed: rows.filter((r) => r.result === "noticed").length, notNoticed: rows.filter((r) => r.result === "NOT NOTICED").map((r) => r.name),
  hung: rows.filter((r) => r.result === "HUNG").map((r) => r.name), slowestSeconds: Math.max(...rows.map((r) => r.seconds ?? 0)) }, null, 1));
