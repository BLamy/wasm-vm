import { join } from "node:path";

import {
  abandonOpenNodeBenchmarkAttempt,
  activeNodeBenchmarkAttempt,
  finishNodeBenchmarkAttempt,
  mergeNodeBenchmarkLedgers,
  nodeBenchmarkAttemptArtifactName,
  parseNodeBenchmarkLedger,
  serializeNodeBenchmarkLedger,
  validateNodeBenchmarkLedger,
} from "./e4-t32-node-ledger.mjs";
import {
  atomicReplaceJson,
  ensureJsonArtifact,
  readJson,
  writeJsonExclusiveAtomic,
} from "./e4-t32-node-ledger-store.mjs";
import {
  validateCpuCalibrationPolicy,
  validatePersistedCpuCalibration,
} from "./e4-t32-node-calibration.mjs";

const PHASES = new Set(["pre", "session", "post"]);

export class NodeAttemptJournalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NodeAttemptJournalError";
    this.code = code;
    Object.assign(this, details);
  }
}

const fail = (code, message, details) => {
  throw new NodeAttemptJournalError(code, message, details);
};

function canonicalJson(value, label = "value", seen = new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) fail("EINVALIDJSON", `${label} contains a non-finite number`);
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) fail("EINVALIDJSON", `${label} contains a cycle`);
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        fail("EINVALIDJSON", `${label} must contain only plain JSON objects`);
      }
      seen.add(value);
      const encoded = Array.isArray(value)
        ? `[${value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`, seen)).join(",")}]`
        : `{${Object.keys(value).sort().map((key) => (
          `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`, seen)}`
        )).join(",")}}`;
      seen.delete(value);
      return encoded;
    }
    default:
      fail("EINVALIDJSON", `${label} contains unsupported ${typeof value}`);
  }
}

const cloneJson = (value, label = "value") => JSON.parse(canonicalJson(value, label));
const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);

function assertStartedEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || event.type !== "attempt-started") {
    fail("EINVALIDSTART", "attempt phase artifacts require an attempt-started event");
  }
  if (typeof event.artifactName !== "string" || !event.artifactName.endsWith("_started.json")) {
    fail("EINVALIDSTART", "attempt-started event has no canonical started artifact name");
  }
  const expected = nodeBenchmarkAttemptArtifactName(event.attemptOrdinal, event.attemptId, "started");
  if (event.artifactName !== expected) {
    fail("EINVALIDSTART", "attempt-started event artifact name is not canonical");
  }
  return cloneJson(event, "attempt-started event");
}

export function nodeAttemptPhaseArtifactName(startedEvent, phase) {
  const event = assertStartedEvent(startedEvent);
  if (!PHASES.has(phase)) fail("EINVALIDPHASE", `invalid attempt phase ${phase}`);
  return event.artifactName.replace(/_started\.json$/, `_${phase}.json`);
}

// Short alias used by the benchmark spec when phase names are already scoped to an attempt.
export const phaseArtifactName = nodeAttemptPhaseArtifactName;

const slotFor = (event) => ({
  id: event.slotId,
  passIndex: event.passIndex,
  variant: event.variant,
});

function assertTerminalPost(post, label) {
  if (post.identityAfterVerified !== true && post.harnessError == null) {
    fail(
      "EPOSTNOTTERMINAL",
      `${label} must assert identityAfterVerified or contain harnessError`,
    );
  }
}

function assertSessionResult(value, label) {
  const hasSession = value.session != null;
  const hasError = value.sessionError != null;
  if (hasSession === hasError) {
    fail("EINVALIDSESSION", `${label} must contain exactly one of session or sessionError`);
  }
}

export function createNodeAttemptJournal({ evidenceDir, ledgerPath, identity, now } = {}) {
  if (typeof evidenceDir !== "string" || evidenceDir.length === 0) {
    fail("EINVALIDCONFIG", "evidenceDir is required");
  }
  if (typeof ledgerPath !== "string" || ledgerPath.length === 0) {
    fail("EINVALIDCONFIG", "ledgerPath is required");
  }
  const frozenIdentity = cloneJson(identity, "journal identity");
  let frozenCalibrationPolicy;
  try {
    frozenCalibrationPolicy = validateCpuCalibrationPolicy(frozenIdentity?.policy?.preflight);
  } catch (error) {
    fail("EINVALIDCONFIG", `identity CPU calibration policy: ${error.message}`);
  }
  const identityPrefix = frozenIdentity?.identitySha256?.slice(0, 16);
  if (typeof identityPrefix !== "string" || !/^[0-9a-f]{16}$/i.test(identityPrefix)) {
    fail("EINVALIDCONFIG", "identity.identitySha256 must begin with 16 hexadecimal characters");
  }
  if (now !== undefined && typeof now !== "function") {
    fail("EINVALIDCONFIG", "now must be a function");
  }
  const timestamp = () => {
    const value = now ? now() : new Date().toISOString();
    if (typeof value !== "string" || value.length === 0) {
      fail("EINVALIDTIME", "now must return a non-empty timestamp string");
    }
    return value;
  };

  const assertIdentity = (candidate, label) => {
    if (!sameJson(candidate, frozenIdentity)) {
      fail("EIDENTITY", `${label} does not match the journal identity`);
    }
  };

  const validateCalibration = (value, label, { optional = false } = {}) => {
    try {
      return validatePersistedCpuCalibration(value, frozenCalibrationPolicy, {
        optional,
        label,
      });
    } catch (error) {
      fail("EINVALIDCALIBRATION", `${label}: ${error.message}`);
    }
  };

  const assertLedger = (value) => {
    const ledger = validateNodeBenchmarkLedger(value);
    assertIdentity(ledger.identity, "ledger");
    return ledger;
  };

  const artifactLocation = (name) => {
    if (typeof name !== "string" || !name.endsWith(".json") || name.includes("/") || name.includes("\\")) {
      fail("EINVALIDARTIFACT", "attempt artifact name must be a plain JSON filename");
    }
    const relativeName = join("attempts", identityPrefix, name);
    return { relativeName, filePath: join(evidenceDir, relativeName) };
  };

  const readArtifact = async (name) => {
    const location = artifactLocation(name);
    let value;
    try {
      value = await readJson(location.filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      fail("EARTIFACTREAD", `invalid attempt artifact ${location.relativeName}: ${error.message}`, {
        cause: error,
        ...location,
      });
    }
    return { ...location, value: cloneJson(value, `artifact ${location.relativeName}`) };
  };

  const assertArtifactOwner = (artifact, startedEvent) => {
    const event = assertStartedEvent(startedEvent);
    assertIdentity(artifact.value.identity, `artifact ${artifact.relativeName}`);
    if (artifact.value.attemptId !== event.attemptId) {
      fail("EARTIFACTATTEMPT", `attempt artifact id mismatch: ${artifact.relativeName}`);
    }
    const expectedSlot = slotFor(event);
    if (["id", "passIndex", "variant"].some(
      (field) => artifact.value.slot?.[field] !== expectedSlot[field],
    )) {
      fail("EARTIFACTSLOT", `attempt artifact slot mismatch: ${artifact.relativeName}`);
    }
  };

  const publishPhase = async (startedEvent, phase, body) => {
    const event = assertStartedEvent(startedEvent);
    assertIdentity(event.identity, "attempt-started event");
    const name = nodeAttemptPhaseArtifactName(event, phase);
    const location = artifactLocation(name);
    const value = {
      kind: `e4-t32-node-attempt-${phase}`,
      recordedAt: timestamp(),
      identity: cloneJson(frozenIdentity),
      attemptId: event.attemptId,
      slot: slotFor(event),
      ...cloneJson(body, `${phase} artifact body`),
    };
    await writeJsonExclusiveAtomic(location.filePath, value);
    return { ...location, value: cloneJson(value) };
  };

  const writePre = async (startedEvent, { preCalibration = null, harnessError = null } = {}) => {
    if (preCalibration == null && harnessError == null) {
      fail("EINVALIDPRE", "pre artifact needs preCalibration or harnessError");
    }
    const canonical = validateCalibration(preCalibration, "preCalibration", { optional: true });
    return publishPhase(startedEvent, "pre", { preCalibration: canonical, harnessError });
  };

  const writeSession = async (startedEvent, { session = null, sessionError = null } = {}) => {
    assertSessionResult({ session, sessionError }, "session artifact");
    return publishPhase(startedEvent, "session", { session, sessionError });
  };

  const writePost = async (
    startedEvent,
    { postCalibration = null, harnessError = null, identityAfterVerified = false } = {},
  ) => {
    const canonical = validateCalibration(postCalibration, "postCalibration", { optional: true });
    const body = { postCalibration: canonical, harnessError, identityAfterVerified };
    assertTerminalPost(body, "post artifact");
    return publishPhase(startedEvent, "post", body);
  };

  const startedSidecarValue = (event) => ({
    kind: "e4-t32-node-attempt-started",
    recordedAt: timestamp(),
    identity: cloneJson(frozenIdentity),
    event: cloneJson(event, "started event"),
  });

  const finishedSidecarValue = (event) => {
    const startedName = nodeBenchmarkAttemptArtifactName(
      event.attemptOrdinal,
      event.attemptId,
      "started",
    );
    const syntheticStart = {
      type: "attempt-started",
      attemptOrdinal: event.attemptOrdinal,
      attemptId: event.attemptId,
      artifactName: startedName,
    };
    const pointer = (name) => artifactLocation(name).relativeName;
    return {
      kind: "e4-t32-node-attempt-finished",
      recordedAt: timestamp(),
      identity: cloneJson(frozenIdentity),
      event: cloneJson(event, "finished event"),
      artifacts: {
        started: pointer(startedName),
        pre: pointer(nodeAttemptPhaseArtifactName(syntheticStart, "pre")),
        session: pointer(nodeAttemptPhaseArtifactName(syntheticStart, "session")),
        post: pointer(nodeAttemptPhaseArtifactName(syntheticStart, "post")),
        finished: pointer(event.artifactName),
      },
    };
  };

  const ensureEventSidecar = async (event, expected, label) => {
    assertIdentity(event.identity, `${label} event`);
    const location = artifactLocation(event.artifactName);
    const ensured = await ensureJsonArtifact(
      location.filePath,
      expected,
      (actual) => sameJson(actual.event ?? actual, event),
    );
    return { ...location, created: ensured.created, value: ensured.value };
  };

  const ensureStarted = async (event) => {
    const started = assertStartedEvent(event);
    return ensureEventSidecar(started, startedSidecarValue(started), "started");
  };

  const ensureFinished = async (event) => {
    if (!event || typeof event !== "object" || event.type !== "attempt-finished") {
      fail("EINVALIDFINISH", "finished sidecar requires an attempt-finished event");
    }
    const expectedName = nodeBenchmarkAttemptArtifactName(
      event.attemptOrdinal,
      event.attemptId,
      "finished",
    );
    if (event.artifactName !== expectedName) {
      fail("EINVALIDFINISH", "attempt-finished event artifact name is not canonical");
    }
    const finished = cloneJson(event, "finished event");
    return ensureEventSidecar(finished, finishedSidecarValue(finished), "finished");
  };

  const persistLedger = async (value) => {
    const ledger = assertLedger(value);
    let existing = null;
    try {
      existing = parseNodeBenchmarkLedger(JSON.stringify(await readJson(ledgerPath)));
      assertIdentity(existing.identity, "persisted ledger");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing) {
      const merged = mergeNodeBenchmarkLedgers(existing, ledger);
      if (!sameJson(merged, ledger)) {
        fail("ELEDGERREGRESSION", "refusing to replace the ledger with an earlier revision");
      }
      if (sameJson(existing, ledger)) return cloneJson(ledger);
    }
    await atomicReplaceJson(ledgerPath, JSON.parse(serializeNodeBenchmarkLedger(ledger)));
    return cloneJson(ledger);
  };

  const persistBegunAttempt = async ({ ledger, event }, { afterIndexPersisted } = {}) => {
    const candidate = assertLedger(ledger);
    const authoritativeOpen = activeNodeBenchmarkAttempt(candidate);
    if (!authoritativeOpen || !sameJson(authoritativeOpen, event)) {
      fail("EOPENATTEMPT", "started sidecar event must match the authoritative open ledger event");
    }
    const persisted = await persistLedger(candidate);
    await afterIndexPersisted?.({ ledger: cloneJson(persisted), event: cloneJson(event) });
    const artifact = await ensureStarted(event);
    return { ledger: persisted, event: cloneJson(event), artifact };
  };

  const finishAndPersist = async (ledgerValue, input, { afterIndexClosed } = {}) => {
    const ledger = assertLedger(ledgerValue);
    const finished = finishNodeBenchmarkAttempt(ledger, {
      ...cloneJson(input, "finish input"),
      identity: cloneJson(frozenIdentity),
    });
    // The index is the authority. It must contain the terminal event before its convenience
    // sidecar appears; a crash in this gap is healed from the index on the next invocation.
    await persistLedger(finished.ledger);
    await afterIndexClosed?.({ ledger: cloneJson(finished.ledger), event: cloneJson(finished.event) });
    const artifact = await ensureFinished(finished.event);
    return { ...finished, artifact };
  };

  const abandonAndPersist = async (ledgerValue, startedEvent, note = null, options = {}) => {
    const ledger = assertLedger(ledgerValue);
    const authoritativeOpen = activeNodeBenchmarkAttempt(ledger);
    if (!authoritativeOpen || !sameJson(authoritativeOpen, startedEvent)) {
      fail("EOPENATTEMPT", "abandonment must match the authoritative open ledger event");
    }
    const abandoned = abandonOpenNodeBenchmarkAttempt(ledger, {
      attemptId: startedEvent.attemptId,
      note,
    });
    await persistLedger(abandoned.ledger);
    await options.afterIndexClosed?.({
      ledger: cloneJson(abandoned.ledger),
      event: cloneJson(abandoned.event),
    });
    const artifact = await ensureFinished(abandoned.event);
    return { ...abandoned, artifact };
  };

  const healEventSidecars = async (ledgerValue) => {
    const ledger = assertLedger(ledgerValue);
    const artifacts = [];
    for (const event of ledger.events) {
      artifacts.push(event.type === "attempt-started"
        ? await ensureStarted(event)
        : await ensureFinished(event));
    }
    return artifacts;
  };

  const recoverOpenAttempt = async (ledgerValue, expectedOpen = null) => {
    const ledger = assertLedger(ledgerValue);
    const open = activeNodeBenchmarkAttempt(ledger);
    if (!open) fail("ENOOPENATTEMPT", "ledger has no open attempt to recover");
    if (expectedOpen && !sameJson(open, expectedOpen)) {
      fail("EOPENATTEMPT", "requested recovery does not match the authoritative open attempt");
    }
    assertIdentity(open.identity, "open attempt");
    await ensureStarted(open);

    const [pre, sessionArtifact, post] = await Promise.all([
      readArtifact(nodeAttemptPhaseArtifactName(open, "pre")),
      readArtifact(nodeAttemptPhaseArtifactName(open, "session")),
      readArtifact(nodeAttemptPhaseArtifactName(open, "post")),
    ]);
    for (const artifact of [pre, sessionArtifact, post].filter(Boolean)) {
      assertArtifactOwner(artifact, open);
    }

    if (!pre) {
      if (sessionArtifact || post) {
        fail("EPHASEORDER", "session/post artifact exists without its preceding pre artifact");
      }
      return {
        recoveredCompletePhases: false,
        ...await abandonAndPersist(ledger, open, {
          recoveredAt: timestamp(),
          reason: "interrupted before a complete pre-calibration artifact",
        }),
      };
    }

    const preCalibration = pre.value.preCalibration ?? null;
    const preHarnessError = pre.value.harnessError ?? null;
    if (preCalibration == null && preHarnessError == null) {
      fail("EINVALIDPRE", `pre artifact has no verdict: ${pre.relativeName}`);
    }
    const canonicalPre = validateCalibration(
      preCalibration,
      `pre artifact ${pre.relativeName}`,
      { optional: true },
    );
    if (preHarnessError != null || canonicalPre?.clean === false) {
      if (sessionArtifact || post) {
        fail("EPHASEORDER", "session/post artifact follows a terminal pre artifact");
      }
      return {
        recoveredCompletePhases: true,
        phaseArtifacts: { pre, session: null, post: null },
        ...await finishAndPersist(ledger, {
          attemptId: open.attemptId,
          preCalibration: canonicalPre,
          postCalibration: null,
          session: null,
          sessionError: null,
          harnessError: preHarnessError,
        }),
      };
    }

    if (!sessionArtifact && post) {
      fail("EPHASEORDER", "post artifact exists without its preceding session artifact");
    }
    if (!sessionArtifact || !post) {
      return {
        recoveredCompletePhases: false,
        phaseArtifacts: { pre, session: sessionArtifact, post },
        ...await abandonAndPersist(ledger, open, {
          recoveredAt: timestamp(),
          reason: "interrupted before complete session/post-calibration artifacts",
          hadSessionArtifact: Boolean(sessionArtifact),
          hadPostArtifact: Boolean(post),
        }),
      };
    }

    assertSessionResult(sessionArtifact.value, `session artifact ${sessionArtifact.relativeName}`);
    assertTerminalPost(post.value, `post artifact ${post.relativeName}`);
    const postCalibration = validateCalibration(
      post.value.postCalibration ?? null,
      `post artifact ${post.relativeName}`,
      { optional: true },
    );
    const session = sessionArtifact.value.session == null
      ? null
      : cloneJson(sessionArtifact.value.session, "recovered session");
    const sessionError = sessionArtifact.value.sessionError == null
      ? null
      : cloneJson(sessionArtifact.value.sessionError, "recovered session error");
    if (session) {
      session.cpuPreflight = {
        before: canonicalPre.evidence ?? null,
        after: postCalibration?.evidence ?? null,
      };
    }
    return {
      recoveredCompletePhases: true,
      phaseArtifacts: { pre, session: sessionArtifact, post },
      ...await finishAndPersist(ledger, {
        attemptId: open.attemptId,
        preCalibration: canonicalPre,
        postCalibration,
        session,
        sessionError,
        harnessError: post.value.harnessError ?? null,
      }),
    };
  };

  const loadLedger = async () => {
    const ledger = parseNodeBenchmarkLedger(JSON.stringify(await readJson(ledgerPath)));
    return assertLedger(ledger);
  };

  return Object.freeze({
    ledgerPath,
    identity: Object.freeze(cloneJson(frozenIdentity)),
    artifactLocation,
    readArtifact,
    writePre,
    writeSession,
    writePost,
    ensureStarted,
    ensureFinished,
    healEventSidecars,
    persistLedger,
    persistBegunAttempt,
    finishAndPersist,
    abandonAndPersist,
    recoverOpenAttempt,
    loadLedger,
  });
}
