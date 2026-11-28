// E5-T43c verifier: P6 (image files == repo), P7 (natural renewals logged through an `ip` wrapper),
// P8 (does the worker's renewal sampler catch a flush+re-add hook?). Run-time sabotage only: the
// hook is bind-mounted over in the booted guest; the image and the tree are untouched.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootNative, lines, repo } from "../../../tools/replay-desktop/native-shell.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "attack");
const image = path.join(repo, "target/e5-t43c/image/replay-desktop.ext4");
const r = { checks: {} };
const g = await bootNative({ image, out, net: "--net-slirp", cli: path.join(here, "cli-lease30.sh"), timeoutMin: 60 });
const { sh, waitFor } = g;
const up = async () => Number((await sh("cut -d' ' -f1 /proc/uptime")).trim());
const sha = (b) => createHash("sha256").update(b).digest("hex");
try {
  r.command = g.command;
  const ready = await waitFor((s) => /REPLAY_DESKTOP_READY uptime=(\S+)/.exec(s), "READY");
  r.readyUptime = Number(ready[1]);
  await g.rootShell();
  await waitFor((s) => /REPLAY_NETWORK bound ip=/.exec(s), "bound");
  // P6
  const HOOK = "/usr/local/share/udhcpc/default.script";
  r.checks.p6 = {
    guestHook: (await sh(`sha256sum ${HOOK} | cut -d' ' -f1`)).trim(),
    repoHook: sha(await readFile(path.join(repo, "tools/replay-desktop/rootfs", HOOK))),
    guestRcS: (await sh("sha256sum /etc/init.d/rcS | cut -d' ' -f1")).trim(),
    repoRcS: sha(await readFile(path.join(repo, "tools/replay-desktop/rootfs/etc/init.d/rcS"))),
    udhcpcCmdline: (await sh("tr '\\0' ' ' < /proc/$(pidof udhcpc)/cmdline")).trim(),
    ipPath: (await sh("command -v ip; ls -l $(command -v ip)")).trim(),
  };
  // P7: wrap the real hook so every `ip` it runs is logged; natural renewals only (no USR1).
  const realIp = lines(await sh("command -v ip"))[0];
  await sh(`mkdir -p /tmp/wrap; cp ${HOOK} /tmp/orig.script; chmod +x /tmp/orig.script
printf '#!/bin/sh\\necho "$(cut -d\\" \\" -f1 /proc/uptime) $*" >> /tmp/iplog\\nexec ${realIp} "$@"\\n' > /tmp/wrap/ip; chmod +x /tmp/wrap/ip
printf '#!/bin/sh\\necho "HOOK $(cut -d\\" \\" -f1 /proc/uptime) $1 ip=$ip mask=$mask lease=$lease" >> /tmp/iplog\\nPATH=/tmp/wrap:$PATH exec /tmp/orig.script "$@"\\n' > /tmp/wrapped.script; chmod +x /tmp/wrapped.script
mount --bind /tmp/wrapped.script ${HOOK} && echo BOUND_OK`, "wrap");
  r.checks.p7 = { wrapperFiles: lines(await sh("cat /tmp/wrap/ip /tmp/wrapped.script")) };
  const t0 = await up();
  const serialBefore = g.serial().length;
  await sh("sleep 40");
  r.checks.p7.waitedGuest = +((await up()) - t0).toFixed(2);
  r.checks.p7.iplog = lines(await sh("cat /tmp/iplog 2>/dev/null"));
  r.checks.p7.consoleRenewLines = g.serial().slice(serialBefore).match(/REPLAY_NETWORK[^\r\n]*/g) ?? [];
  r.checks.p7.udhcpcLog = lines(await sh("tail -n 12 /run/udhcpc.log"));
  r.checks.p7.addresses = lines(await sh("ip -4 -o addr show dev eth0 | awk '{print $4}'"));
  r.checks.p7.routes = lines(await sh("ip -4 route"));
  r.checks.p7.fetch = lines(await sh("node -e 'fetch(\"http://example.com\").then(r=>console.log(\"STATUS\",r.status),e=>console.log(\"ERR\",e.cause?.code??e.message))'"));
  // P8: sabotage hook (flush, then re-add) under the worker's exact sampler, 5 USR1 renewals.
  await sh(`umount ${HOOK}; cat > /tmp/flush.script <<'H'
#!/bin/sh
case "$1" in
  deconfig) ip -4 addr flush dev "$interface" ;;
  bound|renew)
    ip -4 addr flush dev "$interface"
    ip -4 addr add "$ip/\${mask:-24}" dev "$interface"
    for r in $router; do ip -4 route replace default via "$r" dev "$interface"; break; done
    echo "REPLAY_NETWORK $1 ip=$ip router=$router dns=$dns SABOTAGE" >> /run/replay-desktop/events ;;
esac
exit 0
H
chmod +x /tmp/flush.script; mount --bind /tmp/flush.script ${HOOK} && echo SAB_OK`, "sabotage");
  r.checks.p8 = [];
  for (let k = 0; k < 5; k++) {
    await sh("rm -f /tmp/renewed /tmp/samples");
    const before = g.serial().length;
    await sh("( i=0; while [ $i -lt 400 ]; do echo \"S $(ip -4 -o addr show dev eth0 | awk '{print $4}' | tr '\\n' ' ')\"; i=$((i+1)); [ -f /tmp/renewed ] && break; done > /tmp/samples ) & echo $! > /tmp/sampler; sleep 0.5; kill -USR1 $(pidof udhcpc)", "renew");
    await waitFor((s) => /REPLAY_NETWORK renew [^\r\n]*SABOTAGE/.exec(s.slice(before)), "sabotaged renewal");
    const samples = lines(await sh("sleep 1; : > /tmp/renewed; while kill -0 $(cat /tmp/sampler) 2>/dev/null; do sleep 0.1; done; cat /tmp/samples"));
    const set = [...new Set(samples)];
    r.checks.p8.push({ samples: samples.length, set, renewLines: (g.serial().slice(before).match(/REPLAY_NETWORK[^\r\n]*/g) ?? []),
      workerAssertionWouldPass: set.length === 1 && set[0] === "S 10.0.2.15/24" });
  }
  r.checks.p8summary = { trials: 5, caught: r.checks.p8.filter((t) => !t.workerAssertionWouldPass).length };
  r.done = true;
} catch (e) { r.error = String(e?.stack ?? e); }
finally {
  r.hostSeconds = g.hostSeconds(); g.stop();
  await writeFile(path.join(out, "result.json"), JSON.stringify(r, null, 2) + "\n");
  console.log(JSON.stringify({ done: r.done, error: r.error?.split("\n")[0], p8: r.checks.p8summary }));
}
