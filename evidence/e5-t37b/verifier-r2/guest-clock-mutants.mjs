// E5-T37b verifier round 2: mutants of web/guest-clock.js lines 66-133 (the restored-clock
// clause this task's diff added at line 68, and the lines that use its result) against the
// committed unit test file.
//
// usage: node guest-clock-mutants.mjs REPO_ROOT SCRATCH_DIR > guest-clock-mutants.json
//
// Nothing in REPO_ROOT is written: the four sources the test reads and the test itself are
// copied to SCRATCH_DIR/web-copy, each mutant is applied to the copy of guest-clock.js, and
// `node --test tests/e5-t37b-paced-idle.test.mjs` is run there with its own timeout.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [root, scratch] = process.argv.slice(2).map((p) => resolve(p));
const copy = join(scratch, "web-copy");
rmSync(copy, { recursive: true, force: true });
mkdirSync(join(copy, "tests"), { recursive: true });
for (const f of ["guest-clock.js", "idle-sleep.js", "loader.js", "main.js", "package.json", "tests/e5-t37b-paced-idle.test.mjs"]) {
  cpSync(join(root, "web", f), join(copy, f));
}
const original = readFileSync(join(copy, "guest-clock.js"), "utf8");

const L68 = `const selectedMode = interactiveClock === "paced-on-keyboard" || interactiveClock === "paced" ? "paced-icount"`;
const L70 = `if (!restoredClock || (restoredClock.mode !== mode &&
        (mode !== "icount" || restoredClock.mode !== selectedMode)) ||`;
const mutants = [
  ["baseline", "no change", (s) => s],
  ["M1", `68: drop \`|| interactiveClock === "paced"\` (round 1's G5)`,
    [L68, `const selectedMode = interactiveClock === "paced-on-keyboard" ? "paced-icount"`]],
  ["M2", `68: "paced" selects "wall" for the restored-clock check`,
    [L68, `const selectedMode = interactiveClock === "paced-on-keyboard" ? "paced-icount" : interactiveClock === "paced" ? "wall"`]],
  ["M3", "70-71: the checkpoint's mode is not compared at all",
    [L70, `if (!restoredClock ||`]],
  ["M3b", "70-71: any checkpoint mode other than the boot's guestClock is refused (no selected-policy allowance)",
    [L70, `if (!restoredClock || (restoredClock.mode !== mode) ||`]],
  ["M3c", `68: drop "paced-on-keyboard" from the clause`,
    [L68, `const selectedMode = interactiveClock === "paced" ? "paced-icount"`]],
  ["M3d", `69: "wall-on-keyboard" also accepts a paced checkpoint`,
    [`: interactiveClock === "wall-on-keyboard" ? "wall" : mode;`, `: interactiveClock === "wall-on-keyboard" ? "paced-icount" : mode;`]],
  ["M3e", `69: no policy accepts a paced checkpoint (the fallback is "paced-icount" instead of the boot's mode)`,
    [`: interactiveClock === "wall-on-keyboard" ? "wall" : mode;`, `: interactiveClock === "wall-on-keyboard" ? "wall" : "paced-icount";`]],
  ["M4", "72: mtime of the checkpoint is not compared with the machine's",
    [`native?.mtime !== restoredClock.mtime || `, ``]],
  ["M4b", "72: clockDiv of the checkpoint is not compared",
    [`native?.clockDiv !== restoredClock.clockDiv ||`, ``]],
  ["M4c", "73: timebaseHz of the checkpoint is not compared",
    [`native?.timebaseHz !== restoredClock.timebaseHz ||`, ``]],
  ["M4d", "70: a null checkpoint is not refused by the first clause",
    [`if (!restoredClock || (restoredClock.mode`, `if ((restoredClock.mode`]],
  ["M4e", "66+107: a null checkpoint is treated as no checkpoint",
    (s) => { const n = s.split("if (restoredClock !== undefined) {").length - 1; if (n !== 2) throw new Error(`anchor x${n}`); return s.replaceAll("if (restoredClock !== undefined) {", "if (restoredClock) {"); }],
  ["M5", "117: no rebase after a paced (non-icount) restore",
    [`    mode = restoredClock.mode;\n    if (mode !== "icount") machine.rebaseGuestClock();`, `    mode = restoredClock.mode;`]],
  ["M6", "122: the paced clock is selected again on top of a restored paced clock",
    [`  if (interactiveClock === "paced") {\n    if (mode === "icount") {`, `  if (interactiveClock === "paced") {\n    if (true) {`]],
  ["M7", "133: the idle policy is set to not yield",
    [`machine.setPacedIdlePolicy(true, PACED_BUSY_LAG_MS);`, `machine.setPacedIdlePolicy(false, PACED_BUSY_LAG_MS);`]],
  ["M8", "110: the restore selects the boot's guestClock, not the checkpoint's",
    [`machine.setGuestClock(restoredClock.mode);`, `machine.setGuestClock(mode);`]],
  ["M9", "116: the lifecycle forgets the restored mode",
    [`    mode = restoredClock.mode;\n`, ``]],
  ["M10", "112: the after-restore check ignores the mode",
    [`if (after?.mode !== restoredClock.mode || after.mtime`, `if (after.mtime`]],
  ["M11", "134: idleYield is not reported after the policy is set",
    [`    machine.setPacedIdlePolicy(true, PACED_BUSY_LAG_MS);\n    idleYield = true;`, `    machine.setPacedIdlePolicy(true, PACED_BUSY_LAG_MS);`]],
];

const out = [];
for (const [id, what, change] of mutants) {
  let src;
  if (typeof change === "function") src = change(original);
  else {
    const n = original.split(change[0]).length - 1;
    if (n !== 1) throw new Error(`${id}: anchor occurs ${n} times`);
    src = original.replace(change[0], change[1]);
  }
  if (id !== "baseline" && src === original) throw new Error(`${id}: no change`);
  writeFileSync(join(copy, "guest-clock.js"), src);
  const run = spawnSync(process.execPath, ["--test", "--test-timeout=20000", "tests/e5-t37b-paced-idle.test.mjs"],
    { cwd: copy, encoding: "utf8", timeout: 90_000, env: { ...process.env, NODE_OPTIONS: "" } });
  const text = `${run.stdout}${run.stderr}`;
  const num = (k) => Number((text.match(new RegExp(`^ℹ ${k} (\\d+)$`, "m")) ?? [])[1] ?? NaN);
  const failed = [...text.matchAll(/^✖ (.*?) \([0-9.]+ms\)$/gm)].map((m) => m[1]);
  out.push({ id, what, tests: num("tests"), pass: num("pass"), fail: num("fail"), timedOut: run.error?.code === "ETIMEDOUT",
    verdict: id === "baseline" ? (num("fail") === 0 ? "passes" : "BROKEN") : (num("fail") > 0 || run.status !== 0 ? "killed" : "SURVIVED"),
    failedTests: [...new Set(failed)] });
}
writeFileSync(join(copy, "guest-clock.js"), original);
console.log(JSON.stringify({ node: process.version, mutants: out,
  killed: out.filter((m) => m.verdict === "killed").length, survived: out.filter((m) => m.verdict === "SURVIVED").map((m) => m.id) }, null, 1));
