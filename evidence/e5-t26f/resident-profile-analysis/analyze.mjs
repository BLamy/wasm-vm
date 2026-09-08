import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { bindNames, summarize } from "../../../tools/verify/e5-t22c-symbolize-cpu.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha256File = async file => hash(await fs.readFile(file));
const out = "evidence/e5-t26f/resident-profile-analysis", input = "evidence/e5-t26f/resident-profile-33a65efb";
const rawBytes = await fs.readFile(`${input}/interaction-cpu.json`), observationBytes = await fs.readFile(`${input}/post-restore.json`);
const raw = JSON.parse(rawBytes), observation = JSON.parse(observationBytes), m = observation.milestones;
assert.equal(raw.head, "33a65efb90d1656be45931ea5aacb9b670c0c35f");
assert.equal(raw.head, observation.head);
assert.equal(raw.acceptance, false);
assert.equal(raw.diagnostic, true);
assert.equal(hash(rawBytes), m.cpuProfile.sha256);
assert.equal(raw.runtimeSha256, m.run.binding.runtimeSha256);
const runner = await fs.readFile("tools/verify/e5-t26f-browser-roundtrip.mjs", "utf8");
const treeSource = runner.slice(runner.indexOf("async function treeDigest("), runner.indexOf("\nasync function diagnosticBinding("));
const treeDigest = vm.runInNewContext(`${treeSource}\ntreeDigest`, { assert, path, readdir: fs.readdir, lstat: fs.lstat, sha256File, sha256: hash });
const actualRuntime = await treeDigest("web", relative => ["src", "pkg", "bench"].includes(relative.split(path.sep)[0]) ||
  (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative)));
assert.equal(actualRuntime, raw.runtimeSha256, "served runtime no longer matches the recording");
const binding = bindNames(await fs.readFile("web/pkg/wasm_vm_wasm_bg.wasm"), await fs.readFile("target/e5-t26f/resident-symbols/named.wasm"));
const summary = summarize(raw, binding.names), p = raw.profile;
const totalUs = p.timeDeltas.reduce((sum, value) => sum + value, 0);
assert.equal(totalUs, summary.totalUs);
const profileSpanMs = (p.endTime - p.startTime) / 1000;
// Profiler.start settled BEFORE the page's startedAt; Profiler.stop is sent AFTER frozen end.
// Assuming the two monotonic clocks have the same rate, their two endpoint gaps sum to slackMs.
const slackMs = profileSpanMs - (raw.postRestoreEnd - raw.interaction.startedAt);
assert.ok(slackMs >= 0 && slackMs < 100, "cannot bound profile/page clock alignment");
const latency = m.interactionLatency, firstPcm = latency.firstPcm;
const lastZero = latency.pcmSamples.filter(s => s.observedAt < firstPcm.observedAt && s.writeIndex === 0).at(-1);
assert.ok(lastZero && firstPcm.pcm.nonSilentFrames > 0);
const beforeEndUs = (lastZero.observedAt - raw.interaction.startedAt) * 1000;
const afterStartUs = (firstPcm.observedAt - raw.interaction.startedAt + slackMs) * 1000;
const windows = { beforePcm: [0, beforeEndUs], pcmBoundaryUncertain: [beforeEndUs, afterStartUs], afterPcm: [afterStartUs, totalUs] };
function windowSummary([from, to]) {
  let at = 0;
  const samples = [], timeDeltas = [];
  p.samples.forEach((sample, i) => {
    const end = at + p.timeDeltas[i], overlap = Math.max(0, Math.min(to, end) - Math.max(from, at));
    if (overlap > 0) { samples.push(sample); timeDeltas.push(overlap); }
    at = end;
  });
  return summarize({ ...raw, profile: { ...p, samples, timeDeltas } }, binding.names);
}
const rules = [
  ["JIT executor / selection", /jit_browser::|Machine::try_jit_block/],
  ["dispatch discovery / block cache", /::dispatch::/],
  ["interpreter / decode / run loop", /::hart::|::decode(?:_c)?::|Machine::(?:run_traced|next_micro_op)/],
  ["MMU / PMP", /::mmu::|::pmp::|sync_pmp_code_permissions/],
  ["interrupt / clock synchronization", /Machine::(?:sync_plic|sync_clint|sync_sbi_timer|sample_wall_clock)|::csr::|::dev::(?:plic|clint)::/],
  ["virtio / other devices", /::dev::/],
  ["integer division / multiply helpers", /^__(?:u?div|u?mod|multi)/],
  ["collection / hashing / allocation", /^(?:alloc::|core::hash::|<std\[.*::hash::|<dlmalloc)/],
  ["unmapped generated Wasm / its trampolines", /wasm:\/\/wasm\//],
  ["other", /./],
];
function buckets(s) {
  const sums = new Map(rules.map(([name]) => [name, { us: 0, leaves: [] }]));
  for (const leaf of s.self) {
    const [name] = rules.find(([, regex]) => regex.test(leaf.name));
    const bucket = sums.get(name); bucket.us += leaf.us; bucket.leaves.push(leaf.name);
  }
  return [...sums].map(([name, value]) => ({ name, ...value, percent: 100 * value.us / s.totalUs }));
}
const phases = Object.fromEntries(Object.entries(windows).map(([name, window]) => {
  const s = windowSummary(window); return [name, { ...s, buckets: buckets(s) }];
}));
assert.ok(Math.abs(Object.values(phases).reduce((sum, s) => sum + s.totalUs, 0) - totalUs) < 0.001);
const samplesSorted = [...p.timeDeltas].sort((a, b) => a - b);
const result = { acceptance: false, head: raw.head, rawSha256: hash(rawBytes), observationSha256: hash(observationBytes),
  runtimeSha256: actualRuntime, releaseSha256: binding.releaseSha256, namedSha256: binding.namedSha256,
  mappedNames: binding.names.size, matchedNoncustomSections: binding.sections.length,
  samples: p.samples.length, totalUs, profileSpanMs, sampleIntervalsUs: { requested: raw.intervalUs,
    median: samplesSorted[Math.floor(samplesSorted.length / 2)], max: samplesSorted.at(-1) },
  timing: { restoreAt: m.postRestoreStart, profilePageAnchor: raw.interaction.startedAt, frozenEnd: raw.postRestoreEnd,
    elapsedFromFrozenEndMs: raw.postRestoreEnd - m.postRestoreStart, retainedAssertionElapsedMs: m.postRestoreInteraction.elapsedMs,
    profilePageAlignmentSlackMs: slackMs, lastZero, firstPcm, firstMarker: latency.firstMarker,
    markerCalls: latency.markerCalls, markerTotalMs: latency.markerTotalMs, markerMaxMs: latency.markerMaxMs,
    profileRelativeWindowsUs: windows }, summary: { ...summary, buckets: buckets(summary) }, phases,
  caveat: "Weighted sampling, not exact function timers or guest syscall tracing. Phase windows assume equal monotonic clock rates and retain the zero-to-first-observed-PCM plus alignment uncertainty separately. Inclusive costs overlap. Generated Wasm names are not guessed." };
await fs.writeFile(`${out}/analysis.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ binding: { names: result.mappedNames, sections: result.matchedNoncustomSections },
  timing: result.timing, buckets: result.summary.buckets.map(({ leaves, ...b }) => b),
  phases: Object.fromEntries(Object.entries(phases).map(([name, s]) => [name, { ms: s.totalUs / 1000,
    top: s.self.slice(0, 8), runTick: s.inclusive.find(x => x.name.startsWith("runTick ")) }])) }, null, 2));
