// Execute the actual orchestration source with filesystem/child stubs, never browser proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26k-browser-capacity.mjs", import.meta.url), "utf8");
const setup = source.slice(source.indexOf("const repo ="), source.indexOf("async function run("));
async function configure(env, refuse = false) {
  const writes = [], directories = [];
  const scope = { process: { env }, path, fileURLToPath: () => "/repo/tools/verify/runner.mjs",
    execFileSync: () => "a".repeat(40), createHash: () => ({ update() { return this; }, digest: () => "b".repeat(64) }),
    os: { tmpdir: () => "/tmp" }, readFile: async () => "source",
    mkdir: async (p, opts) => { directories.push(p); if (refuse && !opts) throw new Error("EEXIST"); },
    mkdtemp: async p => `${p}unique`, writeFile: async (...args) => writes.push(args) };
  const result = await vm.runInNewContext(`(async () => { ${setup.replace("import.meta.url", '"file:///runner"')}
    return { clean, common, retained, out }; })()`, scope);
  return { ...JSON.parse(JSON.stringify(result)), writes, directories };
}

test("actual setup scrubs tuning/compiler environment and authenticates a new headless seal by default", async () => {
  const result = await configure({ PATH: "/bin", E5_T26F_HEADED: "1", E5_T26F_DIAGNOSTIC: "reuse",
    E5_T26F_DIAGNOSTIC_JIT: "0", E5_T26F_DIAGNOSTIC_COMMAND: "fake", E5_T26F_DIAGNOSTIC_RESIDENCY: "cap-256",
    E5_T26K_OUT: "/evidence/fresh", CARGO_TEST: "1", RUSTFLAGS: "bad", RUST_LOG: "trace" });
  assert.deepEqual(result.clean, { PATH: "/bin" });
  assert.equal(result.common.E5_T26F_HEADED, "0");
  assert.equal(result.common.E5_T26F_FIXTURE, "resident-aplay-v1");
  assert.equal(result.common.E5_T26F_REQUIRE_HEAD, "a".repeat(40));
  assert.equal(result.common.E5_T26F_DIAGNOSTIC_PORT, "61632");
  assert.equal(result.retained, "/tmp/e5-t26k-capacity-unique");
  assert.equal(result.writes.length, 1);
  const invocation = JSON.parse(result.writes[0][1]);
  assert.deepEqual(invocation.order, [4096, 16384, 16384, 4096]);
  assert.equal(Object.keys(invocation.sourceBindings).length, 4);
  assert.equal(result.writes[0][2].flag, "wx");
});

test("existing evidence refuses before invocation writes or browser spawning", async () => {
  await assert.rejects(configure({ E5_T26K_OUT: "/existing" }, true), /EEXIST/);
  assert.ok(source.indexOf("await mkdir(out)") < source.indexOf("const retained ="));
  assert.ok(source.indexOf("await mkdir(out)") < source.indexOf("spawn(process.execPath"));
});

test("actual arm loop first cold-creates then emits only ABBA selection with immutable transcripts", () => {
  assert.match(source, /if \(!process\.env\.E5_T26K_CHECKPOINT\) \{\s+const cold = await run\("cold", \{ E5_T26F_DIAGNOSTIC: "create" \}\)/u);
  assert.match(source, /for \(const \[index, entries\] of \[4096, 16384, 16384, 4096\]\.entries\(\)\)/u);
  assert.match(source, /E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES: String\(entries\)/u);
  assert.match(source, /assert\.equal\(raw.head, head\)/u);
  assert.match(source, /assert\.deepEqual\(results\[0\]\[key\], observed\[key\]/u);
  assert.match(source, /"run.log"\), log, \{ flag: "wx" \}/u);
  assert.match(source, /collectDecodedCacheRecord\(raw, child.code, entries\)/u);
});
