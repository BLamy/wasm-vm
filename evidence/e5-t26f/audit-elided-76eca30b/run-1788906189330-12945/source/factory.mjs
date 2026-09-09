#!/usr/bin/env node
// Build-only factory for one audit-elided counterfactual. This module never launches a browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CURRENT_HEAD = "76eca30b248268e130395c53cb09da62637388a7";
export const SOURCE_PINS = Object.freeze({
  "tools/verify/e5-t26f-browser-roundtrip.mjs": "7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1",
  "tools/verify/e5-t26f-quiet-text-probe.mjs": "1c38cf75c420bf6dc9b187c6aed59e6d0c838e780c1a06e169157e3b5158f6f4",
  "tools/verify/e5-t26f-text-oracle.mjs": "dc14730662600ff3cc978848065d86e431793258c00056c9ae0c3d326edc11ba",
  "tools/verify/e5-t26f-resident-proof.mjs": "d5615b185536f0f0af3da7d4b133ec28ec9e2c62962d22b3cd57e8c24f5a5810",
  "tools/verify/e5-t26f-browser-single-process-observer.mjs": "3be35665f7d403f9c291b5b81b1c07449ef526d171a53f5e7a69b087e79c416d",
  "tools/guest/e5-t26f-resident-observer.sh": "5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9",
  "web/pkg/wasm_vm_wasm_bg.wasm": "20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238",
  "tools/verify/e5-t22c-cpu-profile.mjs": "f75fb38299169c662f6f6668d63d17e8ddaf6ec70a19082455e9de121ea5d5d4",
  "tools/verify/e5-t26f-guest-profile.mjs": "1b9d202be44aa3c01f770ef5483551be0cfc828631b6cbc78caff53baf70948a",
  "tools/verify/e5-t26k-decoded-cache.mjs": "fc6dde980554845fc3d28f5e44dcd0caf0c1659d48b320054a00aeb8e67e9843",
  "web/bench/desktop-perf.js": "d612908317a9d8b6fa031d1652865115b77428c2a923adf32d1642f39be712ed",
  "evidence/e5-t26f/resident-text-template.json": "58609c000193c8079fa21a408aef4d6dd7a7ad17fbc06d3e3f6bd02a6894e85e",
  "evidence/e5-t26f/single-process-observer-76eca30b/invocation.json": "8a44018960c2ae8bdc57e87a786c0773aebf33a12d67382c760eac2a2d3e421d",
});
export const SEAL = Object.freeze({
  creatorHead: CURRENT_HEAD,
  profileSha256: "f634092cc1fa969084d9316f07d4c8dbfdc9685cba445b933d20c049d516efaf",
  snapshotSha256: "573f27b65af05197d1b30a4c745be5582500653e0c031541333ff99da410f1ae",
  runtimeSha256: "18953aff6f7cbab92d13460912bbb868a951b42ad7b5aadfdadc1e46b0913190",
  imageSha256: "d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72",
  wasmSha256: "20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238",
});
export const HELPER_REMOVAL = Object.freeze([
  "e5_observe && [ \"$e5_seen\" = \"$e5_expected\" ] || {",
  "e5_fail \"post-identity:${e5_reason:-changed}\"; return 1;",
  "e5_print_observation post",
]);
export const AUDIT_ELIDED_PLAY_SHA256 = "50fa3e0e8264ebdb6f31d2816c06a5275e8ba4c9ddb892a8cc989ef068f83c58";
const POST_GUARD = `    e5_observe && [ "$e5_seen" = "$e5_expected" ] || {
        e5_fail "post-identity:\${e5_reason:-changed}"; return 1;
    }
    e5_print_observation post
`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function replaceUnique(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `source anchor missing or nonunique: ${anchor.slice(0, 100)}`);
  return source.replace(anchor, () => replacement);
}

export function extractUnique(source, start, end) {
  for (const anchor of [start, end]) assert.equal(source.split(anchor).length, 2, `source boundary missing or nonunique: ${anchor}`);
  const a = source.indexOf(start), b = source.indexOf(end);
  assert.ok(b > a, "source boundaries reversed");
  return source.slice(a, b);
}

export function validateAuditEnvironment(env, requiredHead) {
  assert.equal(env.E5_T26F_FIXTURE, "resident-observer-v1");
  assert.equal(env.E5_T26F_DIAGNOSTIC, "reuse");
  assert.equal(env.E5_T26F_REQUIRE_HEAD, requiredHead);
  const allowed = new Set(["E5_T26F_DIAGNOSTIC_PROFILE", "E5_T26F_DIAGNOSTIC_PORT"]);
  for (const key of Object.keys(env)) if (key.startsWith("E5_T26F_DIAGNOSTIC_") && !allowed.has(key)) {
    assert.fail(`audit-elided counterfactual refuses override ${key}, including empty values`);
  }
  for (const [key, predicate] of [
    ["E5_T26F_DIAGNOSTIC_PROFILE", value => typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value && value !== path.parse(value).root],
    ["E5_T26F_OUT", value => typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value && value !== path.parse(value).root],
  ]) assert.ok(predicate(env[key]), `explicit normalized ${key} required`);
  assert.match(env.E5_T26F_DIAGNOSTIC_PORT, /^[1-9][0-9]*$/u);
  assert.ok(Number(env.E5_T26F_DIAGNOSTIC_PORT) >= 1024 && Number(env.E5_T26F_DIAGNOSTIC_PORT) <= 65535);
  return { mode: "audit-elided-counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false };
}

const AUDIT_LABEL = `auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false`;
const auditRecordLabel = Object.freeze({ auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false });

export function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function derivePlayBody(helper) {
  const start = helper.indexOf("e5_play() {\n");
  const end = helper.indexOf("\n}\n\n# Four plain", start);
  assert.ok(start >= 0 && end > start, "current helper e5_play boundary missing");
  const original = helper.slice(start, end + 3);
  assert.equal(original.length, 691, "current e5_play body length drift");
  const derived = replaceUnique(original, POST_GUARD, "");
  assert.equal(derived.length, 535, "audit-elided e5_play body length drift");
  assert.equal(hash(derived), AUDIT_ELIDED_PLAY_SHA256, "audit-elided e5_play body digest drift");
  return { original, derived };
}

export function deriveAuditElided(sources, repo = repository) {
  assert.ok(path.isAbsolute(repo) && path.resolve(repo) === repo);
  for (const [relative, expected] of Object.entries(SOURCE_PINS)) assert.equal(hash(sources[relative]), expected, `pinned source drift: ${relative}`);
  let source = sources["tools/verify/e5-t26f-browser-roundtrip.mjs"].toString();
  const held = sources["tools/verify/e5-t26f-quiet-text-probe.mjs"].toString();
  const changes = [];
  const replace = (label, anchor, replacement) => {
    source = replaceUnique(source, anchor, replacement);
    changes.push({ label, beforeSha256: hash(anchor), afterSha256: hash(replacement) });
  };
  replace("oracle import", 'import assert from "node:assert/strict";', 'import assert from "node:assert/strict";\nimport { createTextOracle } from "./e5-t26f-text-oracle.mjs";');
  replace("held raster configuration", "const jsonReplacer =", extractUnique(held, "const reviewedTextFile =", "const jsonReplacer =") + "const jsonReplacer =");
  const helper = sources["tools/guest/e5-t26f-resident-observer.sh"].toString();
  const play = derivePlayBody(helper);
  // The existing physical-key helper accepts printable characters, not literal newlines.
  // Decode the exact reviewed body during untimed setup; no audit result is fabricated.
  const encodedPlay = Buffer.from(play.derived).toString("base64");
  const ramInstall = `eval "$(printf %s '${encodedPlay}'|base64 -d)";printf '\\033[2J\\033[H\\033[42me5t26f-audit-elided-ready\\033[0m\\n'`;
  const guard = `${validateAuditEnvironment.toString()}\nvalidateAuditEnvironment(process.env, ${JSON.stringify(CURRENT_HEAD)});\nconst auditSourcePins = ${JSON.stringify(SOURCE_PINS)};\nconst auditSeal = ${JSON.stringify(SEAL)};\nconst auditElidedPlayBodySha256 = ${JSON.stringify(AUDIT_ELIDED_PLAY_SHA256)};\nfor (const [relative, expected] of Object.entries(auditSourcePins)) assert.equal(sha256(await readFile(path.join(repo, relative))), expected, "audit source drift: " + relative);\nassert.equal(sha256(await readFile(path.join(repo, "web/pkg/wasm_vm_wasm_bg.wasm"))), auditSeal.wasmSha256, "sealed WASM drift");\n`;
  replace("isolated admission and current seal pins", "const diagnostic = diagnosticOptions(process.env);", guard.replace("validateAuditEnvironment(process.env);", `validateAuditEnvironment(process.env, ${JSON.stringify(CURRENT_HEAD)});`) + "const diagnostic = diagnosticOptions(process.env);");
  replace("held exact physical-text oracle", "async function waitForDesktopReady(", extractUnique(held, "async function typeQuietTextCommand()", "async function waitForDesktopReady(") + "async function waitForDesktopReady(");
  replace("read-only raster and titlebar installation", "  page = await context.newPage();\n", "  page = await context.newPage();\n" + extractUnique(held, "  await page.addInitScript({ content: `globalThis.__e5FTextOracle", "  if (diagnostic?.guestProfile) await page.addInitScript(").trimEnd() + "\n");
  replace("current 76eca30b seal and copied profile", "  const diagnosticCheckpoint = retained?.checkpoint || null;", `  const diagnosticCheckpoint = retained?.checkpoint || null;
  assert.ok(diagnosticCheckpoint, "audit-elided counterfactual requires retained current seal");
  assert.notEqual(retained.profile, retained.seed, "never launch the sealed profile directly");
  assert.equal(retained.creatorHead, auditSeal.creatorHead);
  assert.equal(diagnosticCheckpoint.profileSha256, auditSeal.profileSha256);
  assert.equal(diagnosticCheckpoint.normalSnapshot.sha256, auditSeal.snapshotSha256);
  assert.equal(binding.runtimeSha256, auditSeal.runtimeSha256);
  assert.equal(binding.imageSha256, auditSeal.imageSha256);`);
  let setup = extractUnique(held, "  const baselineRestore =", "  milestones.normalRestore = { result: firstRestore,");
  setup = replaceUnique(setup, extractUnique(setup, "  const quietCommand =", "  milestones.quietProbe ="), `  await auditRestoreCoherence(baselineRestore, normalSnapshot, "baseline-before-audit-elision");
  const quietCommand = ${JSON.stringify(ramInstall)};
`);
  setup = replaceUnique(setup, 'typeCommand(quietCommand, "quiet-probe-ready",',
    'typeCommand(quietCommand, "e5t26f-audit-elided-ready",');
  setup = replaceUnique(setup, 'limitation: "RAM-only printer replacement; NOT the frozen installed helper or acceptance fixture"',
    '...auditRecordLabel, limitation: "RAM-only audit and reporting elision plus setup display clear; no fresh post-identity proof or acceptance"');
  replace("authenticated baseline plus derived RAM snapshot", '  const firstRestore = await reloadWithAutoRestore(restoreUrl, "normal", Boolean(diagnosticCheckpoint));\n', setup);
  const oldCommand = extractUnique(source, "  const postAudioCommand = await typeCommand(", "  milestones.postRestoreAplay = postAudioCommand;");
  const quietCommand = extractUnique(held, '  assert.equal(postRestoreCommand, "play");', "  milestones.postRestoreAplay = postAudioCommand;");
  replace("held timed play and exact physical-text proof", oldCommand, quietCommand);
  const oldAssertion = '    assert.ok(postAudioCommand.terminalMarkerSeen && postAudioCommand.visualDiffPixels >= 2_000,\n' + '      "post-restore aplay did not produce guest-visible terminal output");';
  const quietAssertions = extractUnique(held, '    assert.equal(postAudioCommand.oracle, "fresh-exact-reviewed-raster");', '    assert.deepEqual(postAudioCommand.baselineMatches,[]);') + '    assert.deepEqual(postAudioCommand.baselineMatches,[]);';
  replace("exact token oracle replaces incompatible pixel heuristic", oldAssertion, quietAssertions);
  source = replaceUnique(source, "const milestones = {", `const auditRecordLabel = { ${AUDIT_LABEL}, limitation: "combined validation/reporting-path materiality only; no causation or acceptance claim" };
const milestones = { ...auditRecordLabel,`);
  source = replaceUnique(source, "  const diagnostic = {\n", "  const diagnostic = { ...auditRecordLabel,\n");
  const resultAnchor = "const result = { schema: \"wasm-vm.e5-t26f.diagnostic-iteration.v1\", acceptance: false,";
  assert.equal(source.split(resultAnchor).length, 3, "diagnostic result anchors drifted");
  source = source.replaceAll(resultAnchor, `const result = { ...auditRecordLabel, schema: "wasm-vm.e5-t26f.diagnostic-iteration.v1", acceptance: false,`);
  assert.ok(helper.includes('e5_observe && [ "$e5_seen" = "$e5_expected" ] || {'));
  assert.ok(helper.includes("e5_print_observation post"));
  replace("repository root", 'const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");', `const repo = ${JSON.stringify(repo)};`);
  const imports = [...source.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)].map(match => match[1]);
  for (const relative of imports) {
    const filename = path.resolve(repo, "tools/verify", relative);
    assert.ok(filename.startsWith(repo + path.sep), "derived import escapes repository");
    source = replaceUnique(source, `from "${relative}"`, `from ${JSON.stringify(pathToFileURL(filename).href)}`);
  }
  return { source, changes, acceptance: false, fVerified: false, postIdentityValidated: false, auditRecordLabel,
    auditElidedPlayBodySha256: hash(play.derived), auditElidedPlayBodyBytes: play.derived.length,
    setupVisualChange: "clear-display-and-home before audit-elided readiness marker; outside T0" };
}

export async function generateAuditElided(output, env = process.env) {
  validateAuditEnvironment(env, CURRENT_HEAD);
  const parent = path.join(repository, "target/e5-t26f");
  assert.ok(typeof output === "string" && path.isAbsolute(output) && path.resolve(output) === output &&
    path.dirname(output) === parent && /^audit-elided-76eca30b-[A-Za-z0-9-]+$/u.test(path.basename(output)),
  "fresh task-owned target/e5-t26f/audit-elided-76eca30b-NAME directory required");
  assert.equal(await realpath(parent), parent, "generated output parent symlink refused");
  const sources = {};
  for (const relative of Object.keys(SOURCE_PINS)) sources[relative] = await readFile(path.join(repository, relative));
  assert.equal(hash(sources["web/pkg/wasm_vm_wasm_bg.wasm"]), SEAL.wasmSha256, "current WASM digest differs from the sealed runtime");
  const derived = deriveAuditElided(sources);
  await mkdir(output);
  const script = path.join(output, "probe.mjs");
  await writeFile(script, derived.source, { flag: "wx" });
  const metadata = { schema: "wasm-vm.e5-t26f.audit-elided-counterfactual-factory.v1", ...derived,
    sourcePins: SOURCE_PINS, seal: SEAL, helperRemovals: HELPER_REMOVAL,
    auditElidedPlayBodySha256: AUDIT_ELIDED_PLAY_SHA256, auditElidedPlayBodyBytes: 535,
    factorySha256: hash(await readFile(fileURLToPath(import.meta.url))), generatedSourceSha256: hash(derived.source),
    invocation: { cwd: repository, argv: [process.execPath, script], env: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("E5_T26F_"))) },
    limitation: "one build-only audit-elided screen; acceptance:false; fVerified:false; postIdentityValidated:false; no browser launched by factory" };
  await writeFile(path.join(output, "factory.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "usage: factory.mjs /ABS/target/e5-t26f/audit-elided-76eca30b-NAME");
  console.log(JSON.stringify(await generateAuditElided(process.argv[2]), null, 2));
}
