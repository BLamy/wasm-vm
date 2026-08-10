import assert from "node:assert/strict";
import test from "node:test";

import {
  E4T32_NODE_MAX_ATTEMPTS_PER_SLOT,
  E4T32_NODE_SLOT_PLAN,
  abandonOpenNodeBenchmarkAttempt,
  activeNodeBenchmarkAttempt,
  assertNodeBenchmarkComplete,
  beginNodeBenchmarkAttempt,
  createNodeBenchmarkLedger,
  deriveNodeBenchmarkResults,
  finishNodeBenchmarkAttempt,
  mergeNodeBenchmarkLedgers,
  nextNodeBenchmarkSlot,
  nodeBenchmarkAttemptArtifactName,
  nodeBenchmarkLedgerStatus,
  parseNodeBenchmarkLedger,
  serializeNodeBenchmarkLedger,
  validateNodeBenchmarkLedger,
} from "./helpers/e4-t32-node-ledger.mjs";

const identity = {
  commit: "0123456789abcdef",
  manifest: {
    sha256: "ac6a2988",
    chunkCount: 6_144,
    artifacts: {
      kernelSha256: "kernel",
      bootSnapshotSha256: "snapshot",
      overlayDeltaSha256: "overlay",
    },
  },
  matrix: { processesPerSession: 2, localAssets: true },
};

const calibration = (clean, label) => ({ clean, label, samples: 8 });

function sessionFor(slot, firstValues = [100, 200]) {
  return {
    variant: slot.variant,
    passIndex: slot.passIndex,
    backend: slot.variant === "main-interp" ? "main-thread" : "whole-machine-worker",
    runs: firstValues.map((firstMs, index) => ({
      firstMs,
      completeMs: firstMs + 10 + index,
      stretchMs: 10 + index,
    })),
  };
}

function begin(ledger, attemptId) {
  const slot = nextNodeBenchmarkSlot(ledger);
  assert.ok(slot, "test expected another slot");
  return beginNodeBenchmarkAttempt(ledger, {
    attemptId,
    slotId: slot.id,
    identity,
  });
}

function finishClean(ledger, attemptId, values) {
  const open = activeNodeBenchmarkAttempt(ledger);
  assert.equal(open?.attemptId, attemptId);
  return finishNodeBenchmarkAttempt(ledger, {
    attemptId,
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(true, "after"),
    session: sessionFor(open, values),
  });
}

function acceptAllSlots(ledger, prefix = "clean", valuesFor = () => [100, 200]) {
  let next = ledger;
  let index = 0;
  while (nextNodeBenchmarkSlot(next)) {
    const slot = nextNodeBenchmarkSlot(next);
    const attemptId = `${prefix}-${index}`;
    next = begin(next, attemptId).ledger;
    next = finishClean(next, attemptId, valuesFor(slot, index)).ledger;
    index += 1;
  }
  return next;
}

test("fixed plan is balanced, ordered, and only exposes the earliest incomplete slot", () => {
  assert.deepEqual(E4T32_NODE_SLOT_PLAN, [
    { id: "p0:main-interp", passIndex: 0, variant: "main-interp" },
    { id: "p0:worker-interp", passIndex: 0, variant: "worker-interp" },
    { id: "p0:worker-jit512", passIndex: 0, variant: "worker-jit512" },
    { id: "p1:worker-jit512", passIndex: 1, variant: "worker-jit512" },
    { id: "p1:worker-interp", passIndex: 1, variant: "worker-interp" },
    { id: "p1:main-interp", passIndex: 1, variant: "main-interp" },
  ]);
  assert.equal(E4T32_NODE_MAX_ATTEMPTS_PER_SLOT, 3);

  const initial = createNodeBenchmarkLedger(identity);
  assert.deepEqual(nextNodeBenchmarkSlot(initial), {
    ...E4T32_NODE_SLOT_PLAN[0],
    slotIndex: 0,
    attemptsUsed: 0,
    attemptsRemaining: 3,
  });
  assert.throws(
    () => beginNodeBenchmarkAttempt(initial, {
      attemptId: "wrong-slot",
      slotId: E4T32_NODE_SLOT_PLAN[1].id,
      identity,
    }),
    (error) => error.code === "out-of-order-slot",
  );

  const started = begin(initial, "plan-0");
  assert.equal(nodeBenchmarkLedgerStatus(started.ledger), "attempt-open");
  assert.equal(nextNodeBenchmarkSlot(started.ledger), null);
  assert.equal(activeNodeBenchmarkAttempt(started.ledger).attemptId, "plan-0");
  assert.throws(
    () => beginNodeBenchmarkAttempt(started.ledger, { attemptId: "plan-1", identity }),
    (error) => error.code === "open-attempt",
  );
  assert.deepEqual(initial.events, [], "begin must return a new append-only ledger");
});

test("started and finished event/artifact IDs cannot collide", () => {
  let ledger = createNodeBenchmarkLedger(identity);
  const first = begin(ledger, "same-ish/a");
  ledger = abandonOpenNodeBenchmarkAttempt(first.ledger, { attemptId: "same-ish/a" }).ledger;
  const second = begin(ledger, "same-ish_a");
  ledger = abandonOpenNodeBenchmarkAttempt(second.ledger, { attemptId: "same-ish_a" }).ledger;
  const eventIds = ledger.events.map((event) => event.eventId);
  const artifactNames = ledger.events.map((event) => event.artifactName);
  assert.equal(new Set(eventIds).size, eventIds.length);
  assert.equal(new Set(artifactNames).size, artifactNames.length);
  assert.notEqual(
    nodeBenchmarkAttemptArtifactName(0, "same-ish/a", "started"),
    nodeBenchmarkAttemptArtifactName(0, "same-ish_a", "started"),
  );
  assert.throws(
    () => begin(ledger, "same-ish/a"),
    (error) => error.code === "duplicate-attempt-id",
  );
});

test("bad preflight and successful session with bad postflight are durable retries, never accepted", () => {
  let ledger = createNodeBenchmarkLedger(identity);
  ledger = begin(ledger, "bad-pre").ledger;
  let finished = finishNodeBenchmarkAttempt(ledger, {
    attemptId: "bad-pre",
    identity,
    preCalibration: calibration(false, "before"),
    postCalibration: null,
  });
  assert.deepEqual(
    { outcome: finished.event.outcome, reason: finished.event.reason },
    { outcome: "inconclusive", reason: "calibration-contaminated" },
  );
  ledger = finished.ledger;
  assert.equal(nextNodeBenchmarkSlot(ledger).attemptsUsed, 1);

  ledger = begin(ledger, "bad-post").ledger;
  const open = activeNodeBenchmarkAttempt(ledger);
  finished = finishNodeBenchmarkAttempt(ledger, {
    attemptId: "bad-post",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(false, "after"),
    session: sessionFor(open, [1, 2]),
  });
  ledger = finished.ledger;
  assert.equal(finished.event.outcome, "inconclusive");
  assert.equal(deriveNodeBenchmarkResults(ledger)["main-interp"].runs.length, 0);
  assert.equal(nextNodeBenchmarkSlot(ledger).attemptsUsed, 2);

  ledger = begin(ledger, "first-clean").ledger;
  ledger = finishClean(ledger, "first-clean", [100, 200]).ledger;
  assert.equal(nextNodeBenchmarkSlot(ledger).id, "p0:worker-interp");
  assert.deepEqual(
    deriveNodeBenchmarkResults(ledger)["main-interp"].acceptedAttemptIds,
    ["first-clean"],
  );
  assert.throws(
    () => beginNodeBenchmarkAttempt(ledger, {
      attemptId: "late-main-retry",
      slotId: "p0:main-interp",
      identity,
    }),
    (error) => error.code === "out-of-order-slot",
  );
});

test("deep identity mismatch fails closed at begin and at finish", () => {
  const initial = createNodeBenchmarkLedger(identity);
  const reorderedIdentity = {
    matrix: { localAssets: true, processesPerSession: 2 },
    manifest: {
      artifacts: {
        overlayDeltaSha256: "overlay",
        bootSnapshotSha256: "snapshot",
        kernelSha256: "kernel",
      },
      chunkCount: 6_144,
      sha256: "ac6a2988",
    },
    commit: "0123456789abcdef",
  };
  assert.doesNotThrow(() => beginNodeBenchmarkAttempt(initial, {
    attemptId: "deep-equal",
    identity: reorderedIdentity,
  }));
  assert.throws(
    () => beginNodeBenchmarkAttempt(initial, {
      attemptId: "deep-mismatch",
      identity: {
        ...identity,
        manifest: { ...identity.manifest, artifacts: { ...identity.manifest.artifacts, kernelSha256: "other" } },
      },
    }),
    (error) => error.code === "identity-mismatch",
  );

  let ledger = begin(initial, "finish-mismatch").ledger;
  const open = activeNodeBenchmarkAttempt(ledger);
  const finished = finishNodeBenchmarkAttempt(ledger, {
    attemptId: "finish-mismatch",
    identity: { ...identity, manifest: { ...identity.manifest, chunkCount: 6_143 } },
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(false, "after"),
    session: sessionFor(open),
  });
  assert.equal(finished.event.outcome, "refuted", "identity dominates environment noise");
  assert.equal(finished.event.reason, "identity-mismatch");
  assert.equal(nodeBenchmarkLedgerStatus(finished.ledger), "refuted");
  assert.equal(nextNodeBenchmarkSlot(finished.ledger), null);
});

test("resume identity rejects every frozen candidate, harness, host, policy, and guest mutation", () => {
  const frozenIdentity = {
    candidate: {
      head: "head-a",
      trackedTreeClean: true,
      sourceFiles: [
        { path: "web/tests/e4-t32-node-walltime.spec.js", sha256: "harness-a" },
        { path: "web/playwright.config.js", sha256: "config-a" },
        { path: "tools/serve-dev.sh", sha256: "serve-a" },
      ],
      generatedFiles: [
        { path: "web/pkg/wasm_vm_wasm_bg.wasm", sha256: "wasm-a" },
        { path: "web/pkg/wasm_vm_wasm.js", sha256: "glue-a" },
        { path: "web/pkg/snippets/pkg/inline0.js", sha256: "snippet-a" },
      ],
    },
    harness: { playwright: "1.49.1", browserVersion: "131", browserSha256: "browser-a" },
    host: { platform: "darwin", arch: "arm64", logicalCpus: 8, cpuModels: ["Apple M2"] },
    policy: { version: "v2", plan: E4T32_NODE_SLOT_PLAN, urls: { p0: "/?worker=0" } },
    guest: {
      nodeManifestSha256: "node-a",
      kernelSha256: "kernel-a",
      bootSnapshotSha256: "snapshot-a",
      overlayDeltaSha256: "overlay-a",
    },
  };
  const mutations = [
    ["HEAD", (value) => { value.candidate.head = "head-b"; }],
    ["clean tree", (value) => { value.candidate.trackedTreeClean = false; }],
    ["harness hash", (value) => { value.candidate.sourceFiles[0].sha256 = "harness-b"; }],
    ["config hash", (value) => { value.candidate.sourceFiles[1].sha256 = "config-b"; }],
    ["serve hash", (value) => { value.candidate.sourceFiles[2].sha256 = "serve-b"; }],
    ["wasm hash", (value) => { value.candidate.generatedFiles[0].sha256 = "wasm-b"; }],
    ["glue hash", (value) => { value.candidate.generatedFiles[1].sha256 = "glue-b"; }],
    ["snippet hash", (value) => { value.candidate.generatedFiles[2].sha256 = "snippet-b"; }],
    ["Playwright", (value) => { value.harness.playwright = "1.50.0"; }],
    ["browser", (value) => { value.harness.browserSha256 = "browser-b"; }],
    ["OS", (value) => { value.host.platform = "linux"; }],
    ["architecture", (value) => { value.host.arch = "x64"; }],
    ["CPU", (value) => { value.host.cpuModels = ["other"] ; }],
    ["policy", (value) => { value.policy.version = "v3"; }],
    ["URL", (value) => { value.policy.urls.p0 = "/?jit=1"; }],
    ["Node manifest", (value) => { value.guest.nodeManifestSha256 = "node-b"; }],
    ["kernel", (value) => { value.guest.kernelSha256 = "kernel-b"; }],
    ["snapshot", (value) => { value.guest.bootSnapshotSha256 = "snapshot-b"; }],
    ["overlay", (value) => { value.guest.overlayDeltaSha256 = "overlay-b"; }],
  ];
  const ledger = createNodeBenchmarkLedger(frozenIdentity);
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(frozenIdentity);
    mutate(changed);
    assert.throws(
      () => beginNodeBenchmarkAttempt(ledger, {
        attemptId: `mismatch-${label}`,
        identity: changed,
      }),
      (error) => error.code === "identity-mismatch",
      label,
    );
  }
});

test("clean product error refutes, while product error plus contaminated postflight stops", () => {
  let cleanErrorLedger = begin(createNodeBenchmarkLedger(identity), "clean-error").ledger;
  const cleanError = finishNodeBenchmarkAttempt(cleanErrorLedger, {
    attemptId: "clean-error",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(true, "after"),
    sessionError: { name: "Error", message: "Node exited 9" },
  });
  assert.equal(cleanError.event.outcome, "refuted");
  assert.equal(cleanError.event.reason, "session-error");
  assert.equal(nodeBenchmarkLedgerStatus(cleanError.ledger), "refuted");
  assert.equal(nextNodeBenchmarkSlot(cleanError.ledger), null);

  let mixedLedger = begin(createNodeBenchmarkLedger(identity), "mixed-error").ledger;
  const mixed = finishNodeBenchmarkAttempt(mixedLedger, {
    attemptId: "mixed-error",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(false, "after"),
    sessionError: { name: "Error", message: "Node exited 9" },
  });
  mixedLedger = mixed.ledger;
  assert.equal(mixed.event.outcome, "mixed-inconclusive");
  assert.equal(mixed.event.reason, "session-error-with-contaminated-calibration");
  assert.equal(nodeBenchmarkLedgerStatus(mixedLedger), "mixed-inconclusive");
  assert.equal(nextNodeBenchmarkSlot(mixedLedger), null);
  assert.throws(
    () => beginNodeBenchmarkAttempt(mixedLedger, { attemptId: "silent-mixed-retry", identity }),
    (error) => error.code === "ledger-terminal",
  );
});

test("unexpected calibration or browser harness errors are terminal and never retryable", () => {
  let ledger = begin(createNodeBenchmarkLedger(identity), "harness-crash").ledger;
  const finished = finishNodeBenchmarkAttempt(ledger, {
    attemptId: "harness-crash",
    identity,
    preCalibration: null,
    postCalibration: null,
    harnessError: { name: "Error", message: "browser disconnected" },
  });
  ledger = finished.ledger;
  assert.equal(finished.event.outcome, "harness-error");
  assert.equal(finished.event.reason, "unexpected-harness-error");
  assert.equal(nodeBenchmarkLedgerStatus(ledger), "harness-error");
  assert.equal(nextNodeBenchmarkSlot(ledger), null);
  assert.throws(
    () => beginNodeBenchmarkAttempt(ledger, { attemptId: "silent-harness-retry", identity }),
    (error) => error.code === "ledger-terminal",
  );
});

test("three inconclusive attempts stop as environment-inconclusive", () => {
  let ledger = createNodeBenchmarkLedger(identity);
  for (let index = 0; index < 3; index += 1) {
    const id = `env-${index}`;
    ledger = begin(ledger, id).ledger;
    ledger = finishNodeBenchmarkAttempt(ledger, {
      attemptId: id,
      identity,
      preCalibration: calibration(false, "before"),
      postCalibration: null,
    }).ledger;
  }
  assert.equal(nodeBenchmarkLedgerStatus(ledger), "environment-inconclusive");
  assert.equal(nextNodeBenchmarkSlot(ledger), null);
  assert.throws(
    () => beginNodeBenchmarkAttempt(ledger, { attemptId: "env-3", identity }),
    (error) => error.code === "ledger-terminal",
  );
  assert.throws(
    () => assertNodeBenchmarkComplete(ledger),
    (error) => error.code === "ledger-incomplete",
  );
});

test("crash-orphan start survives serialization, consumes an attempt, and needs explicit abandonment", () => {
  const initial = createNodeBenchmarkLedger(identity);
  const begun = begin(initial, "crashed-before-calibration");
  const recovered = parseNodeBenchmarkLedger(serializeNodeBenchmarkLedger(begun.ledger));
  assert.equal(nodeBenchmarkLedgerStatus(recovered), "attempt-open");
  assert.equal(nextNodeBenchmarkSlot(recovered), null);
  assert.throws(
    () => beginNodeBenchmarkAttempt(recovered, { attemptId: "implicit-retry", identity }),
    (error) => error.code === "open-attempt",
  );

  const abandoned = abandonOpenNodeBenchmarkAttempt(recovered, {
    attemptId: "crashed-before-calibration",
    note: { recoveredBy: "next invocation" },
  });
  assert.equal(abandoned.event.reason, "orphaned-attempt");
  assert.equal(nextNodeBenchmarkSlot(abandoned.ledger).attemptsUsed, 1);
  assert.equal(deriveNodeBenchmarkResults(abandoned.ledger)["main-interp"].sessions.length, 0);
});

test("serialization and cross-invocation merge accept only an exact append-only extension", () => {
  const initial = createNodeBenchmarkLedger(identity);
  const begun = begin(initial, "cross-invocation").ledger;
  const persistedBefore = serializeNodeBenchmarkLedger(begun);
  const invocationTwo = parseNodeBenchmarkLedger(persistedBefore);
  const extended = finishClean(invocationTwo, "cross-invocation").ledger;
  const merged = mergeNodeBenchmarkLedgers(persistedBefore, serializeNodeBenchmarkLedger(extended));
  assert.equal(nodeBenchmarkLedgerStatus(merged), "running");
  assert.equal(nextNodeBenchmarkSlot(merged).id, "p0:worker-interp");
  assert.equal(serializeNodeBenchmarkLedger(begun), persistedBefore, "old revision stays immutable");

  const divergent = finishNodeBenchmarkAttempt(invocationTwo, {
    attemptId: "cross-invocation",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(false, "after"),
    session: sessionFor(activeNodeBenchmarkAttempt(invocationTwo), [1, 2]),
  }).ledger;
  assert.throws(
    () => mergeNodeBenchmarkLedgers(extended, divergent),
    (error) => error.code === "divergent-history",
  );

  const tampered = JSON.parse(serializeNodeBenchmarkLedger(extended));
  tampered.events[1].outcome = "inconclusive";
  assert.throws(
    () => validateNodeBenchmarkLedger(tampered),
    (error) => error.code === "invalid-event-outcome",
  );
});

test("missing or duplicate pass identity is a refutation, never accepted evidence", () => {
  let missing = begin(createNodeBenchmarkLedger(identity), "missing-pass").ledger;
  const missingSession = sessionFor(activeNodeBenchmarkAttempt(missing));
  delete missingSession.passIndex;
  const missingFinish = finishNodeBenchmarkAttempt(missing, {
    attemptId: "missing-pass",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(true, "after"),
    session: missingSession,
  });
  assert.equal(missingFinish.event.outcome, "refuted");
  assert.equal(missingFinish.event.reason, "session-slot-mismatch");

  let wrong = begin(createNodeBenchmarkLedger(identity), "duplicate-p0").ledger;
  const wrongSession = sessionFor(activeNodeBenchmarkAttempt(wrong));
  wrongSession.passIndex = 1;
  const wrongFinish = finishNodeBenchmarkAttempt(wrong, {
    attemptId: "duplicate-p0",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(true, "after"),
    session: wrongSession,
  });
  assert.equal(wrongFinish.event.outcome, "refuted");
  assert.equal(wrongFinish.event.reason, "session-slot-mismatch");
});

test("complete matrix has passes 0/1, exactly two sessions and four runs per variant", () => {
  const complete = acceptAllSlots(createNodeBenchmarkLedger(identity));
  assert.equal(nodeBenchmarkLedgerStatus(complete), "complete");
  assert.equal(nextNodeBenchmarkSlot(complete), null);
  const results = assertNodeBenchmarkComplete(complete);
  for (const result of Object.values(results)) {
    assert.equal(result.sessions.length, 2);
    assert.equal(result.runs.length, 4);
    assert.deepEqual(result.sessions.map((session) => session.passIndex).sort(), [0, 1]);
  }
  assert.throws(
    () => beginNodeBenchmarkAttempt(complete, { attemptId: "final-parity-retry", identity }),
    (error) => error.code === "ledger-terminal",
  );
});

test("rejected fast timing remains durable but cannot alter accepted medians", () => {
  let ledger = createNodeBenchmarkLedger(identity);
  ledger = begin(ledger, "suspiciously-fast").ledger;
  ledger = finishNodeBenchmarkAttempt(ledger, {
    attemptId: "suspiciously-fast",
    identity,
    preCalibration: calibration(true, "before"),
    postCalibration: calibration(false, "after"),
    session: sessionFor(activeNodeBenchmarkAttempt(ledger), [1, 2]),
  }).ledger;

  ledger = acceptAllSlots(ledger, "accepted", (slot) => {
    if (slot.variant !== "main-interp") return [300, 400];
    return slot.passIndex === 0 ? [100, 200] : [500, 600];
  });
  const results = assertNodeBenchmarkComplete(ledger);
  assert.equal(results["main-interp"].firstMedianMs, 350);
  assert.equal(results["main-interp"].completeMedianMs, 360.5);
  assert.deepEqual(results["main-interp"].runs.map((run) => run.firstMs), [100, 200, 500, 600]);
  assert.ok(
    ledger.events.some((event) => event.attemptId === "suspiciously-fast" && event.outcome === "inconclusive"),
    "discarded attempt remains in the append-only evidence log",
  );
});
