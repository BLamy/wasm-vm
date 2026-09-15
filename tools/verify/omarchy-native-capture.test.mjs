// E5.5-T03f harness-only tests. These spawn a synthetic Node CLI and make no
// claim about a real guest, renderer, desktop, or native capture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(repo, "tools/verify/omarchy-native-capture.mjs");
const testTimeoutMs = 999;

// The fake CLI implements only the serial probe protocol consumed by the
// helper. Its process/environment/thread outputs are deliberately synthetic.
const fakeCli = String.raw`
const fs = require("node:fs");
const log = process.env.FAKE_LOG;
const pid = process.env.FAKE_PID || "123";
const renderer = process.env.FAKE_RENDERER || "softpipe";
const lpThreads = process.env.FAKE_LP_NUM_THREADS || "";
const threads = process.env.FAKE_THREADS || "Hyprland\nrender-worker";
const mode = process.env.FAKE_MODE || "valid";
const record = (value) => fs.appendFileSync(log, value.replaceAll("\n", "\\n") + "\n");
const prompt = () => process.stdout.write("[omarchy@omarchy-demo ~]$ ");
const reply = (token, status, output) => {
  process.stdout.write("\n" + token + "_begin\n" + output + "\n" + token + "_end:" + status + "\n");
  prompt();
};
process.stdout.write("[omarchy@omarchy-demo ~]$ ");
let input = "";
process.stdin.on("data", (bytes) => {
  input += bytes.toString("utf8");
  let split;
  while ((split = input.indexOf("\r")) >= 0) {
    const command = input.slice(0, split);
    input = input.slice(split + 1);
    record(command);
    if (command.includes("sync && printf")
      && command.includes("WVM_OMARCHY_DESKTOP_") && command.includes("'READY'")) process.exit(0);
    const match = command.match(/(capture_[0-9]+)_begin/);
    if (!match) continue;
    const token = match[1];
    let output = "";
    if (command.includes("id -u")) {
      output = "1000";
      setTimeout(() => {
        reply(token, 0, output);
      }, 5);
      continue;
    }
    else if (command.includes("hyprctl -j instances")) {
      output = JSON.stringify([{ instance: "main", pid: /^[0-9]+$/.test(pid) ? Number(pid) : pid }]);
    }
    else if (command.includes("-j clients")) {
      output = JSON.stringify([{ class: "foot", mapped: true, hidden: false, pid: 456,
        address: "0xabc", size: [100, 100] }]);
    } else if (command.includes("-j layers")) {
      output = JSON.stringify({ layers: [
        { namespace: "omarchy-bar", w: 1, h: 1, pid: 222 },
        { namespace: "omarchy-background", w: 1, h: 1, pid: 222 },
      ] });
    } else if (command.includes("ps -u 1000")) {
      output = "222 quickshell /usr/bin/quickshell --path=/usr/share/omarchy/shell";
    } else if (command.includes("/proc/") && command.includes("environ")) {
      output = "GALLIUM_DRIVER=" + renderer + "\nLIBGL_ALWAYS_SOFTWARE=1" + (lpThreads ? "\nLP_NUM_THREADS=" + lpThreads : "");
    } else if (command.includes("ps -T -p")) output = threads;
    else if (command.includes("hyprland.log")) output = "GL_RENDERER: synthetic-" + renderer;
    setTimeout(() => reply(token, 0, output), 5);
  }
});
if (mode === "malicious-pid") setTimeout(() => process.exit(0), 250);
`;

async function withTempDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5-t03f-capture-"));
  try {
    return await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function runHelper(directory, overrides = {}, { killAfterMs = null } = {}) {
  const log = path.join(directory, `${overrides.FAKE_MODE || "run"}.log`);
  const child = spawn(process.execPath, [helper, process.execPath, "-e", fakeCli], {
    cwd: repo,
    env: { ...process.env, OMARCHY_CAPTURE_TIMEOUT_MS: String(testTimeoutMs), FAKE_LOG: log, ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", bytes => { stdout += bytes; });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const close = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr, log })));
  if (killAfterMs !== null) {
    const timer = setTimeout(() => child.kill("SIGTERM"), killAfterMs);
    child.once("close", () => clearTimeout(timer));
  }
  return close;
}

test("invalid expectedRenderer is rejected before the fake CLI is spawned", async () => {
  await withTempDirectory(async directory => {
    const result = await runHelper(directory, { OMARCHY_EXPECT_RENDERER: "mesa-evil" });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /mesa-evil/u);
    await assert.rejects(() => fs.access(result.log), { code: "ENOENT" });
  });
});

test("valid synthetic softpipe instance exercises environment and thread probes", async () => {
  await withTempDirectory(async directory => {
    const result = await runHelper(directory, { OMARCHY_EXPECT_RENDERER: "softpipe" });
    const commands = await fs.readFile(result.log, "utf8");
    assert.equal(result.code, 0, `${result.stderr}\nstdout:\n${result.stdout}\ncommands:\n${commands}`);
    assert.match(result.stdout, /OMARCHY_DESKTOP_OBSERVATION/u);
    assert.match(result.stdout, /OMARCHY_RENDERER_OBSERVATION/u);
    assert.match(result.stdout, /GALLIUM_DRIVER=softpipe/u);
    assert.match(commands, /\/proc\/123\/environ/u);
    assert.match(commands, /ps -T -p 123/u);
    assert.match(commands, /hyprland\.log/u);
    assert.match(commands, /sync && printf/u);
    assert.match(commands, /WVM_OMARCHY_DESKTOP_/u);
    assert.match(commands, /'READY'/u);
    assert.doesNotMatch(commands, /WVM_OMARCHY_DESKTOP_READY/u);
  });
});

test("requested softpipe rejects a synthetic llvmpipe thread", async () => {
  await withTempDirectory(async directory => {
    const result = await runHelper(directory, {
      OMARCHY_EXPECT_RENDERER: "softpipe",
      FAKE_THREADS: "Hyprland\nllvmpipe-0",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /llvmpipe/u);
  });
});

test("explicit LP0 validates the same synthetic PID environment before snapshot", async () => {
  await withTempDirectory(async directory => {
    const result = await runHelper(directory, {
      OMARCHY_EXPECT_LP_NUM_THREADS: "0",
      FAKE_RENDERER: "llvmpipe",
      FAKE_LP_NUM_THREADS: "0",
    });
    const commands = await fs.readFile(result.log, "utf8");
    assert.equal(result.code, 0, `${result.stderr}\nstdout:\n${result.stdout}`);
    assert.match(result.stdout, /"expectedLpNumThreads":"0"/u);
    assert.match(result.stdout, /"configurationObserved":"lp0-configuration-observed"/u);
    assert.match(commands, /\/proc\/123\/environ/u);
    assert.match(commands, /LP_NUM_THREADS/u);
    assert.match(commands, /sync && printf/u);
  });
});

test("malicious PID is rejected before any PID-derived command is sent", async () => {
  await withTempDirectory(async directory => {
    const result = await runHelper(directory, {
      FAKE_MODE: "malicious-pid",
      FAKE_PID: "123; touch /tmp/e5-t03f-pwned",
    }, { killAfterMs: testTimeoutMs });
    const commands = await fs.readFile(result.log, "utf8");
    assert.doesNotMatch(commands, /hyprctl -i/u);
    assert.doesNotMatch(commands, /\/proc\//u);
  });
});
