// Independent synthetic harness attack. This is never desktop response evidence.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { DIRECT_OPAQUE_COMMAND, assertDirectOpaqueProperties, auditDirectOpaque }
  from "../../../tools/verify/omarchy-direct-opaque-command.mjs";
import { formatRpcCommand } from "../../../web/guest-rpc.js";

const dir = new URL("./", import.meta.url);
const props = ["opaque", "force_rgbx", "opacity", "opacity_inactive", "opacity_fullscreen",
  "opacity_override", "opacity_inactive_override", "opacity_fullscreen_override"];
const expected = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '${[
  ...props.map(p => `dispatch setprop active ${p} 1`),
  ...props.map(p => `getprop active ${p}`), "j/activewindow",
].join("; ")}'`;
assert.equal(DIRECT_OPAQUE_COMMAND, expected);
const foot = { address: "0x7f1ab234", class: "foot", mapped: true, hidden: false,
  at: [16, 40], size: [1248, 744] };
const lines = ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok",
  "true", "true", "1", "1.000", "1", "true", "true", "true"];
const stdout = `${lines.join("\n\n\n")}\n\n\n${JSON.stringify(foot)}\n`;
const iso = n => new Date(n).toISOString();
function fixture(raw = stdout) {
  return {
    directOpaqueRequested: true, startup: { deadlineAt: iso(4000) },
    trial: { outcome: "startup-failed-input-not-tested" },
    directOpaque: { command: expected, requestCount: 1, startedAt: iso(1000),
      deadlineAtMs: 4000, status: "properties-confirmed", respondedAt: iso(1300),
      response: { exit: 0, stdout }, foot: structuredClone(foot) },
    workerTraffic: [
      { type: "serial-input", sent: true, ms: 1100, timestamp: iso(1100),
        bytes: [...Buffer.from(formatRpcCommand(expected, "criticai1"))] },
      { type: "serial-output", ms: 1200, timestamp: iso(1200),
        text: `\n__WVBEGIN_criticai1\n${raw}__WVEND_criticai1_0\n` },
    ],
  };
}
const cases = [];
function check(name, fn, rejects) {
  const repeats = [];
  for (let run = 1; run <= 2; run++) {
    let error = null, value;
    try { value = fn(); } catch (e) { error = String(e); }
    assert.equal(Boolean(error), rejects, `${name}: unexpected acceptance`);
    repeats.push({ run, rejected: Boolean(error), error, value: value ?? null });
  }
  cases.push({ name, expectedRejection: rejects, repeats });
}
check("literal complete response control", () => assertDirectOpaqueProperties({ exit: 0, stdout }), false);
check("complete actual wire control", () => auditDirectOpaque(fixture()), false);
const missingRead = `${lines.slice(0, 15).join("\n")}\n${JSON.stringify(foot)}\n`;
check("exit-zero partial final override read", () => assertDirectOpaqueProperties({ exit: 0, stdout: missingRead }), true);
const badWrite = stdout.replace(/^ok/u, "Invalid prop name");
check("exit-zero first write failure with otherwise good reads", () => assertDirectOpaqueProperties({ exit: 0, stdout: badWrite }), true);
check("forged complete summary over actual partial wire", () => auditDirectOpaque(fixture(missingRead)), true);
check("actual complete reply arrives beyond original deadline", () => {
  const r = fixture(); r.workerTraffic[1].timestamp = iso(4001); r.workerTraffic[1].ms = 4001;
  r.directOpaque.respondedAt = iso(4002); return auditDirectOpaque(r);
}, true);
check("failed configuration attempts to claim physical typing", () => {
  const r = fixture(missingRead); r.directOpaque.status = "configuration-failed";
  delete r.directOpaque.response; delete r.directOpaque.respondedAt;
  r.keyboard = { startedAt: iso(1500), typedAt: iso(1600), guestFile: "/tmp/not-an-actual-input" };
  return auditDirectOpaque(r);
}, true);
check("changed direct batch order cannot bind to fixed command", () => {
  const r = fixture();
  r.workerTraffic[0].bytes = [...Buffer.from(formatRpcCommand(expected.replace(
    "dispatch setprop active opaque 1; dispatch setprop active force_rgbx 1",
    "dispatch setprop active force_rgbx 1; dispatch setprop active opaque 1"), "criticai1"))];
  return auditDirectOpaque(r);
}, true);
const sources = {};
for (const file of ["tools/verify/omarchy-direct-opaque-command.mjs", "tools/verify/omarchy-latency-receipt.mjs", "web/guest-rpc.js"]) {
  sources[file] = createHash("sha256").update(await fs.readFile(new URL(`../../../${file}`, dir))).digest("hex");
}
const result = { productEvidence: false, purpose: "bounded independent partial-property and false-success attack",
  sourceHashes: sources, fixedCommand: expected, literalControlStdout: stdout, partialStdout: missingRead, cases };
await fs.writeFile(new URL("attack.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
