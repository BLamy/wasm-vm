#!/usr/bin/env node
// Drive the real native guest to a mapped Omarchy session before triggering save_resume.
// The resulting pair still requires a fresh browser restore + screenshot/input verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { plainTerminal, parseProbe, probeCommand, parseInstances, desktopObservation } from "./omarchy-browser-session.mjs";
import { hasOmarchyDesktopLayers } from "../../web/omarchy-desktop-readiness.js";

const [binary, ...args] = process.argv.slice(2);
assert.ok(binary && args.length, "usage: omarchy-native-capture.mjs BINARY boot ARGS...");
const child = spawn(binary, args, { stdio: ["pipe", "pipe", "inherit"] });
let serial = "", exited = false;
const observers = new Set();
child.stdout.on("data", (bytes) => {
  process.stdout.write(bytes);
  serial = (serial + bytes.toString("utf8")).slice(-2_000_000);
  // Bash/readline asks for cursor position before rendering its prompt on this serial terminal.
  if (bytes.includes(Buffer.from("\x1b[6n"))) child.stdin.write("\x1b[1;1R");
  for (const notify of observers) notify();
});
const exit = new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code, signal) => {
    exited = true;
    for (const notify of observers) notify();
    resolve({ code, signal });
  });
});
const deadline = Date.now() + Number(process.env.OMARCHY_CAPTURE_TIMEOUT_MS || 7_200_000);
function waitFor(read, timeout = 300_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("guest observation timed out")),
      Math.max(1, Math.min(timeout, deadline - Date.now())));
    const finish = (error, value) => {
      clearTimeout(timer); observers.delete(check);
      if (error) reject(error); else resolve(value);
    };
    const check = () => {
      const result = read();
      if (result) finish(null, result);
      else if (exited) finish(new Error("guest exited before desktop capture"));
    };
    observers.add(check); check();
  });
}
let sequence = 0;
async function probe(command) {
  const token = `capture_${++sequence}`;
  child.stdin.write(probeCommand(command, token));
  return waitFor(() => parseProbe(serial, token));
}
try {
  await waitFor(() => /\[omarchy@omarchy-demo [^\n]*\]\$ /u.test(plainTerminal(serial)), 7_200_000);
  assert.equal((await probe("id -u")).output, "1000");
  while (Date.now() < deadline) {
    const instances = parseInstances(await probe("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances"));
    assert.ok(instances.length <= 1, "warm desktop requires one Hyprland instance");
    const instance = instances.find((v) => /^[A-Za-z0-9_.-]+$/u.test(v.instance || "") && v.pid > 0);
    if (instance) {
      const ctl = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i ${instance.instance}`;
      const clients = await probe(`${ctl} -j clients`);
      const layers = await probe(`${ctl} -j layers`);
      const processes = await probe("ps -u 1000 -o pid=,comm=,args=");
      if ([clients, layers, processes].every((r) => r.status === 0)) {
        const observed = desktopObservation(JSON.parse(clients.output), JSON.parse(layers.output), processes.output);
        console.log(`\nOMARCHY_DESKTOP_OBSERVATION ${JSON.stringify(observed)}`);
        if (observed.mappedFoot && observed.quickshellObserved && hasOmarchyDesktopLayers(JSON.parse(layers.output))) {
          // Concatenated arguments ensure the trigger cannot appear in the echoed input command.
          // sync runs before the marker, pairing the mmap disk with the RAM page cache.
          child.stdin.write("sync && printf '\\n%s%s\\n' 'WVM_OMARCHY_DESKTOP_' 'READY'\r");
          const result = await exit;
          assert.equal(result.code, 0, `capture exit: ${JSON.stringify(result)}`);
          process.exitCode = 0;
          break;
        }
      }
    }
    // Polls are deliberately sparse: compositor startup, not diagnostic forks, owns the CPU.
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (!exited) throw new Error("Omarchy desktop capture exceeded its deadline");
} catch (error) {
  child.kill("SIGTERM");
  console.error(error.stack || error);
  process.exitCode = 1;
}
