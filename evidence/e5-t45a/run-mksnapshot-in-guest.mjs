// E5-T45a: run the cross-built riscv64 node_mksnapshot inside wasm-vm (the target), from a second
// drive, and write Node's built-in snapshot + code cache source back to that drive.
//   node evidence/e5-t45a/run-mksnapshot-in-guest.mjs IMAGE DRIVE OUT
import { bootNative } from "../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, drive, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net", extraDrives: [drive], browserTopology: false, timeoutMin: 240, maxInstrs: "4000000000000" });
// No display device without the browser topology: wait for the monitor, not for READY.
await g.waitFor((s) => /REPLAY_DESKTOP_MONITOR start/.test(s), "the monitor");
await g.rootShell();
const r = {};
r.mount = await g.sh("mkdir -p /tmp/mk && mount -t ext4 /dev/vdb /tmp/mk && ls -la /tmp/mk && free -m");
r.run = await g.sh("cd /tmp/mk && a=$(cut -d' ' -f1 /proc/uptime); RECORD_REPLAY_DONT_RECORD=1 ./node_mksnapshot /tmp/mk/node_snapshot.cc > /tmp/mk/mksnapshot.log 2>&1; echo \"exit $?\"; b=$(cut -d' ' -f1 /proc/uptime); echo \"guest_s $a $b\"; tail -5 /tmp/mk/mksnapshot.log; ls -la /tmp/mk; sync; umount /tmp/mk; echo UMOUNTED");
r.hostSeconds = g.hostSeconds();
g.stop();
await writeFile(`${out}/result.json`, JSON.stringify(r, null, 2));
console.log(r.mount); console.log(r.run); console.log("host s", r.hostSeconds);
