#!/usr/bin/env node
// A bounded native opcode measurement. The private zero-ID copy is never a release artifact.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { spawn, execFile as callbackExec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { R3_IDENTITIES } from "./omarchy-input-trial.mjs";
import { BASE_SHA256, BASE_SIZE, DEFAULT_SOURCE } from "./omarchy-softpipe-candidate.mjs";
import { sections } from "./omarchy-wait-checkpoint.mjs";

const execFile = promisify(callbackExec);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const core = Buffer.alloc(32); core.write("0.0.1");
export const INSTRUCTION_BUDGET = 100_000_000;

export function validatePair(snapshot, delta, manifestBytes) {
  const manifest = JSON.parse(manifestBytes);
  const identity = Object.fromEntries(["version", "image_len", "chunk_size", "layout", "chunks"].map(k => [k, manifest[k]]));
  const base = sha(Buffer.from(JSON.stringify(identity)));
  assert.equal(manifest.image_len, BASE_SIZE);
  assert.equal(manifest.chunk_size, 262144);
  assert.equal(manifest.chunks.length, 16384);
  assert.ok(snapshot.length >= 84 && delta.length >= 61, "truncated pair");
  assert.equal(snapshot.subarray(0, 8).toString(), "WVMRESU1");
  assert.equal(snapshot.readUInt32LE(8), 1);
  assert.deepEqual(snapshot.subarray(12, 44), core);
  assert.equal(snapshot.subarray(44, 76).toString("hex"), base);
  assert.equal(snapshot.readBigUInt64LE(76), 0n);
  assert.equal(delta.subarray(0, 5).toString(), "WVOD1");
  assert.equal(delta.readUInt32LE(5), 4096);
  assert.equal(delta.readBigUInt64LE(9), BigInt(BASE_SIZE));
  assert.equal(delta.subarray(17, 49).toString("hex"), base);
  assert.equal(delta.readBigUInt64LE(49), 0n);
  const count = delta.readUInt32LE(57);
  assert.equal(delta.length, 61 + count * 4104, "invalid delta length");
  let previous = -1n;
  for (let i = 0; i < count; i++) {
    const index = delta.readBigUInt64LE(61 + i * 4104);
    assert.ok(index > previous && index < BigInt(BASE_SIZE / 4096), "duplicate, unordered or out-of-range delta record");
    previous = index;
  }
  return { base, core: core.toString("hex"), generation: 0, blocks: count };
}

export function diagnosticSnapshot(raw) {
  const before = { prefix: sha(raw.subarray(0, 12)), suffix: sha(raw.subarray(76)), sha256: sha(raw) };
  raw.fill(0, 12, 76);
  assert.equal(sha(raw.subarray(0, 12)), before.prefix);
  assert.equal(sha(raw.subarray(76)), before.suffix);
  return { changedRange: { offset: 12, length: 64 }, before, afterSha256: sha(raw),
    limitation: "Private native diagnostic only; zero coherence IDs do not prove restore acceptance." };
}

export function recountProfile(profile) {
  const sum = values => values.reduce((a, b) => {
    assert.ok(Number.isSafeInteger(b) && b >= 0, "invalid histogram count"); return a + b;
  }, 0);
  const count = code => profile.opcode7[code] ?? 0;
  assert.equal(sum(Object.values(profile.opcode7)), profile.total_retired, "opcode total drift");
  const fma = sum(["0x43", "0x47", "0x4b", "0x4f"].map(count));
  const compute = count("0x53") + fma;
  assert.equal(sum(Object.values(profile.op_fp_funct7)), count("0x53"), "OP-FP total drift");
  assert.equal(sum(Object.values(profile.fma_opcode7)), fma, "FMA total drift");
  assert.equal(compute, profile.fp_compute, "FP compute classification drift");
  assert.equal(profile.fp, profile.fp_ldst + compute);
  assert.ok(profile.fp_ldst >= count("0x07") + count("0x27"));
  assert.equal(profile.trace_retired, profile.total_retired);
  assert.equal(profile.fp_region64.length, profile.fp_region64_distinct);
  assert.equal(sum(profile.fp_region64.map(r => r.total)) + profile.fp_region64_dropped,
    profile.total_retired, "region total drift");
  const regions = profile.fp_region64.map(r => {
    assert.match(r.pc, /^0x[0-9a-f]{16}$/u);
    assert.equal(BigInt(r.pc) & 63n, 0n);
    assert.ok(r.fp_compute <= r.total && r.total > 0);
    return { ...r, computePercent: 100 * r.fp_compute / r.total, sharePercent: 100 * r.total / profile.total_retired };
  });
  assert.equal(new Set(regions.map(r => r.pc)).size, regions.length);
  const regionalCompute = sum(regions.map(r => r.fp_compute));
  assert.ok(regionalCompute <= compute);
  if (profile.fp_region64_dropped === 0) assert.equal(regionalCompute, compute, "region FP drift");
  const computePercent = 100 * compute / profile.total_retired;
  return { compute, computePercent, reportedFpLoadStore: profile.fp_ldst,
    loadStoreLimitation: "Compressed FP load/store counts cannot be independently reconstructed from low-seven-bit opcode totals.",
    opFpFunct7: profile.op_fp_funct7, hotRegions: regions.sort((a, b) => b.total - a.total).slice(0, 32),
    truncation: { pairSamplesDropped: profile.pair_hist_dropped, regionSamplesDropped: profile.fp_region64_dropped },
    policyReopenConditionObserved: computePercent > 5 && regions.some(r => r.sharePercent >= 1 && r.computePercent > 5),
    limitation: "Retired opcode mix only; not a throughput, JIT speedup or desktop responsiveness measurement." };
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}

export async function recordProcess(command, args, prefix, env, timeoutMs) {
  const stdout = createWriteStream(`${prefix}.stdout`, { flags: "wx" });
  const stderr = createWriteStream(`${prefix}.stderr`, { flags: "wx" });
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  let timedOut = false, killTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already closed */ }
    killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already closed */ } }, 5000);
  }, timeoutMs);
  const result = await new Promise(resolve => {
    child.once("error", error => resolve({ error: String(error) }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer); clearTimeout(killTimer);
  await Promise.all([stdout, stderr].map(stream => stream.writableFinished ? undefined : new Promise(resolve => stream.once("finish", resolve))));
  return { command, args, cwd: repo, pid: child.pid, startedAt, finishedAt: new Date().toISOString(), timedOut, ...result };
}

export async function main(output) {
  assert.ok(output, "usage: omarchy-renderer-opcodes.mjs NEW_OUTPUT_DIR");
  const out = path.resolve(output); await fs.mkdir(out, { recursive: false });
  const work = await fs.mkdtemp(path.join(repo, "target/omarchy-opcodes-"));
  const receipt = { purpose: "R3 renderer opcode measurement", work, startedAt: new Date().toISOString(),
    head: (await execFile("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim(),
    desktopAcceptance: false, instructionBudget: INSTRUCTION_BUDGET };
  const save = () => fs.writeFile(path.join(out, "report.json"), JSON.stringify(receipt, null, 2) + "\n");
  try {
    await execFile("git", ["diff", "--quiet", "HEAD", "--", "crates", "Cargo.toml", "Cargo.lock"], { cwd: repo });
    const env = { ...process.env };
    receipt.environmentPolicy = { scrubPrefixes: ["CARGO_", "WASM_VM_"], scrubExact: ["RUSTFLAGS", "RUST_LOG"],
      buildOverrides: {}, runOverrides: { WASM_VM_FP_HISTOGRAM: "1" },
      developerDirectory: env.DEVELOPER_DIR ?? null,
      limitations: ["--virtio-rng uses OS entropy if the guest consumes it; this is not cross-run determinism or performance proof.",
        "The non-null retirement sink selects interpreter execution even when --jit is supplied."] };
    for (const key of Object.keys(env)) if (receipt.environmentPolicy.scrubPrefixes.some(prefix => key.startsWith(prefix)) ||
      receipt.environmentPolicy.scrubExact.includes(key)) delete env[key];
    receipt.build = await recordProcess("cargo", ["build", "--offline", "--release", "-p", "wasm-vm-cli", "--bin", "wasm-vm"],
      path.join(out, "build"), env, 1200000);
    await save(); assert.equal(receipt.build.code, 0, "native build failed");
    const binary = path.join(work, "wasm-vm"); await fs.copyFile(path.join(repo, "target/release/wasm-vm"), binary);
    await fs.chmod(binary, 0o700); receipt.binary = { path: binary, sha256: await hashFile(binary) };
    const sources = {
      kernel: path.join(repo, "releases/kernel/6.6.63/Image"),
      bootSnapshot: path.join(repo, "target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz"),
      overlayDelta: path.join(repo, "target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz"),
      chunkManifest: path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k/manifest.json"),
      image: path.join(repo, DEFAULT_SOURCE),
    };
    receipt.sources = {};
    for (const [role, filename] of Object.entries(sources)) {
      const actual = { size: (await fs.stat(filename)).size, sha256: await hashFile(filename) };
      assert.deepEqual(actual, role === "image" ? { size: BASE_SIZE, sha256: BASE_SHA256 } : R3_IDENTITIES[role]);
      receipt.sources[role] = { path: filename, ...actual };
    }
    const snapshot = gunzipSync(await fs.readFile(sources.bootSnapshot), { maxOutputLength: 2 * 1024 ** 3 });
    const delta = gunzipSync(await fs.readFile(sources.overlayDelta), { maxOutputLength: 64 * 1024 ** 2 });
    receipt.pair = validatePair(snapshot, delta, await fs.readFile(sources.chunkManifest));
    const clock = sections(snapshot).get(9);
    assert.equal(clock?.length, 24); assert.equal(clock.readBigUInt64LE(8), 64n);
    assert.ok(clock.readBigUInt64LE(0) < 64n);
    receipt.snapshotClock = { phase: Number(clock.readBigUInt64LE(0)), divider: 64, stimecmp: clock.readBigUInt64LE(16).toString() };
    receipt.snapshotAdaptation = diagnosticSnapshot(snapshot);
    const nativeSnapshot = path.join(work, "diagnostic-only.snap"); await fs.writeFile(nativeSnapshot, snapshot, { flag: "wx" });
    const drive = path.join(work, "paired.ext4"); await execFile("cp", ["-c", sources.image, drive]);
    const disk = await fs.open(drive, "r+");
    try {
      for (let i = 0; i < receipt.pair.blocks; i++) {
        const at = 61 + i * 4104, offset = Number(delta.readBigUInt64LE(at)) * 4096;
        assert.equal((await disk.write(delta.subarray(at + 8, at + 4104), 0, 4096, offset)).bytesWritten, 4096);
      }
      await disk.sync();
    } finally { await disk.close(); }
    const beforeDrive = path.join(work, "paired-before.ext4"); await execFile("cp", ["-c", drive, beforeDrive]);
    receipt.privateInputs = { snapshot: nativeSnapshot, drive, beforeDrive, driveSha256: await hashFile(beforeDrive) };
    await save();
    const args = ["boot", "--kernel", sources.kernel, "--drive", `file=${drive}`, "--ram-mib", "1024", "--net", "--virtio-rng",
      "--browser-topology", "--icount-divider", "64", "--jit", "--block-cache", "--interrupt-batching", "--quantum", "500000",
      "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0", "--max-instrs", String(INSTRUCTION_BUDGET),
      "--no-input", "--no-reboot", "--stats", "--resume-from", nativeSnapshot, "--evidence", path.join(out, "guest-evidence.txt")];
    receipt.run = await recordProcess(binary, args, path.join(out, "native"), { ...env, WASM_VM_FP_HISTOGRAM: "1" }, 300000);
    await save(); assert.equal(receipt.run.code, 102, "profile did not reach its instruction budget");
    assert.equal(receipt.run.timedOut, false);
    const stderr = await fs.readFile(path.join(out, "native.stderr"), "utf8");
    const rows = stderr.split("\n").filter(line => line.startsWith("FP_SHARE_JSON "));
    assert.equal(rows.length, 1); const profile = JSON.parse(rows[0].slice("FP_SHARE_JSON ".length));
    assert.ok(profile.total_retired > INSTRUCTION_BUDGET * 0.99 && profile.total_retired <= INSTRUCTION_BUDGET);
    await fs.writeFile(path.join(out, "profile.json"), JSON.stringify(profile, null, 2) + "\n");
    receipt.recount = recountProfile(profile);
    const evidence = await fs.readFile(path.join(out, "guest-evidence.txt"), "utf8");
    assert.ok(evidence.includes(`trace fnv64=${profile.trace_fnv64}\n`));
    assert.ok(evidence.includes(`trace retired=${profile.trace_retired}\n`));
    assert.ok(evidence.includes("trace mode=retirement-records\n"));
    for (const value of Object.values(receipt.sources)) assert.equal(await hashFile(value.path), value.sha256, "source artifact changed");
    receipt.result = "opcode-measurement-complete";
  } catch (error) { receipt.result = "unproven"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); await save(); }
  console.log(JSON.stringify(receipt.recount));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv[2]);
