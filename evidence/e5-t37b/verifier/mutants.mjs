// Verifier (E5-T37b): one-line mutants of COPIES of web/{idle-sleep,loader,guest-clock,main}.js,
// each run against the worker's own test file. Usage: node mutants.mjs <repo>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const repo = path.resolve(process.argv[2]); const work = path.join(path.dirname(new URL(import.meta.url).pathname), "mutant-web");
const files = ["idle-sleep.js", "loader.js", "guest-clock.js", "main.js"];
const fresh = () => { rmSync(work, { recursive: true, force: true }); mkdirSync(path.join(work, "tests"), { recursive: true });
  for (const f of files) cpSync(path.join(repo, "web", f), path.join(work, f));
  cpSync(path.join(repo, "web/tests/e5-t37b-paced-idle.test.mjs"), path.join(work, "tests/e5-t37b-paced-idle.test.mjs")); };
const M = [
  // idle-sleep.js
  ["S1 cap ignored", "idle-sleep.js", "const duration = Math.min(ms, maxMs);", "const duration = ms;"],
  ["S2 minimum ignored", "idle-sleep.js", "!(ms >= minMs) ||", "!(ms >= 0) ||"],
  ["S3 delivery does not void the ticket", "idle-sleep.js", "deliveries += 1;\n      return wake();", "return wake();"],
  ["S4 stale-callback guard dropped", "idle-sleep.js", "if (!armed || mine !== generation) return;", "if (!armed) return;"],
  ["S5 wake does not clear the timer", "idle-sleep.js", "    clearTimer(handle);\n", ""],
  ["S6 second sleep allowed while armed", "idle-sleep.js", "if (armed || ticket !== deliveries ||", "if (ticket !== deliveries ||"],
  ["S7 ticket ignored", "idle-sleep.js", "if (armed || ticket !== deliveries ||", "if (armed ||"],
  ["S8 resume not called when the timer fires", "idle-sleep.js", "        handle = undefined;\n        resume();", "        handle = undefined;"],
  ["S9 armed flag left set after the timer fires", "idle-sleep.js", "        armed = false;\n        handle = undefined;\n        resume();", "        handle = undefined;\n        resume();"],
  // loader.js glue
  ["L1 wrap does not wake", "loader.js", "controller[name] = (...args) => { wakeIdle(); return method.apply(controller, args); };", "controller[name] = (...args) => { return method.apply(controller, args); };"],
  ["L2 wake after the method instead of before", "loader.js", "controller[name] = (...args) => { wakeIdle(); return method.apply(controller, args); };", "controller[name] = (...args) => { const r = method.apply(controller, args); wakeIdle(); return r; };"],
  ["L3 wakeIdle does not schedule", "loader.js", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;\n      schedule();", "      if (!idleSleeper.delivered()) return;\n      tickScheduled = false;"],
  ["L4 sleepIdle leaves tickScheduled false", "loader.js", "      if (!idleSleeper.sleep(ms, tick, ticket)) return false;\n      tickScheduled = true;", "      if (!idleSleeper.sleep(ms, tick, ticket)) return false;"],
  ["L5 sleepIdle ignores paused/stopped/quota and a scheduled tick", "loader.js", "    const sleepIdle = (ms, ticket) => {\n      if (tickScheduled || stopped || paused || quotaPaused) return false;", "    const sleepIdle = (ms, ticket) => {"],
  ["L6 sleepIdle drops the ticket", "loader.js", "idleSleeper.sleep(ms, tick, ticket)", "idleSleeper.sleep(ms, tick)"],
  ["L7 sleep resumes into schedule, not tick", "loader.js", "idleSleeper.sleep(ms, tick, ticket)", "idleSleeper.sleep(ms, schedule, ticket)"],
  ["L8 ticket taken after the wait", "loader.js", "{ idleTicket = idleSleeper.ticket(); idleMs = machine.takeIdleWaitMs(); }", "{ idleMs = machine.takeIdleWaitMs(); idleTicket = idleSleeper.ticket(); }"],
  ["L9 gate admits a persistent boot", "loader.js", "(persist !== false || wholeImageUrl == null)", "(wholeImageUrl == null)"],
  ["L10 gate admits a boot without the whole image", "loader.js", "(persist !== false || wholeImageUrl == null)", "(persist !== false)"],
  ["L11 lifecycle built without the policy", "loader.js", "createGuestClockLifecycle(machine, guestClock, icountDivider, interactiveClock, restoredSessionClock ?? gpuWarmData?.clockState)", "createGuestClockLifecycle(machine, guestClock, icountDivider, undefined, restoredSessionClock ?? gpuWarmData?.clockState)"],
  ["L12 wait taken for every boot", "loader.js", "if (guestClockLifecycle.idleYield) { idleTicket", "if (true) { idleTicket"],
  ["L13 wrap applied to every boot", "loader.js", "    if (guestClockLifecycle.idleYield) {\n      for (const [name, method] of Object.entries(controller)) {", "    if (true) {\n      for (const [name, method] of Object.entries(controller)) {"],
  ["L14 tick end always schedules (never sleeps)", "loader.js", "if (!sleepIdle(idleMs, idleTicket)) schedule();", "schedule();"],
  // guest-clock.js
  ["G1 policy set with yield false", "guest-clock.js", "machine.setPacedIdlePolicy(true, PACED_BUSY_LAG_MS);", "machine.setPacedIdlePolicy(false, PACED_BUSY_LAG_MS);"],
  ["G2 time-moved check dropped", "guest-clock.js", "if (after?.mode !== \"paced-icount\" || after.mtime !== before.mtime ||\n          after.timebaseHz !== before.timebaseHz || after.clockDiv !== before.clockDiv) {\n        throw new Error(\"paced clock selection changed", "if (after?.mode !== \"paced-icount\") {\n        throw new Error(\"paced clock selection changed"],
  ["G3 bindings check dropped", "guest-clock.js", "for (const method of [\"setPacedIdlePolicy\", \"takeIdleWaitMs\"]) {", "for (const method of []) {"],
  ["G4 idleYield reported for every policy", "guest-clock.js", "  let idleYield = false;", "  let idleYield = true;"],
  ["G5 restore path: paced not accepted as the selected mode", "guest-clock.js", "interactiveClock === \"paced-on-keyboard\" || interactiveClock === \"paced\" ? \"paced-icount\"", "interactiveClock === \"paced-on-keyboard\" ? \"paced-icount\""],
  ["G6 unbounded busy lag", "guest-clock.js", "machine.setPacedIdlePolicy(true, PACED_BUSY_LAG_MS);", "machine.setPacedIdlePolicy(true, undefined);"],
  // main.js
  ["M1 pace=0 ignored", "main.js", "get(\"pace\") === \"0\" ? undefined : \"paced\"", "get(\"pace\") === \"never\" ? undefined : \"paced\""],
  ["M2 paced never requested", "main.js", "get(\"pace\") === \"0\" ? undefined : \"paced\"", "get(\"pace\") === \"0\" ? undefined : undefined"],
];
const rows = [];
for (const [name, file, find, replace] of M) {
  fresh(); const p = path.join(work, file); const text = readFileSync(p, "utf8");
  if (text.split(find).length !== 2) { rows.push({ name, file, result: "NOT APPLIED (text not found exactly once)" }); continue; }
  writeFileSync(p, text.replace(find, replace));
  const r = spawnSync(process.execPath, ["--test", "tests/e5-t37b-paced-idle.test.mjs"], { cwd: work, encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
  if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL") { rows.push({ name, file, result: "killed (the test file HANGS: no result within 20 s)", by: [] }); spawnSync("pkill", ["-f", "mutant-web|tests/e5-t37b-paced-idle.test.mjs"]); continue; }
  const failed = [...r.stdout.matchAll(/^✖ (.+?) \([\d.]+ms\)$/gm)].map((m) => m[1]);
  rows.push({ name, file, result: r.status === 0 ? "SURVIVED" : "killed", by: [...new Set(failed)] });
}
fresh(); const base = spawnSync(process.execPath, ["--test", "tests/e5-t37b-paced-idle.test.mjs"], { cwd: work, encoding: "utf8" });
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify({ unmutatedCopyPasses: base.status === 0, mutants: rows }, null, 1));
