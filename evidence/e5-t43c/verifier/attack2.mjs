// E5-T43c verifier, boot 2. attack.mjs's `ip` PATH wrapper never ran: busybox ash runs its `ip`
// applet directly (`command -v ip` prints `ip`; there is no ip file), so the hook's commands are
// traced here with `sh -x` instead. P7: every command the real hook runs on natural (lease 30 s)
// and USR1 renewals. P8: the worker's sampler (exact text) against a flush+re-add hook, with the
// sampler window and the hook's flush/add instants timestamped so a miss can be told from a
// window that never spanned the renewal.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootNative, lines, repo } from "../../../tools/replay-desktop/native-shell.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "attack2");
const image = path.join(repo, "target/e5-t43c/image/replay-desktop.ext4");
const HOOK = "/usr/local/share/udhcpc/default.script";
const r = { checks: {} };
const g = await bootNative({ image, out, net: "--net-slirp", cli: path.join(here, "cli-lease30.sh"), timeoutMin: 60 });
const { sh, waitFor } = g;
try {
  r.command = g.command;
  r.readyUptime = Number((await waitFor((s) => /REPLAY_DESKTOP_READY uptime=(\S+)/.exec(s), "READY"))[1]);
  await g.rootShell();
  await waitFor((s) => /REPLAY_NETWORK bound ip=/.exec(s), "bound");
  await sh(`cp ${HOOK} /tmp/orig.script; chmod +x /tmp/orig.script; cat > /tmp/traced.script <<'H'
#!/bin/sh
echo "HOOK $1 ip=$ip mask=$mask lease=$lease t=$(awk '{print $1}' /proc/uptime)" >> /tmp/xtrace
exec /bin/sh -x /tmp/orig.script "$@" 2>> /tmp/xtrace
H
chmod +x /tmp/traced.script; mount --bind /tmp/traced.script ${HOOK} && echo TRACE_OK`, "trace");
  await sh("sleep 35");
  const before = g.serial().length;
  await sh("kill -USR1 $(pidof udhcpc)");
  await waitFor((s) => /REPLAY_NETWORK renew/.exec(s.slice(before)), "usr1 renew");
  await sh("sleep 1");
  r.checks.p7 = { xtrace: lines(await sh("cat /tmp/xtrace")), addresses: lines(await sh("ip -4 -o addr show dev eth0 | awk '{print $4}'")),
    routes: lines(await sh("ip -4 route")), resolv: lines(await sh("cat /etc/resolv.conf")), udhcpcLog: lines(await sh("tail -n 8 /run/udhcpc.log")) };
  const x = r.checks.p7.xtrace;
  r.checks.p7.summary = { hookRuns: x.filter((l) => l.startsWith("HOOK")).length,
    addrDel: x.filter((l) => /^\+ ip -4 addr del/.test(l)), flush: x.filter((l) => /flush/.test(l)),
    replace: x.filter((l) => /^\+ ip -4 addr replace/.test(l)) };
  await sh(`umount ${HOOK}; cat > /tmp/flush.script <<'H'
#!/bin/sh
case "$1" in
  deconfig) ip -4 addr flush dev "$interface" ;;
  bound|renew)
    echo "FLUSH $(awk '{print $1}' /proc/uptime)" >> /tmp/sablog
    ip -4 addr flush dev "$interface"
    ip -4 addr add "$ip/\${mask:-24}" dev "$interface"
    echo "ADDED $(awk '{print $1}' /proc/uptime)" >> /tmp/sablog
    for r in $router; do ip -4 route replace default via "$r" dev "$interface"; break; done
    echo "REPLAY_NETWORK $1 ip=$ip router=$router dns=$dns SABOTAGE" >> /run/replay-desktop/events ;;
esac
exit 0
H
chmod +x /tmp/flush.script; mount --bind /tmp/flush.script ${HOOK} && echo SAB_OK`, "sabotage");
  r.checks.p8 = [];
  for (let k = 0; k < 8; k++) {
    await sh("rm -f /tmp/renewed /tmp/samples /tmp/sablog /tmp/window");
    const b = g.serial().length;
    await sh("( awk '{print \"START\", $1}' /proc/uptime > /tmp/window; i=0; while [ $i -lt 400 ]; do echo \"S $(ip -4 -o addr show dev eth0 | awk '{print $4}' | tr '\\n' ' ')\"; i=$((i+1)); [ -f /tmp/renewed ] && break; done > /tmp/samples; awk '{print \"END\", $1}' /proc/uptime >> /tmp/window ) & echo $! > /tmp/sampler; sleep 0.5; kill -USR1 $(pidof udhcpc)", "renew");
    await waitFor((s) => /REPLAY_NETWORK renew [^\r\n]*SABOTAGE/.exec(s.slice(b)), "sabotaged renewal");
    const samples = lines(await sh("sleep 1; : > /tmp/renewed; while kill -0 $(cat /tmp/sampler) 2>/dev/null; do sleep 0.1; done; cat /tmp/samples"));
    const set = [...new Set(samples)];
    const win = Object.fromEntries(lines(await sh("cat /tmp/window")).map((l) => l.split(" ")).map(([k, v]) => [k, Number(v)]));
    const sab = lines(await sh("cat /tmp/sablog")).map((l) => l.split(" ")).map(([k, v]) => ({ k, t: Number(v) }));
    const flushes = sab.filter((e) => e.k === "FLUSH").map((e) => e.t);
    const spanned = flushes.some((t) => t >= win.START && t <= win.END);
    r.checks.p8.push({ samples: samples.length, set, window: win, sablog: sab, spanned,
      gapSamples: samples.filter((s) => s === "S").length, workerAssertionWouldPass: set.length === 1 && set[0] === "S 10.0.2.15/24" && samples.length >= 5 });
  }
  const t = r.checks.p8;
  r.checks.p8summary = { trials: t.length, spanned: t.filter((x) => x.spanned).length,
    caughtWhenSpanned: t.filter((x) => x.spanned && !x.workerAssertionWouldPass).length,
    missedWhenSpanned: t.filter((x) => x.spanned && x.workerAssertionWouldPass).length };
  r.done = true;
} catch (e) { r.error = String(e?.stack ?? e); }
finally {
  r.hostSeconds = g.hostSeconds(); g.stop();
  await writeFile(path.join(out, "result.json"), JSON.stringify(r, null, 2) + "\n");
  console.log(JSON.stringify({ done: r.done, error: r.error?.split("\n")[0], p7: r.checks.p7?.summary, p8: r.checks.p8summary }));
}
