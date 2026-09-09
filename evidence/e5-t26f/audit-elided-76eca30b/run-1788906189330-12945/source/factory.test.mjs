import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AUDIT_ELIDED_PLAY_SHA256, CURRENT_HEAD, HELPER_REMOVAL, SEAL, SOURCE_PINS, deriveAuditElided, derivePlayBody, extractUnique, generateAuditElided, shellSingleQuote, validateAuditEnvironment } from "./factory.mjs";
// Import itself must be inert: no target creation and no browser side effects.
import { createRunLayout, validateClosedResult } from "./run.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sources = Object.fromEntries(Object.keys(SOURCE_PINS).map(file => [file, readFileSync(path.join(repo, file))]));
const baseEnv = () => ({ E5_T26F_REQUIRE_HEAD: CURRENT_HEAD, E5_T26F_FIXTURE: "resident-observer-v1", E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/audit-elided-sealed", E5_T26F_DIAGNOSTIC_PORT: "61637", E5_T26F_OUT: "/private/tmp/audit-elided-output" });

test("pins current sources and refuses drift", () => {
  const a = deriveAuditElided(sources), b = deriveAuditElided(sources);
  assert.deepEqual(a, b); assert.equal(a.acceptance, false); assert.equal(a.fVerified, false); assert.equal(a.postIdentityValidated, false);
  for (const file of Object.keys(SOURCE_PINS)) assert.equal(sha(sources[file]), SOURCE_PINS[file]);
  assert.throws(() => deriveAuditElided({ ...sources, [Object.keys(SOURCE_PINS)[0]]: Buffer.concat([sources[Object.keys(SOURCE_PINS)[0]], Buffer.from("\n")]) }), /pinned source drift/);
});

test("admission refuses overrides and requires the current seal", () => {
  assert.deepEqual(validateAuditEnvironment(baseEnv(), CURRENT_HEAD), { mode: "audit-elided-counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false });
  for (const key of ["CPU", "LATENCY", "JIT", "RESIDENCY", "COMMAND", "COMPLETE", "KEY_DELAY_MS", "UNKNOWN"]) assert.throws(() => validateAuditEnvironment({ ...baseEnv(), [`E5_T26F_DIAGNOSTIC_${key}`]: "" }, CURRENT_HEAD), /refuses override/);
  assert.throws(() => validateAuditEnvironment({ ...baseEnv(), E5_T26F_REQUIRE_HEAD: "05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6" }, CURRENT_HEAD), /76eca30b/);
  assert.equal(SEAL.creatorHead, CURRENT_HEAD);
});

test("generated source removes exactly the requested guest block and retains guards", () => {
  const generated = deriveAuditElided(sources).source;
  const helper = sources["tools/guest/e5-t26f-resident-observer.sh"].toString();
  const play = derivePlayBody(helper);
  assert.equal(play.derived.length, 535); assert.equal(sha(play.derived), AUDIT_ELIDED_PLAY_SHA256);
  const shell = spawnSync("sh", ["-n"], { input: `eval ${shellSingleQuote(play.derived)}; printf '\\033[2J\\033[H'\n`, encoding: "utf8" });
  assert.equal(shell.status, 0, shell.stderr);
  assert.ok(generated.includes("audit-elided-ready"));
  assert.ok(generated.includes("\\\\033[2J\\\\033[H"));
  const command = JSON.parse(generated.match(/const quietCommand = ("[^\n]+");/u)[1]);
  assert.match(command, /^[\x20-\x7e]+$/u, "physical setup has no literal newline");
  const encoded = command.match(/printf %s '([A-Za-z0-9+/=]+)'\|base64 -d/u)[1];
  assert.equal(Buffer.from(encoded, "base64").toString(), play.derived);
  const setup = spawnSync("sh", ["-c", command + "; type e5_play >/dev/null"], { encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(setup.stdout, "\x1b[2J\x1b[H\x1b[42me5t26f-audit-elided-ready\x1b[0m\n");
  assert.ok(generated.includes('typeCommand(quietCommand, "e5t26f-audit-elided-ready",'));
  assert.ok(!generated.includes('typeCommand(quietCommand, "quiet-probe-ready",'));
  assert.ok(helper.includes('e5_observe && [ "$e5_seen" = "$e5_expected" ]'));
  assert.ok(helper.includes("e5_print_observation post"));
  assert.ok(play.derived.includes("e5_armed=0")); assert.ok(play.derived.includes("trap ':' PIPE"));
  assert.ok(play.derived.includes('if wait "$e5_pid"; then')); assert.ok(play.derived.includes("exec 3>&-"));
  assert.doesNotMatch(generated, /postAudioCommand\.visualDiffPixels >= 2_000/u);
  assert.ok(generated.includes("baselineMatches,[]"));
  assert.ok(generated.includes("postRestoreEnd - postRestoreStart <= 2_000"));
  assert.ok(generated.includes("postIdentityValidated: false"));
  for (const removed of HELPER_REMOVAL) assert.ok(helper.includes(removed));
});

test("generated module is syntactically valid and imports are pinned absolute files", () => {
  const generated = deriveAuditElided(sources).source;
  const checked = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: generated, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr); assert.doesNotMatch(generated, /from "\.\.?\//u);
  assert.ok(extractUnique(generated, "async function typeQuietTextCommand()", "async function waitForDesktopReady(").includes("findTemplate"));
});

test("factory writes only a fresh generated target and metadata", async t => {
  const parent = path.join(repo, "target/e5-t26f");
  const output = path.join(parent, `audit-elided-76eca30b-factory-test-${randomUUID()}`);
  const metadata = await generateAuditElided(output, baseEnv());
  t.after(() => rmSync(output, { recursive: true, force: true }));
  assert.equal(metadata.acceptance, false); assert.equal(metadata.fVerified, false);
  assert.deepEqual(metadata.seal, SEAL); assert.deepEqual(metadata.sourcePins, SOURCE_PINS);
  assert.equal(JSON.parse(readFileSync(path.join(output, "factory.json"))).generatedSourceSha256, metadata.generatedSourceSha256);
  await assert.rejects(generateAuditElided(output, baseEnv()), /EEXIST/u);
});

test("closed result uses original cap and rejects non-cap or missing proof", () => {
  const labels = { auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false };
  const make = end => ({ ...labels, milestones: { ...labels,
    run: { binding: { head: CURRENT_HEAD, runtimeSha256: SEAL.runtimeSha256 } },
    postRestoreStart: 1000, postRestoreEnd: end,
    normalRestore: { result: { completedAt: 1000 } } } });
  assert.deepEqual(validateClosedResult(make(3000), 0),
    { t0: 1000, end: 3000, elapsedMs: 2000, capLimitMs: 2000, capFailed: false });
  const failed = make(3001);
  failed.error = { message: "post-restore interaction exceeded 2 seconds" };
  assert.equal(validateClosedResult(failed, 1).capFailed, true);
  assert.throws(() => validateClosedResult(failed, 0));
  assert.throws(() => validateClosedResult({ ...failed, error: { message: "missing audio" } }, 1));
  assert.throws(() => validateClosedResult({ ...failed, fVerified: true }, 1));
  const incomplete = make(undefined);
  assert.throws(() => validateClosedResult(incomplete, 1));
});

test("launcher metadata cannot occupy the child's fresh record directory", async t => {
  const output = path.join(repo, "target/e5-t26f", `audit-elided-layout-test-${randomUUID()}`);
  const layout = await createRunLayout(output);
  t.after(() => rmSync(output, { recursive: true, force: true }));
  writeFileSync(path.join(output, "invocation.json"), "{}\n", { flag: "wx" });
  assert.equal(layout.record, path.join(output, "record"));
  assert.deepEqual(readdirSync(layout.record), []);
  assert.deepEqual(readdirSync(output).sort(), ["invocation.json", "record"]);
  await assert.rejects(createRunLayout(output), /EEXIST/u);
  const launcher = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  assert.ok(launcher.includes('E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_OUT: record'));
  assert.ok(launcher.includes('generateAuditElided(target, env)'));
  assert.ok(launcher.includes('cwd: repo, env, stdio:'));
  assert.ok(launcher.includes('const rawPath = path.join(record,'));
});
