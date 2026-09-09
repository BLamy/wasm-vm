#!/usr/bin/env node
// Build-only factory for ONE nonacceptance screen; this module never launches a browser.
// Derive from the current proper runner, not the held quiet driver's older runtime bindings.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE_PINS = Object.freeze({
  "tools/verify/e5-t26f-browser-roundtrip.mjs": "7f8b58f7e3f6e0f16b7b6cb91b8593e625ed058e7aa764df428e9990f85100a1",
  "tools/verify/e5-t26f-quiet-text-probe.mjs": "1c38cf75c420bf6dc9b187c6aed59e6d0c838e780c1a06e169157e3b5158f6f4",
  "tools/verify/e5-t26f-text-oracle.mjs": "dc14730662600ff3cc978848065d86e431793258c00056c9ae0c3d326edc11ba",
  "evidence/e5-t26f/resident-text-template.json": "58609c000193c8079fa21a408aef4d6dd7a7ad17fbc06d3e3f6bd02a6894e85e",
});
// Observed in the CLOSED 05b record, not guessed from the current checkout.
export const SEAL = Object.freeze({
  creatorHead: "05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6",
  profileSha256: "f7a2bc52a45ed895eb1edd71f722ab1fb5c5ccf106a0753a6630b17f84940685",
  snapshotSha256: "87477fbfe7b1d31edfb75336f0f49f0001f175106a6506933cef733d579699e7",
  runtimeSha256: "f897f34951ca3ab59909f0ce6bbe2e8a68a6620cdace4d1e4eca617cbd601ce8",
  imageSha256: "d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72",
});
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Also serialized into the generated driver, before any output/profile/browser work.
export function validateQuietEnvironment(env) {
  assert.equal(env.E5_T26F_FIXTURE, "resident-observer-v1", "quiet screen requires the C observer fixture");
  assert.equal(env.E5_T26F_DIAGNOSTIC, "reuse", "quiet screen is reuse-only, never acceptance or cold creation");
  const allowed = ["E5_T26F_DIAGNOSTIC_PROFILE", "E5_T26F_DIAGNOSTIC_PORT"];
  for (const key of Object.keys(env)) {
    if (key.startsWith("E5_T26F_DIAGNOSTIC_") && !allowed.includes(key)) {
      assert.fail(`quiet screen refuses diagnostic override ${key}, including empty values`);
    }
  }
  const directory = env.E5_T26F_DIAGNOSTIC_PROFILE;
  assert.ok(typeof directory === "string" && path.isAbsolute(directory) &&
    path.resolve(directory) === directory && directory !== path.parse(directory).root, "explicit normalized sealed profile required");
  assert.ok(typeof env.E5_T26F_DIAGNOSTIC_PORT === "string" && /^[1-9][0-9]*$/u.test(env.E5_T26F_DIAGNOSTIC_PORT) &&
    Number(env.E5_T26F_DIAGNOSTIC_PORT) >= 1024 && Number(env.E5_T26F_DIAGNOSTIC_PORT) <= 65535, "explicit stable port required");
  assert.ok(typeof env.E5_T26F_OUT === "string" && path.isAbsolute(env.E5_T26F_OUT) &&
    path.resolve(env.E5_T26F_OUT) === env.E5_T26F_OUT && env.E5_T26F_OUT !== path.parse(env.E5_T26F_OUT).root,
  "explicit fresh evidence output required");
  return { acceptance: false, fVerified: false, mode: "single-process-quiet-screen" };
}

export function replaceUnique(source, anchor, replacement) {
  assert.ok(anchor && source.split(anchor).length === 2, `source anchor missing or nonunique: ${anchor.slice(0, 100)}`);
  return source.replace(anchor, () => replacement);
}

export function extractUnique(source, start, end) {
  for (const anchor of [start, end]) {
    assert.equal(source.split(anchor).length, 2, `source boundary missing or nonunique: ${anchor}`);
  }
  const a = source.indexOf(start), b = source.indexOf(end);
  assert.ok(b > a, "source boundaries reversed");
  return source.slice(a, b);
}

export function deriveQuietProbe(sources, repo = repository) {
  assert.ok(path.isAbsolute(repo) && path.resolve(repo) === repo, "normalized repository path required");
  for (const [relative, expected] of Object.entries(SOURCE_PINS)) {
    assert.equal(hash(sources[relative]), expected, `pinned source drift: ${relative}`);
  }
  let source = sources["tools/verify/e5-t26f-browser-roundtrip.mjs"].toString();
  const held = sources["tools/verify/e5-t26f-quiet-text-probe.mjs"].toString();
  const changes = [];
  function replace(label, anchor, replacement) {
    source = replaceUnique(source, anchor, replacement);
    changes.push({ label, beforeSha256: hash(anchor), afterSha256: hash(replacement) });
  }
  replace("oracle import", 'import assert from "node:assert/strict";',
    'import assert from "node:assert/strict";\nimport { createTextOracle } from "./e5-t26f-text-oracle.mjs";');
  const config = extractUnique(held, "const reviewedTextFile =", "const jsonReplacer =");
  replace("held raster configuration", "const jsonReplacer =", config + "const jsonReplacer =");
  const guard = `${validateQuietEnvironment.toString()}\nvalidateQuietEnvironment(process.env);\n` +
    `const quietSourcePins = ${JSON.stringify(SOURCE_PINS)};\nconst quietSeal = ${JSON.stringify(SEAL)};\n` +
    `for (const [relative, expected] of Object.entries(quietSourcePins))\n` +
    `  assert.equal(sha256(await readFile(path.join(repo, relative))), expected, "quiet screen source drift: " + relative);\n`;
  replace("early isolated admission and live source pins", "const diagnostic = diagnosticOptions(process.env);",
    guard + "const diagnostic = diagnosticOptions(process.env);");
  const oracle = extractUnique(held, "async function typeQuietTextCommand()", "async function waitForDesktopReady(");
  replace("held exact physical-text oracle", "async function waitForDesktopReady(", oracle + "async function waitForDesktopReady(");
  const install = extractUnique(held, "  await page.addInitScript({ content: `globalThis.__e5FTextOracle", "  if (diagnostic?.guestProfile) await page.addInitScript(");
  replace("read-only raster and titlebar installation", "  page = await context.newPage();",
    "  page = await context.newPage();\n" + install.trimEnd());
  replace("05b seal only, copied by unchanged prepareDiagnostic", "  const diagnosticCheckpoint = retained?.checkpoint || null;",
    `  const diagnosticCheckpoint = retained?.checkpoint || null;
  assert.ok(diagnosticCheckpoint, "quiet screen requires the sealed checkpoint");
  assert.notEqual(retained.profile, retained.seed, "never launch the original sealed profile");
  assert.equal(retained.creatorHead, quietSeal.creatorHead);
  assert.equal(diagnosticCheckpoint.profileSha256, quietSeal.profileSha256);
  assert.equal(diagnosticCheckpoint.normalSnapshot.sha256, quietSeal.snapshotSha256);
  assert.equal(binding.runtimeSha256, quietSeal.runtimeSha256);
  assert.equal(binding.imageSha256, quietSeal.imageSha256);`);
  replace("nonacceptance provenance", "let lastPhase = null;",
    `milestones.run.singleProcessQuiet = { acceptance: false, fVerified: false,
  sourcePins: quietSourcePins, seal: quietSeal,
  generatedSourceSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  argv: process.argv.slice(), limitation: "RAM-only printer suppression; one diagnostic screen, no speedup or F acceptance claim" };
let lastPhase = null;`);
  let setup = extractUnique(held, "  const baselineRestore =", "  milestones.normalRestore = { result: firstRestore,");
  // Authenticate the old restore before the RAM-only intervention; this is setup, not timed play.
  setup = replaceUnique(setup, "  const quietCommand =",
    '  await auditRestoreCoherence(baselineRestore, normalSnapshot, "baseline-before-quiet");\n  const quietCommand =');
  replace("held RAM-only preparation and derived reload",
    '  const firstRestore = await reloadWithAutoRestore(restoreUrl, "normal", Boolean(diagnosticCheckpoint));\n', setup);
  const oldCommand = extractUnique(source, "  const postAudioCommand = await typeCommand(", "  milestones.postRestoreAplay = postAudioCommand;");
  const quietCommand = extractUnique(held, '  assert.equal(postRestoreCommand, "play");', "  milestones.postRestoreAplay = postAudioCommand;");
  replace("held timed play and raster focus proof", oldCommand, quietCommand);
  const oldAssertion = '    assert.ok(postAudioCommand.terminalMarkerSeen && postAudioCommand.visualDiffPixels >= 2_000,\n' +
    '      "post-restore aplay did not produce guest-visible terminal output");';
  const quietAssertions = extractUnique(held, '    assert.equal(postAudioCommand.oracle, "fresh-exact-reviewed-raster");',
    '    assert.deepEqual(postAudioCommand.baselineMatches,[]);') + '    assert.deepEqual(postAudioCommand.baselineMatches,[]);';
  replace("exact token replaces only the timed area heuristic", oldAssertion, quietAssertions);
  replace("repository root", 'const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");',
    `const repo = ${JSON.stringify(repo)};`);
  // Only static relative imports move; all runner logic, guest paths and asset URLs stay intact.
  const imports = [...source.matchAll(/from "(\.\.?\/[^"\n]+)"/gu)].map(match => match[1]);
  for (const relative of imports) {
    const filename = path.resolve(repo, "tools/verify", relative);
    assert.ok(filename.startsWith(repo + path.sep), "derived import escapes repository");
    replace("import " + relative, `from "${relative}"`, `from ${JSON.stringify(pathToFileURL(filename).href)}`);
  }
  return { source, changes, acceptance: false, fVerified: false };
}

export async function generateQuietProbe(output, env = process.env) {
  validateQuietEnvironment(env);
  const parent = path.join(repository, "target/e5-t26f");
  assert.ok(typeof output === "string" && path.isAbsolute(output) && path.resolve(output) === output &&
    path.dirname(output) === parent && /^single-process-quiet-[a-zA-Z0-9-]+$/u.test(path.basename(output)),
  "new task-owned target/e5-t26f/single-process-quiet-NAME directory required");
  assert.equal(await realpath(parent), parent, "generated output parent symlink refused");
  const sources = {};
  for (const relative of Object.keys(SOURCE_PINS)) sources[relative] = await readFile(path.join(repository, relative));
  const derived = deriveQuietProbe(sources);
  await mkdir(output); // No overwrite, including an existing empty directory or symlink.
  const script = path.join(output, "probe.mjs");
  await writeFile(script, derived.source, { flag: "wx" });
  const metadata = { schema: "wasm-vm.e5-t26f.single-process-quiet-factory.v1",
    acceptance: false, fVerified: false, sourcePins: SOURCE_PINS, seal: SEAL, changes: derived.changes,
    factorySha256: hash(await readFile(fileURLToPath(import.meta.url))), generatedSourceSha256: hash(derived.source),
    invocation: { cwd: repository, argv: [process.execPath, script],
      env: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("E5_T26F_"))) },
    limitation: "Generated only; no browser executed and no timing result. Retain this directory with the eventual diagnostic evidence." };
  await writeFile(path.join(output, "factory.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "usage: single-process-quiet-probe.mjs /ABS/target/e5-t26f/single-process-quiet-NAME (generate only)");
  console.log(JSON.stringify(await generateQuietProbe(process.argv[2]), null, 2));
}
