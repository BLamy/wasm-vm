const VERSION = 2;
const MAX_ATTEMPTS = 3;

const PLAN = [
  { id: "p0:main-interp", passIndex: 0, variant: "main-interp" },
  { id: "p0:worker-interp", passIndex: 0, variant: "worker-interp" },
  { id: "p0:worker-jit512", passIndex: 0, variant: "worker-jit512" },
  { id: "p1:worker-jit512", passIndex: 1, variant: "worker-jit512" },
  { id: "p1:worker-interp", passIndex: 1, variant: "worker-interp" },
  { id: "p1:main-interp", passIndex: 1, variant: "main-interp" },
];

export const E4T32_NODE_LEDGER_VERSION = VERSION;
export const E4T32_NODE_MAX_ATTEMPTS_PER_SLOT = MAX_ATTEMPTS;
export const E4T32_NODE_SLOT_PLAN = Object.freeze(
  PLAN.map((slot) => Object.freeze({ ...slot })),
);

export class NodeBenchmarkLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeBenchmarkLedgerError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new NodeBenchmarkLedgerError(code, message);
};

function canonicalJson(value, label = "value", seen = new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) fail("non-json-value", `${label} contains a non-finite number`);
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) fail("non-json-value", `${label} contains a cycle`);
      seen.add(value);
      let encoded;
      if (Array.isArray(value)) {
        encoded = `[${value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`, seen)).join(",")}]`;
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          fail("non-json-value", `${label} must contain only plain JSON objects`);
        }
        encoded = `{${Object.keys(value).sort().map((key) => (
          `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`, seen)}`
        )).join(",")}}`;
      }
      seen.delete(value);
      return encoded;
    }
    default:
      fail("non-json-value", `${label} contains unsupported ${typeof value}`);
  }
}

const cloneJson = (value, label) => JSON.parse(canonicalJson(value, label));
const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);
const expectedPlan = () => E4T32_NODE_SLOT_PLAN.map((slot) => ({ ...slot }));

const attemptToken = (attemptId) => Buffer.from(attemptId, "utf8").toString("base64url");

export function nodeBenchmarkAttemptArtifactName(attemptOrdinal, attemptId, phase) {
  if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 0) {
    fail("invalid-attempt-order", "attempt ordinal must be a non-negative safe integer");
  }
  if (typeof attemptId !== "string" || !attemptId.trim() || attemptId.length > 128) {
    fail("invalid-attempt-id", "attempt id must be 1-128 non-whitespace characters");
  }
  if (phase !== "started" && phase !== "finished") {
    fail("invalid-event-phase", "artifact phase must be started or finished");
  }
  return `E4T32_NODE_ATTEMPT_${attemptOrdinal}_${attemptToken(attemptId)}_${phase}.json`;
}

const eventId = (attemptId, phase) => `attempt-${phase}:${attemptToken(attemptId)}`;

function validateCalibration(calibration, label, { optional = false } = {}) {
  if (calibration === null && optional) return null;
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    fail("invalid-calibration", `${label} must be a JSON object`);
  }
  if (typeof calibration.clean !== "boolean") {
    fail("invalid-calibration", `${label}.clean must be boolean`);
  }
  return cloneJson(calibration, label);
}

function acceptedSessionProblem(session, slot) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return "accepted attempt has no session object";
  }
  if (session.variant !== slot.variant) {
    return `session variant ${session.variant} does not match ${slot.variant}`;
  }
  if (session.passIndex !== slot.passIndex) {
    return `session pass ${session.passIndex} does not match ${slot.passIndex}`;
  }
  if (!Array.isArray(session.runs) || session.runs.length !== 2) {
    return "accepted session must contain exactly two runs";
  }
  for (const [index, run] of session.runs.entries()) {
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      return `run ${index} is not an object`;
    }
    for (const field of ["firstMs", "completeMs", "stretchMs"]) {
      if (!Number.isFinite(run[field]) || run[field] < 0) {
        return `run ${index}.${field} must be a non-negative finite number`;
      }
    }
  }
  return null;
}

function sessionSlotMismatch(session, slot) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  return session.variant !== slot.variant || session.passIndex !== slot.passIndex;
}

function classifyFinishedEvent(event, ledgerIdentity, slot) {
  if (!sameJson(event.identity, ledgerIdentity)) {
    return { outcome: "refuted", reason: "identity-mismatch" };
  }
  if (event.harnessError !== null) {
    return { outcome: "harness-error", reason: "unexpected-harness-error" };
  }
  if (event.inconclusiveReason === "orphaned-attempt") {
    return { outcome: "inconclusive", reason: "orphaned-attempt" };
  }
  if (sessionSlotMismatch(event.session, slot)) {
    return { outcome: "refuted", reason: "session-slot-mismatch" };
  }
  const preClean = event.preCalibration?.clean === true;
  const postClean = event.postCalibration?.clean === true;
  if (!preClean || !postClean) {
    if (event.sessionError !== null) {
      return {
        outcome: "mixed-inconclusive",
        reason: "session-error-with-contaminated-calibration",
      };
    }
    return { outcome: "inconclusive", reason: "calibration-contaminated" };
  }
  if (event.sessionError !== null) {
    return { outcome: "refuted", reason: "session-error" };
  }
  if (event.session === null) {
    return { outcome: "refuted", reason: "missing-session" };
  }
  if (acceptedSessionProblem(event.session, slot)) {
    return { outcome: "refuted", reason: "invalid-session" };
  }
  return { outcome: "accepted", reason: "clean" };
}

function validateAttemptId(attemptId) {
  if (typeof attemptId !== "string" || !attemptId.trim() || attemptId.length > 128) {
    fail("invalid-attempt-id", "attempt id must be 1-128 non-whitespace characters");
  }
}

function replayLedger(ledger) {
  let slotIndex = 0;
  let attemptsInSlot = 0;
  let attemptsStarted = 0;
  let open = null;
  let terminal = null;
  const attemptIds = new Set();
  const eventIds = new Set();

  for (const [ordinal, event] of ledger.events.entries()) {
    if (terminal) fail("event-after-terminal", `event ${event?.eventId ?? ordinal} follows terminal ${terminal}`);
    if (slotIndex >= PLAN.length) fail("event-after-complete", `event ${event?.eventId ?? ordinal} follows completion`);
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      fail("invalid-event", `event ${ordinal} must be an object`);
    }
    if (event.ordinal !== ordinal) fail("invalid-event-order", `event ordinal must be ${ordinal}`);
    if (typeof event.eventId !== "string" || eventIds.has(event.eventId)) {
      fail("duplicate-event-id", `event ${ordinal} has a missing or duplicate eventId`);
    }
    eventIds.add(event.eventId);
    const slot = PLAN[slotIndex];

    if (event.type === "attempt-started") {
      if (open) fail("open-attempt", `attempt ${open.attemptId} must finish before another begins`);
      if (attemptsInSlot >= MAX_ATTEMPTS) {
        fail("slot-attempts-exhausted", `${slot.id} already used ${MAX_ATTEMPTS} attempts`);
      }
      validateAttemptId(event.attemptId);
      if (attemptIds.has(event.attemptId)) fail("duplicate-attempt-id", `duplicate attempt id ${event.attemptId}`);
      attemptIds.add(event.attemptId);
      if (event.eventId !== eventId(event.attemptId, "started")) {
        fail("invalid-event-id", `started event id does not match attempt ${event.attemptId}`);
      }
      if (event.attemptOrdinal !== attemptsStarted) {
        fail("invalid-attempt-order", `attempt ${event.attemptId} ordinal must be ${attemptsStarted}`);
      }
      if (event.slotId !== slot.id || event.passIndex !== slot.passIndex || event.variant !== slot.variant) {
        fail("out-of-order-slot", `attempt ${event.attemptId} must target earliest incomplete slot ${slot.id}`);
      }
      if (!sameJson(event.identity, ledger.identity)) {
        fail("identity-mismatch", `started attempt ${event.attemptId} identity does not match ledger`);
      }
      if (event.artifactName !== nodeBenchmarkAttemptArtifactName(
        event.attemptOrdinal,
        event.attemptId,
        "started",
      )) {
        fail("invalid-artifact-name", `started attempt ${event.attemptId} artifact name is not canonical`);
      }
      attemptsInSlot += 1;
      attemptsStarted += 1;
      open = event;
      continue;
    }

    if (event.type !== "attempt-finished") fail("invalid-event-type", `unknown event type ${event.type}`);
    if (!open || event.attemptId !== open.attemptId) {
      fail("finish-without-start", `finish event ${event.attemptId} has no matching open attempt`);
    }
    if (event.eventId !== eventId(event.attemptId, "finished")) {
      fail("invalid-event-id", `finished event id does not match attempt ${event.attemptId}`);
    }
    for (const field of ["attemptOrdinal", "slotId", "passIndex", "variant"]) {
      if (event[field] !== open[field]) fail("finish-mismatch", `finished event ${field} differs from start`);
    }
    if (event.artifactName !== nodeBenchmarkAttemptArtifactName(
      event.attemptOrdinal,
      event.attemptId,
      "finished",
    )) {
      fail("invalid-artifact-name", `finished attempt ${event.attemptId} artifact name is not canonical`);
    }
    cloneJson(event.identity, `attempt ${event.attemptId} identity`);
    validateCalibration(event.preCalibration, `attempt ${event.attemptId} preCalibration`, { optional: true });
    validateCalibration(event.postCalibration, `attempt ${event.attemptId} postCalibration`, { optional: true });
    if (event.session !== null) cloneJson(event.session, `attempt ${event.attemptId} session`);
    if (event.sessionError !== null) cloneJson(event.sessionError, `attempt ${event.attemptId} sessionError`);
    if (event.harnessError !== null) cloneJson(event.harnessError, `attempt ${event.attemptId} harnessError`);
    if (event.session !== null && event.sessionError !== null) {
      fail("invalid-event", `attempt ${event.attemptId} cannot contain both session and sessionError`);
    }
    if (event.inconclusiveReason !== null && event.inconclusiveReason !== "orphaned-attempt") {
      fail("invalid-inconclusive-reason", `attempt ${event.attemptId} has an invalid forced reason`);
    }
    if (event.inconclusiveReason === "orphaned-attempt" && (
      event.preCalibration !== null || event.postCalibration !== null ||
      event.session !== null || event.sessionError !== null || event.harnessError !== null
    )) {
      fail("invalid-orphan", `orphaned attempt ${event.attemptId} cannot contain staged results`);
    }
    const classification = classifyFinishedEvent(event, ledger.identity, slot);
    if (event.outcome !== classification.outcome || event.reason !== classification.reason) {
      fail(
        "invalid-event-outcome",
        `attempt ${event.attemptId} must be ${classification.outcome}/${classification.reason}`,
      );
    }
    open = null;
    if (event.outcome === "accepted") {
      slotIndex += 1;
      attemptsInSlot = 0;
    } else if (event.outcome === "refuted") {
      terminal = "refuted";
    } else if (event.outcome === "mixed-inconclusive") {
      terminal = "mixed-inconclusive";
    } else if (event.outcome === "harness-error") {
      terminal = "harness-error";
    } else if (attemptsInSlot === MAX_ATTEMPTS) {
      terminal = "environment-inconclusive";
    }
  }

  if (!terminal && slotIndex === PLAN.length) terminal = "complete";
  return {
    slotIndex,
    attemptsInSlot,
    attemptsStarted,
    open,
    terminal,
    attemptIds,
    eventIds,
  };
}

export function validateNodeBenchmarkLedger(value) {
  const ledger = cloneJson(value, "ledger");
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    fail("invalid-ledger", "ledger must be an object");
  }
  if (ledger.version !== VERSION) fail("unsupported-version", `ledger version must be ${VERSION}`);
  if (!sameJson(ledger.plan, expectedPlan())) fail("invalid-plan", "ledger must use the fixed E4-T32 plan");
  if (ledger.identity === null || ledger.identity === undefined) {
    fail("missing-identity", "ledger identity is required");
  }
  cloneJson(ledger.identity, "ledger identity");
  if (!Array.isArray(ledger.events)) fail("invalid-ledger", "ledger.events must be an array");
  replayLedger(ledger);
  return ledger;
}

export function createNodeBenchmarkLedger(identity) {
  if (identity === null || identity === undefined) fail("missing-identity", "ledger identity is required");
  return validateNodeBenchmarkLedger({
    version: VERSION,
    plan: expectedPlan(),
    identity: cloneJson(identity, "ledger identity"),
    events: [],
  });
}

export function nodeBenchmarkLedgerStatus(value) {
  const ledger = validateNodeBenchmarkLedger(value);
  const state = replayLedger(ledger);
  if (state.open) return "attempt-open";
  return state.terminal ?? "running";
}

export function activeNodeBenchmarkAttempt(value) {
  const ledger = validateNodeBenchmarkLedger(value);
  const open = replayLedger(ledger).open;
  return open ? cloneJson(open, "open attempt") : null;
}

export function nextNodeBenchmarkSlot(value) {
  const ledger = validateNodeBenchmarkLedger(value);
  const state = replayLedger(ledger);
  if (state.open || state.terminal) return null;
  const slot = PLAN[state.slotIndex];
  return {
    ...slot,
    slotIndex: state.slotIndex,
    attemptsUsed: state.attemptsInSlot,
    attemptsRemaining: MAX_ATTEMPTS - state.attemptsInSlot,
  };
}

export function beginNodeBenchmarkAttempt(value, input) {
  const ledger = validateNodeBenchmarkLedger(value);
  const state = replayLedger(ledger);
  if (state.open) fail("open-attempt", `attempt ${state.open.attemptId} is still open`);
  if (state.terminal) fail("ledger-terminal", `cannot begin an attempt on ${state.terminal} ledger`);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-attempt", "attempt input must be an object");
  }
  validateAttemptId(input.attemptId);
  if (state.attemptIds.has(input.attemptId)) fail("duplicate-attempt-id", `duplicate attempt id ${input.attemptId}`);
  const slot = PLAN[state.slotIndex];
  if (input.slotId !== undefined && input.slotId !== slot.id) {
    fail("out-of-order-slot", `next attempt must target ${slot.id}, not ${input.slotId}`);
  }
  if (!sameJson(input.identity, ledger.identity)) {
    fail("identity-mismatch", "attempt identity does not deeply match ledger identity");
  }
  const started = {
    eventId: eventId(input.attemptId, "started"),
    ordinal: ledger.events.length,
    type: "attempt-started",
    attemptId: input.attemptId,
    attemptOrdinal: state.attemptsStarted,
    slotId: slot.id,
    passIndex: slot.passIndex,
    variant: slot.variant,
    identity: cloneJson(input.identity, "attempt identity"),
    artifactName: nodeBenchmarkAttemptArtifactName(state.attemptsStarted, input.attemptId, "started"),
  };
  const next = validateNodeBenchmarkLedger({ ...ledger, events: [...ledger.events, started] });
  return { ledger: next, event: cloneJson(started, "started event") };
}

export function finishNodeBenchmarkAttempt(value, input) {
  const ledger = validateNodeBenchmarkLedger(value);
  const state = replayLedger(ledger);
  if (!state.open) fail("finish-without-start", "there is no open attempt to finish");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-finish", "finish input must be an object");
  }
  if (input.attemptId !== state.open.attemptId) {
    fail("finish-mismatch", `open attempt is ${state.open.attemptId}, not ${input.attemptId}`);
  }
  const preCalibration = validateCalibration(input.preCalibration ?? null, "preCalibration", { optional: true });
  const postCalibration = validateCalibration(input.postCalibration ?? null, "postCalibration", { optional: true });
  const session = input.session == null ? null : cloneJson(input.session, "session");
  const sessionError = input.sessionError == null ? null : cloneJson(input.sessionError, "sessionError");
  const harnessError = input.harnessError == null ? null : cloneJson(input.harnessError, "harnessError");
  if (session !== null && sessionError !== null) {
    fail("invalid-finish", "finish cannot contain both session and sessionError");
  }
  const finished = {
    eventId: eventId(input.attemptId, "finished"),
    ordinal: ledger.events.length,
    type: "attempt-finished",
    attemptId: state.open.attemptId,
    attemptOrdinal: state.open.attemptOrdinal,
    slotId: state.open.slotId,
    passIndex: state.open.passIndex,
    variant: state.open.variant,
    identity: cloneJson(input.identity, "attempt identity"),
    preCalibration,
    postCalibration,
    session,
    sessionError,
    harnessError,
    inconclusiveReason: null,
    artifactName: nodeBenchmarkAttemptArtifactName(
      state.open.attemptOrdinal,
      state.open.attemptId,
      "finished",
    ),
  };
  Object.assign(finished, classifyFinishedEvent(finished, ledger.identity, PLAN[state.slotIndex]));
  const next = validateNodeBenchmarkLedger({ ...ledger, events: [...ledger.events, finished] });
  return { ledger: next, event: cloneJson(finished, "finished event") };
}

export function abandonOpenNodeBenchmarkAttempt(value, { attemptId, note = null } = {}) {
  const ledger = validateNodeBenchmarkLedger(value);
  const state = replayLedger(ledger);
  if (!state.open) fail("finish-without-start", "there is no open attempt to abandon");
  if (attemptId !== state.open.attemptId) {
    fail("finish-mismatch", `open attempt is ${state.open.attemptId}, not ${attemptId}`);
  }
  const finished = {
    eventId: eventId(attemptId, "finished"),
    ordinal: ledger.events.length,
    type: "attempt-finished",
    attemptId,
    attemptOrdinal: state.open.attemptOrdinal,
    slotId: state.open.slotId,
    passIndex: state.open.passIndex,
    variant: state.open.variant,
    identity: cloneJson(state.open.identity, "attempt identity"),
    preCalibration: null,
    postCalibration: null,
    session: null,
    sessionError: null,
    harnessError: null,
    inconclusiveReason: "orphaned-attempt",
    note: note == null ? null : cloneJson(note, "orphan note"),
    artifactName: nodeBenchmarkAttemptArtifactName(state.open.attemptOrdinal, attemptId, "finished"),
    outcome: "inconclusive",
    reason: "orphaned-attempt",
  };
  const next = validateNodeBenchmarkLedger({ ...ledger, events: [...ledger.events, finished] });
  return { ledger: next, event: cloneJson(finished, "abandoned event") };
}

export function serializeNodeBenchmarkLedger(value) {
  return canonicalJson(validateNodeBenchmarkLedger(value), "ledger");
}

export function parseNodeBenchmarkLedger(serialized) {
  if (typeof serialized !== "string") fail("invalid-serialization", "serialized ledger must be a string");
  let value;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    fail("invalid-serialization", `invalid ledger JSON: ${error.message}`);
  }
  return validateNodeBenchmarkLedger(value);
}

export function mergeNodeBenchmarkLedgers(leftValue, rightValue) {
  const left = typeof leftValue === "string"
    ? parseNodeBenchmarkLedger(leftValue)
    : validateNodeBenchmarkLedger(leftValue);
  const right = typeof rightValue === "string"
    ? parseNodeBenchmarkLedger(rightValue)
    : validateNodeBenchmarkLedger(rightValue);
  if (!sameJson(left.identity, right.identity)) fail("identity-mismatch", "cannot merge different benchmark identities");
  const common = Math.min(left.events.length, right.events.length);
  for (let index = 0; index < common; index += 1) {
    if (!sameJson(left.events[index], right.events[index])) {
      fail("divergent-history", `event histories diverge at ordinal ${index}`);
    }
  }
  return validateNodeBenchmarkLedger(left.events.length >= right.events.length ? left : right);
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function deriveNodeBenchmarkResults(value, { requireComplete = false } = {}) {
  const ledger = validateNodeBenchmarkLedger(value);
  const status = nodeBenchmarkLedgerStatus(ledger);
  if (requireComplete && status !== "complete") {
    fail("ledger-incomplete", `benchmark ledger is ${status}, not complete`);
  }
  const results = Object.fromEntries(
    ["main-interp", "worker-interp", "worker-jit512"].map((variant) => [variant, {
      acceptedAttemptIds: [],
      sessions: [],
      runs: [],
    }]),
  );
  for (const event of ledger.events) {
    if (event.type !== "attempt-finished" || event.outcome !== "accepted") continue;
    const result = results[event.variant];
    result.acceptedAttemptIds.push(event.attemptId);
    const session = cloneJson(event.session, `accepted session ${event.attemptId}`);
    result.sessions.push(session);
    result.runs.push(...session.runs.map((run) => cloneJson(run, `accepted run ${event.attemptId}`)));
  }
  for (const [variant, result] of Object.entries(results)) {
    const coldRuns = result.sessions.map((session) => session.runs[0]);
    const subsequentRuns = result.sessions.flatMap((session) => session.runs.slice(1));
    result.firstMedianMs = median(result.runs.map((run) => run.firstMs));
    result.completeMedianMs = median(result.runs.map((run) => run.completeMs));
    result.firstAfterRestoreMedianMs = median(coldRuns.map((run) => run.firstMs));
    result.completeAfterRestoreMedianMs = median(coldRuns.map((run) => run.completeMs));
    result.subsequentFirstMedianMs = median(subsequentRuns.map((run) => run.firstMs));
    result.subsequentFirstMaxMs = subsequentRuns.length
      ? Math.max(...subsequentRuns.map((run) => run.firstMs))
      : null;
    result.stretchMaxMs = result.runs.length
      ? Math.max(...result.runs.map((run) => run.stretchMs))
      : null;
    if (requireComplete) {
      const passIndices = result.sessions.map((session) => session.passIndex).sort();
      if (result.sessions.length !== 2 || result.runs.length !== 4 || !sameJson(passIndices, [0, 1])) {
        fail(
          "invalid-complete-counts",
          `${variant} completion requires passes 0/1, exactly 2 sessions and 4 runs`,
        );
      }
    }
  }
  return results;
}

export function assertNodeBenchmarkComplete(value) {
  return deriveNodeBenchmarkResults(value, { requireComplete: true });
}
