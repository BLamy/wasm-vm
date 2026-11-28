// Boot a Replay desktop image on the native CLI with the browser's device topology (the machine
// the warm-snapshot capture boots) and drive its serial root shell. Shared by the image
// acceptance scripts under tools/verify/.
//
// Guest time is the retire-count clock (640 M instructions per guest second at divider 64), so
// guest seconds measured through this shell are instruction counts, independent of host speed.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Must equal web/main.js REPLAY_DESKTOP_BOOTARGS.
export const BOOTARGS = "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4";

export async function bootNative({ image, out, kernel = path.join(repo, "releases/kernel/6.6.63/Image"),
  cli = path.join(repo, "target/release/wasm-vm"), timeoutMin = 30, maxInstrs = "400000000000",
  // The NIC: "--net" (loopback, no DHCP server), "--net-slirp" (DHCP, DNS, NAT) or null (none).
  net = "--net" }) {
  await mkdir(out, { recursive: true });
  const args = ["boot", "--kernel", kernel, "--drive", `file=${path.resolve(image)},ro`,
    "--ram-mib", "1024", ...(net ? [net] : []), "--virtio-rng", "--browser-topology", "--icount-divider", "64",
    "--block-cache", "--interrupt-batching", "--quantum", "500000",
    "--max-instrs", maxInstrs, "--no-reboot", "--append", BOOTARGS];
  const live = createWriteStream(path.join(out, "console.log"));
  const t0 = Date.now();
  const child = spawn(cli, args, { stdio: ["pipe", "pipe", "pipe"] });
  let serial = "", exited = false, seq = 0;
  const observers = new Set();
  const notify = () => { for (const f of observers) f(); };
  child.stdout.on("data", (b) => {
    serial += b.toString("utf8"); live.write(b);
    // The shell's line editor asks for the cursor position; answer so it does not wait.
    if (b.includes(Buffer.from("\x1b[6n"))) child.stdin.write("\x1b[1;1R");
    notify();
  });
  child.stderr.on("data", (b) => { live.write(b); });
  child.on("close", () => { exited = true; notify(); });
  const deadline = t0 + timeoutMin * 60_000;
  function waitFor(pred, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error(`timeout waiting for ${what}`)), Math.max(1, deadline - Date.now()));
      const done = (e, v) => { clearTimeout(timer); observers.delete(check); e ? reject(e) : resolve(v); };
      const check = () => { const v = pred(serial); if (v) done(null, v); else if (exited) done(new Error(`guest exited waiting for ${what}`)); };
      observers.add(check); check();
    });
  }
  // Run a root-shell command and return its output: the text between a begin and an end
  // marker the shell prints around it. Both are assembled from two shell words, so the echoed
  // command line (which the line editor may wrap anywhere) can never contain either.
  async function sh(cmd, what = cmd) {
    const n = ++seq;
    const begin = `WVM_BEGIN_${n}`, end = `WVM_DONE_${n}`;
    const from = serial.length;
    child.stdin.write(`printf '%s%s\\n' 'WVM_BEGIN_' '${n}'; ${cmd}; printf '%s%s\\n' 'WVM_DONE_' '${n}'\n`);
    await waitFor((s) => s.indexOf(`${end}\n`, from) >= 0 || s.indexOf(`${end}\r\n`, from) >= 0, what);
    const start = serial.indexOf(begin, from);
    return serial.slice(serial.indexOf("\n", start) + 1, serial.indexOf(end, start)).replace(/\r/g, "");
  }
  // Wake the respawned serial shell and give it the image's PATH (rcS's does not reach it).
  async function rootShell() {
    child.stdin.write("\n");
    await sh("cd /tmp; export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin", "root shell");
  }
  return { command: [cli, ...args], startedAt: new Date(t0).toISOString(), waitFor, sh, rootShell,
    serial: () => serial, hostSeconds: () => (Date.now() - t0) / 1000,
    stop: () => { child.kill("SIGKILL"); live.end(); } };
}
export const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
export const last = (text) => lines(text).at(-1) ?? "";
