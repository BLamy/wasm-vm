// E5-T43e probe: where do the slirp capture's extra non-zero pages come from? Boot the image with a
// NIC (argv[2]: --net-slirp or --net), wait as the capture does (Node line, 30 s settle), report.
import { bootNative } from "../../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [net, out] = process.argv.slice(2);
const g = await bootNative({ image: "target/e5-t43c/image/replay-desktop.ext4", out, net });
await g.waitFor((s) => /REPLAY_NODE_SNAPSHOT bytes=/.test(s), "node line");
await g.rootShell();
await g.sh("sleep 30");
const r = {};
r.meminfo = await g.sh("grep -E 'MemFree|^Cached|Buffers|AnonPages|Shmem:|Slab|SUnreclaim|KernelStack|PageTables' /proc/meminfo");
r.rss = await g.sh("for p in /proc/[0-9]*; do n=$(cat $p/comm 2>/dev/null); r=$(grep VmRSS $p/status 2>/dev/null | awk '{print $2}'); [ -n \"$r\" ] && echo \"$r $n\"; done | sort -rn | head -25");
r.tcp = await g.sh("cat /proc/net/tcp /proc/net/udp | wc -l; cat /proc/net/tcp; cat /proc/net/udp");
r.slab = await g.sh("sort -k3 -rn /proc/slabinfo 2>/dev/null | head -5 || true");
g.stop();
await writeFile(`${out}/probe.json`, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 1));
