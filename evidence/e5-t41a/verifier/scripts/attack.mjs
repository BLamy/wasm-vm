#!/usr/bin/env node
// E5-T41a verifier attacks, over the native serial root shell.
//   node attack.mjs --mode success|kill-node|kill-subshell|ready-only --image IMG --out DIR
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { bootNative, last, lines } from "../../../../tools/replay-desktop/native-shell.mjs";

const { values: opt } = parseArgs({ options: { mode: { type: "string" }, image: { type: "string" }, out: { type: "string" } } });
const out = path.resolve(opt.out);
const g = await bootNative({ image: opt.image, out, timeoutMin: 40 });
const { sh, waitFor } = g;
const log = [];
const step = async (name, cmd) => { const text = await sh(cmd, name); log.push({ name, cmd, out: text }); return text; };
const R = { mode: opt.mode, image: opt.image, startedAt: g.startedAt };
const REAL = "/opt/replay-node-26/bin/node";
// find the build node: comm node with build-snapshot in cmdline (pattern bracketed so grep never matches itself)
const BUILD = `i=0; while [ $i -lt 400 ]; do pid=$(for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q '^/opt/replay-node-26/bin/node --snapshot-blob /run/replay-node/startup.blob.tm[p]' && echo \${p#/proc/}; done | head -n 1); [ -n "$pid" ] && break; sleep 0.05; i=$((i+1)); done; echo "tries=$i comm=$(cat /proc/$pid/comm 2>/dev/null) uptime=$(cut -d' ' -f1 /proc/uptime)"; echo $pid`;
const timeIt = (cmd) => `a=$(cut -d' ' -f1 /proc/uptime); ${cmd} >/dev/null 2>&1; b=$(cut -d' ' -f1 /proc/uptime); echo "T $a $b"`;
try {
  if (opt.mode === "ready-only") {
    await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
    R.ready = /REPLAY_DESKTOP_READY uptime=(\S+) mem_hwm_kib=(\d+)/.exec(g.serial()).slice(1);
  } else {
    await waitFor((s) => s.includes("REPLAY_DESKTOP_MONITOR start"), "monitor start");
    await g.rootShell();
    R.early = await step("early state", `cat /proc/uptime; ls -la /run/replay-node; grep -c . /run/replay-desktop/events`);
    const pid = last(await step("build pid", BUILD));
    R.buildPid = pid;
    if (pid) {
      R.buildProc = await step("build proc", `cut -d' ' -f19 /proc/${pid}/stat | sed 's/^/nice=/'; tr '\\0' '\\n' < /proc/${pid}/environ | grep RECORD_REPLAY; tr '\\0' ' ' < /proc/${pid}/cmdline; echo; grep PPid /proc/${pid}/status; ls -l /run/replay-node`);
    }
    if (opt.mode === "kill-node") {
      R.kill = await step("kill build node", `kill -9 ${pid}; sleep 1; cat /proc/uptime; ls -la /run/replay-node; cat /run/replay-node/build.log`);
    } else if (opt.mode === "kill-subshell") {
      const ppid = last(await sh(`grep PPid /proc/${pid}/status | cut -f2`, "ppid"));
      R.kill = await step("kill build subshell", `cat /proc/${ppid}/cmdline | tr '\\0' ' '; echo; kill -9 ${ppid}; sleep 1; cat /proc/uptime; ls -la /run/replay-node; [ -d /proc/${pid} ] && echo build-node-still-running`);
    } else {
      // success: the half-written-blob window — node during the build
      R.duringBuild = await step("node during build", `ls -l /run/replay-node; node -p 'String(process.env.NODE_OPTIONS) + " " + 6*7'; echo rc=$?; ls -l /run/replay-node`);
    }
    await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
    R.ready = /REPLAY_DESKTOP_READY uptime=(\S+) mem_hwm_kib=(\d+)/.exec(g.serial()).slice(1);
    if (opt.mode === "kill-subshell") {
      // give the monitor 60 guest seconds to (not) print a Node line
      R.after = await step("after 60 s", `sleep 60; cat /proc/uptime; ls -la /run/replay-node; node -p 'String(process.env.NODE_OPTIONS) + " " + 6*7'`);
    } else {
      await waitFor((s) => /REPLAY_NODE_SNAPSHOT(_FAILED)? [^\n]*\n/.test(s), "Node line");
    }
    const s = g.serial();
    R.nodeLine = (/REPLAY_NODE_SNAPSHOT\S* [^\n]*/.exec(s) ?? [null])[0];
    R.order = { readyIndex: s.indexOf("REPLAY_DESKTOP_READY"), nodeIndex: s.indexOf("REPLAY_NODE_SNAPSHOT") };
    R.state = await step("state after", `ls -la /run/replay-node; cat /run/replay-node/build.log; node -p 'String(process.env.NODE_OPTIONS) + " " + 6*7'; echo rc=$?`);
    R.timing = [];
    for (let i = 0; i < 3; i++) R.timing.push(await step("node -e 0", timeIt("node -e 0")));
    if (opt.mode === "success") {
      await step("fixtures", `cd /tmp
printf 'console.log(JSON.stringify(process.argv.slice(1)), String(process.env.NODE_OPTIONS))\\n' > a.js
cp a.js ./--build-snapshot.js
printf '#!/usr/bin/env node\\nconsole.log("envshebang", process.argv.length, process.argv[1], typeof require)\\n' > envs; chmod +x envs
printf '#!/usr/local/bin/node\\nconsole.log("directshebang", process.argv.length, process.argv[1])\\n' > dirs; chmod +x dirs
printf '#!/usr/bin/env -S node --no-warnings\\nconsole.log("dashS", JSON.stringify(process.execArgv))\\n' > dashs; chmod +x dashs
ls /opt/replay-node-26/bin /opt/replay-node-26/lib/node_modules 2>&1 | head -20`);
      const cases = {
        dashdash: [`node -- /tmp/a.js x`, `${REAL} -- /tmp/a.js x`],
        dashScript: [`node ./--build-snapshot.js q`, `${REAL} ./--build-snapshot.js q`],
        emptyNO: [`NODE_OPTIONS= node -p 'JSON.stringify(process.env.NODE_OPTIONS)'`, null],
        spacesNO: [`NODE_OPTIONS='--title="a b"' node -p 'process.title + "|" + process.env.NODE_OPTIONS'`, `NODE_OPTIONS='--title="a b"' ${REAL} -p 'process.title + "|" + process.env.NODE_OPTIONS'`],
        spacesArgv: [`node /tmp/a.js 'a b' '' c`, `${REAL} /tmp/a.js 'a b' '' c`],
        snapArg: [`node /tmp/a.js --snapshot-blob`, `${REAL} /tmp/a.js --snapshot-blob`],
        envShebang: [`/tmp/envs 1 2`, `env -u NODE_OPTIONS PATH=/opt/replay-node-26/bin:$PATH /tmp/envs 1 2`],
        directShebang: [`/tmp/dirs 1`, null],
        dashS: [`/tmp/dashs`, null],
        npm: [`npm --version 2>&1 | tail -n 1; echo rc=$?`, `env -u NODE_OPTIONS PATH=/opt/replay-node-26/bin:$PATH /opt/replay-node-26/bin/npm --version 2>&1 | tail -n 1`],
        npmNodeOpt: [`npm exec -c 'node -p process.env.NODE_OPTIONS' 2>&1 | tail -n 2`, null],
        nested: [`node -e 'console.log(require("child_process").execSync("node -p process.env.NODE_OPTIONS").toString().trim())'`, null],
        repl: [`echo '6*7' | node -i 2>&1 | grep -c 42`, `echo '6*7' | ${REAL} -i 2>&1 | grep -c 42`],
        stdinScript: [`echo 'console.log(process.argv.length, 5*5)' | node - x y`, `echo 'console.log(process.argv.length, 5*5)' | ${REAL} - x y`],
      };
      R.args = {};
      for (const [k, [w, p]] of Object.entries(cases)) {
        R.args[k] = { wrapped: lines(await step(`w ${k}`, w)).join("\n") };
        if (p) R.args[k].plain = lines(await step(`p ${k}`, p)).join("\n");
      }
      // novel: corrupt (truncated) blob at the published path
      R.truncated = await step("truncated blob", `cp /run/replay-node/startup.blob /tmp/good.blob; head -c 1048576 /tmp/good.blob > /run/replay-node/startup.blob; node -p 6*7 2>&1 | tail -n 5; echo rc=$?; cp /tmp/good.blob /run/replay-node/startup.blob; node -p 6*7; echo rc=$?`);
      // empty blob (zero bytes, e.g. a user's `: >`)
      R.emptyBlob = await step("empty blob", `: > /run/replay-node/startup.blob; node -p 6*7 2>&1 | tail -n 3; echo rc=$?; cp /tmp/good.blob /run/replay-node/startup.blob`);
      // the desktop user (uid 1000) runs node: is the blob readable to them?
      R.desktopUser = await step("desktop user", `su -s /bin/sh desktop -c "/usr/local/bin/node -p 'process.env.NODE_OPTIONS + \\" \\" + process.getuid()'"; ls -l /run/replay-node`);
      // tmpfs space for /run
      R.df = await step("df", `df -k /run /tmp /dev/shm`);
      // user deletes the blob
      R.deleted = await step("rm blob", `rm /run/replay-node/startup.blob; node -p 'String(process.env.NODE_OPTIONS) + " " + 6*7'; echo rc=$?`);
      R.deletedTiming = [];
      for (let i = 0; i < 3; i++) R.deletedTiming.push(await step("rm node -e 0", timeIt("node -e 0")));
    }
    R.monitorPid = await step("monitor", `for p in /proc/[0-9]*; do grep -qs 'replay-desktop-monito[r]' $p/cmdline && echo \${p#/proc/}; done; cat /run/replay-desktop/mem-hwm-kib`);
  }
  R.pass = true;
} catch (e) { R.pass = false; R.error = String(e?.stack ?? e); }
finally {
  R.hostSeconds = g.hostSeconds();
  await writeFile(path.join(out, "attack.json"), JSON.stringify({ ...R, log }, null, 2) + "\n");
  g.stop();
}
console.log(JSON.stringify({ ...R }, null, 2));
