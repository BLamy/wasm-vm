#!/usr/bin/env node

// E5-T16c: drive the real Alpine riscv64 Weston/pixman guest through the candidate-neutral T16a
// protocol. The serial script controls guest lifecycle; the native CLI injects the exact
// keyboard/tablet frames and samples the core/GPU counters at guest-emitted phase boundaries.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  WORKLOAD_SCHEMA,
  buildWorkloadPlan,
  planSha256,
  stableStringify,
} from "./display-server-workload.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const image = path.resolve(process.env.E5_T16A_IMAGE || "");
const evidenceDir = path.join(repo, process.env.E5_T16C_EVIDENCE_DIR || "evidence/e5-t16c");
const manifest = path.join(path.dirname(image), "MANIFEST.txt");
const fileManifest = path.join(path.dirname(image), "FILE-MANIFEST.txt");
// Match the shared harness bound. Cold Alpine boots can exceed 15 minutes before login on the
// reference machine, while this remains a finite proof window.
const timeoutMs = 30 * 60 * 1_000;

const planInput = await readStdin();
const plan = JSON.parse(planInput);
assert.equal(stableStringify(plan), stableStringify(buildWorkloadPlan()), "driver received a non-canonical T16a plan");
assert.equal(process.env.E5_T16A_PLAN_SHA256, planSha256(), "harness plan digest was not propagated");
assert.ok(image.length > 0, "harness did not provide E5_T16A_IMAGE");
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
// The harness owns the input digest and computes it before the guest can mutate the ext4 image.
// Keep that pre-run binding in the driver summary; the post-run image is useful diagnostics only.
const inputImageDigest = await sha256File(image);

const stdoutPath = path.join(evidenceDir, "weston-console.log");
const stderrPath = path.join(evidenceDir, "weston-stderr.log");
const guestEvidencePath = path.join(evidenceDir, "weston-guest-evidence.txt");
const gpuTracePath = path.join(evidenceDir, "weston-gpu-trace.log");
const runSummaryPath = path.join(evidenceDir, "weston-run.json");

// Marker text is assembled from adjacent shell words. The command echo cannot contain a complete
// marker and fool the native observer before the guest actually executes printf.
const guestScript = String.raw`m() {
  rss=0
  for p in $$ $(pidof weston foot 2>/dev/null); do
    h=$(awk '$1 == "VmHWM:" {print $2 * 1024; exit}' /proc/$p/status 2>/dev/null)
    case "$h" in ''|*[!0-9]*) h=0;; esac
    [ "$h" -gt "$rss" ] && rss=$h
  done
  interrupts=$(awk 'NR > 1 { for (i=2; i<=NF; i++) if ($i ~ /^[0-9]+$/) total += $i } END { print total + 0 }' /proc/interrupts)
  printf 'E5T16C_''METRIC phase=%s rss=%s interrupts=%s\n' "$1" "$rss" "$interrupts"
  printf 'E5T16A_''%s_DONE\n' "$1"
}
m COLD_START
sleep 1
m IDLE
export XDG_RUNTIME_DIR=/run/user/1000
export WAYLAND_DISPLAY=wayland-0
e5-t16c-start-weston >/tmp/weston.log 2>&1 &
weston_job=$!
sleep 5
printf 'E5T16C_''WESTON_LOG_EARLY_BEGIN\n'
cat /tmp/weston.log 2>/dev/null
printf 'E5T16C_''WESTON_LOG_EARLY_END\n'
if pidof weston >/dev/null 2>&1; then printf 'E5T16C_''WESTON_STARTED=1\n'; else printf 'E5T16C_''WESTON_STARTED=0\n'; fi
e5-t16c-open-terminal >/tmp/foot.log 2>&1 &
foot_job=$!
sleep 5
printf 'E5T16C_''FOOT_LOG_EARLY_BEGIN\n'
cat /tmp/foot.log 2>/dev/null
printf 'E5T16C_''FOOT_LOG_EARLY_END\n'
if pidof foot >/dev/null 2>&1; then printf 'E5T16C_''FOOT_STARTED=1\n'; else printf 'E5T16C_''FOOT_STARTED=0\n'; fi
m OPEN_TERMINAL
sleep 5
m TYPE_100
sleep 2
m DRAG_300
sleep 2
for p in $(pidof foot 2>/dev/null); do kill "$p" 2>/dev/null; done
sleep 2
if pidof foot >/dev/null 2>&1; then printf 'E5T16C_''APP_EXITED=0\n'; else printf 'E5T16C_''APP_EXITED=1\n'; fi
for p in $(pidof weston 2>/dev/null); do kill "$p" 2>/dev/null; done
sleep 2
if pidof weston >/dev/null 2>&1; then printf 'E5T16C_''WM_EXITED=0\n'; else printf 'E5T16C_''WM_EXITED=1\n'; fi
printf 'E5T16C_''WESTON_LOG_BEGIN\n'
cat /tmp/weston.log 2>/dev/null
printf 'E5T16C_''WESTON_LOG_END\n'
printf 'E5T16C_''FOOT_LOG_BEGIN\n'
cat /tmp/foot.log 2>/dev/null
printf 'E5T16C_''FOOT_LOG_END\n'
m CLOSE
sleep 2
poweroff -f
`;

await mkdir(evidenceDir, { recursive: true });
const stdoutLog = createWriteStream(stdoutPath);
const stderrLog = createWriteStream(stderrPath);
const child = spawn(cli, [
  "boot",
  "--kernel", kernel,
  "--drive", `file=${image}`,
  "--net",
  "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
  "--gpu-trace", gpuTracePath,
  "--evidence", guestEvidencePath,
  "--display-workload",
  "--no-reboot",
  "--max-instrs", "40000000000",
  "--quantum", "200000",
], {
  cwd: repo,
  env: {
    ...process.env,
    E5_T16_DISPLAY_COMPOSITOR: "weston",
    E5_T16C_TYPING_TEXT: plan.terminal.typingText,
    E5_T16C_TYPING_TEXT_SHA256: plan.terminal.typingTextSha256,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let loginSent = false;
let scriptSent = false;
let timedOut = false;
const append = (current, chunk) => `${current}${chunk.toString("utf8")}`.slice(-4_000_000);
child.stdout.on("data", (chunk) => {
  stdout = append(stdout, chunk);
  stdoutLog.write(chunk);
  if (!loginSent && stdout.includes("wasm-vm login:")) {
    loginSent = true;
    child.stdin.write("root\n");
  }
  if (loginSent && !scriptSent && stdout.includes("wasm-vm:~#")) {
    scriptSent = true;
    child.stdin.write(guestScript);
  }
});
child.stderr.on("data", (chunk) => {
  stderr = append(stderr, chunk);
  stderrLog.write(chunk);
});
const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, timeoutMs);
const exit = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
clearTimeout(timer);
stdoutLog.end();
stderrLog.end();
await Promise.all([
  new Promise((resolve) => stdoutLog.once("finish", resolve)),
  new Promise((resolve) => stderrLog.once("finish", resolve)),
]);

assert.equal(timedOut, false, "weston workload exceeded its bounded timeout");
assert.deepEqual(exit, { code: 0, signal: null }, `native weston run failed: ${stderr.slice(-2_000)}`);
assert.equal(loginSent, true, "native workload never reached the Alpine login prompt");
assert.equal(scriptSent, true, "native workload never reached the Alpine shell prompt");
assert.match(stdout, /E5T16C_WESTON_STARTED=1/u, "weston did not stay running after launch");
assert.match(stdout, /E5T16C_FOOT_STARTED=1/u, "foot did not stay running after launch");
assert.match(stdout, /E5T16C_APP_EXITED=1/u, "foot did not exit during close");
assert.match(stdout, /E5T16C_WM_EXITED=1/u, "weston did not exit during close");
assert.match(stdout, /E5T16C_LAUNCH weston --backend=drm --renderer=pixman/u, "pixman/DRM launch proof is missing");
assert.match(stdout, /Using Pixman renderer/u, "weston's runtime log did not prove pixman was active");
assert.doesNotMatch(stdout, /--renderer=(?:auto|gl|gles2|gl2|vulkan)/u, "a non-pixman renderer appeared in the finalist run");
assert.doesNotMatch(stdout, /Using GL renderer/u, "weston selected its GL renderer");
assert.match(stdout, /E5T16C_WESTON_LOG_BEGIN/u);
assert.match(stdout, /E5T16C_FOOT_LOG_BEGIN/u);
assert.match(stdout, /reboot: Power down/u, "guest did not reach the kernel power-down line");

const captureMatch = stderr.match(/^E5T16C_CAPTURE_JSON (\{.*\})$/mu);
assert.ok(captureMatch, "native CLI did not emit a T16c capture");
const native = JSON.parse(captureMatch[1]);
assert.ok(Array.isArray(native.phases) && native.phases.length === 6, "native capture is missing phases");
assert.equal(native.observations.errors.length, 0);
assert.ok(Number.isSafeInteger(native.observations.cursorqEvents));
if (native.observations.cursorqEvents === 0) {
  assert.match(native.observations.cursorqStatus, /^capability-gap:/u);
}
const typing = native.phases.find((phase) => phase.id === "type-100");
assert.equal(typing.details.characters, 100);
assert.equal(typing.details.frames, 200);
assert.equal(typing.details.rejectedEvents, 0);
const drag = native.phases.find((phase) => phase.id === "drag-300");
assert.deepEqual(
  { axis: drag.details.axis, deltaPx: drag.details.deltaPx, steps: drag.details.steps },
  { axis: "x", deltaPx: 300, steps: 30 },
);
assert.equal(drag.details.frames, 32);
assert.equal(drag.details.rejectedEvents, 0);
assert.ok(typing.end.uploadedBytes >= typing.start.uploadedBytes, "typing upload counter regressed");

const guestEvidence = await readFile(guestEvidencePath, "utf8");
const retired = guestEvidence.match(/^trace retired=(\d+)$/mu);
assert.ok(retired && Number(retired[1]) > 0, "guest evidence has no retired-instruction count");
assert.match(guestEvidence, /^outcome=Exited\(0\)$/mu, "guest evidence did not record a clean SBI poweroff");
const trace = await readFile(gpuTracePath, "utf8");
assert.match(trace, /^wasm-vm virtio-gpu command trace v1$/mu);
assert.match(trace, /^records=\d+ dropped=0$/mu);

const postRunImageDigest = await sha256File(image);
const result = {
  schema: WORKLOAD_SCHEMA,
  task: "E5-T16a",
  environment: "emulator",
  architecture: "riscv64",
  candidate: {
    id: "weston-pixman",
    server: "drm",
    wm: "weston",
    terminal: "foot",
    renderer: "pixman",
    clipboard: "wl-clipboard",
  },
  image: { id: path.basename(image), sha256: inputImageDigest },
  sources: {
    guestInstructions: "guest-e4-minstret",
    uploadedBytes: "guest-t09-vm-stats-gpu-bytesUploaded",
    peakRssBytes: "guest-proc-status-vmHWM",
    idleWakeups: "guest-proc-interrupts-idle-delta",
    cursorqEvents: "guest-virtio-gpu-cursorq-trace",
  },
  plan,
  ...native,
};

await writeFile(runSummaryPath, `${JSON.stringify({
  task: "E5-T16c",
  command: "tools/run-weston-pixman.mjs",
  image: result.image,
  imagePostRun: { id: path.basename(image), sha256: postRunImageDigest },
  imageManifest: {
    packagePath: path.relative(repo, manifest),
    packageSha256: await sha256File(manifest),
    filePath: path.relative(repo, fileManifest),
    fileSha256: await sha256File(fileManifest),
  },
  renderer: { backend: "drm", renderer: "pixman", log: "E5T16C_LAUNCH + Using Pixman renderer" },
  guestEvidence: { path: path.relative(repo, guestEvidencePath), sha256: await sha256File(guestEvidencePath) },
  gpuTrace: { path: path.relative(repo, gpuTracePath), sha256: await sha256File(gpuTracePath) },
  console: { path: path.relative(repo, stdoutPath), sha256: await sha256File(stdoutPath) },
  stderr: { path: path.relative(repo, stderrPath), sha256: await sha256File(stderrPath) },
  capture: result,
}, null, 2)}\n`);

// runDriver owns the final image digest and schema normalization. The driver emits only this one
// JSON document on stdout; diagnostics are kept in the replayable evidence files above.
process.stdout.write(JSON.stringify(result));

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk.toString();
  return value.trim();
}
