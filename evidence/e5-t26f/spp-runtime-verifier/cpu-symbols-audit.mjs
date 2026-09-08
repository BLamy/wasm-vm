#!/usr/bin/env node
// Bounded existing-byte audit. No compilation, browser, fixture or runtime-tree traversal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "../../..");
const root = "evidence/e5-t26f/single-process-observer-96ecb801";
const mapping = "evidence/e5-t26f/spp-cpu-symbols";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const files = {
  source: "tools/verify/e5-t22c-symbolize-cpu.mjs",
  release: "web/pkg/wasm_vm_wasm_bg.wasm",
  named: "target/e5-t26f/spp-cpu-symbols-96ecb801/companion/named.wasm",
  profile: `${root}/cpu-default/record/interaction-cpu.json`,
  raw: `${root}/cpu-default/record/failure-post-restore-interaction-checks.json`,
  summary: `${mapping}/cpu-summary.json`, sections: `${mapping}/section-binding.json`,
  existingResult: "evidence/e5-t26f/spp-runtime-verifier/cpu-result.json",
  prediction: "evidence/e5-t26f/spp-runtime-verifier/cpu-plan.md",
};
const bytes = {}, hashes = {};
for (const [key, relative] of Object.entries(files)) { bytes[key] = await readFile(path.join(repo, relative)); hashes[key] = sha(bytes[key]); }
assert.equal(hashes.source, "15006e82701a6aa010e1e96638e4d6cf5f07118843c8c4c0d4bb79f1fd9519d5");
assert.equal(hashes.release, "84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d");
assert.equal(hashes.named, "372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116");
assert.equal(hashes.profile, "21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a");
assert.equal(hashes.existingResult, "3807b7181eeab140e76fe934798ead8d467002fb9d02ec0ca8fb76621e84c3c0");
const { bindNames, summarize } = await import(pathToFileURL(path.join(repo, files.source)).href);
const binding = bindNames(bytes.release, bytes.named); // Compares complete non-custom payload bytes.
assert.equal(binding.sections.length, 11);
assert.equal(binding.names.size, 1890);
assert.deepEqual(binding.sections, JSON.parse(bytes.sections).sections);
const recording = JSON.parse(bytes.profile), worker = JSON.parse(bytes.summary), raw = JSON.parse(bytes.raw);
assert.deepEqual(Object.fromEntries(binding.names), worker.names);
const heldSummary = summarize(recording, binding.names);
const p = recording.profile, nodes = new Map(p.nodes.map(n => [n.id, n])), parents = new Map();
for (const node of p.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const moduleUrl = new URL("./pkg/wasm_vm_wasm_bg.wasm", recording.url).href;
const label = node => {
  const frame = node.callFrame, match = /^wasm-function\[(\d+)\]$/u.exec(frame.functionName);
  return frame.url === moduleUrl && match ? binding.names.get(Number(match[1])) ?? frame.functionName : `${frame.functionName} ${frame.url}`.trim();
};
const self = new Map(), inclusive = new Map(); let totalUs = 0;
const add = (map, name, us) => map.set(name, (map.get(name) ?? 0) + us);
assert.equal(p.samples.length, p.timeDeltas.length);
for (let i = 0; i < p.samples.length; i++) {
  const us = p.timeDeltas[i], id = p.samples[i];
  assert.ok(Number.isSafeInteger(us) && us >= 0 && nodes.has(id)); totalUs += us;
  add(self, label(nodes.get(id)), us);
  const seenIds = new Set(), labels = new Set();
  for (let at = id; at !== undefined; at = parents.get(at)) {
    assert.ok(!seenIds.has(at)); seenIds.add(at); labels.add(label(nodes.get(at)));
  }
  for (const name of labels) add(inclusive, name, us);
}
const rank = map => [...map].sort((a, b) => b[1] - a[1]).map(([name, us]) => ({ name, us, percent: 100 * us / totalUs }));
const independent = { totalUs, samples: p.samples.length, self: rank(self), inclusive: rank(inclusive) };
assert.deepEqual(independent, heldSummary);
for (const [key, value] of Object.entries(independent)) assert.deepEqual(value, worker.profile[key]);
assert.equal(totalUs, 3260775); assert.equal(p.samples.length, 2608);
const prior = JSON.parse(bytes.existingResult);
assert.deepEqual(independent, prior.symbolization.summary);
assert.deepEqual(prior.symbolization.attribution, worker.profile.attribution);
const plic = independent.self.find(row => row.name.startsWith("wasm_vm_core::Machine::sync_plic::"));
assert.equal(plic.us, 208905);
const elapsedMs = raw.milestones.postRestoreEnd - raw.milestones.postRestoreStart;
assert.equal(elapsedMs, 4023.1999999284744);
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
assert.equal(head, "96ecb801fdf8b67af75cd150db82d115bcf046cd");
const result = { head, files, hashes, verdict: "HELD bounded sampled attribution; F timing FAILED; no causal/speedup claim",
  noncustomSectionsEqual: true, sections: binding.sections, names: binding.names.size,
  independentSummaryMatchesHeldToolAndWorker: true, summary: independent,
  categoriesCarriedFromPriorIndependentAuditAndCrosschecked: prior.symbolization.attribution,
  bridgeNodes: prior.symbolization.bridgeNodes, plic, elapsedMs,
  limits: { existingFoundationPreserved: true, profileIntervalNotFInterval: true, hitCountMismatchPreserved: prior.cpu.integrity.hitMismatches,
    failedWorkerOriginalScript: "NOT RETAINED; reconstructed comparison explicitly NOT ORIGINAL",
    fVerified: false, sourceCandidateReviewed: false } };
for (const [key, relative] of Object.entries(files)) assert.equal(sha(await readFile(path.join(repo, relative))), hashes[key]);
const output = path.join(here, "cpu-symbols-result.json");
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, resultSha256: sha(await readFile(output)), rawSha256: hashes.raw, profileSha256: hashes.profile, plic, head }, null, 2));
