// Exercise the actual CLI guards without permitting output/server/browser setup.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, "../../..");
const missingParent = path.join(out, "preflight-never-created");
assert.equal(await fs.stat(missingParent).catch(() => null), null);
const base = { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" };
for (const key of Object.keys(base)) if (key.startsWith("OMARCHY_")) delete base[key];
const cases = [
  { label: "experiment-outside-input-trial", mode: "verify",
    env: { OMARCHY_INPUT_TRIAL_EXPERIMENT: "residency" },
    expected: "OMARCHY_INPUT_TRIAL_EXPERIMENT requires input-trial mode" },
  { label: "mixed-residency-and-checkpoint", mode: "input-trial",
    env: { OMARCHY_INPUT_TRIAL_EXPERIMENT: "residency", OMARCHY_INPUT_TRIAL_ARM: "control",
      OMARCHY_CANDIDATE_PAIR_DIR: "pinned", OMARCHY_CANDIDATE_CHUNKS: "pinned",
      OMARCHY_FAILURE_CHECKPOINT: "1" },
    expected: "residency is isolated from other experiments" },
];
const results = [];
for (const item of cases) {
  // The nonexistent output parent is a second stop: even a missing guard
  // cannot progress through mkdir to the local server or browser launch.
  const args = ["tools/verify/omarchy-desktop-live.mjs", "local",
    path.join(missingParent, item.label), item.mode];
  const result = spawnSync(process.execPath, args, { cwd: repo, env: { ...base, ...item.env },
    encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1, item.label);
  assert.ok(result.stderr.includes(item.expected), result.stderr);
  assert.equal(await fs.stat(missingParent).catch(() => null), null);
  results.push({ ...item, args, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, noOutputSetup: true });
}
const source = await fs.readFile(path.join(repo, "tools/verify/omarchy-desktop-live.mjs"));
const receipt = { checkedAt: new Date().toISOString(),
  recorderSha256: createHash("sha256").update(source).digest("hex"),
  browsersLaunched: 0, guestRuns: 0, cases: results };
await fs.writeFile(path.join(out, "preflight-checks.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ browsersLaunched: 0, passed: results.map(row => row.label) }, null, 2));
