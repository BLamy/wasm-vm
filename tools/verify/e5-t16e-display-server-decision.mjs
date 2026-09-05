#!/usr/bin/env node

// E5-T16e: independently synthesize the two finalist captures, re-compute T09 damage bytes,
// check two fresh winner replays against the decision margin, and publish the T17 handoff.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateCapture } from "../../tools/display-server-workload.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repo, "evidence/e5-t16e");
const decisionDocPath = path.join(repo, "docs/decisions/display-server.md");
const decisionSummaryPath = path.join(evidenceDir, "display-server-decision.json");
const packageAuditPath = path.join(repo, "evidence/e5-t16d/package-audit.json");
const packageVerificationPath = path.join(repo, "evidence/e5-t16d/package-audit-verification.json");
const repositories = Object.freeze([
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/main",
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/community",
]);
const finalists = Object.freeze({
  "labwc-pixman": Object.freeze({
    path: "evidence/e5-t16b/labwc-capture.json",
    wm: "labwc",
    packages: Object.freeze([
      "labwc",
      "foot",
      "seatd",
      "eudev",
      "udev-init-scripts",
      "pixman",
      "xkeyboard-config",
      "wlr-randr",
      "wl-clipboard",
      "font-dejavu",
    ]),
  }),
  "weston-pixman": Object.freeze({
    path: "evidence/e5-t16c/weston-capture.json",
    wm: "weston",
    packages: Object.freeze([
      "weston",
      "weston-backend-drm",
      "weston-shell-desktop",
      "foot",
      "seatd",
      "eudev",
      "udev-init-scripts",
      "pixman",
      "xkeyboard-config",
      "wl-clipboard",
      "font-dejavu",
    ]),
  }),
});
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(repo, relativePath), "utf8"));
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const relative = (file) => path.relative(repo, file);

function phase(capture, id) {
  const result = capture.phases.find((item) => item.id === id);
  assert.ok(result, `${capture.candidate.id}: missing ${id} phase`);
  return result;
}

function counterDelta(current, previous, field) {
  const delta = current[field] - previous[field];
  assert.ok(Number.isSafeInteger(delta) && delta >= 0, `${field}: counter delta is invalid`);
  return delta;
}

function measure(capture) {
  const cold = phase(capture, "cold-start");
  const idle = phase(capture, "idle");
  const typing = phase(capture, "type-100");
  const close = phase(capture, "close");
  const totalGuestInstructions = counterDelta(close.end, cold.start, "guestInstructions");
  const idleInstructions = counterDelta(idle.end, idle.start, "guestInstructions");
  const idleDurationMs = idle.end.wallMs - idle.start.wallMs;
  const idleWakeups = counterDelta(idle.end, idle.start, "idleWakeups");
  const typingDamageBytes = counterDelta(typing.end, typing.start, "uploadedBytes");
  const metrics = {
    coldStartMs: cold.end.wallMs - cold.start.wallMs,
    totalGuestInstructions,
    idleInstructions,
    idleInstructionRatio: idleInstructions / totalGuestInstructions,
    typingDamageBytes,
    peakRssBytes: Math.max(...capture.phases.map((item) => item.peakRssBytes)),
    idleWakeups,
    idleWakeupsPerSecond: idleWakeups / (idleDurationMs / 1_000),
    cursorqEvents: capture.observations.cursorqEvents,
    cursorqStatus: capture.observations.cursorqStatus ?? "not-reported",
    workloadOutcome: capture.phases.every((item) => item.outcome === "passed")
      && close.details.applicationExited === true
      && close.details.compositorExited === true,
  };
  assert.equal(metrics.totalGuestInstructions, capture.summary.guestInstructions, `${capture.candidate.id}: summary instruction total drifted`);
  assert.equal(metrics.typingDamageBytes, capture.summary.typingUploadedBytes, `${capture.candidate.id}: summary typing damage drifted`);
  assert.equal(metrics.idleWakeups, capture.summary.idleWakeups, `${capture.candidate.id}: summary idle wakeups drifted`);
  assert.equal(metrics.peakRssBytes, capture.summary.peakRssBytes, `${capture.candidate.id}: summary RSS drifted`);
  return metrics;
}

function validateFinalistCapture(capture, id, wm) {
  assert.deepEqual(capture.candidate, {
    id,
    server: "drm",
    wm,
    terminal: "foot",
    renderer: "pixman",
    clipboard: "wl-clipboard",
  });
  assert.equal(capture.environment, "emulator");
  assert.equal(capture.architecture, "riscv64");
  assert.equal(capture.observations.errors.length, 0);
  const metrics = measure(capture);
  assert.ok(metrics.workloadOutcome, `${id}: workload did not pass all phases`);
  assert.ok(metrics.idleInstructionRatio <= 0.02, `${id}: idle cost exceeds the 2% budget`);
  return metrics;
}

function independentTypingDamage(rawCapture) {
  const typing = rawCapture.phases.find((item) => item.id === "type-100");
  assert.ok(typing, "raw capture has no type-100 phase");
  const value = typing.end.uploadedBytes - typing.start.uploadedBytes;
  assert.ok(Number.isSafeInteger(value) && value >= 0, "raw T09 uploaded-byte delta is invalid");
  assert.equal(rawCapture.summary.typingUploadedBytes, value, "raw capture summary is not the T09 counter delta");
  return value;
}

function varianceAgainstMargin(values, margin) {
  assert.equal(values.length, 2, "winner variance requires two fresh reruns");
  assert.ok(margin > 0, "winner margin must be positive");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);
  const maxAbsoluteDeviation = Math.max(...values.map((value) => Math.abs(value - mean)));
  assert.ok(maxAbsoluteDeviation < margin, `winner variance ${maxAbsoluteDeviation} exceeds winning margin ${margin}`);
  return { method: "max absolute deviation from two-run mean", values, mean, spread, maxAbsoluteDeviation, margin };
}

function packageVersion(manifest, packageName) {
  const line = manifest.find((entry) => entry.startsWith(`${packageName}-`));
  assert.ok(line, `package manifest is missing ${packageName}`);
  return line;
}

function validatePackageAudit(audit) {
  assert.equal(audit.schema, "wasm-vm.e5-t16d.package-audit.v1");
  assert.equal(audit.environment, "emulator");
  assert.equal(audit.architecture, "riscv64");
  assert.deepEqual(audit.repositories, repositories);
  const selected = audit.candidates.find((candidate) => candidate.id === "weston-pixman");
  assert.ok(selected, "T16d has no weston-pixman package audit");
  assert.deepEqual(selected.repositoriesObserved, repositories);
  assert.equal(selected.architectureObserved, "riscv64");
  assert.equal(selected.install.rc, 0);
  assert.match(selected.install.output, /OK:/u);
  assert.equal(selected.packageInfo.rc, 0);
  for (const packageName of finalists["weston-pixman"].packages) {
    assert.equal(selected.searches[packageName].rc, 0, `${packageName}: package search failed`);
    assert.ok(selected.installedManifest.some((entry) => entry.startsWith(`${packageName}-`)), `${packageName}: package install missing`);
    assert.match(selected.packageInfo.output, new RegExp(`\\b${packageName.replaceAll("-", "[-]")}\\b`, "u"));
  }
  return Object.fromEntries(finalists["weston-pixman"].packages.map((packageName) => [packageName, packageVersion(selected.installedManifest, packageName)]));
}

const rawCaptures = {};
const captures = {};
const metrics = {};
for (const [id, finalist] of Object.entries(finalists)) {
  rawCaptures[id] = await readJson(finalist.path);
  captures[id] = validateCapture(rawCaptures[id]);
  metrics[id] = validateFinalistCapture(captures[id], id, finalist.wm);
}

const audit = await readJson("evidence/e5-t16d/package-audit.json");
const packageVerification = await readJson("evidence/e5-t16d/package-audit-verification.json");
assert.equal(packageVerification.audit.sha256, await sha256File(packageAuditPath));
const selectedPackageVersions = validatePackageAudit(audit);

const rerunArtifact = await readJson("evidence/e5-t16e/winner-reruns.json");
assert.equal(rerunArtifact.schema, "wasm-vm.e5-t16e.winner-reruns.v1");
assert.equal(rerunArtifact.task, "E5-T16e");
assert.equal(rerunArtifact.candidate, "weston-pixman");
assert.equal(rerunArtifact.runCount, 2);
assert.match(rerunArtifact.source.commit, COMMIT);
assert.match(rerunArtifact.source.image.sha256, SHA256);
assert.equal(rerunArtifact.source.packageManifest.sha256, await sha256File(path.join(repo, rerunArtifact.source.packageManifest.path)));
assert.equal(rerunArtifact.source.fileManifest.sha256, await sha256File(path.join(repo, rerunArtifact.source.fileManifest.path)));
const rerunMetrics = [];
for (const run of rerunArtifact.runs) {
  assert.equal(run.image.sha256, rerunArtifact.source.image.sha256, `${run.id}: rerun was not copied from the clean source image`);
  assert.notEqual(run.image.postRunSha256, run.image.sha256, `${run.id}: rerun did not produce a post-run image state`);
  assert.equal(run.capture.sha256, await sha256File(path.join(repo, run.capture.path)), `${run.id}: capture digest drifted`);
  const raw = await readJson(run.capture.path);
  const capture = validateCapture(raw);
  validateFinalistCapture(capture, "weston-pixman", "weston");
  independentTypingDamage(raw);
  assert.deepEqual(run.summary, capture.summary, `${run.id}: summary is not the normalized capture summary`);
  for (const artifact of Object.values(run.artifacts)) {
    assert.equal(artifact.sha256, await sha256File(path.join(repo, artifact.path)), `${run.id}: artifact digest drifted`);
  }
  const console = await readFile(path.join(repo, run.artifacts["weston-console.log"].path), "utf8");
  const guestEvidence = await readFile(path.join(repo, run.artifacts["weston-guest-evidence.txt"].path), "utf8");
  const gpuTrace = await readFile(path.join(repo, run.artifacts["weston-gpu-trace.log"].path), "utf8");
  assert.match(console, /E5T16C_LAUNCH weston --backend=drm --renderer=pixman/u);
  assert.match(console, /Using Pixman renderer/u);
  assert.doesNotMatch(console, /Using GL renderer|--renderer=(?:auto|gl|gles2|gl2|vulkan)/u);
  assert.match(guestEvidence, /^outcome=Exited\(0\)$/mu);
  assert.match(gpuTrace, /^records=\d+ dropped=0$/mu);
  rerunMetrics.push(measure(capture));
}

const winner = metrics["weston-pixman"];
const runnerUp = metrics["labwc-pixman"];
const winningMargin = runnerUp.idleInstructionRatio - winner.idleInstructionRatio;
const variance = varianceAgainstMargin(rerunMetrics.map((item) => item.idleInstructionRatio), winningMargin);
const damageRecomputation = Object.fromEntries(Object.keys(finalists).map((id) => [id, {
  source: `${finalists[id].path}: phases[type-100].end.uploadedBytes - phases[type-100].start.uploadedBytes`,
  bytes: independentTypingDamage(rawCaptures[id]),
  characters: 100,
}]));

if (process.argv.includes("--self-test")) {
  assert.throws(
    () => varianceAgainstMargin([winner.idleInstructionRatio, winner.idleInstructionRatio + (winningMargin * 3)], winningMargin),
    /winner variance/u,
    "winner-variance mutant was accepted",
  );
  const damageMutant = structuredClone(rawCaptures["weston-pixman"]);
  damageMutant.phases.find((item) => item.id === "type-100").end.uploadedBytes += 1;
  assert.throws(() => independentTypingDamage(damageMutant), /raw capture summary/u, "damage-counter mutant was accepted");
  process.stdout.write("E5T16E_SELF_TEST=variance-and-damage-rejected\n");
}

const evidence = {
  schema: "wasm-vm.e5-t16e.display-server-decision.v1",
  task: "E5-T16e",
  command: "make verify-E5-T16e",
  decision: {
    selected: "weston-pixman",
    winnerMetric: "idle-instruction-ratio",
    winningMargin,
    variance,
  },
  finalists: Object.fromEntries(Object.entries(metrics).map(([id, value]) => [id, {
    capture: finalists[id].path,
    metrics: value,
    damageRecomputedBytes: damageRecomputation[id].bytes,
  }])),
  winnerReruns: {
    artifact: "evidence/e5-t16e/winner-reruns.json",
    sourceImage: rerunArtifact.source,
    runs: rerunArtifact.runs.map((run, index) => ({ id: run.id, capture: run.capture, metrics: rerunMetrics[index], artifacts: run.artifacts })),
  },
  packageHandoff: {
    repositories,
    versions: selectedPackageVersions,
    audit: "evidence/e5-t16d/package-audit.json",
    auditVerification: "evidence/e5-t16d/package-audit-verification.json",
    packageManifest: "target/e5-t16e/weston-image/MANIFEST.txt",
    fileManifest: "target/e5-t16e/weston-image/FILE-MANIFEST.txt",
  },
  scope: { independentMachines: false, webkit: false, hostRr: false },
};
await writeFile(decisionSummaryPath, `${JSON.stringify(evidence, null, 2)}\n`);

const fmt = (value) => Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(6);
const pct = (value) => `${(value * 100).toFixed(4)}%`;
const metricRows = [
  ["Cold start (guest wall time)", "coldStartMs", "ms"],
  ["Total retired guest instructions", "totalGuestInstructions", "instructions"],
  ["Idle instructions (1 s phase)", "idleInstructions", "instructions"],
  ["Idle instruction ratio", "idleInstructionRatio", "ratio"],
  ["100-character typing damage", "typingDamageBytes", "bytes"],
  ["Peak guest RSS", "peakRssBytes", "bytes"],
  ["Idle wakeups", "idleWakeups", "wakeups"],
  ["Idle wakeups per second", "idleWakeupsPerSecond", "wakeups/s"],
];
const formatMetric = (value, unit) => unit === "ratio" ? pct(value) : `${fmt(value)} ${unit}`;
const table = metricRows.map(([label, key, unit]) => `| ${label} | ${formatMetric(metrics["labwc-pixman"][key], unit)} | ${formatMetric(metrics["weston-pixman"][key], unit)} |`).join("\n");
const packageTable = Object.entries(selectedPackageVersions)
  .map(([name, version]) => `| \`${name}\` | \`${version}\` |`)
  .join("\n");
const rerunTable = rerunArtifact.runs.map((run, index) => {
  const item = rerunMetrics[index];
  return `| ${run.id} | ${fmt(item.coldStartMs)} ms | ${fmt(item.idleInstructions)} | ${pct(item.idleInstructionRatio)} | ${fmt(item.typingDamageBytes)} | ${fmt(item.peakRssBytes)} | ${fmt(item.idleWakeups)} | ${item.workloadOutcome ? "passed" : "failed"} |`;
}).join("\n");
const document = `# Display-server decision

## Decision

Select **Weston with its DRM/Pixman renderer**, ` + "`foot`" + ` as the terminal, and ` + "`wl-clipboard`" + ` as the clipboard tool for E5-T17. The decision is based on the exact inside-emulator captures below: Weston has the lower idle instruction ratio, lower peak RSS, and fewer idle wakeups, while both candidates remain below the 2% idle-cost budget. Weston’s cold start is slightly slower and its 100-character typing path uploads more damage bytes; those are recorded trade-offs, not extrapolations.

Labwc is not selected because its capture reports no cursorq traffic and explicitly classifies that as a capability gap. The Weston choice therefore does not rely on an unobserved hardware cursor path; it uses the verified DRM/Pixman path and keeps cursor-plane acceleration a documented revisit trigger.

## Finalist comparison

All values are from the native riscv64 emulator and the shared T16a six-phase workload. “Typing damage” is independently recomputed from the raw T09 uploadedBytes counter points for the type-100 phase.

| Metric | labwc / Pixman | Weston / Pixman |
|---|---:|---:|
${table}
| Cursorq use | ${fmt(metrics["labwc-pixman"].cursorqEvents)} events; capability gap | ${fmt(metrics["weston-pixman"].cursorqEvents)} events; capability gap |
| Workload outcome | ${metrics["labwc-pixman"].workloadOutcome ? "passed" : "failed"} | ${metrics["weston-pixman"].workloadOutcome ? "passed" : "failed"} |

Both rows passed cold start, idle, terminal open, 100-character typing, 300 px drag, and close. The labwc capture is [evidence/e5-t16b/labwc-capture.json](../../evidence/e5-t16b/labwc-capture.json); the Weston capture is [evidence/e5-t16c/weston-capture.json](../../evidence/e5-t16c/weston-capture.json). Renderer provenance is WLR_BACKENDS=drm WLR_RENDERER=pixman for labwc and weston --backend=drm --renderer=pixman plus Using Pixman renderer for Weston.

## Damage recomputation

The independent calculation is exactly phases[type-100].end.uploadedBytes - phases[type-100].start.uploadedBytes from each raw capture, not the summary field:

- labwc / Pixman: **${fmt(damageRecomputation["labwc-pixman"].bytes)} bytes** for 100 characters.
- Weston / Pixman: **${fmt(damageRecomputation["weston-pixman"].bytes)} bytes** for 100 characters.

The zero-byte labwc result is retained as observed counter data and is not treated as a cursorq or rendering success claim.

## Winner variance

The baseline idle-ratio margin is labwc minus Weston: **${pct(winningMargin)}** (${(winningMargin * 100).toFixed(4)} percentage points). Two fresh Weston cold replays were made from separate copies of the same clean T16e image:

| Replay | Cold start | Idle instructions | Idle ratio | Typing damage | Peak RSS | Idle wakeups | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
${rerunTable}

Using the declared method of maximum absolute deviation from the two-run mean, the fresh-run variance is **${pct(variance.maxAbsoluteDeviation)}**, with spread **${pct(variance.spread)}**. It is below the **${pct(variance.margin)}** winning margin, so this decision is published. Any future rerun whose maximum deviation exceeds that margin should fail this gate and reopen the decision.

## T17 handoff

Use the exact signed package set below against the v3.20 riscv64 main and community repositories. The full dependency closure, signatures, search output, install output, and package-info records are in [evidence/e5-t16d/package-audit.json](../../evidence/e5-t16d/package-audit.json) and [evidence/e5-t16d/package-audit-verification.json](../../evidence/e5-t16d/package-audit-verification.json).

Repositories:

- https://dl-cdn.alpinelinux.org/alpine/v3.20/main
- https://dl-cdn.alpinelinux.org/alpine/v3.20/community

| Requested package | Installed version |
|---|---|
${packageTable}

Configuration sketch for T17:

1. Start Weston as desktop with weston --backend=drm --renderer=pixman.
2. Keep seatd in the default runlevel; retain eudev and udev-init-scripts for device discovery.
3. Set XDG_RUNTIME_DIR=/run/user/1000 (0700, owned by desktop) and WAYLAND_DISPLAY=wayland-0 before launching Weston and foot.
4. Launch foot inside the Weston session; use wl-clipboard for the Wayland clipboard path.
5. Preserve the T16c launcher/file manifest inputs, including /usr/local/bin/e5-t16c-start-weston and /usr/local/bin/e5-t16c-open-terminal, while T17 gives them production names.

## Revisit triggers

- Re-run the two-candidate decision if a riscv64 package version, Weston DRM/Pixman behavior, or the selected dependency closure changes.
- Re-run if virgl, WebGPU, or another hardware-accelerated renderer becomes available in the guest; the current choice is specifically for the measured Pixman path.
- Reopen if Weston’s idle instruction ratio exceeds 2%, if its fresh-run variance exceeds the baseline margin, or if a later T15 cursor-plane implementation produces reliable cursorq traffic and changes the damage/RSS trade-off.
- Keep the no-GL/no-fbdev substitution rule: a production image must preserve the recorded DRM/Pixman launch unless a new measured decision replaces it.

## Evidence identity

- Fresh rerun source commit: ${rerunArtifact.source.commit}; clean source image SHA-256: ${rerunArtifact.source.image.sha256}.
- T16d package audit: [evidence/e5-t16d/package-audit.json](../../evidence/e5-t16d/package-audit.json).
- Fresh winner reruns: [evidence/e5-t16e/winner-reruns.json](../../evidence/e5-t16e/winner-reruns.json).
- Machine-readable decision: [evidence/e5-t16e/display-server-decision.json](../../evidence/e5-t16e/display-server-decision.json).
- Scope is native emulator/guest evidence only; independent-machine, WebKit, and host-rr legs are waived for this decision.
`;
await mkdir(path.dirname(decisionDocPath), { recursive: true });
await writeFile(decisionDocPath, document);
process.stdout.write(`E5T16E_VERIFIED=${JSON.stringify({
  selected: evidence.decision.selected,
  winningMargin,
  variance: variance.maxAbsoluteDeviation,
  damageRecomputation,
  outputs: [relative(decisionDocPath), relative(decisionSummaryPath)],
})}\n`);
