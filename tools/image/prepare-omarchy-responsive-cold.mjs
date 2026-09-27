#!/usr/bin/env node
// Prepare the responsive Omarchy desktop pair from a FRESH graphical session (cold boot).
//
// prepare-omarchy-responsive.mjs edits a restored session in place, which cannot change the
// compositor's own environment. The LP_NUM_THREADS=0 part of the responsive profile only takes
// effect when Hyprland starts, so this preparer runs in two native phases on one working disk:
//
//   A. restore a source pair (base image + its overlay delta, resumed RAM), apply
//      omarchy-responsive-profile.sh over the serial console, `sync`, and exit the CLI cleanly
//      (the snapshot this writes is discarded);
//   B. cold-boot the same disk with the browser's device topology, wait for the package shell's
//      bar and the profile's Foot, check the compositor PID's actual LP_NUM_THREADS=0 environment
//      and absence of an llvmpipe-N worker, apply the same direct opaque window properties as the
//      shipped pair, let the desktop settle, and capture a coherent pair against the SAME base
//      image / chunk manifest (so only the pair files need re-publishing).
//
//   node tools/image/prepare-omarchy-responsive-cold.mjs --bin target/release/wasm-vm \
//     --kernel <kernel> --pair <source pair dir> --base-image <ext4> --chunks <chunk dir> --out <new dir>
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync, constants as zlib } from "node:zlib";
import { DIRECT_OPAQUE_COMMAND, assertDirectOpaqueProperties } from "../verify/omarchy-direct-opaque-command.mjs";
import { validateExpectedLpEnvironment } from "../verify/omarchy-thread-setting.mjs";
import {
  HYPR, SerialGuest, computeDelta, coreIdHex, encodeDelta, identity, manifestBaseId, parseArgs, plain,
  readPairHeaders, settled,
} from "./prepare-omarchy-responsive.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE = path.join(repo, "tools/image/omarchy-responsive-profile.sh");
const BLOCK = 4096;
const APPEND = "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0";

function cliArgs({ kernel, drive, resume, trigger, snapshotOut, coreId, baseId }) {
  return ["boot", "--kernel", kernel, "--drive", `file=${drive}`, "--ram-mib", "1024", "--net", "--virtio-rng",
    "--browser-topology", "--icount-divider", "64", "--jit", "--block-cache", "--interrupt-batching",
    "--append", APPEND, "--quantum", "500000", "--max-instrs", "4000000000000",
    ...(resume ? ["--resume-from", resume] : []),
    "--snapshot-trigger", trigger, "--snapshot-out", snapshotOut,
    "--snapshot-core-id", coreId, "--snapshot-base-id", baseId];
}

// One CLI run with a serial driver; `body` gets (run, guest) and must end the run through the trigger.
async function phase(name, bin, args, timeoutMs, receipt, save, out, body) {
  const record = receipt.phases[name] = { command: [bin, ...args], serial: [], settleProbes: [] };
  // The CLI injects one virtio-tablet click at (640,420) whenever the guest prints CLICK_MARKER.
  const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WASM_VM_PREP_TABLET_CLICK: `${CLICK_MARKER.join("")}@640,420` } });
  const serialLog = [], stderr = [];
  child.stderr.on("data", (bytes) => stderr.push(bytes));
  const guest = new SerialGuest(child, serialLog);
  const watchdog = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const started = Date.now();
  try {
    const run = async (command, label, ms) => {
      const result = await guest.run(command, ms);
      record.serial.push({ label, ...result });
      await save();
      return result;
    };
    child.stdin.write("\r");
    await guest.waitFor(() => /\[omarchy@omarchy-demo [^\n]*\]\$ /u.test(plain(guest.serial)), timeoutMs, `${name} prompt`);
    record.promptHostMs = Date.now() - started;
    assert.equal((await run("id -u", "identity")).output, "1000");
    await body(run, guest, record);
    record.exit = await guest.exit;
    assert.equal(record.exit.code, 0, `${name} exit ${JSON.stringify(record.exit)}`);
  } finally {
    clearTimeout(watchdog);
    record.hostMs = Date.now() - started;
    if (!guest.exited) { child.kill("SIGKILL"); await guest.exit; }
    await fs.writeFile(path.join(out, `${name}.serial.log`), Buffer.concat(serialLog));
    await fs.writeFile(path.join(out, `${name}.stderr.log`), Buffer.concat(stderr));
    await save();
  }
}

const trigger = (guest, a, b) => guest.child.stdin.write(`sync && printf '\\n%s%s\\n' '${a}' '${b}'\r`);

// Handle one real pointer device event before capture. In a session that has never seen one,
// Hyprland's first pointer event costs ~1.7e9 guest instructions on its main thread (measured in
// the browser: the first click on a fresh cold-booted pair took ~80 s to echo typing, a second
// click ~0.3 s of CPU); a compositor warp (hl.dsp.cursor.move) does not pay it. The CLI injects a
// virtio-tablet left click over the terminal when the guest prints the marker (split so the
// echoed command cannot match), exactly the event a browser click delivers.
const CLICK_MARKER = ["WVM_PREP_", "TABLET_CLICK"];
async function warmPointer(run, guest, record, timeoutMs) {
  const clicked = await run(`printf '%s%s\\n' '${CLICK_MARKER[0]}' '${CLICK_MARKER[1]}'; sleep 5`, "tablet-click", 1_800_000);
  assert.equal(clicked.status, 0, clicked.output);
  await settled(guest, record, "pointer-warm", timeoutMs);
}

export async function main(argv) {
  // --warm-only: resume an already cold-prepared pair, only warm the pointer path, and recapture.
  const warmOnly = argv.includes("--warm-only");
  const args = parseArgs(argv.filter((a) => a !== "--warm-only"));
  const out = path.resolve(args.out);
  await fs.mkdir(out, { recursive: false });
  const timeoutMs = Number(args["timeout-min"] ?? 180) * 60_000;
  const receipt = { kind: "omarchy-responsive-cold-pair", startedAt: new Date().toISOString(), passed: false,
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    profile: await identity(PROFILE), phases: {} };
  const save = () => fs.writeFile(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  const work = await fs.mkdtemp(path.join(path.dirname(out), ".omarchy-responsive-cold-"));
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
    assert.equal(headers.snapshotGeneration, headers.deltaGeneration, "snapshot and delta disagree on the overlay generation");
    assert.equal(receipt.inputs.baseImage.size, manifest.image_len);
    snapshot.fill(0, 12, 84); // private native copy; see prepare-omarchy-responsive.mjs
    const restore = path.join(work, "restore.snap");
    await fs.writeFile(restore, snapshot);
    const drive = path.join(work, "omarchy.ext4");
    try { execFileSync("cp", ["-c", args["base-image"], drive]); } catch { await fs.copyFile(args["base-image"], drive); }
    const disk = await fs.open(drive, "r+");
    try {
      for (const record of headers.records) await disk.write(delta, record.at, BLOCK, record.index * BLOCK);
    } finally { await disk.close(); }
    receipt.restoredDeltaBlocks = headers.records.length;

    if (warmOnly) {
      const rawSnapshot = path.join(work, "omarchy-ready.snap");
      await phase("warm", args.bin, cliArgs({ kernel: args.kernel, drive, resume: restore, trigger: "WVM_OMARCHY_RESPONSIVE_READY",
        snapshotOut: rawSnapshot, coreId, baseId }), timeoutMs, receipt, save, out, async (run, guest, record) => {
        const hypr = (await run("pgrep -x Hyprland", "hyprland-pid")).output.trim();
        const environment = await run(`tr '\\000' '\\n' < /proc/${hypr}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'`, "hyprland-environment");
        const threads = await run(`ps -T -p ${hypr} -o comm=`, "hyprland-threads");
        record.lp = validateExpectedLpEnvironment({ environment: environment.output, threads: threads.output, lpNumThreads: "0" });
        await warmPointer(run, guest, record, timeoutMs);
        await run("sleep 150", "clock-flush");
        await settled(guest, record, "post-flush", timeoutMs);
        await settled(guest, record, "pre-capture", timeoutMs);
        record.finalClients = JSON.parse((await run(`${HYPR} -j clients`, "final-clients")).output);
        trigger(guest, "WVM_OMARCHY_RESPONSIVE_", "READY");
      });
      await finishPair(rawSnapshot, drive, args, manifest, baseId, coreId, out, receipt);
      return;
    }

    // A. Profile files into the source session's disk; exit cleanly after sync.
    await phase("profile", args.bin, cliArgs({ kernel: args.kernel, drive, resume: restore, trigger: "WVM_OMARCHY_PROFILE_SYNCED",
      snapshotOut: path.join(work, "discard.snap"), coreId, baseId }), timeoutMs, receipt, save, out, async (run, guest) => {
      const profile = (await fs.readFile(PROFILE)).toString("base64");
      const applied = await run(`echo ${profile} | base64 -d > /tmp/omarchy-responsive-profile.sh && bash /tmp/omarchy-responsive-profile.sh && cat ~/.config/uwsm/env`, "profile");
      assert.equal(applied.status, 0, applied.output);
      assert.match(applied.output, /LP_NUM_THREADS=0/u);
      assert.match(applied.output, /\.local\/bin:\$PATH/u);
      trigger(guest, "WVM_OMARCHY_PROFILE_", "SYNCED");
    });
    await fs.rm(path.join(work, "discard.snap"), { force: true });
    await fs.rm(restore, { force: true });

    // B. Fresh graphical session on the profiled disk.
    const rawSnapshot = path.join(work, "omarchy-ready.snap");
    await phase("cold", args.bin, cliArgs({ kernel: args.kernel, drive, trigger: "WVM_OMARCHY_RESPONSIVE_READY",
      snapshotOut: rawSnapshot, coreId, baseId }), timeoutMs, receipt, save, out, async (run, guest, record) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        assert.ok(Date.now() < deadline, "fresh desktop did not map its bar and terminal");
        const probe = await run(`${HYPR} -j clients && echo WV_SPLIT && ${HYPR} -j layers`, "desktop-probe", 1_800_000);
        const [clientsText, layersText] = probe.output.split("WV_SPLIT");
        let clients = [], layers = {};
        try { clients = JSON.parse(clientsText); layers = JSON.parse(layersText); } catch { /* compositor still starting */ }
        const layerText = JSON.stringify(layers);
        if (clients.length === 1 && clients[0].class === "foot" && clients[0].mapped && layerText.includes('"omarchy-bar"')) {
          assert.doesNotMatch(layerText, /"omarchy-background"/u);
          record.foot = clients[0];
          record.layers = layers;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
      const hypr = (await run("pgrep -x Hyprland", "hyprland-pid")).output.trim();
      assert.match(hypr, /^[0-9]+$/u, "exactly one Hyprland");
      const environment = await run(`tr '\\000' '\\n' < /proc/${hypr}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'`, "hyprland-environment");
      const threads = await run(`ps -T -p ${hypr} -o comm=`, "hyprland-threads");
      record.lp = validateExpectedLpEnvironment({ environment: environment.output, threads: threads.output, lpNumThreads: "0" });
      const exe = await run(`readlink /proc/${record.foot.pid}/exe; test -f ~/.local/state/omarchy/indicators/stay-awake && echo stay-awake`, "foot-exe");
      assert.deepEqual(exe.output.split("\n").map((s) => s.trim()).filter(Boolean), ["/home/omarchy/.local/bin/foot", "stay-awake"]);
      const opaque = await run(DIRECT_OPAQUE_COMMAND, "direct-opaque", 1_800_000);
      record.opaqueFoot = assertDirectOpaqueProperties({ exit: opaque.status, stdout: opaque.output });
      await settled(guest, record, "desktop-ready", timeoutMs);
      await warmPointer(run, guest, record, timeoutMs);
      // Present any pending damage before capture (see prepare-omarchy-responsive.mjs).
      await run("sleep 150", "clock-flush");
      await settled(guest, record, "post-flush", timeoutMs);
      await settled(guest, record, "pre-capture", timeoutMs);
      record.finalClients = JSON.parse((await run(`${HYPR} -j clients`, "final-clients")).output);
      trigger(guest, "WVM_OMARCHY_RESPONSIVE_", "READY");
    });

    await finishPair(rawSnapshot, drive, args, manifest, baseId, coreId, out, receipt);
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

async function finishPair(rawSnapshot, drive, args, manifest, baseId, coreId, out, receipt) {
  const raw = await fs.readFile(rawSnapshot);
  assert.equal(raw.subarray(12, 44).toString("hex"), coreId);
  assert.equal(raw.subarray(44, 76).toString("hex"), baseId);
  const blocks = await computeDelta(drive, args.chunks, manifest);
  const newDelta = encodeDelta(blocks, manifest.image_len, baseId);
  readPairHeaders(raw, newDelta);
  await fs.writeFile(path.join(out, "omarchy-ready.snap.gz"), gzipSync(raw, { level: zlib.Z_BEST_COMPRESSION }));
  await fs.writeFile(path.join(out, "omarchy-overlay-delta.bin.gz"), gzipSync(newDelta, { level: zlib.Z_BEST_COMPRESSION }));
  receipt.outputs = {
    bootSnapshot: { ...(await identity(path.join(out, "omarchy-ready.snap.gz"))), rawSize: raw.length },
    overlayDelta: { ...(await identity(path.join(out, "omarchy-overlay-delta.bin.gz"))), rawSize: newDelta.length, blocks: blocks.length },
  };
  for (const key of ["kernel", "chunkManifest", "bootSnapshot", "overlayDelta", "baseImage"]) {
    assert.deepEqual(await identity(receipt.inputs[key].path), receipt.inputs[key], `input changed: ${key}`);
  }
  receipt.passed = true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
