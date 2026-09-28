#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bindNames } from "../../../../tools/verify/e5-t22c-symbolize-cpu.mjs";

const repo = path.resolve(import.meta.dirname, "../../../..");
const symbols = import.meta.dirname;
const releasePath = path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm");
const namedPath = path.join(repo, "target/omarchy-softpipe-r1/symbols/named.wasm");
const rawPath = path.join(repo, "target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm");
const profilePath = path.join(repo, "evidence/omarchy-profile/input-followup-r1/renderer.cpuprofile");
const profilePageUrl = "http://127.0.0.1:58755/app.html";
const moduleUrl = new URL("./pkg/wasm_vm_wasm_bg.wasm", profilePageUrl).href;
const selectedSymbols = [
  "wasm_vm_core::Machine::run::hb3a70af4514667f1",
  "wasm_vm_core::hart::Hart::execute::hd1da7e6748700a68",
  "wasm_vm_core::Machine::next_micro_op::h12a59264ce5c0708",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function u32(bytes, state) {
  let value = 0, shift = 0;
  for (;;) {
    assert.ok(state.at < bytes.length, "truncated Wasm LEB");
    const byte = bytes[state.at++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return value;
    shift += 7;
    assert.ok(shift < 35, "invalid Wasm u32");
  }
}

function wasmSections(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
  const state = { at: 8 }, result = [];
  while (state.at < bytes.length) {
    const id = bytes[state.at++], length = u32(bytes, state), start = state.at;
    const payload = bytes.subarray(start, start + length);
    assert.equal(payload.length, length, "bounded Wasm section");
    result.push({ id, length, payloadSha256: sha256(payload), payload });
    state.at += length;
  }
  assert.equal(state.at, bytes.length, "Wasm section walk");
  return result;
}

function wasmString(bytes, state) {
  const length = u32(bytes, state);
  return Buffer.from(bytes.subarray(state.at, state.at + length)).toString("utf8");
}

function customNames(sections) {
  return sections.filter(section => section.id === 0).map(section => {
    const state = { at: 0 };
    return wasmString(section.payload, state);
  });
}

function functionCount(sections) {
  const functionSection = sections.find(section => section.id === 3);
  if (!functionSection) return null;
  return u32(functionSection.payload, { at: 0 });
}

function stat(meta = {}) {
  return { samples: 0, timeUs: 0, indices: new Set(), urls: new Set(), kind: meta.kind, url: meta.url };
}

function addStat(map, key, timeUs, meta = {}) {
  let value = map.get(key);
  if (!value) { value = stat(meta); map.set(key, value); }
  value.samples += 1;
  value.timeUs += timeUs;
  if (meta.index !== undefined) value.indices.add(meta.index);
  if (meta.url) value.urls.add(meta.url);
  if (!value.kind && meta.kind) value.kind = meta.kind;
  if (!value.url && meta.url) value.url = meta.url;
  return value;
}

function serialStat(value, totalUs) {
  return {
    symbol: value.symbol,
    kind: value.kind,
    url: value.url || [...value.urls][0] || "",
    indices: [...value.indices].sort((a, b) => a - b),
    samples: value.samples,
    timeUs: value.timeUs,
    percent: totalUs ? (100 * value.timeUs) / totalUs : 0,
  };
}

function sortedStats(map, totalUs) {
  return [...map.entries()].sort((a, b) => b[1].timeUs - a[1].timeUs).map(([symbol, value]) => serialStat({ ...value, symbol }, totalUs));
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

const [releaseBytes, namedBytes, rawBytes, profile] = await Promise.all([
  readFile(releasePath), readFile(namedPath), readFile(rawPath), readFile(profilePath, "utf8").then(JSON.parse),
]);
const binding = bindNames(releaseBytes, namedBytes);
const rawSections = wasmSections(rawBytes), releaseSections = wasmSections(releaseBytes), namedSections = wasmSections(namedBytes);
const releaseSha256 = sha256(releaseBytes), namedSha256 = sha256(namedBytes), rawSha256 = sha256(rawBytes);
assert.equal(releaseSha256, binding.releaseSha256);
assert.equal(namedSha256, binding.namedSha256);

const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
const nodeInfo = new Map(), indexBindings = new Map();
for (const node of profile.nodes) {
  const frame = node.callFrame;
  const match = /^wasm-function\[(\d+)\]$/.exec(frame.functionName);
  if (frame.url === moduleUrl && match) {
    const index = Number(match[1]);
    const symbol = binding.names.get(index) || frame.functionName;
    const info = { key: symbol, symbol, kind: "rust", url: frame.url, index, offset: frame.columnNumber };
    nodeInfo.set(node.id, info);
    const existing = indexBindings.get(index) || { index, symbol, offsets: new Set(), nodeIds: new Set() };
    existing.offsets.add(frame.columnNumber);
    existing.nodeIds.add(node.id);
    indexBindings.set(index, existing);
  } else {
    const key = `${frame.functionName} @ ${frame.url || "<host>"}`;
    nodeInfo.set(node.id, { key, symbol: frame.functionName, kind: "non-rust", url: frame.url, offset: frame.columnNumber });
  }
}

const self = new Map(), inclusive = new Map(), edges = new Map(), directCallers = new Map(), inclusiveCallers = new Map();
const indexSelf = new Map(), indexInclusive = new Map();
const target = "__udivti3";
let totalUs = 0;
for (let sampleIndex = 0; sampleIndex < profile.samples.length; ++sampleIndex) {
  const timeUs = profile.timeDeltas[sampleIndex];
  assert.ok(Number.isFinite(timeUs) && timeUs >= 0);
  totalUs += timeUs;
  const chain = [], seenNodes = new Set();
  for (let id = profile.samples[sampleIndex]; id; id = parents.get(id)) {
    assert.ok(!seenNodes.has(id), "profile call tree is acyclic");
    seenNodes.add(id);
    chain.push(nodeInfo.get(id));
  }
  chain.reverse();
  const leaf = chain.at(-1);
  const leafStat = addStat(self, leaf.key, timeUs, leaf);
  leafStat.symbol = leaf.symbol;
  if (leaf.index !== undefined) {
    const item = indexSelf.get(leaf.index) || { samples: 0, timeUs: 0 };
    item.samples += 1; item.timeUs += timeUs; indexSelf.set(leaf.index, item);
  }
  const seenInclusive = new Set(), seenInclusiveIndices = new Set();
  for (const item of chain) {
    if (!seenInclusive.has(item.key)) {
      const itemStat = addStat(inclusive, item.key, timeUs, item);
      itemStat.symbol = item.symbol;
      seenInclusive.add(item.key);
    }
    if (item.index !== undefined && !seenInclusiveIndices.has(item.index)) {
      const current = indexInclusive.get(item.index) || { samples: 0, timeUs: 0 };
      current.samples += 1; current.timeUs += timeUs; indexInclusive.set(item.index, current);
      seenInclusiveIndices.add(item.index);
    }
  }
  for (let i = 1; i < chain.length; ++i) {
    const parent = chain[i - 1], child = chain[i], key = `${parent.key}\u0000${child.key}`;
    const edge = addStat(edges, key, timeUs, { kind: "edge", url: child.url });
    edge.symbol = child.key;
    edge.parent = parent.key;
    edge.child = child.key;
  }
  const targetPositions = chain.map((item, index) => item.key === target ? index : -1).filter(index => index >= 0);
  for (const targetIndex of targetPositions) {
    const child = chain[targetIndex];
    if (targetIndex > 0) {
      const parent = chain[targetIndex - 1];
      const caller = addStat(directCallers, parent.key, timeUs, parent);
      caller.symbol = parent.symbol;
    }
    const seenAncestors = new Set();
    for (let i = 0; i < targetIndex; ++i) {
      const ancestor = chain[i];
      if (seenAncestors.has(ancestor.key)) continue;
      seenAncestors.add(ancestor.key);
      const caller = addStat(inclusiveCallers, ancestor.key, timeUs, ancestor);
      caller.symbol = ancestor.symbol;
    }
    void child;
  }
}

const selfStats = sortedStats(self, totalUs), inclusiveStats = sortedStats(inclusive, totalUs);
const selfBySymbol = new Map(selfStats.map(item => [item.symbol, item]));
const inclusiveBySymbol = new Map(inclusiveStats.map(item => [item.symbol, item]));
const functionBindings = [...indexBindings.values()].sort((a, b) => a.index - b.index).map(item => {
  const selfValue = indexSelf.get(item.index) || { samples: 0, timeUs: 0 };
  const inclusiveValue = indexInclusive.get(item.index) || { samples: 0, timeUs: 0 };
  return {
    index: item.index, symbol: item.symbol, offsets: [...item.offsets].sort((a, b) => a - b), nodeIds: [...item.nodeIds].sort((a, b) => a - b),
    selfSamples: selfValue.samples, selfTimeUs: selfValue.timeUs, selfPercent: 100 * selfValue.timeUs / totalUs,
    inclusiveSamples: inclusiveValue.samples, inclusiveTimeUs: inclusiveValue.timeUs, inclusivePercent: 100 * inclusiveValue.timeUs / totalUs,
  };
});

const directCallerStats = [...directCallers.entries()].sort((a, b) => b[1].timeUs - a[1].timeUs).map(([symbol, value]) => serialStat({ ...value, symbol }, totalUs));
const inclusiveCallerStats = [...inclusiveCallers.entries()].sort((a, b) => b[1].timeUs - a[1].timeUs).map(([symbol, value]) => serialStat({ ...value, symbol }, totalUs));
const udivSelf = selfBySymbol.get(target) || null;
const udivInclusive = inclusiveBySymbol.get(target) || null;

const softfloatEntries = selfStats.filter(item => /softfloat|rustc_apfloat/i.test(item.symbol)).map(item => ({
  symbol: item.symbol,
  self: item,
  inclusive: inclusiveBySymbol.get(item.symbol) || null,
}));
for (const item of inclusiveStats.filter(item => /softfloat|rustc_apfloat/i.test(item.symbol) && !softfloatEntries.some(entry => entry.symbol === item.symbol))) {
  softfloatEntries.push({ symbol: item.symbol, self: selfBySymbol.get(item.symbol) || null, inclusive: item });
}
softfloatEntries.sort((a, b) => (b.self?.timeUs || 0) - (a.self?.timeUs || 0));

function classify(item) {
  const symbol = item.symbol || "";
  const url = item.url || "";
  if (item.kind === "rust" && /^__/.test(symbol)) return "compiler-builtin";
  if (item.kind === "rust" && /rustc_apfloat|softfloat/i.test(symbol)) return "numeric-runtime";
  if (item.kind === "rust" && /jit|BlockCache|CompiledBlockExecutor/i.test(symbol)) return "jit-control-rust";
  if (item.kind === "rust" && symbol.startsWith("wasm_vm_core::")) return "interpreter-core-rust";
  if (item.kind === "rust" && symbol.startsWith("wasm_vm_wasm::")) return "wasm-runtime-rust";
  if (item.kind === "rust") return "other-rust";
  if (url.startsWith("wasm://wasm/")) return "jit-wasm-module";
  if (/^(js-to-wasm|wasm-to-js|__wbg_)/.test(symbol)) return "wasm-bindgen-glue";
  return "host-js-or-other";
}

const distribution = new Map();
for (const item of selfStats) {
  const category = classify(item);
  const value = distribution.get(category) || { category, samples: 0, timeUs: 0 };
  value.samples += item.samples; value.timeUs += item.timeUs; distribution.set(category, value);
}
const distributionRows = [...distribution.values()].sort((a, b) => b.timeUs - a.timeUs).map(item => ({ ...item, percent: 100 * item.timeUs / totalUs }));
const interpreterTimeUs = (distribution.get("interpreter-core-rust")?.timeUs || 0);
const jitTimeUs = (distribution.get("jit-control-rust")?.timeUs || 0) + (distribution.get("jit-wasm-module")?.timeUs || 0);

const sourceLineSymbols = [
  "wasm_vm_core::Machine::run::hb3a70af4514667f1",
  "wasm_vm_core::hart::Hart::execute::hd1da7e6748700a68",
  "wasm_vm_core::Machine::next_micro_op::h12a59264ce5c0708",
].map(symbol => ({
  symbol,
  profileFunctions: functionBindings.filter(item => item.symbol === symbol),
  sourceLines: null,
  result: "unavailable-without-guessing",
  reason: "The exact c48 named companion has no DWARF custom sections. The available raw target Wasm has DWARF but is a different module: its function section count and executable identity do not match c48, so its offsets cannot be applied to this profile.",
}));

const topDirectCaller = directCallerStats[0] || null;
const candidate = {
  title: "Investigate the observed __udivti3 integer-division path",
  target: target,
  evidence: { self: udivSelf, inclusive: udivInclusive, topDirectCaller },
  boundary: "Measure divisor/value patterns and callers before changing code; this is a narrow compiler-builtin path, not a softfloat attribution.",
};

const analysis = {
  schema: "wasm-vm.omarchy-softpipe.profile-symbol-analysis.v1",
  generatedFrom: { profilePath: path.relative(repo, profilePath), profileSha256: sha256(await readFile(profilePath)), moduleUrl, releaseSha256, namedSha256, rawTargetSha256: rawSha256 },
  binding: { exactSectionBound: true, names: binding.names.size, executableSections: binding.sections },
  profile: { totalUs, samples: profile.samples.length, nodeCount: profile.nodes.length, boundProfileFunctionIndices: functionBindings.length, missingNamedIndices: functionBindings.filter(item => item.symbol.startsWith("wasm-function[")).map(item => item.index) },
  allProfileFunctionIndices: functionBindings,
  top30Self: selfStats.slice(0, 30),
  top30Inclusive: inclusiveStats.slice(0, 30),
  udivti3: { self: udivSelf, inclusive: udivInclusive, directCallers: directCallerStats, inclusiveCallers: inclusiveCallerStats },
  softfloatAndApfloat: softfloatEntries,
  sourceLineMapping: {
    rawTarget: { sha256: rawSha256, functionCount: functionCount(rawSections), customSections: customNames(rawSections), dwarfSections: customNames(rawSections).filter(name => name.startsWith(".debug_")) },
    exactC48Companion: { sha256: namedSha256, functionCount: functionCount(namedSections), customSections: customNames(namedSections), dwarfSections: customNames(namedSections).filter(name => name.startsWith(".debug_")) },
    c48Release: { sha256: releaseSha256, functionCount: functionCount(releaseSections), customSections: customNames(releaseSections) },
    targets: sourceLineSymbols,
  },
  interpreterVsJit: {
    classificationRules: { interpreterCoreRust: "wasm_vm_core:: symbols excluding names matching jit, BlockCache, or CompiledBlockExecutor", jitControlRust: "Rust symbols matching jit, BlockCache, or CompiledBlockExecutor", jitWasmModule: "non-Rust frames whose URL starts wasm://wasm/", caveat: "These are host CPU sample buckets by frame label; core-machine self time is not a guest-instruction count." },
    rows: distributionRows,
    interpreterCoreRust: { timeUs: interpreterTimeUs, percent: 100 * interpreterTimeUs / totalUs },
    jitLabeled: { timeUs: jitTimeUs, percent: 100 * jitTimeUs / totalUs },
  },
  futureT03dCandidate: candidate,
};

const mdRows = (rows, columns) => rows.map(row => `| ${columns.map(column => cell(column(row))).join(" | ")} |`).join("\n");
const md = `# c48 profile symbol analysis\n\n` +
  `- Profile: ${analysis.generatedFrom.profilePath} (${analysis.generatedFrom.profileSha256})\n` +
  `- Exact release: ${releaseSha256}; name companion: ${namedSha256}; exact non-custom section binding: **true**; names: ${binding.names.size}\n` +
  `- Samples: ${profile.samples.length}; sampled time: ${totalUs} us.\n\n` +
  `## Top 30 direct self time\n\n| Rank | Symbol | Self us | Self % | Samples | Indices |\n| ---: | --- | ---: | ---: | ---: | --- |\n` +
  mdRows(analysis.top30Self.map((row, index) => ({ ...row, rank: index + 1 })), [row => row.rank, row => row.symbol, row => row.timeUs, row => row.percent.toFixed(3), row => row.samples, row => row.indices.join(", ")]) + "\n\n" +
  `## __udivti3\n\n` +
  `Direct self: ${udivSelf ? `${udivSelf.timeUs} us (${udivSelf.percent.toFixed(3)}%), ${udivSelf.samples} samples` : "not observed"}. Inclusive: ${udivInclusive ? `${udivInclusive.timeUs} us (${udivInclusive.percent.toFixed(3)}%)` : "not observed"}.\n\n` +
  `### Direct callers\n\n| Caller | Sampled us | % | Samples |\n| --- | ---: | ---: | ---: |\n` +
  mdRows(directCallerStats, [row => row.symbol, row => row.timeUs, row => row.percent.toFixed(3), row => row.samples]) + "\n\n" +
  `### Inclusive callers\n\n| Ancestor | Sampled us | % | Samples |\n| --- | ---: | ---: | ---: |\n` +
  mdRows(inclusiveCallerStats, [row => row.symbol, row => row.timeUs, row => row.percent.toFixed(3), row => row.samples]) + "\n\n" +
  `## softfloat and rustc_apfloat entries\n\n| Symbol | Self us | Self % | Inclusive us | Inclusive % | Indices |\n| --- | ---: | ---: | ---: | ---: | --- |\n` +
  mdRows(softfloatEntries, [row => row.symbol, row => row.self?.timeUs ?? 0, row => (row.self?.percent ?? 0).toFixed(3), row => row.inclusive?.timeUs ?? 0, row => (row.inclusive?.percent ?? 0).toFixed(3), row => (row.self?.indices || row.inclusive?.indices || []).join(", ")]) + "\n\n" +
  `## Source-lined offsets\n\n` +
  `No source-line mapping is claimed. The exact c48 companion contains no DWARF; the raw target has DWARF but is a different module (raw functions: ${functionCount(rawSections)}; c48 functions: ${functionCount(releaseSections)}). Applying raw DWARF offsets would be guessing.\n\n` +
  `| Symbol | c48 index/offset | Result |\n| --- | --- | --- |\n` +
  mdRows(sourceLineSymbols, [row => row.symbol, row => row.profileFunctions.map(item => `${item.index}/${item.offsets.join(",")}`).join("; "), row => row.result]) + "\n\n" +
  `## Interpreter versus JIT labels\n\n` +
  `These are measured host CPU sample buckets, not guest-instruction counts. JIT-labeled frames are kept separate.\n\n| Bucket | Sampled us | % | Samples |\n| --- | ---: | ---: | ---: |\n` +
  mdRows(distributionRows, [row => row.category, row => row.timeUs, row => row.percent.toFixed(3), row => row.samples]) + `\n\n` +
  `Interpreter-core bucket: ${interpreterTimeUs} us (${(100 * interpreterTimeUs / totalUs).toFixed(3)}%). JIT-labeled bucket: ${jitTimeUs} us (${(100 * jitTimeUs / totalUs).toFixed(3)}%).\n\n` +
  `## Narrow future T03d candidate\n\n` +
  `Investigate the observed __udivti3 integer-division path, beginning with its top direct caller: **${topDirectCaller?.symbol || "none observed"}**. This is the narrowest evidence-supported target from this profile; measure divisor/value patterns and verify generated code before proposing a replacement. It is not a softfloat diagnosis.\n`;

await writeFile(path.join(symbols, "profile-analysis.json"), JSON.stringify(analysis, null, 2) + "\n");
await writeFile(path.join(symbols, "profile-analysis.md"), md);
console.log(JSON.stringify({ status: "passed", output: ["profile-analysis.json", "profile-analysis.md"], totalUs, top30: analysis.top30Self.slice(0, 5), udivti3: analysis.udivti3, candidate }, null, 2));
