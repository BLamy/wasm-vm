// Verifier: does run-loop-harness.mjs notice the loader/sleeper mutants (incl. the ones the worker's tests miss)?
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const repo = path.resolve(process.argv[2]); const here = path.dirname(new URL(import.meta.url).pathname); const work = path.join(here, "harness-mutant-web");
const M = [
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
];
const rows = [];
for (const [name, file, find, replace] of M) {
  rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
  for (const f of ["loader.js", "idle-sleep.js", "task-quiescence.js"]) cpSync(path.join(repo, "web", f), path.join(work, f));
  const p = path.join(work, file), text = readFileSync(p, "utf8");
  if (text.split(find).length !== 2) { rows.push({ name, result: "NOT APPLIED" }); continue; }
  writeFileSync(p, text.replace(find, replace));
  // The wrap anchor of the harness is the unmutated text; L13 changes it, so tell the harness.
  const r = spawnSync(process.execPath, [path.join(here, "run-loop-harness.mjs"), work, "120"], { encoding: "utf8", timeout: 120_000, env: { ...process.env, HARNESS_WRAP_ANCHOR: name.startsWith("L13") ? "    if (true) {\n      for (const [name, method] of Object.entries(controller)) {" : "" } });
  let failed = []; try { failed = JSON.parse(r.stdout).results.filter((x) => !x.ok).map((x) => `${x.name.slice(0, 40)}: ${x.error.slice(0, 110)}`); } catch { failed = ["harness crashed: " + (r.stderr || r.error?.message || "").split("\n").find((l) => /Error/.test(l))?.slice(0, 140)]; }
  rows.push({ name, result: failed.length ? "noticed" : "NOT NOTICED", by: failed });
}
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(rows, null, 1));
