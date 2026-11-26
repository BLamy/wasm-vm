#!/usr/bin/env node
// E5-T41a: boot a Replay desktop image on the native CLI (browser device topology, the same
// machine the warm-snapshot capture boots) and check, over the serial root shell, that Node
// starts from the startup snapshot rcS builds at boot, that nothing depends on it, and that the
// monitor is quiet after REPLAY_DESKTOP_READY.
//
//   node tools/verify/e5-t41a-node-snapshot.mjs --image IMG --out DIR [--baseline-ready 5.28]
//
// Guest time is the retire-count clock (640 M instructions per guest second at divider 64), so
// the guest seconds reported here are instruction counts, independent of the host's speed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { bootNative, last, lines, repo } from "../replay-desktop/native-shell.mjs";

const { values: opt } = parseArgs({ options: {
  image: { type: "string" }, out: { type: "string" },
  kernel: { type: "string", default: path.join(repo, "releases/kernel/6.6.63/Image") },
  cli: { type: "string", default: path.join(repo, "target/release/wasm-vm") },
  // READY uptime (guest seconds) of the same boot of the image this one replaces.
  "baseline-ready": { type: "string" },
  "timeout-min": { type: "string", default: "30" },
} });
assert.ok(opt.image && opt.out, "usage: e5-t41a-node-snapshot.mjs --image IMG --out DIR");
const out = path.resolve(opt.out);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const guest = await bootNative({ image: opt.image, out, kernel: opt.kernel, cli: opt.cli, timeoutMin: Number(opt["timeout-min"]) });
const { sh, waitFor } = guest;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// Guest seconds a command takes, from /proc/uptime around it (10 ms resolution).
async function guestSeconds(cmd) {
  const text = await sh(`a=$(cut -d' ' -f1 /proc/uptime); ${cmd} >/dev/null 2>&1; b=$(cut -d' ' -f1 /proc/uptime); echo "T $a $b"`, cmd);
  const m = /^T (\S+) (\S+)$/m.exec(text);
  assert.ok(m, `no timing for ${cmd}: ${text}`);
  return +(Number(m[2]) - Number(m[1])).toFixed(2);
}

const REAL = "/opt/replay-node-26/bin/node";
const BLOB = "/run/replay-node/startup.blob";
const result = { task: "E5-T41a", startedAt: guest.startedAt, command: guest.command,
  imageSha256: sha256(await readFile(opt.image)) };
let failure = null;
try {
  await waitFor((s) => /REPLAY_NODE_SNAPSHOT(_FAILED)? [^\n]*\n/.test(s), "the Node snapshot line");
  const ready = /REPLAY_DESKTOP_READY uptime=(\S+) mem_hwm_kib=(\d+)/.exec(guest.serial());
  const node = /REPLAY_NODE_SNAPSHOT bytes=(\d+) uptime=(\S+)/.exec(guest.serial());
  assert.ok(ready, "REPLAY_DESKTOP_READY was printed");
  assert.ok(node, "REPLAY_NODE_SNAPSHOT bytes= was printed (not _FAILED)");
  assert.ok(ready.index < node.index, "READY comes before the Node line");
  result.markers = { readyUptime: Number(ready[1]), memHwmKibAtReady: Number(ready[2]),
    nodeSnapshotBytes: Number(node[1]), nodeSnapshotUptime: Number(node[2]), hostSecondsToNodeLine: guest.hostSeconds() };
  assert.ok(result.markers.nodeSnapshotBytes > 1 << 20, "the snapshot is more than 1 MiB");
  if (opt["baseline-ready"] !== undefined) {
    result.markers.baselineReadyUptime = Number(opt["baseline-ready"]);
    assert.ok(Math.abs(result.markers.readyUptime - result.markers.baselineReadyUptime) <= 0.3,
      `READY at ${result.markers.readyUptime} s, baseline ${result.markers.baselineReadyUptime} s`);
  }
  await guest.rootShell();

  // The monitor after READY: 60 guest seconds, its own CPU time plus its children's.
  const monitorTicks = async () => {
    const pid = last(await sh("for p in /proc/[0-9]*; do grep -qs replay-desktop-monitor $p/cmdline && echo ${p#/proc/}; done | head -n 1", "monitor pid"));
    const stat = last(await sh(`cat /proc/${pid}/stat`, "monitor stat")).split(") ")[1].split(" ");
    return { pid, ticks: [11, 12, 13, 14].reduce((sum, i) => sum + Number(stat[i]), 0) }; // utime stime cutime cstime
  };
  const hwmBefore = Number(last(await sh("cat /run/replay-desktop/mem-hwm-kib", "hwm")));
  const m0 = await monitorTicks();
  // Push the high-water mark up for a moment so a later sample has to record it.
  await sh("dd if=/dev/zero of=/dev/shm/e5t41a bs=1M count=48 2>/dev/null; sleep 60; rm -f /dev/shm/e5t41a", "60 guest seconds");
  const m1 = await monitorTicks();
  const hwmAfter = Number(last(await sh("cat /run/replay-desktop/mem-hwm-kib", "hwm")));
  result.monitor = { pid: m0.pid, guestCpuSecondsIn60: (m1.ticks - m0.ticks) / 100, memHwmKib: [hwmBefore, hwmAfter] };
  assert.equal(m1.pid, m0.pid, "the monitor is still the same process");
  // Twelve samples (awk, wc and sleep: three forks each) cost about 5 ms of guest CPU apiece;
  // the per-second loop this replaces used about 0.7 s a minute, plus sway's side of get_tree.
  assert.ok(result.monitor.guestCpuSecondsIn60 <= 0.15, `monitor used ${result.monitor.guestCpuSecondsIn60} s of guest CPU in 60 s`);
  // 48 MiB of tmpfs lower MemAvailable by a little less than 48 MiB (the kernel's estimate also
  // counts reclaimable cache); half of it is proof enough that the monitor still samples.
  assert.ok(hwmAfter >= hwmBefore + 24 * 1024, `high-water mark still sampled (${hwmBefore} -> ${hwmAfter} KiB)`);

  // Behaviour: the same answers through the wrapper (snapshot) and from the real binary.
  await sh(`cat > /tmp/m.js <<'EOS'
console.log(typeof require, typeof module, __filename, require.main === module, process.argv.slice(2).join(","));
EOS
echo 'import os from "node:os"; console.log(os.arch(), import.meta.url)' > /tmp/m.mjs
echo 'console.log(require("child_process").execFileSync(process.execPath, ["-p", "6*7"]).toString().trim())' > /tmp/child.js
echo 'const {Worker} = require("worker_threads"); new Worker("require(\\"worker_threads\\").parentPort.postMessage(7)", {eval: true}).on("message", (m) => console.log("worker", m))' > /tmp/worker.js
echo 'console.log(typeof fetch, require("crypto").createHash("sha256").update("a").digest("hex").slice(0, 8), require("zlib").gzipSync("x").length, new Intl.NumberFormat("en").format(1234.5))' > /tmp/misc.js`, "fixtures");
  const cases = [
    ["version", "-p process.version"],
    ["execArgv", `-p 'JSON.stringify(process.execArgv)' `],
    ["execPath", "-p process.execPath"],
    ["script", "/tmp/m.js a b"],
    ["module", "/tmp/m.mjs"],
    ["stdin module", "--input-type=module </tmp/m.mjs 2>&1 | cut -c1-12"],
    ["child", "/tmp/child.js"],
    ["worker", "/tmp/worker.js"],
    ["misc", "/tmp/misc.js"],
    ["exit code", `-e 'process.exit(3)'; echo rc=$?`],
  ];
  result.behaviour = {};
  for (const [name, argv] of cases) {
    const wrapped = lines(await sh(`node ${argv}`, `wrapper ${name}`)).join("\n");
    const plain = lines(await sh(`env -u NODE_OPTIONS ${REAL} ${argv}`, `real ${name}`)).join("\n");
    result.behaviour[name] = { wrapped, plain };
    assert.equal(wrapped, plain, `${name}: same output with and without the snapshot`);
    assert.ok(wrapped.length > 0, `${name}: printed something`);
  }
  assert.equal(result.behaviour.version.wrapped, "v26.13.1");
  assert.equal(result.behaviour.execArgv.wrapped, `["-p","JSON.stringify(process.execArgv)"]`);
  assert.equal(result.behaviour.execPath.wrapped, REAL);
  assert.equal(result.behaviour["exit code"].wrapped, "rc=3");
  // The wrapper really passes the snapshot, and a child through execPath inherits it.
  assert.equal(last(await sh("node -p process.env.NODE_OPTIONS", "NODE_OPTIONS")), `--snapshot-blob=${BLOB}`);
  assert.equal(last(await sh(`node -e 'console.log(require("child_process").execFileSync(process.execPath, ["-p", "process.env.NODE_OPTIONS"]).toString().trim())'`, "child env")), `--snapshot-blob=${BLOB}`);
  // Left alone: a caller's own snapshot option, and --build-snapshot (its blob is the output).
  assert.equal(last(await sh(`NODE_OPTIONS=--snapshot-blob=${BLOB} node -p process.env.NODE_OPTIONS`, "own NODE_OPTIONS")), `--snapshot-blob=${BLOB}`);
  assert.equal(last(await sh(`NODE_OPTIONS=--max-old-space-size=128 node -p process.env.NODE_OPTIONS`, "merged NODE_OPTIONS")), `--snapshot-blob=${BLOB} --max-old-space-size=128`);
  assert.equal(last(await sh(`node --snapshot-blob /tmp/user.blob --build-snapshot /dev/null && node --snapshot-blob /tmp/user.blob -p 'process.env.NODE_OPTIONS === undefined'`, "user snapshot")), "true");

  // Speed: guest seconds of `node -e 0`, three runs each (the first of each after a warm-up).
  await sh(`node -e 0; env -u NODE_OPTIONS ${REAL} -e 0`, "warm-up");
  const timing = { wrapper: [], real: [], wrapperWithoutBlob: [] };
  for (let i = 0; i < 3; i++) {
    timing.wrapper.push(await guestSeconds("node -e 0"));
    timing.real.push(await guestSeconds(`env -u NODE_OPTIONS ${REAL} -e 0`));
  }
  await sh(`mv ${BLOB} ${BLOB}.away`, "move the blob away");
  assert.equal(last(await sh("node -p 6*7", "wrapper without the blob")), "42");
  assert.equal(last(await sh("node -p 'process.env.NODE_OPTIONS === undefined'", "no option without the blob")), "true");
  for (let i = 0; i < 3; i++) timing.wrapperWithoutBlob.push(await guestSeconds("node -e 0"));
  await sh(`mv ${BLOB}.away ${BLOB}`, "put the blob back");
  result.nodeStartGuestSeconds = { ...timing, medians: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, median(v)])) };
  const med = result.nodeStartGuestSeconds.medians;
  assert.ok(med.wrapper <= 0.45, `node -e 0 through the wrapper: ${med.wrapper} guest s`);
  assert.ok(med.real >= 0.70, `node -e 0 without the snapshot: ${med.real} guest s`);
  assert.ok(med.wrapperWithoutBlob >= 0.70, `wrapper without the blob: ${med.wrapperWithoutBlob} guest s`);
  result.pass = true;
} catch (error) {
  failure = error;
  result.pass = false;
  result.error = String(error?.stack ?? error);
} finally {
  result.hostSeconds = guest.hostSeconds();
  await writeFile(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  guest.stop();
}
console.log(JSON.stringify({ pass: result.pass, markers: result.markers, monitor: result.monitor,
  nodeStartGuestSeconds: result.nodeStartGuestSeconds?.medians, error: result.error }, null, 2));
if (failure) process.exit(1);
