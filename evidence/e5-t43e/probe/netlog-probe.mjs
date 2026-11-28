// E5-T43e probe: which hosts does the guest's Chrome contact at startup when online? Boot an image
// (argv[2]) with the slirp NIC, wait as the capture does (Node line, 30 s settle), list the guest's
// TCP/UDP sockets and, when the image logs it, the hosts in Chrome's net log.
import { bootNative } from "../../../tools/replay-desktop/native-shell.mjs";
import { writeFile } from "node:fs/promises";
const [image, out] = process.argv.slice(2);
const g = await bootNative({ image, out, net: "--net-slirp" });
await g.waitFor((s) => /REPLAY_NODE_SNAPSHOT bytes=/.test(s), "node line");
await g.rootShell();
await g.sh("sleep 30");
const r = {};
r.tcp = await g.sh("cat /proc/net/tcp; cat /proc/net/udp");
r.hosts = await g.sh("grep -o '\"url\":\"[^\"]*\"\\|\"host\":\"[^\"]*\"' /tmp/chrome-netlog.json 2>/dev/null | sort | uniq -c | sort -rn | head -40");
r.meminfo = await g.sh("grep -E 'MemFree|^Cached|AnonPages' /proc/meminfo");
g.stop();
await writeFile(`${out}/probe.json`, JSON.stringify(r, null, 2));
console.log(r.tcp); console.log(r.hosts); console.log(r.meminfo);
