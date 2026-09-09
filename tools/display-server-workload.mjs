#!/usr/bin/env node

// E5-T16a: candidate-neutral workload and capture contract for display-server measurements.
//
// A candidate driver reads the frozen plan on stdin and writes exactly one JSON capture to stdout.
// The harness computes the scratch-image digest itself, validates every phase/counter boundary,
// and only then writes a normalized result. No host-native or extrapolated measurement can enter
// the finalist table through this boundary.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WORKLOAD_SCHEMA = "wasm-vm.e5-t16a.display-server-workload.v1";
export const WORKLOAD_TASK = "E5-T16a";
export const WORKLOAD_ENVIRONMENT = "emulator";
export const WORKLOAD_ARCHITECTURE = "riscv64";
export const DRIVER_OUTPUT_LIMIT = 2 * 1024 * 1024;
// A cold Alpine riscv64 boot is a deliberately bounded macro run; the browser reference is
// roughly 15.3 minutes, so leave headroom for native JIT translation without making the driver
// unbounded.
export const DRIVER_TIMEOUT_MS = 30 * 60 * 1_000;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[0-9a-f]{64}$/u;
const PHASE_IDS = Object.freeze([
  "cold-start",
  "idle",
  "open-terminal",
  "type-100",
  "drag-300",
  "close",
]);
const TYPING_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-_";
export const TYPING_TEXT = Object.freeze(
  Array.from({ length: 100 }, (_, index) => TYPING_ALPHABET[index % TYPING_ALPHABET.length]).join(""),
);

function markerFor(phase) {
  return `E5T16A_${phase.replaceAll("-", "_").toUpperCase()}_DONE`;
}

const PHASE_SPECS = Object.freeze(PHASE_IDS.map((id) => Object.freeze({ id, marker: markerFor(id) })));
export const WORKLOAD_PHASES = PHASE_SPECS;
const TYPING_TEXT_SHA256 = createHash("sha256").update(TYPING_TEXT).digest("hex");
const SOURCE_CONTRACT = Object.freeze({
  guestInstructions: "guest-e4-minstret",
  uploadedBytes: "guest-t09-vm-stats-gpu-bytesUploaded",
  peakRssBytes: "guest-proc-status-vmHWM",
  idleWakeups: "guest-proc-interrupts-idle-delta",
  cursorqEvents: "guest-virtio-gpu-cursorq-trace",
});

const PLAN = Object.freeze({
  version: 1,
  phases: PHASE_SPECS,
  idle: Object.freeze({ requestedMs: 1_000, minimumMs: 900 }),
  terminal: Object.freeze({
    openPhase: "open-terminal",
    closePhase: "close",
    typedCharacters: 100,
    typingText: TYPING_TEXT,
    typingTextSha256: TYPING_TEXT_SHA256,
  }),
  drag: Object.freeze({
    phase: "drag-300",
    axis: "x",
    deltaPx: 300,
    from: Object.freeze({ x: 100, y: 100 }),
    to: Object.freeze({ x: 400, y: 100 }),
    steps: 30,
  }),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildWorkloadPlan() {
  return JSON.parse(JSON.stringify(PLAN));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function planSha256() {
  return sha256(stableStringify(PLAN));
}

export class WorkloadValidationError extends Error {
  constructor(code, location, message) {
    super(`${code} at ${location}: ${message}`);
    this.name = "WorkloadValidationError";
    this.code = code;
    this.location = location;
  }
}

function fail(code, location, message) {
  throw new WorkloadValidationError(code, location, message);
}

function object(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("TYPE", location, "expected an object");
  }
  return value;
}

function string(value, location) {
  if (typeof value !== "string" || value.length === 0) fail("VALUE", location, "expected a non-empty string");
  return value;
}

function nonNegativeInteger(value, location) {
  if (!Number.isSafeInteger(value) || value < 0) fail("COUNTER", location, "expected a non-negative safe integer");
  return value;
}

function nonNegativeNumber(value, location) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("TIME", location, "expected a finite non-negative number");
  }
  return value;
}

function exact(value, expected, code, location) {
  if (stableStringify(value) !== stableStringify(expected)) {
    fail(code, location, `expected ${stableStringify(expected)}`);
  }
}

function validatePlan(value) {
  object(value, "plan");
  exact(value, PLAN, "PLAN_MISMATCH", "plan");
}

function validateCandidate(value) {
  const candidate = object(value, "candidate");
  for (const field of ["id", "server", "wm", "terminal", "renderer"]) {
    string(candidate[field], `candidate.${field}`);
  }
  if (candidate.clipboard !== undefined) string(candidate.clipboard, "candidate.clipboard");
  return {
    id: candidate.id,
    server: candidate.server,
    wm: candidate.wm,
    terminal: candidate.terminal,
    renderer: candidate.renderer,
    ...(candidate.clipboard === undefined ? {} : { clipboard: candidate.clipboard }),
  };
}

function validateImage(value) {
  const image = object(value, "image");
  string(image.id, "image.id");
  if (typeof image.sha256 !== "string" || !SHA256.test(image.sha256)) {
    fail("IMAGE_DIGEST", "image.sha256", "expected a lowercase SHA-256 digest");
  }
  return { id: image.id, sha256: image.sha256 };
}

function validateCounterPoint(value, location) {
  const point = object(value, location);
  return {
    wallMs: nonNegativeNumber(point.wallMs, `${location}.wallMs`),
    guestInstructions: nonNegativeInteger(point.guestInstructions, `${location}.guestInstructions`),
    uploadedBytes: nonNegativeInteger(point.uploadedBytes, `${location}.uploadedBytes`),
    idleWakeups: nonNegativeInteger(point.idleWakeups, `${location}.idleWakeups`),
  };
}

function validatePhaseDetails(phase, location) {
  const details = object(phase.details ?? {}, `${location}.details`);
  if (phase.id === "type-100") {
    if (details.characters !== 100) fail("WORKLOAD_SHAPE", `${location}.details.characters`, "typing phase must contain 100 characters");
    if (details.textSha256 !== PLAN.terminal.typingTextSha256) {
      fail("WORKLOAD_SHAPE", `${location}.details.textSha256`, "typing text digest does not match the frozen plan");
    }
  }
  if (phase.id === "drag-300") {
    if (details.deltaPx !== 300 || details.axis !== "x") {
      fail("WORKLOAD_SHAPE", `${location}.details`, "drag phase must move exactly 300 px on x");
    }
    if (details.steps !== PLAN.drag.steps) {
      fail("WORKLOAD_SHAPE", `${location}.details.steps`, `drag phase must use ${PLAN.drag.steps} steps`);
    }
  }
  if (phase.id === "close" && details.applicationExited !== true) {
    fail("WORKLOAD_SHAPE", `${location}.details.applicationExited`, "close phase must observe application exit");
  }
  return JSON.parse(JSON.stringify(details));
}

function validateObservations(value) {
  const observations = object(value, "observations");
  const cursorqEvents = nonNegativeInteger(observations.cursorqEvents, "observations.cursorqEvents");
  const cursorqStatus = observations.cursorqStatus === undefined
    ? undefined
    : string(observations.cursorqStatus, "observations.cursorqStatus");
  if (!Array.isArray(observations.markerSequence)) fail("MARKERS", "observations.markerSequence", "expected an array");
  exact(
    observations.markerSequence,
    PHASE_SPECS.map((phase) => phase.marker),
    "MARKER_SEQUENCE",
    "observations.markerSequence",
  );
  if (!Array.isArray(observations.errors) || observations.errors.length !== 0) {
    fail("OBSERVATION_ERRORS", "observations.errors", "workload capture contains errors");
  }
  return {
    cursorqEvents,
    ...(cursorqStatus === undefined ? {} : { cursorqStatus }),
    markerSequence: [...observations.markerSequence],
    errors: [],
  };
}

function validateSources(value) {
  object(value, "sources");
  exact(value, SOURCE_CONTRACT, "SOURCE_CONTRACT", "sources");
  return { ...SOURCE_CONTRACT };
}

function validatePhaseList(value) {
  if (!Array.isArray(value) || value.length !== PHASE_SPECS.length) fail("PHASES", "phases", "expected one record for every workload phase");
  let previousEnd = null;
  const phases = value.map((raw, index) => {
    const location = `phases[${index}]`;
    const phase = object(raw, location);
    const spec = PHASE_SPECS[index];
    if (phase.id !== spec.id) fail("PHASE_ID", `${location}.id`, `expected ${spec.id}`);
    if (phase.marker !== spec.marker) fail("MARKER", `${location}.marker`, `expected ${spec.marker}`);
    if (phase.outcome !== "passed") fail("PHASE_OUTCOME", `${location}.outcome`, "only a passed phase can enter evidence");
    const start = validateCounterPoint(phase.start, `${location}.start`);
    const end = validateCounterPoint(phase.end, `${location}.end`);
    for (const field of ["wallMs", "guestInstructions", "uploadedBytes", "idleWakeups"]) {
      if (end[field] < start[field]) fail("COUNTER_ORDER", `${location}.${field}`, "end counter precedes start counter");
      if (previousEnd !== null && start[field] < previousEnd[field]) {
        fail("COUNTER_ORDER", `${location}.start.${field}`, "phase counters are not monotonic");
      }
    }
    if (!Number.isSafeInteger(phase.peakRssBytes) || phase.peakRssBytes < 1) {
      fail("RSS", `${location}.peakRssBytes`, "expected a positive safe integer");
    }
    const details = validatePhaseDetails(phase, location);
    if (phase.id === "idle" && end.wallMs - start.wallMs < PLAN.idle.minimumMs) {
      fail("IDLE_INTERVAL", `${location}.end.wallMs`, `idle interval must be at least ${PLAN.idle.minimumMs} ms`);
    }
    previousEnd = end;
    return {
      id: phase.id,
      marker: phase.marker,
      start,
      end,
      peakRssBytes: phase.peakRssBytes,
      outcome: "passed",
      details,
    };
  });
  return phases;
}

function summarize(phases) {
  const first = phases[0].start;
  const last = phases.at(-1).end;
  const idle = phases.find((phase) => phase.id === "idle");
  const idleSeconds = (idle.end.wallMs - idle.start.wallMs) / 1_000;
  return {
    guestInstructions: last.guestInstructions - first.guestInstructions,
    uploadedBytes: last.uploadedBytes - first.uploadedBytes,
    peakRssBytes: Math.max(...phases.map((phase) => phase.peakRssBytes)),
    idleWakeups: idle.end.idleWakeups - idle.start.idleWakeups,
    idleWakeupsPerSecond: (idle.end.idleWakeups - idle.start.idleWakeups) / idleSeconds,
    phaseDurationsMs: Object.fromEntries(phases.map((phase) => [phase.id, phase.end.wallMs - phase.start.wallMs])),
    typingUploadedBytes: phases.find((phase) => phase.id === "type-100").end.uploadedBytes
      - phases.find((phase) => phase.id === "type-100").start.uploadedBytes,
  };
}

/** Validate and normalize a complete driver capture. */
export function validateCapture(value) {
  const capture = object(value, "capture");
  if (capture.schema !== WORKLOAD_SCHEMA) fail("SCHEMA", "schema", `expected ${WORKLOAD_SCHEMA}`);
  if (capture.task !== WORKLOAD_TASK) fail("TASK", "task", `expected ${WORKLOAD_TASK}`);
  if (capture.environment !== WORKLOAD_ENVIRONMENT) fail("TARGET", "environment", "capture must come from the emulator");
  if (capture.architecture !== WORKLOAD_ARCHITECTURE) fail("TARGET", "architecture", "capture must target riscv64");
  validatePlan(capture.plan);
  const candidate = validateCandidate(capture.candidate);
  const image = validateImage(capture.image);
  const sources = validateSources(capture.sources);
  const phases = validatePhaseList(capture.phases);
  const observations = validateObservations(capture.observations);
  return {
    schema: WORKLOAD_SCHEMA,
    task: WORKLOAD_TASK,
    environment: WORKLOAD_ENVIRONMENT,
    architecture: WORKLOAD_ARCHITECTURE,
    candidate,
    image,
    sources,
    plan: buildWorkloadPlan(),
    phases,
    observations,
    summary: summarize(phases),
  };
}

/** A deterministic capture used only to test the contract and its failure paths. */
export function fixtureCapture() {
  let counters = { wallMs: 0, guestInstructions: 1_000, uploadedBytes: 0, idleWakeups: 10 };
  const phases = PHASE_SPECS.map((spec, index) => {
    const start = { ...counters };
    const delta = spec.id === "idle"
      ? { wallMs: 1_000, guestInstructions: 500, uploadedBytes: 0, idleWakeups: 3 }
      : { wallMs: 200, guestInstructions: 100 + index, uploadedBytes: 256 + (index * 64), idleWakeups: 1 };
    counters = {
      wallMs: start.wallMs + delta.wallMs,
      guestInstructions: start.guestInstructions + delta.guestInstructions,
      uploadedBytes: start.uploadedBytes + delta.uploadedBytes,
      idleWakeups: start.idleWakeups + delta.idleWakeups,
    };
    const details = spec.id === "type-100"
      ? { characters: 100, textSha256: PLAN.terminal.typingTextSha256 }
      : spec.id === "drag-300"
        ? { axis: "x", deltaPx: 300, steps: 30 }
        : spec.id === "close"
          ? { applicationExited: true }
          : {};
    return {
      id: spec.id,
      marker: spec.marker,
      start,
      end: { ...counters },
      peakRssBytes: 16 * 1024 * 1024 + (index * 4 * 1024),
      outcome: "passed",
      details,
    };
  });
  return {
    schema: WORKLOAD_SCHEMA,
    task: WORKLOAD_TASK,
    environment: WORKLOAD_ENVIRONMENT,
    architecture: WORKLOAD_ARCHITECTURE,
    candidate: {
      id: "fixture",
      server: "fixture-server",
      wm: "fixture-wm",
      terminal: "fixture-terminal",
      renderer: "fixture-renderer",
    },
    image: { id: "fixture-image", sha256: "a".repeat(64) },
    sources: { ...SOURCE_CONTRACT },
    plan: buildWorkloadPlan(),
    phases,
    observations: {
      cursorqEvents: 12,
      markerSequence: PHASE_SPECS.map((phase) => phase.marker),
      errors: [],
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectedFailure(mutator, code) {
  const value = clone(fixtureCapture());
  mutator(value);
  try {
    validateCapture(value);
  } catch (error) {
    if (error?.code === code) return true;
    throw error;
  }
  fail("SELF_TEST", "mutant", `expected ${code}`);
}

export function runSelfTest() {
  const normalized = validateCapture(fixtureCapture());
  const second = validateCapture(JSON.parse(stableStringify(normalized)));
  const normalizedJson = stableStringify(normalized);
  const secondJson = stableStringify(second);
  if (normalizedJson !== secondJson) fail("SELF_TEST", "determinism", "normalization changed on replay");
  const checks = {
    validCapture: true,
    deterministicNormalization: true,
    missingMarker: expectedFailure((value) => { value.observations.markerSequence.pop(); }, "MARKER_SEQUENCE"),
    counterOrder: expectedFailure((value) => { value.phases[2].end.guestInstructions = 0; }, "COUNTER_ORDER"),
    sourceContract: expectedFailure((value) => { value.sources.uploadedBytes = "host-native"; }, "SOURCE_CONTRACT"),
    typingShape: expectedFailure((value) => { value.phases[3].details.characters = 99; }, "WORKLOAD_SHAPE"),
    preIdleExit: expectedFailure((value) => { value.phases[1].outcome = "failed"; }, "PHASE_OUTCOME"),
  };
  return {
    schema: "wasm-vm.e5-t16a.display-server-workload-self-test.v1",
    task: WORKLOAD_TASK,
    planSha256: planSha256(),
    phaseMarkers: PHASE_SPECS.map((phase) => phase.marker),
    phaseCount: PHASE_SPECS.length,
    sources: { ...SOURCE_CONTRACT },
    typingCharacters: TYPING_TEXT.length,
    dragDeltaPx: PLAN.drag.deltaPx,
    normalizedSha256: sha256(normalizedJson),
    summary: normalized.summary,
    checks,
  };
}

function collectOutput(stream, label) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > DRIVER_OUTPUT_LIMIT) {
        reject(new WorkloadValidationError("DRIVER_OUTPUT_LIMIT", label, `output exceeded ${DRIVER_OUTPUT_LIMIT} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", (error) => reject(error));
  });
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * Execute a candidate driver without a shell. The driver receives the frozen plan on stdin and
 * must emit one complete capture on stdout. The harness owns the image digest and target fields.
 */
export async function runDriver({
  imagePath,
  runner,
  outputPath = null,
  cwd = REPO,
  env = process.env,
  timeoutMs = DRIVER_TIMEOUT_MS,
}) {
  if (!Array.isArray(runner) || runner.length === 0 || runner.some((item) => typeof item !== "string" || item.length === 0)) {
    fail("DRIVER", "runner", "expected a non-empty executable/argument array");
  }
  if (typeof imagePath !== "string" || imagePath.length === 0) fail("IMAGE", "imagePath", "an image path is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("DRIVER", "timeoutMs", "expected a positive safe integer");
  const resolvedImage = path.resolve(cwd, imagePath);
  const imageDigest = sha256(await readFile(resolvedImage));
  const plan = buildWorkloadPlan();
  const child = spawn(runner[0], runner.slice(1), {
    cwd,
    env: {
      ...env,
      E5_T16A_SCHEMA: WORKLOAD_SCHEMA,
      E5_T16A_PLAN_SHA256: planSha256(),
      E5_T16A_IMAGE: resolvedImage,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutPromise = collectOutput(child.stdout, "driver.stdout");
  const stderrPromise = collectOutput(child.stderr, "driver.stderr");
  child.stdin.end(`${stableStringify(plan)}\n`);
  let timedOut = false;
  let killTimer = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGTERM"); } catch { /* child may have exited at the boundary */ }
    killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* child may have exited after SIGTERM */ }
    }, 1_000);
  }, timeoutMs);
  let exit;
  let stdout;
  let stderr;
  try {
    [exit, stdout, stderr] = await Promise.all([childExit(child), stdoutPromise, stderrPromise]);
  } finally {
    clearTimeout(timeout);
    if (killTimer !== null) clearTimeout(killTimer);
  }
  if (timedOut) fail("DRIVER_TIMEOUT", "driver", `driver exceeded ${timeoutMs} ms`);
  if (exit.code !== 0 || exit.signal !== null) {
    fail("DRIVER_EXIT", "driver", `driver exited code=${exit.code ?? "null"} signal=${exit.signal ?? "none"}: ${stderr.trim()}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    fail("DRIVER_OUTPUT", "driver.stdout", `expected one JSON capture: ${error.message}`);
  }
  const capture = {
    ...parsed,
    image: { id: parsed?.image?.id ?? path.basename(resolvedImage), sha256: imageDigest },
  };
  const normalized = validateCapture(capture);
  if (outputPath !== null) {
    await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);
  }
  return normalized;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length || args[index + 1].startsWith("--")) fail("CLI", name, "option requires a value");
  return args[index + 1];
}

async function main(argv) {
  const command = argv[0] ?? "self-test";
  if (command === "self-test") {
    process.stdout.write(`${JSON.stringify(runSelfTest(), null, 2)}\n`);
    return;
  }
  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(buildWorkloadPlan(), null, 2)}\n`);
    return;
  }
  if (command === "validate") {
    const capturePath = option(argv.slice(1), "--capture");
    if (!capturePath) fail("CLI", "--capture", "validate requires a capture path");
    const value = JSON.parse(await readFile(path.resolve(capturePath), "utf8"));
    process.stdout.write(`${JSON.stringify(validateCapture(value), null, 2)}\n`);
    return;
  }
  if (command === "run") {
    const args = argv.slice(1);
    const imagePath = option(args, "--image");
    const outputPath = option(args, "--output");
    const separator = args.indexOf("--");
    if (separator < 0 || separator === args.length - 1) fail("CLI", "--", "run requires a driver command after --");
    const result = await runDriver({
      imagePath,
      outputPath: outputPath ? path.resolve(outputPath) : null,
      runner: args.slice(separator + 1),
    });
    if (!outputPath) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  fail("CLI", "command", `unknown command ${command}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
