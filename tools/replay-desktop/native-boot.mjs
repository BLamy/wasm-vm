#!/usr/bin/env node
// E5-T34b: cold-boot the minimal Replay desktop image on native wasm-vm with the browser desktop
// device layout, wait for the guest's REPLAY_DESKTOP_READY marker (sway has mapped the Replay
// Chrome 108 window and the foot terminal, and Chrome's DevTools pipe reported the smoke page
// title "Replay RISC-V PASS #1"), then over the serial root shell:
//   1. focus the terminal and prove the real keyboard path: type `echo KEYBOARD_` into foot's pty
//      (TIOCSTI), have the native CLI inject one virtio-keyboard KEY_A (--keyboard-proof; evdev ->
//      udev/libinput -> sway -> foot), then type ` | tee /tmp/keyboard.txt` + Enter and expect
//      `KEYBOARD_a`;
//   2. type `node -e "console.log(process.version)" | tee /tmp/node-version.txt` into the foot
//      terminal's shell (TIOCSTI, i.e. as keystrokes on that terminal) and wait for the output;
//   3. capture the sway output with grim (PNG, base64 over serial) — the desktop screenshot;
//   4. read the guest RAM high-water mark, per-process VmHWM and uptime;
// and write evidence (console log without the base64 payload, PNG, JSON summary).
//
//   node tools/replay-desktop/native-boot.mjs --image IMG --out DIR [--ram-mib 2048]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({ options: {
  image: { type: "string" }, out: { type: "string" },
  "ram-mib": { type: "string", default: "2048" },
  kernel: { type: "string", default: path.join(repo, "releases/kernel/6.6.63/Image") },
  cli: { type: "string", default: path.join(repo, "target/release/wasm-vm") },
  "timeout-min": { type: "string", default: "150" },
} });
assert.ok(opt.image && opt.out, "usage: native-boot.mjs --image IMG --out DIR");
const out = path.resolve(opt.out);
await mkdir(out, { recursive: true });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const imageSha = sha256(await readFile(opt.image));
const kernelSha = sha256(await readFile(opt.kernel));

const append = "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4";
const args = ["boot", "--kernel", opt.kernel, "--drive", `file=${path.resolve(opt.image)},ro`,
  "--ram-mib", opt["ram-mib"], "--net", "--virtio-rng", "--browser-topology",
  "--icount-divider", "64", "--jit", "--block-cache", "--interrupt-batching",
  "--keyboard-proof", "--quantum", "500000", "--max-instrs", "40000000000000", "--no-reboot",
  "--evidence", path.join(out, "guest-evidence.txt"), "--append", append];

const live = createWriteStream(path.join(out, "console.live.log"));
const t0 = Date.now();
const child = spawn(opt.cli, args, { stdio: ["pipe", "pipe", "pipe"] });
let serial = "", stderr = "", exited = false;
const marks = {};
const observers = new Set();
const notify = () => { for (const f of observers) f(); };
child.stdout.on("data", (b) => {
  const s = b.toString("utf8");
  serial += s;
  live.write(b);
  if (b.includes(Buffer.from("\x1b[6n"))) child.stdin.write("\x1b[1;1R");
  for (const m of s.matchAll(/(REPLAY_[A-Z_]+)/g)) if (!(m[1] in marks)) {
    marks[m[1]] = (Date.now() - t0) / 1000;
    process.stderr.write(`[native-boot +${marks[m[1]].toFixed(0)}s] ${m[1]}\n`);
  }
  notify();
});
child.stderr.on("data", (b) => { stderr += b.toString("utf8"); notify(); });
const exit = new Promise((resolve) => child.on("close", (code, signal) => {
  exited = true; notify(); resolve({ code, signal });
}));
const deadline = t0 + Number(opt["timeout-min"]) * 60_000;
function waitFor(pred, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`timeout waiting for ${what}`)), Math.max(1, deadline - Date.now()));
    const done = (e, v) => { clearTimeout(timer); observers.delete(check); e ? reject(e) : resolve(v); };
    const check = () => { const v = pred(); if (v) done(null, v); else if (exited) done(new Error(`guest exited waiting for ${what}`)); };
    observers.add(check); check();
  });
}
let seq = 0;
// Run a root-shell command; the end marker is assembled from two shell words so the echoed
// command line can never satisfy the wait.
async function sh(cmd, what = cmd) {
  const tag = `WVM_DONE_${++seq}`;
  const from = serial.length;
  child.stdin.write(`${cmd}; printf '%s%s\\n' 'WVM_DONE_' '${seq}'\n`);
  await waitFor(() => serial.indexOf(tag + "\n", from) >= 0 || serial.indexOf(tag + "\r\n", from) >= 0, what);
  return serial.slice(from, serial.indexOf(tag, from));
}

const summary = { task: "E5-T34b", startedAt: new Date(t0).toISOString(), command: [opt.cli, ...args],
  imageSha256: imageSha, kernelSha256: kernelSha, ramMib: Number(opt["ram-mib"]) };
try {
  await waitFor(() => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(serial), "REPLAY_DESKTOP_READY");
  const ready = serial.match(/REPLAY_DESKTOP_READY uptime=(\S+) mem_hwm_kib=(\d+)/);
  summary.desktopReady = { hostSeconds: marks.REPLAY_DESKTOP_READY, guestUptimeSeconds: Number(ready[1]),
    memHwmKibAtReady: Number(ready[2]) };
  summary.markersHostSeconds = { ...marks };
  // Wake the respawned serial root shell.
  child.stdin.write("\n");
  await sh("cd /; export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin", "root shell");
  summary.chromium = {
    targets: (serial.match(/REPLAY_CHROMIUM_TARGETS (.*?) uptime=/) || [])[1] || null,
    page: (serial.match(/REPLAY_CHROMIUM_PAGE (.*?) uptime=/) || [])[1] || null,
    ready: (serial.match(/REPLAY_CHROMIUM_READY [^\n]*/) || [])[0] || null,
    sandbox: [...serial.matchAll(/REPLAY_RENDERER_SANDBOX [^\n]*/g)].map((m) => m[0].trim()),
  };
  const sway = "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg";
  summary.keyboard = { focus: (await sh(`${sway} '[app_id=replay-terminal] focus' >/dev/null && echo FOCUS''_OK`, "focus terminal")).includes("FOCUS_OK") };
  await sh("replay-desktop-type -n 'echo KEYBOARD_'", "type prefix");
  const kbFrom = stderr.length;
  await sh("printf '%s%s\\n' 'WVM_KB_' 'INJECT'", "keyboard marker");
  await waitFor(() => stderr.indexOf("keyboard proof injected", kbFrom) >= 0, "host KEY_A injection");
  summary.keyboard.injected = (stderr.slice(kbFrom).match(/wasm-vm: keyboard proof[^\n]*/) || [])[0];
  await new Promise((r) => setTimeout(r, 20_000)); // let evdev -> libinput -> sway -> foot deliver it
  await sh("replay-desktop-type ' | tee /tmp/keyboard.txt'", "type suffix");
  let kb = "";
  for (let i = 0; i < 20 && !/^KEYBOARD_\S*\s*$/m.test(kb); i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    kb = await sh("cat /tmp/keyboard.txt 2>/dev/null", "keyboard output");
  }
  summary.keyboard.output = (kb.match(/^(KEYBOARD_\S*)\s*$/m) || [])[1] || null;
  summary.keyboard.pass = summary.keyboard.output === "KEYBOARD_a";
  const typed = await sh(`replay-desktop-type 'node -e "console.log(process.version)" | tee /tmp/node-version.txt'`, "type into foot");
  summary.terminal = { typed: typed.trim().split("\n").filter((l) => l.includes("WVM_TYPE")).map((l) => l.trim()) };
  const tType = Date.now();
  let version = "";
  while (!/^v\d+\.\d+\.\d+/.test(version)) {
    if (Date.now() > deadline) throw new Error("node never printed its version");
    await new Promise((r) => setTimeout(r, 15_000));
    const o = await sh("cat /tmp/node-version.txt 2>/dev/null", "node output");
    version = (o.match(/^(v\d+\.\d+\.\d+\S*)\s*$/m) || [])[1] || "";
  }
  summary.terminal.nodeVersion = version;
  summary.terminal.hostSecondsFromTypeToOutput = (Date.now() - tType) / 1000;
  await new Promise((r) => setTimeout(r, 20_000)); // let foot repaint before the capture
  const shot = await sh("replay-desktop-shot desktop", "screenshot");
  const m = shot.match(/WVM_PNG_BEGIN desktop (\d+) ([0-9a-f]{64})\r?\n([\s\S]*?)WVM_PNG_END desktop/);
  assert.ok(m, "screenshot markers");
  const png = Buffer.from(m[3].replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  assert.equal(png.length, Number(m[1]), "png length");
  assert.equal(sha256(png), m[2], "png sha256");
  await writeFile(path.join(out, "desktop.png"), png);
  summary.screenshot = { file: "desktop.png", bytes: png.length, sha256: m[2],
    width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const metrics = await sh([
    "cat /proc/uptime", "cat /run/replay-desktop/mem-hwm-kib", "grep -E '^(MemTotal|MemFree|MemAvailable|Shmem|Cached):' /proc/meminfo",
    "for p in $(pidof chrome sway foot seatd); do printf 'VMHWM %s %s %s\\n' $p $(cat /proc/$p/comm) $(awk '/^VmHWM:/{print $2}' /proc/$p/status); done",
    "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_outputs | grep -E '\"(name|current_mode|width|height)\"' | head -6",
    "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_inputs | grep -E '\"(identifier|type)\"'",
    "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_tree | grep -E '\"(app_id|name)\": \"[^\"]+\"' | grep -v -E 'root|__i3'",
    "cat /run/replay-desktop/events | cut -c1-200", "grep -i -E 'error|fail' /run/user/1000/sway.log | head -20",
    "tail -20 /home/desktop/.local/state/replay-chromium/browser.log", "mount | grep -E ' / |tmpfs'",
  ].join("; "), "metrics");
  summary.guestMetricsRaw = metrics.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  summary.memHwmKib = Number((metrics.match(/^\s*(\d+)\s*$/m) || [])[1]);
  child.stdin.write("sync; poweroff -f\n");
  await Promise.race([exit, new Promise((r) => setTimeout(r, 120_000))]);
  // Acceptance is asserted, not just recorded: any wrong value fails the run (exit 1).
  const page = summary.chromium.page || "";
  const checks = {
    titlePass: /"title":"Replay RISC-V PASS #\d+"/.test(summary.chromium.targets || ""),
    pagePass: /\\"pass\\": true/.test(page) && /\\"javascript\\": 42/.test(page) &&
      /\\"webassembly\\": 42/.test(page) && /42,\\n\s*128,\\n\s*64,\\n\s*255/.test(page),
    rendererSandboxed: summary.chromium.sandbox.length > 0 &&
      summary.chromium.sandbox.every((l) => /NoNewPrivs=1/.test(l) && /Seccomp=2/.test(l)),
    keyboard: summary.keyboard?.pass === true,
    node26: summary.terminal?.nodeVersion === "v26.13.1",
  };
  summary.acceptance = { checks, pass: Object.values(checks).every(Boolean) };
  if (!summary.acceptance.pass) {
    throw new Error(`acceptance failed: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}`);
  }
} catch (e) {
  summary.error = String(e.stack || e);
  process.stderr.write(`[native-boot] ${summary.error}\n`);
} finally {
  if (!exited) child.kill("SIGKILL");
  summary.exit = await exit;
  summary.hostSecondsTotal = (Date.now() - t0) / 1000;
  summary.markersHostSeconds = { ...marks };
  const log = serial.replace(/(WVM_PNG_BEGIN \S+ \d+ [0-9a-f]{64}\r?\n)[\s\S]*?(WVM_PNG_END)/g, "$1[base64 elided: see PNG]\n$2");
  await writeFile(path.join(out, "console.log"), log);
  await writeFile(path.join(out, "stderr.log"), stderr);
  await writeFile(path.join(out, "native-boot.json"), JSON.stringify(summary, null, 2) + "\n");
  process.stderr.write(`[native-boot] wrote ${out}\n`);
  if (summary.error) process.exitCode = 1;
}
