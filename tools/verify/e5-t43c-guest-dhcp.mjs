#!/usr/bin/env node
// E5-T43c: boot a Replay desktop image on the native CLI (browser device topology) and check,
// over the serial root shell, how the guest's network comes up in one of three machines:
//
//   --mode slirp     the slirp stack (DHCP, DNS, NAT): eth0 gets a lease, a default route and a
//                    nameserver; `node` fetches over it; a renewal keeps the address in place.
//   --mode loopback  a NIC with no DHCP server: nothing waits, nothing is configured, udhcpc
//                    keeps asking in the background.
//   --mode none      no NIC: no udhcpc at all.
//
// In every mode READY's guest uptime must be within 0.3 s of --baseline-ready (the same mode's
// READY on the image this one replaces). --ready-only records READY and stops (to measure that
// baseline on the old image).
//
//   node tools/verify/e5-t43c-guest-dhcp.mjs --image IMG --out DIR --mode slirp [--baseline-ready S]
//
// Guest time is the retire-count clock (640 M instructions per guest second at divider 64).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { bootNative, lines, repo } from "../replay-desktop/native-shell.mjs";

const { values: opt } = parseArgs({ options: {
  image: { type: "string" }, out: { type: "string" }, mode: { type: "string" },
  kernel: { type: "string", default: path.join(repo, "releases/kernel/6.6.63/Image") },
  cli: { type: "string", default: path.join(repo, "target/release/wasm-vm") },
  "baseline-ready": { type: "string" },
  "ready-only": { type: "boolean", default: false },
  "timeout-min": { type: "string", default: "30" },
} });
const NIC = { slirp: "--net-slirp", loopback: "--net", none: null };
assert.ok(opt.image && opt.out && opt.mode in NIC, "usage: e5-t43c-guest-dhcp.mjs --image IMG --out DIR --mode slirp|loopback|none");
const out = path.resolve(opt.out);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const guest = await bootNative({ image: opt.image, out, kernel: opt.kernel, cli: opt.cli,
  timeoutMin: Number(opt["timeout-min"]), net: NIC[opt.mode] });
const { sh, waitFor } = guest;
const uptime = async () => Number((await sh("cut -d' ' -f1 /proc/uptime")).trim());

const result = { task: "E5-T43c", mode: opt.mode, startedAt: guest.startedAt, command: guest.command,
  imageSha256: sha256(await readFile(opt.image)), checks: {} };
let failure = null;
try {
  const readyMatch = await waitFor((s) => /REPLAY_DESKTOP_READY uptime=(\S+) mem_hwm_kib=(\d+)/.exec(s), "REPLAY_DESKTOP_READY");
  result.readyUptime = Number(readyMatch[1]);
  if (opt["baseline-ready"] !== undefined) {
    result.baselineReadyUptime = Number(opt["baseline-ready"]);
    assert.ok(Math.abs(result.readyUptime - result.baselineReadyUptime) <= 0.3,
      `READY at ${result.readyUptime} s, baseline ${result.baselineReadyUptime} s`);
  }
  if (!opt["ready-only"]) {
    await guest.rootShell();
    const c = result.checks;
    c.resolvLink = (await sh("readlink /etc/resolv.conf")).trim();
    assert.equal(c.resolvLink, "/run/resolv.conf", "/etc/resolv.conf links to /run/resolv.conf");
    if (opt.mode === "slirp") {
      // The lease line the hook relays through the monitor to the serial console.
      const bound = await waitFor((s) => /REPLAY_NETWORK bound ip=(\S+) router=(\S*) dns=([^\r\n]*)/.exec(s), "the DHCP lease");
      c.leaseLine = bound[0].trim();
      c.leaseUptimeAtCheck = await uptime();
      c.addresses = lines(await sh("ip -4 -o addr show dev eth0 | awk '{print $4}'"));
      assert.deepEqual(c.addresses, [`${bound[1]}/24`], "eth0 holds exactly the lease's address");
      c.routes = lines(await sh("ip -4 route"));
      assert.ok(c.routes.includes(`default via ${bound[2]} dev eth0`), `a default route via ${bound[2]}: ${c.routes}`);
      c.resolvConf = lines(await sh("cat /etc/resolv.conf"));
      assert.ok(c.resolvConf.length > 0 && c.resolvConf.every((l) => /^(nameserver \S+|search \S+)$/.test(l)), `resolv.conf: ${c.resolvConf}`);
      assert.ok(c.resolvConf.includes(`nameserver ${bound[3].trim().split(/\s+/)[0]}`), "the lease's nameserver is in resolv.conf");
      c.lookup = lines(await sh("node -e 'require(\"dns\").lookup(\"example.com\",(e,a)=>console.log(e?\"ERR \"+e.code:\"ADDR \"+a))'"));
      assert.ok(c.lookup.some((l) => /^ADDR \d+\.\d+\.\d+\.\d+$/.test(l)), `name lookup: ${c.lookup}`);
      c.fetchHttp = lines(await sh("node -e 'fetch(\"http://example.com\").then(r=>console.log(\"STATUS\",r.status),e=>console.log(\"ERR\",e.cause?.code??e.message))'"));
      assert.ok(c.fetchHttp.includes("STATUS 200"), `http fetch: ${c.fetchHttp}`);
      c.fetchHttps = lines(await sh("node -e 'fetch(\"https://example.com\").then(r=>console.log(\"STATUS\",r.status),e=>console.log(\"ERR\",e.cause?.code??e.message))'"));
      assert.ok(c.fetchHttps.includes("STATUS 200"), `https fetch: ${c.fetchHttps}`);
      // A renewal: sample eth0's addresses as fast as the shell can while udhcpc renews; the
      // lease's address must be there in every sample, and alone.
      const before = guest.serial().length;
      await sh("( i=0; while [ $i -lt 400 ]; do echo \"S $(ip -4 -o addr show dev eth0 | awk '{print $4}' | tr '\\n' ' ')\"; i=$((i+1)); [ -f /tmp/renewed ] && break; done > /tmp/samples ) & echo $! > /tmp/sampler; sleep 0.5; kill -USR1 $(pidof udhcpc)", "renew");
      const renew = await waitFor((s) => /REPLAY_NETWORK renew ip=(\S+)[^\r\n]*/.exec(s.slice(before)), "the renewal");
      c.renewLine = renew[0].trim();
      assert.equal(renew[1], bound[1], "the renewal keeps the address");
      const samples = lines(await sh("sleep 1; : > /tmp/renewed; while kill -0 $(cat /tmp/sampler) 2>/dev/null; do sleep 0.1; done; cat /tmp/samples"));
      c.renewSamples = samples.length;
      c.renewSampleSet = [...new Set(samples)];
      assert.ok(samples.length >= 5, `enough samples across the renewal: ${samples.length}`);
      assert.deepEqual(c.renewSampleSet, [`S ${bound[1]}/24`], "the address stayed, alone, through the renewal");
      c.fetchAfterRenew = lines(await sh("node -e 'fetch(\"http://example.com\").then(r=>console.log(\"STATUS\",r.status),e=>console.log(\"ERR\",e.cause?.code??e.message))'"));
      assert.ok(c.fetchAfterRenew.includes("STATUS 200"), `fetch after renewal: ${c.fetchAfterRenew}`);
    } else {
      // Give udhcpc time to have asked and given up at least once; nothing may be configured.
      const t = await uptime();
      await sh("sleep 20");
      c.waitedGuestSeconds = +((await uptime()) - t).toFixed(2);
      c.udhcpc = (await sh("pidof udhcpc || echo none")).trim();
      c.eth0 = (await sh("[ -d /sys/class/net/eth0 ] && echo present || echo absent")).trim();
      c.addresses = lines(await sh("ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}'"));
      c.defaultRoute = lines(await sh("ip -4 route | grep default || true"));
      c.resolvConfExists = (await sh("[ -e /etc/resolv.conf ] && echo yes || echo no")).trim();
      c.networkLines = (guest.serial().match(/REPLAY_NETWORK[^\r\n]*/g) ?? []);
      c.nodeRuns = lines(await sh("node -e 'console.log(\"NODE_OK\")'"));
      assert.deepEqual(c.addresses, [], "no address");
      assert.deepEqual(c.defaultRoute, [], "no default route");
      assert.equal(c.resolvConfExists, "no", "no resolver configuration");
      assert.deepEqual(c.networkLines, [], "no lease line");
      assert.ok(c.nodeRuns.includes("NODE_OK"), "node runs offline");
      if (opt.mode === "loopback") {
        assert.equal(c.eth0, "present");
        assert.match(c.udhcpc, /^\d+$/, "udhcpc keeps asking in the background");
      } else {
        assert.equal(c.eth0, "absent");
        assert.equal(c.udhcpc, "none", "no udhcpc without a NIC");
      }
    }
    c.udhcpcLog = lines(await sh("cat /run/udhcpc.log 2>/dev/null | head -20"));
  }
  result.pass = true;
} catch (e) {
  failure = e;
  result.pass = false;
  result.error = String(e?.stack ?? e);
} finally {
  result.hostSeconds = guest.hostSeconds();
  guest.stop();
  await writeFile(path.join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ mode: result.mode, pass: result.pass, readyUptime: result.readyUptime, error: result.error?.split("\n")[0] }));
}
if (failure) process.exit(1);
