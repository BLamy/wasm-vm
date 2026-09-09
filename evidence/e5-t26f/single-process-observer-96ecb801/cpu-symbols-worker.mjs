#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  access,
  mkdir,
  readFile,
  readdir,
  lstat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { bindNames, summarize } from "../../../tools/verify/e5-t22c-symbolize-cpu.mjs";

const execFile = promisify(execFileCallback);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const targetRoot = path.join(repo, "target/e5-t26f/spp-cpu-symbols-96ecb801");
const companion = path.join(targetRoot, "companion");
const tmp = path.join(companion, "tmp");
const evidenceRoot = path.join(repo, "evidence/e5-t26f/spp-cpu-symbols");
const logs = path.join(evidenceRoot, "logs");
const release = path.join(repo, "web/pkg/wasm_vm_wasm_bg.wasm");
const distRelease = path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm");
const rustInput = path.join(repo, "target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm");
const profileFile = path.join(repo,
  "evidence/e5-t26f/single-process-observer-96ecb801/cpu-default/record/interaction-cpu.json");
const failureFile = path.join(repo,
  "evidence/e5-t26f/single-process-observer-96ecb801/cpu-default/record/failure-post-restore-interaction-checks.json");
const invocationFile = path.join(repo,
  "evidence/e5-t26f/single-process-observer-96ecb801/cpu-default/invocation.json");
const symbolizer = path.join(repo, "tools/verify/e5-t22c-symbolize-cpu.mjs");
const symbolizerTests = path.join(repo, "tools/verify/e5-t22c-symbolize-cpu.test.mjs");
const bindgen = "/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen";
const wasmOpt = "/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt";
const named = path.join(companion, "named.wasm");
const archive = path.join(companion, "named.wasm.gz");
const expectedHead = "96ecb801fdf8b67af75cd150db82d115bcf046cd";
const expectedRuntime = "65935dd0535eb38ed23d78956f63ec800daf3f6bb63094c9c694e236786f74e1";
const expectedWasm = "84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d";
const expectedProfile = "21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a";
const expectedSamples = 2608;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const relative = file => path.relative(repo, file);
const json = value => JSON.stringify(value, null, 2) + "\n";
const utc = () => new Date().toISOString();

async function digestFile(file) {
  const bytes = await readFile(file);
  return { path: relative(file), realpath: await pathRealpath(file), size: bytes.length, sha256: sha256(bytes) };
}

async function pathRealpath(file) {
  return path.resolve(file);
}

async function readHead() {
  const pointer = (await readFile(path.join(repo, ".git/HEAD"), "utf8")).trim();
  const ref = pointer.startsWith("ref: ") ? pointer.slice(5) : null;
  const resolved = ref ? (await readFile(path.join(repo, ".git", ref), "utf8")).trim() : pointer;
  return { pointer, ref, resolved };
}

function runtimeInclude(relativePath) {
  const first = relativePath.split(path.sep)[0];
  return ["src", "pkg", "bench"].includes(first) ||
    (!relativePath.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relativePath));
}

async function runtimeInventory() {
  const entries = [];
  async function visit(relativeDirectory) {
    for (const name of (await readdir(path.join(repo, "web", relativeDirectory))).sort()) {
      const next = path.join(relativeDirectory, name);
      if (!runtimeInclude(next)) continue;
      const file = path.join(repo, "web", next);
      const info = await lstat(file);
      assert.ok(!info.isSymbolicLink(), `runtime inventory refuses symlink: ${file}`);
      if (info.isDirectory()) {
        await visit(next);
      } else {
        assert.ok(info.isFile(), `runtime inventory requires a regular file: ${file}`);
        const bytes = await readFile(file);
        entries.push([next, info.size, sha256(bytes)]);
      }
    }
  }
  await visit("");
  assert.equal(entries.length, 150, "proper runner runtime file count");
  return { count: entries.length, entries, aggregate: sha256(JSON.stringify(entries)) };
}

async function inputSnapshot() {
  const [head, runtime] = await Promise.all([readHead(), runtimeInventory()]);
  const files = {};
  for (const file of [symbolizer, symbolizerTests, rustInput, release, distRelease, profileFile,
    failureFile, invocationFile]) files[relative(file)] = await digestFile(file);
  return { capturedAt: utc(), head, files, runtime };
}

async function writeNew(file, contents, encoding = "utf8") {
  await writeFile(file, contents, { encoding, flag: "wx" });
}

const commandRecords = [];
async function command(label, executable, args) {
  const prefix = path.join(logs, label);
  const record = {
    executable,
    argv: args,
    cwd: repo,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: tmp },
    startedAt: utc(),
    logPrefix: relative(prefix),
  };
  await writeNew(`${prefix}.command.json`, json(record));
  const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", TMPDIR: tmp };
  try {
    const result = await execFile(executable, args, { cwd: repo, env, maxBuffer: 2 * 1024 * 1024 });
    record.stdout = result.stdout;
    record.stderr = result.stderr;
    record.code = 0;
    record.signal = null;
  } catch (error) {
    record.stdout = error.stdout ?? "";
    record.stderr = error.stderr ?? "";
    record.code = typeof error.code === "number" ? error.code : null;
    record.signal = error.signal ?? null;
    record.error = String(error);
  }
  record.finishedAt = utc();
  await writeNew(`${prefix}.stdout.log`, record.stdout);
  await writeNew(`${prefix}.stderr.log`, record.stderr);
  await writeNew(`${prefix}.exit.json`, json({ code: record.code, signal: record.signal }));
  commandRecords.push(record);
  if (record.code !== 0 || record.signal) throw new Error(`${label} failed: ${record.error ?? record.stderr}`);
  return record;
}

function classifyProfile(recording, names) {
  const moduleUrl = new URL("./pkg/wasm_vm_wasm_bg.wasm", recording.url).href;
  const nodes = new Map(recording.profile.nodes.map(node => [node.id, node]));
  const categories = new Map();
  const bridge = new Map();
  const generated = new Map();
  const add = (map, key, us) => {
    const old = map.get(key) ?? { samples: 0, timeUs: 0 };
    map.set(key, { samples: old.samples + 1, timeUs: old.timeUs + us });
  };
  for (let i = 0; i < recording.profile.samples.length; ++i) {
    const node = nodes.get(recording.profile.samples[i]);
    assert.ok(node, "profile sample node exists");
    const frame = node.callFrame;
    const match = /^wasm-function\[(\d+)\]$/u.exec(frame.functionName);
    const us = recording.profile.timeDeltas[i];
    if (frame.url === moduleUrl && match && names.has(Number(match[1]))) {
      add(categories, "Authenticated indexed release functions", us);
    } else if (frame.url === moduleUrl && frame.functionName.startsWith("js-to-wasm:")) {
      add(categories, "Literal release bridge labels", us);
      add(bridge, `${frame.functionName} ${frame.url}`.trim(), us);
    } else if (frame.url.startsWith("wasm://")) {
      add(categories, "Unmapped generated WASM", us);
      add(generated, frame.url, us);
    } else if (!frame.url) {
      add(categories, "Runtime/synthetic labels", us);
    } else {
      add(categories, "JavaScript/other URL labels", us);
    }
  }
  const totalUs = recording.profile.timeDeltas.reduce((sum, value) => sum + value, 0);
  const rank = map => [...map].sort((a, b) => b[1].timeUs - a[1].timeUs)
    .map(([name, value]) => ({ name, ...value, share: 100 * value.timeUs / totalUs }));
  return {
    denominator: "sumTimeDeltas",
    totalUs,
    categories: rank(categories),
    bridgeFrames: rank(bridge),
    unmappedGeneratedWasm: {
      distinctUrls: generated.size,
      urls: rank(generated),
    },
  };
}

function formatRows(rows, limit = 8) {
  return rows.slice(0, limit).map((row, index) =>
    `${index + 1}. ${row.name}: ${row.timeUs ?? row.us}µs (${(row.share ?? row.percent).toFixed(3)}%)`).join("\n");
}

async function main() {
  await access(bindgen);
  await access(wasmOpt);
  const before = await inputSnapshot();
  assert.equal(before.head.resolved, expectedHead, "required exact HEAD");
  assert.equal(before.runtime.aggregate, expectedRuntime, "proper-runner runtime aggregate");
  assert.equal(before.files[relative(release)].sha256, expectedWasm, "served web/pkg WASM digest");
  assert.equal(before.files[relative(distRelease)].sha256, expectedWasm, "served web/dist WASM digest");
  assert.equal(before.files[relative(profileFile)].sha256, expectedProfile, "closed CPU profile digest");

  await command("01-wasm-bindgen-version", bindgen, ["--version"]);
  await command("02-wasm-opt-version", wasmOpt, ["--version"]);
  await command("03-symbolizer-tests", process.execPath, ["--test", relative(symbolizerTests)]);
  await command("04-wasm-bindgen", bindgen, ["--target", "web", "--out-dir", companion,
    "--out-name", "wasm_vm_wasm", rustInput]);
  await command("05-wasm-opt-names", wasmOpt, ["-O", "-g", path.join(companion, "wasm_vm_wasm_bg.wasm"),
    "-o", named]);

  const [releaseBytes, distBytes, namedBytes, profileBytes, profile, failure, invocation] = await Promise.all([
    readFile(release), readFile(distRelease), readFile(named), readFile(profileFile),
    readFile(profileFile, "utf8").then(JSON.parse), readFile(failureFile, "utf8").then(JSON.parse),
    readFile(invocationFile, "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(distBytes, releaseBytes, "served web/pkg and web/dist bytes differ");
  const binding = bindNames(releaseBytes, namedBytes);
  assert.equal(binding.sections.length, 11, "all 11 non-custom sections authenticated");
  assert.equal(binding.releaseSha256, expectedWasm, "authenticated served WASM digest");
  assert.equal(profile.profile.samples.length, expectedSamples, "closed profile sample count");
  assert.equal(sha256(profileBytes), expectedProfile, "profile bytes changed during processing");

  // This is intentionally after bindNames: no profile name is attributed before the
  // executable sections are proven equal to the served release module.
  const summary = summarize(profile, binding.names);
  assert.equal(summary.samples, expectedSamples);
  assert.equal(summary.totalUs, 3260775);
  const attribution = classifyProfile(profile, binding.names);
  const closedFailure = {
    source: relative(failureFile),
    invocation: relative(invocationFile),
    acceptance: invocation.acceptance,
    exitCode: 1,
    head: invocation.head,
    label: "CPU replay closed child1 canonical2s cap failure; diagnostic only",
    failureLabel: failure.label,
    lastPhase: failure.lastPhase,
    profileSha256: sha256(profileBytes),
  };
  assert.equal(closedFailure.acceptance, false);
  assert.equal(closedFailure.head, expectedHead);

  const sectionBinding = {
    schema: "wasm-vm.e5-t26f.spp-cpu-symbols.section-binding.v1",
    served: {
      webPkg: { path: relative(release), sha256: sha256(releaseBytes) },
      webDist: { path: relative(distRelease), sha256: sha256(distBytes) },
      byteIdentical: true,
    },
    named: { path: relative(named), sha256: sha256(namedBytes), size: namedBytes.length },
    allNoncustomSectionsEqual: true,
    noncustomSectionCount: binding.sections.length,
    sections: binding.sections,
    names: binding.names.size,
  };
  await writeNew(path.join(evidenceRoot, "section-binding.json"), json(sectionBinding));
  await writeNew(path.join(evidenceRoot, "inputs-before.json"), json(before));
  await writeNew(path.join(evidenceRoot, "closed-failure.json"), json(closedFailure));
  await writeNew(path.join(evidenceRoot, "cpu-summary.json"), json({
    schema: "wasm-vm.e5-t26f.spp-cpu-symbols.cpu-summary.v1",
    ...binding,
    names: Object.fromEntries(binding.names),
    profile: {
      path: relative(profileFile),
      sha256: sha256(profileBytes),
      url: profile.url,
      intervalUs: profile.intervalUs,
      ...summary,
      attribution,
    },
    closedFailure,
  }));
  await writeNew(archive, gzipSync(namedBytes, { level: 9, mtime: 0 }));
  const roundTrip = gunzipSync(await readFile(archive));
  assert.deepEqual(roundTrip, namedBytes, "named companion gzip round trip");

  const after = await inputSnapshot();
  assert.deepEqual(after.head, before.head, "HEAD changed during offline symbolization");
  assert.deepEqual(after.files, before.files, "source/profile/served inputs changed");
  assert.deepEqual(after.runtime, before.runtime, "proper-runner runtime changed");
  await writeNew(path.join(evidenceRoot, "inputs-after.json"), json(after));
  await writeNew(path.join(evidenceRoot, "commands.json"), json(commandRecords));
  await writeNew(path.join(evidenceRoot, "artifact-hashes.json"), json({
    generatedAt: utc(),
    artifacts: await Promise.all([named, archive, path.join(companion, "wasm_vm_wasm_bg.wasm"),
      path.join(companion, "wasm_vm_wasm.js"), path.join(companion, "wasm_vm_wasm.d.ts"),
      path.join(companion, "wasm_vm_wasm_bg.wasm.d.ts")].map(digestFile)),
    evidence: await Promise.all(["section-binding.json", "cpu-summary.json", "closed-failure.json",
      "inputs-before.json", "inputs-after.json", "commands.json"].map(file => digestFile(path.join(evidenceRoot, file)))),
  }));

  const categoryRows = attribution.categories.map(row =>
    `| ${row.name} | ${row.samples} | ${row.timeUs} | ${row.share.toFixed(3)}% |`).join("\n");
  const index = `# Offline CPU symbolization sidecar\n\n` +
    `This fresh sidecar processed the existing target WASM once. It did not rerun the ` +
    `guest or browser and did not modify source, runtime, profiles, or served artifacts. ` +
    `The closed CPU replay is retained as diagnostic-only evidence: ` +
    `\`${closedFailure.source}\` has \`acceptance:false\`, exit code 1, and the ` +
    `child1 canonical two-second cap failure.\n\n` +
    `## Binding\n\n` +
    `The generated named companion is \`${relative(named)}\`; its gzip archive is ` +
    `\`${relative(archive)}\`. The served \`web/pkg\` and \`web/dist/pkg\` WASM copies ` +
    `are byte-identical at \`${expectedWasm}\`. \`bindNames\` authenticated all ` +
    `11 non-custom sections before profile attribution and recovered ${binding.names.size.toLocaleString()} ` +
    `function names.\n\n` +
    `## Profile\n\n` +
    `Profile: \`${relative(profileFile)}\`, SHA-256 \`${expectedProfile}\`, ` +
    `${summary.samples.toLocaleString()} samples. Self and inclusive rankings below use ` +
    `the existing \`summarize\` implementation. Percentages use the sum of ` +
    `\`timeDeltas\`: **${summary.totalUs.toLocaleString()}µs**. Inclusive rows overlap.\n\n` +
    `### Self time\n\n${formatRows(summary.self)}\n\n` +
    `### Inclusive time\n\n${formatRows(summary.inclusive)}\n\n` +
    `### Self-frame categories\n\n| Category | Samples | Sample µs | Share |\n| --- | ---: | ---: | ---: |\n${categoryRows}\n\n` +
    `Unmapped generated WASM has ${attribution.unmappedGeneratedWasm.distinctUrls} distinct ` +
    `\`wasm://\` module URLs. The ${attribution.bridgeFrames.length} literal ` +
    `js-to-wasm bridge frame(s) remain literal and were not force-indexed.\n\n` +
    `## Integrity and reproduction records\n\n` +
    `- [Section binding](section-binding.json)\n` +
    `- [CPU summary](cpu-summary.json)\n` +
    `- [Closed diagnostic failure](closed-failure.json)\n` +
    `- [Before inputs/runtime inventory](inputs-before.json)\n` +
    `- [After inputs/runtime inventory](inputs-after.json)\n` +
    `- [Tool commands and versions](commands.json)\n` +
    `- [Generated artifact digests](artifact-hashes.json)\n` +
    `- [Command logs](logs/)\n\n` +
    `The exact proper-runner inventory is 150 files with aggregate ` +
    `\`${expectedRuntime}\`; HEAD resolves to \`${expectedHead}\` before and after. ` +
    `The profile source, target WASM input, served WASM copies, symbolizer/test sources, ` +
    `and runtime inventory are byte-identical before and after.\n\n` +
    `## Limitations\n\n` +
    `This is sampled attribution only. Sample weights are not exact unprofiled wall time, ` +
    `and they do not establish causation or explain the cap failure. Generated WASM ` +
    `modules and bridge frames were not assigned invented names.\n`;
  await writeNew(path.join(evidenceRoot, "INDEX.md"), index);
  console.log(JSON.stringify({ names: binding.names.size, sections: binding.sections.length,
    samples: summary.samples, totalUs: summary.totalUs, named: sha256(namedBytes), archive: sha256(await readFile(archive)) }));
}

try {
  await main();
} catch (error) {
  const failure = { schema: "wasm-vm.e5-t26f.spp-cpu-symbols.failure.v1", failedAt: utc(),
    error: String(error), stack: error?.stack ?? null, commands: commandRecords };
  try { await writeNew(path.join(evidenceRoot, "failure.json"), json(failure)); } catch { /* preserve the first failure */ }
  console.error(error);
  process.exitCode = 1;
}
