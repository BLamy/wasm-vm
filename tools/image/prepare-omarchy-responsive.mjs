#!/usr/bin/env node
// Prepare the responsive Omarchy desktop pair (RAM snapshot + disk overlay delta).
//
// Restores the currently shipped prepared pair in the native CLI with the browser's exact device
// topology, applies tools/image/omarchy-responsive-profile.sh to the live session over the serial
// console, relaunches the demo terminal, waits until the desktop is genuinely idle, and captures a
// new coherent pair against the SAME base image / chunk manifest. Only the two pair artifacts (and
// web/artifacts-omarchy.json) change; the 4 GiB chunked image on R2 is reused as-is.
//
//   node tools/image/prepare-omarchy-responsive.mjs \
//     --bin target/release/wasm-vm --kernel releases/kernel/6.6.63/Image \
//     --pair releases/boot-snapshot --base-image target/omarchy-profile-sdr-r3.ext4 \
//     --chunks target/omarchy-profile-chunks-sdr-r3-256k --out target/omarchy-responsive-pair
//
// The output directory must not exist. Nothing under --pair/--base-image/--chunks is modified.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync, constants as zlib } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE = path.join(repo, "tools/image/omarchy-responsive-profile.sh");
const TRIGGER = ["WVM_OMARCHY_RESPONSIVE_", "READY"];
const BLOCK = 4096;

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    assert.match(key ?? "", /^--(bin|kernel|pair|base-image|chunks|out|timeout-min)$/u, `unknown argument ${key}`);
    assert.ok(argv[i + 1], `${key} needs a value`);
    out[key.slice(2)] = argv[i + 1];
  }
  for (const key of ["bin", "kernel", "pair", "base-image", "chunks", "out"]) assert.ok(out[key], `--${key} is required`);
  return out;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function identity(file) {
  return { path: path.resolve(file), size: (await fs.stat(file)).size, sha256: await hashFile(file) };
}

// The browser and build-omarchy-snapshot.sh derive the base id from exactly these manifest keys.
export function manifestBaseId(manifest) {
  const canonical = Object.fromEntries(["version", "image_len", "chunk_size", "layout", "chunks"].map((k) => [k, manifest[k]]));
  return sha256(Buffer.from(JSON.stringify(canonical)));
}

export function coreIdHex(version) {
  const bytes = Buffer.alloc(32);
  bytes.write(version, "utf8");
  return bytes.toString("hex");
}

// Snapshot header: magic(8) version(4) core(32) base(32) generation(8) — see validatePair in
// tools/verify/omarchy-renderer-opcodes.mjs. Overlay delta: magic(5) block(4) len(8) base(32) gen(8) count(4).
export function readPairHeaders(snapshot, delta) {
  assert.equal(snapshot.subarray(0, 8).toString("latin1"), "WVMRESU1", "not a resume snapshot");
  assert.equal(delta.subarray(0, 5).toString("latin1"), "WVOD1", "not an overlay delta");
  assert.equal(delta.readUInt32LE(5), BLOCK, "unexpected delta block size");
  const count = delta.readUInt32LE(57);
  assert.equal(delta.length, 61 + count * (8 + BLOCK), "truncated overlay delta");
  const records = [];
  let previous = -1n;
  for (let i = 0; i < count; i++) {
    const at = 61 + i * (8 + BLOCK);
    const index = delta.readBigUInt64LE(at);
    assert.ok(index > previous, "overlay delta records must be strictly increasing");
    previous = index;
    records.push({ index: Number(index), at: at + 8 });
  }
  return {
    snapshotCore: snapshot.subarray(12, 44).toString("hex"),
    snapshotBase: snapshot.subarray(44, 76).toString("hex"),
    snapshotGeneration: Number(snapshot.readBigUInt64LE(76)),
    deltaImageLen: Number(delta.readBigUInt64LE(9)),
    deltaBase: delta.subarray(17, 49).toString("hex"),
    deltaGeneration: Number(delta.readBigUInt64LE(49)),
    records,
  };
}

export function encodeDelta(blocks, imageLen, baseHex) {
  const header = Buffer.alloc(61);
  header.write("WVOD1", 0, "latin1");
  header.writeUInt32LE(BLOCK, 5);
  header.writeBigUInt64LE(BigInt(imageLen), 9);
  Buffer.from(baseHex, "hex").copy(header, 17);
  header.writeBigUInt64LE(0n, 49);
  header.writeUInt32LE(blocks.length, 57);
  const parts = [header];
  for (const { index, bytes } of blocks) {
    const idx = Buffer.alloc(8);
    idx.writeBigUInt64LE(BigInt(index));
    parts.push(idx, bytes);
  }
  return Buffer.concat(parts);
}

// Every 4 KiB block of the working image that differs from the published chunk it came from.
async function computeDelta(workImage, chunkRoot, manifest) {
  const handle = await fs.open(workImage, "r");
  const blocks = [];
  try {
    const buffer = Buffer.alloc(manifest.chunk_size);
    for (let chunk = 0; chunk < manifest.chunks.length; chunk++) {
      const digest = manifest.chunks[chunk];
      const base = await fs.readFile(path.join(chunkRoot, "chunks", `${digest}.bin`));
      assert.equal(base.length, manifest.chunk_size, `chunk ${chunk} has the wrong size`);
      assert.equal(sha256(base), digest, `chunk ${chunk} fails its content address`);
      const { bytesRead } = await handle.read(buffer, 0, manifest.chunk_size, chunk * manifest.chunk_size);
      assert.equal(bytesRead, manifest.chunk_size, `working image truncated at chunk ${chunk}`);
      for (let off = 0; off < manifest.chunk_size; off += BLOCK) {
        if (!buffer.subarray(off, off + BLOCK).equals(base.subarray(off, off + BLOCK))) {
          blocks.push({ index: (chunk * manifest.chunk_size + off) / BLOCK, bytes: Buffer.from(buffer.subarray(off, off + BLOCK)) });
        }
      }
    }
  } finally { await handle.close(); }
  return blocks;
}

const plain = (text) => text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/gu, "").replace(/\x1bP[\s\S]*?\x1b\\/gu, "")
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "").replaceAll("\r", "");

class SerialGuest {
  constructor(child, log) {
    this.child = child; this.serial = ""; this.waiters = new Set(); this.exited = null; this.seq = 0; this.log = log;
    child.stdout.on("data", (bytes) => {
      log.push(bytes);
      this.serial = (this.serial + bytes.toString("utf8")).slice(-4_000_000);
      // Bash/readline asks for the cursor position before drawing a prompt on this serial line.
      if (bytes.includes(Buffer.from("\x1b[6n"))) child.stdin.write("\x1b[1;1R");
      for (const check of this.waiters) check();
    });
    this.exit = new Promise((resolve) => child.on("close", (code, signal) => {
      this.exited = { code, signal };
      for (const check of this.waiters) check();
      resolve(this.exited);
    }));
  }
  waitFor(read, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error(`${label}: timed out after ${timeoutMs} ms`)), timeoutMs);
      const done = (error, value) => { clearTimeout(timer); this.waiters.delete(check); error ? reject(error) : resolve(value); };
      const check = () => {
        const value = read();
        if (value) done(null, value);
        else if (this.exited) done(new Error(`${label}: emulator exited ${JSON.stringify(this.exited)}`));
      };
      this.waiters.add(check); check();
    });
  }
  async run(command, timeoutMs = 900_000) {
    assert.ok(!/[\r\n]/u.test(command), "serial command must be one line");
    const token = `resp_${++this.seq}_${Date.now() % 1e6}`;
    const started = Date.now();
    this.child.stdin.write(`printf '\\n%s\\n' '${token}_begin'; ( ${command} ); wv_rc=$?; printf '\\n%s:%s\\n' '${token}_end' "$wv_rc"\r`);
    const result = await this.waitFor(() => {
      const lines = plain(this.serial).split("\n");
      const start = lines.lastIndexOf(`${token}_begin`);
      if (start < 0) return null;
      for (let end = start + 1; end < lines.length; end++) {
        const match = lines[end].match(new RegExp(`^${token}_end:([0-9]+)$`, "u"));
        if (match) return { status: Number(match[1]), output: lines.slice(start + 1, end).join("\n").trim() };
      }
      return null;
    }, timeoutMs, command.slice(0, 60));
    return { command, ...result, hostMs: Date.now() - started };
  }
}

const HYPR = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0";

// A desktop is settled when the compositor answers promptly and the single hart idles.
async function settled(guest, receipt, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = await guest.run(`${HYPR} version >/dev/null && read -r u0 i0 < /proc/uptime && sleep 2 && read -r u1 i1 < /proc/uptime && echo "$u0 $i0 $u1 $i1"`);
    const [u0, i0, u1, i1] = probe.output.split(/\s+/u).map(Number);
    const idleShare = (i1 - i0) / (u1 - u0);
    receipt.settleProbes.push({ label, status: probe.status, uptime: u1, idleShare, hostMs: probe.hostMs });
    if (probe.status === 0 && idleShare >= 0.9) return idleShare;
    assert.ok(Date.now() < deadline, `${label}: desktop did not settle`);
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  const out = path.resolve(args.out);
  await fs.mkdir(out, { recursive: false });
  const timeoutMs = Number(args["timeout-min"] ?? 120) * 60_000;
  const receipt = { kind: "omarchy-responsive-pair", startedAt: new Date().toISOString(), passed: false,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    profile: await identity(PROFILE), settleProbes: [], serial: [] };
  const save = () => fs.writeFile(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  const work = await fs.mkdtemp(path.join(path.dirname(out), ".omarchy-responsive-work-"));
  const serialLog = [];
  try {
    const manifestPath = path.join(args.chunks, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const baseId = manifestBaseId(manifest);
    const version = (await fs.readFile(path.join(repo, "Cargo.toml"), "utf8")).match(/^version\s*=\s*"([^"]+)"/mu)[1];
    const coreId = coreIdHex(version);
    receipt.inputs = {
      bin: await identity(args.bin), kernel: await identity(args.kernel), chunkManifest: await identity(manifestPath),
      bootSnapshot: await identity(path.join(args.pair, "omarchy-ready.snap.gz")),
      overlayDelta: await identity(path.join(args.pair, "omarchy-overlay-delta.bin.gz")),
      baseImage: await identity(args["base-image"]),
    };
    receipt.binding = { baseId, coreId, version };
    await save();

    const snapshot = gunzipSync(await fs.readFile(path.join(args.pair, "omarchy-ready.snap.gz")), { maxOutputLength: 4 * 1024 ** 3 });
    const delta = gunzipSync(await fs.readFile(path.join(args.pair, "omarchy-overlay-delta.bin.gz")), { maxOutputLength: 1024 ** 3 });
    const headers = readPairHeaders(snapshot, delta);
    assert.equal(headers.snapshotBase, baseId, "snapshot is not bound to this chunk manifest");
    assert.equal(headers.deltaBase, baseId, "overlay delta is not bound to this chunk manifest");
    assert.equal(headers.snapshotCore, coreId, "snapshot is not bound to this core version");
    assert.equal(headers.deltaImageLen, manifest.image_len);
    assert.equal(headers.snapshotGeneration, headers.deltaGeneration, "snapshot and delta disagree on the overlay generation");
    receipt.sourceGeneration = headers.snapshotGeneration;
    assert.equal(receipt.inputs.baseImage.size, manifest.image_len);

    // The native CLI restores only zero-identity, generation-0 blobs (a pair exported from the
    // browser carries its persisted overlay generation, e.g. 48). The disk here is rebuilt from
    // base + delta, so the binding is re-established by construction; the private copy never
    // leaves `work`, and the captured pair is written with generation 0 in both headers.
    snapshot.fill(0, 12, 84);
    const nativeSnapshot = path.join(work, "restore.snap");
    await fs.writeFile(nativeSnapshot, snapshot);
    const drive = path.join(work, "omarchy.ext4");
    try { execFileSync("cp", ["-c", args["base-image"], drive]); } catch { await fs.copyFile(args["base-image"], drive); }
    const disk = await fs.open(drive, "r+");
    try {
      for (const record of headers.records) await disk.write(delta, record.at, BLOCK, record.index * BLOCK);
    } finally { await disk.close(); }
    receipt.restoredDeltaBlocks = headers.records.length;

    const rawSnapshot = path.join(work, "omarchy-ready.snap");
    const cliArgs = ["boot", "--kernel", args.kernel, "--drive", `file=${drive}`, "--ram-mib", "1024", "--net", "--virtio-rng",
      "--browser-topology", "--icount-divider", "64", "--jit", "--block-cache", "--interrupt-batching",
      "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0", "--quantum", "500000",
      "--max-instrs", "4000000000000", "--resume-from", nativeSnapshot,
      "--snapshot-trigger", TRIGGER.join(""), "--snapshot-out", rawSnapshot,
      "--snapshot-core-id", coreId, "--snapshot-base-id", baseId];
    receipt.command = [args.bin, ...cliArgs];
    const child = spawn(args.bin, cliArgs, { stdio: ["pipe", "pipe", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (bytes) => stderr.push(bytes));
    const guest = new SerialGuest(child, serialLog);
    const watchdog = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    try {
      const run = async (command, label) => {
        const result = await guest.run(command);
        receipt.serial.push({ label, ...result });
        await save();
        return result;
      };
      child.stdin.write("\r");
      await guest.waitFor(() => /\[omarchy@omarchy-demo [^\n]*\]\$ /u.test(plain(guest.serial)), 600_000, "restored prompt");
      assert.equal((await run("id -u", "identity")).output, "1000");

      // 1. User-level profile files, then have the running shell reread its shell.json.
      const profile = (await fs.readFile(PROFILE)).toString("base64");
      const applied = await run(`echo ${profile} | base64 -d > /tmp/omarchy-responsive-profile.sh && bash /tmp/omarchy-responsive-profile.sh`, "profile");
      assert.equal(applied.status, 0, applied.output);
      const reload = await run("XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 OMARCHY_PATH=/usr/share/omarchy OMARCHY_SHELL_IPC_TIMEOUT=600s omarchy-shell shell reloadConfig", "shell-reload");
      assert.equal(reload.output, "ok");

      // 2. With the background layer gone the full-screen recomposite loop stops.
      await settled(guest, receipt, "background-disabled", timeoutMs);
      const layers = await run(`${HYPR} -j layers`, "layers");
      assert.doesNotMatch(layers.output, /"omarchy-background"/u);
      assert.match(layers.output, /"omarchy-bar"/u);

      // 3. Replace the demo terminal with the profile's Foot (same package bytes, no effect global).
      const oldFoot = (await run("pgrep -u 1000 -x foot", "old-foot")).output.trim();
      assert.match(oldFoot, /^[0-9]+$/u, "exactly one package Foot must be running");
      await run(`kill ${oldFoot}; while kill -0 ${oldFoot} 2>/dev/null; do sleep 0.2; done`, "stop-old-foot");
      await settled(guest, receipt, "old-foot-closed", timeoutMs);
      const launch = await run(`${HYPR} dispatch 'hl.dsp.exec_cmd("/home/omarchy/.local/bin/foot")'`, "launch-foot");
      assert.equal(launch.output, "ok");
      const mapDeadline = Date.now() + timeoutMs;
      for (;;) {
        assert.ok(Date.now() < mapDeadline, "profile terminal did not map");
        const clients = await run(`${HYPR} -j clients`, "clients");
        let list = [];
        try { list = JSON.parse(clients.output); } catch { /* compositor still busy */ }
        if (list.length === 1 && list[0].class === "foot" && list[0].mapped && list[0].size?.[0] === 1256) {
          receipt.foot = list[0];
          break;
        }
      }
      await settled(guest, receipt, "terminal-ready", timeoutMs);
      const exe = await run(`readlink /proc/${receipt.foot.pid}/exe; pgrep -u 1000 -f omarchy-launch-screensaver || true; test -f ~/.local/state/omarchy/indicators/stay-awake && echo stay-awake`, "verify");
      assert.deepEqual(exe.output.split("\n").map((s) => s.trim()).filter(Boolean), ["/home/omarchy/.local/bin/foot", "stay-awake"]);
      receipt.finalLayers = JSON.parse((await run(`${HYPR} -j layers`, "final-layers")).output);
      // A newly mapped surface's damage is composited only when Hyprland next renders a frame, and
      // with the background layer gone the only periodic commit left is the bar clock (once per
      // guest minute). A capture taken before that tick restores a scanout that still shows the
      // half-drawn terminal and spends ~2e9 guest instructions recompositing it after restore
      // (pair r2, evidence/omarchy-responsive/README.md). Sleep across two clock ticks in guest
      // time (idle time is fast-forwarded, so this is cheap) so the pending damage is presented.
      await run("sleep 150", "clock-flush");
      await settled(guest, receipt, "post-flush", timeoutMs);
      await settled(guest, receipt, "pre-capture", timeoutMs);

      // 4. Pair the mmap disk with the page cache, then trigger save_resume (the CLI exits 0).
      child.stdin.write(`sync && printf '\\n%s%s\\n' '${TRIGGER[0]}' '${TRIGGER[1]}'\r`);
      receipt.exit = await guest.exit;
      assert.equal(receipt.exit.code, 0, `capture exit ${JSON.stringify(receipt.exit)}`);
    } finally {
      clearTimeout(watchdog);
      if (!guest.exited) { child.kill("SIGKILL"); await guest.exit; }
      await fs.writeFile(path.join(out, "serial.log"), Buffer.concat(serialLog));
      await fs.writeFile(path.join(out, "emulator.stderr.log"), Buffer.concat(stderr));
    }

    const raw = await fs.readFile(rawSnapshot);
    assert.equal(raw.subarray(12, 44).toString("hex"), coreId);
    assert.equal(raw.subarray(44, 76).toString("hex"), baseId);
    const blocks = await computeDelta(drive, args.chunks, manifest);
    const newDelta = encodeDelta(blocks, manifest.image_len, baseId);
    readPairHeaders(raw, newDelta);
    await fs.writeFile(path.join(out, "omarchy-ready.snap.gz"), gzipSync(raw, { level: zlib.Z_BEST_COMPRESSION }));
    await fs.writeFile(path.join(out, "omarchy-overlay-delta.bin.gz"), gzipSync(newDelta, { level: zlib.Z_BEST_COMPRESSION }));
    receipt.outputs = {
      bootSnapshot: { ...(await identity(path.join(out, "omarchy-ready.snap.gz"))), rawSize: raw.length, rawSha256: sha256(raw) },
      overlayDelta: { ...(await identity(path.join(out, "omarchy-overlay-delta.bin.gz"))), rawSize: newDelta.length, blocks: blocks.length },
    };
    for (const key of ["kernel", "chunkManifest", "bootSnapshot", "overlayDelta", "baseImage"]) {
      assert.deepEqual(await identity(receipt.inputs[key].path), receipt.inputs[key], `input changed: ${key}`);
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.stack || error);
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await save();
    await fs.rm(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ passed: receipt.passed, outputs: receipt.outputs }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
