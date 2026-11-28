// Verifier novel attack (E5-T43e): resume the shipped gen 3 warm snapshot natively on a NIC and read the
// guest's sockets, lease, and eth0 counters over the serial shell.
// argv: snapRaw image nic out
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [snap, image, nic, out] = process.argv.slice(2);
const APPEND = "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4";
const CORE = "302e302e31000000000000000000000000000000000000000000000000000000";
const BASE = "77c962873eae2df47c3efc4e351c719f878444792b1b1f13420592743c1ce297";
const args = ["boot", "--kernel", "releases/kernel/6.6.63/Image", "--drive", `file=${image},ro`, "--ram-mib", "1024", nic,
  "--virtio-rng", "--browser-topology", "--icount-divider", "64", "--block-cache", "--interrupt-batching", "--quantum", "500000",
  "--max-instrs", "200000000000", "--no-reboot", "--resume-from", snap, "--resume-core-id", CORE, "--resume-base-id", BASE, "--append", APPEND];
const c = spawn("target/release/wasm-vm", args, { stdio: ["pipe", "pipe", "pipe"] });
let s = "";
c.stdout.on("data", (b) => { s += b; if (b.includes(Buffer.from("\x1b[6n"))) c.stdin.write("\x1b[1;1R"); });
c.stderr.on("data", (b) => { s += b; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(4000); c.stdin.write("\n"); await wait(3000);
const net = nic === "--net-slirp"
  ? "echo FETCH; /usr/local/bin/node -e 'fetch(\"http://example.com\").then(r=>console.log(\"STATUS\",r.status),e=>console.log(\"ERR\",e.cause?.code??e.message))'; echo TCP_AFTER_FETCH; cat /proc/net/tcp;"
  : "";
c.stdin.write("export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; echo V_BEGIN; cat /proc/uptime; " +
  "echo TCP; cat /proc/net/tcp; echo TCP6; cat /proc/net/tcp6; echo UDP; cat /proc/net/udp /proc/net/udp6; " +
  "echo ADDR; ip -4 -o addr show dev eth0; ip -4 route; cat /etc/resolv.conf; pidof udhcpc; " +
  "echo TX0 $(cat /sys/class/net/eth0/statistics/tx_packets) RX0 $(cat /sys/class/net/eth0/statistics/rx_packets); sleep 30; " +
  "echo TX1 $(cat /sys/class/net/eth0/statistics/tx_packets) RX1 $(cat /sys/class/net/eth0/statistics/rx_packets); cat /proc/loadavg; cat /proc/uptime; " +
  net + " echo V_DONE_$((2+3))\n");
const t0 = Date.now();
while (!/V_DONE_5/.test(s) && Date.now() - t0 < 900000) await wait(1000);
c.kill("SIGKILL");
writeFileSync(out, s);
console.log(s.slice(s.indexOf("V_BEGIN")));
