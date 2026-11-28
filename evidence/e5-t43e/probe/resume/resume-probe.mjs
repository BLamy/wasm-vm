// E5-T43e probe: resume a warm snapshot natively (argv: snap, disk, coreId, baseId, nic, out) and
// look at the guest over the serial root shell: CPU per process, the kernel log, Chrome's log.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [snap, disk, core, base, nic, out] = process.argv.slice(2);
const APPEND = "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4";
const args = ["boot", "--kernel", "releases/kernel/6.6.63/Image", "--drive", `file=${disk}`, "--ram-mib", "1024", nic,
  "--virtio-rng", "--browser-topology", "--icount-divider", "64", "--block-cache", "--interrupt-batching", "--quantum", "500000",
  "--max-instrs", "200000000000", "--no-reboot", "--resume-from", snap, "--resume-core-id", core, "--resume-base-id", base, "--append", APPEND];
const c = spawn("target/release/wasm-vm", args, { stdio: ["pipe", "pipe", "pipe"] });
let s = "";
c.stdout.on("data", (b) => { s += b; if (b.includes(Buffer.from("\x1b[6n"))) c.stdin.write("\x1b[1;1R"); });
c.stderr.on("data", (b) => { s += b; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(4000);
c.stdin.write("\n");
await wait(2000);
c.stdin.write("export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; cat /proc/uptime; sleep 20; cat /proc/uptime; top -bn1 | head -25; cat /proc/loadavg; dmesg | tail -15; tail -5 /run/replay-desktop/events; tail -30 /home/desktop/.local/state/replay-chromium/browser.log; ls /dev/input; echo PROBE_DONE_$((1+1))\n");
const t0 = Date.now();
while (!/PROBE_DONE_2/.test(s) && Date.now() - t0 < 600000) await wait(1000);
c.kill("SIGKILL");
writeFileSync(`${out}`, s);
console.log(s.slice(-6000));
