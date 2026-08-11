import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activeNodeBenchmarkAttempt,
  beginNodeBenchmarkAttempt,
  createNodeBenchmarkLedger,
  deriveNodeBenchmarkResults,
  finishNodeBenchmarkAttempt,
  nextNodeBenchmarkSlot,
  nodeBenchmarkSequencePrefix,
  nodeBenchmarkLedgerStatus,
} from "./helpers/e4-t32-node-ledger.mjs";
import {
  createNodeAttemptJournal,
  nodeAttemptPhaseArtifactName,
} from "./helpers/e4-t32-node-attempt-journal.mjs";
import {
  readJson,
  writeJsonExclusiveAtomic,
} from "./helpers/e4-t32-node-ledger-store.mjs";

const identity = {
  identitySha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  candidate: { head: "0123456789abcdef", clean: true },
  policy: { version: "e4-t32-v2" },
};

const cleanCalibration = (label) => ({
  clean: true,
  evidence: { label, realmRatio: 1.001, pairsHeld: 8 },
});
const dirtyCalibration = (label) => ({
  clean: false,
  evidence: { label, realmRatio: 1.3, pairsHeld: 6 },
});

function sessionFor(open) {
  const sequencePrefix = nodeBenchmarkSequencePrefix(open);
  const run = (index, firstMs, completeMs) => {
    const nodePid = 900 + index;
    const nodeSequence = `${sequencePrefix}_${index}`;
    const completionMarker = `__E4T32_NODE_DONE_${nodeSequence}_${nodePid}_0`;
    return {
      firstMs,
      completeMs,
      stretchMs: completeMs - firstMs,
      exit: 0,
      nodeSequence,
      nodeCommand: "node -e 'console.log(3)'",
      nodePid,
      outputLine: "3",
      completionMarker,
      oracleTranscript: `3\n${completionMarker}\n`,
    };
  };
  return {
    variant: open.variant,
    passIndex: open.passIndex,
    backend: open.variant === "main-interp" ? "main-thread" : "whole-machine-worker",
    runs: [
      run(0, 100, 120),
      run(1, 80, 99),
    ],
    sequencePrefix,
  };
}

async function withJournal(run) {
  const directory = await mkdtemp(join(tmpdir(), "e4-t32-attempt-journal-"));
  let tick = 0;
  const journal = createNodeAttemptJournal({
    evidenceDir: directory,
    ledgerPath: join(directory, "ledger.json"),
    identity,
    now: () => `2026-08-10T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
  try {
    return await run({ directory, journal });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function beginPersisted(journal, attemptId = "attempt-0") {
  const initial = createNodeBenchmarkLedger(identity);
  const slot = nextNodeBenchmarkSlot(initial);
  const begun = beginNodeBenchmarkAttempt(initial, {
    attemptId,
    slotId: slot.id,
    identity,
  });
  await journal.persistBegunAttempt(begun);
  return begun;
}

async function writeCompletePhases(
  journal,
  open,
  { preCalibration = cleanCalibration("before"), postCalibration = cleanCalibration("after"),
    session = sessionFor(open), sessionError = null, harnessError = null } = {},
) {
  await journal.writePre(open, { preCalibration });
  await journal.writeSession(open, { session, sessionError });
  await journal.writePost(open, {
    postCalibration,
    harnessError,
    identityAfterVerified: harnessError == null,
  });
}

test("phase names are canonical and phase publication is append-only", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "append-only");
    assert.match(nodeAttemptPhaseArtifactName(begun.event, "pre"), /_pre\.json$/);
    assert.throws(
      () => nodeAttemptPhaseArtifactName(begun.event, "unknown"),
      (error) => error.code === "EINVALIDPHASE",
    );
    await journal.writePre(begun.event, { preCalibration: cleanCalibration("before") });
    await assert.rejects(
      journal.writePre(begun.event, { preCalibration: dirtyCalibration("replacement") }),
      (error) => error.code === "EEXIST",
    );
  });
});

test("the index is authoritative for started sidecars", async () => {
  await withJournal(async ({ journal }) => {
    const initial = createNodeBenchmarkLedger(identity);
    const begun = beginNodeBenchmarkAttempt(initial, {
      attemptId: "authoritative-start",
      slotId: nextNodeBenchmarkSlot(initial).id,
      identity,
    });
    await assert.rejects(
      journal.persistBegunAttempt({
        ledger: begun.ledger,
        event: { ...begun.event, variant: "worker-interp" },
      }),
      (error) => error.code === "EOPENATTEMPT",
    );
    await journal.persistBegunAttempt(begun);
    assert.deepEqual(await journal.loadLedger(), begun.ledger);
  });
});

test("crash after a clean post artifact recovers the first clean attempt as accepted", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "clean-before-finish");
    await writeCompletePhases(journal, begun.event);

    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger(), begun.event);
    assert.equal(recovered.recoveredCompletePhases, true);
    assert.equal(recovered.event.outcome, "accepted");
    assert.equal(recovered.event.reason, "clean");
    assert.equal(nodeBenchmarkLedgerStatus(recovered.ledger), "running");
    assert.equal(nextNodeBenchmarkSlot(recovered.ledger).id, "p0:worker-interp");
    assert.deepEqual(
      deriveNodeBenchmarkResults(recovered.ledger)["main-interp"].acceptedAttemptIds,
      ["clean-before-finish"],
    );
    assert.equal(
      recovered.event.session.cpuPreflight.before.label,
      "before",
      "recovery must attach the staged calibration evidence to the accepted session",
    );
    assert.deepEqual(
      recovered.event.session.runs.map((run) => ({
        nodeSequence: run.nodeSequence,
        nodeCommand: run.nodeCommand,
        nodePid: run.nodePid,
        outputLine: run.outputLine,
        completionMarker: run.completionMarker,
        oracleTranscript: run.oracleTranscript,
      })),
      sessionFor(begun.event).runs.map((run) => ({
        nodeSequence: run.nodeSequence,
        nodeCommand: run.nodeCommand,
        nodePid: run.nodePid,
        outputLine: run.outputLine,
        completionMarker: run.completionMarker,
        oracleTranscript: run.oracleTranscript,
      })),
      "crash recovery must retain every bounded raw Node oracle field",
    );
  });
});

test("a clean staged session error refutes instead of being retried", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "clean-product-error");
    await writeCompletePhases(journal, begun.event, {
      session: null,
      sessionError: { name: "Error", message: "Node exited 9" },
    });
    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger());
    assert.equal(recovered.event.outcome, "refuted");
    assert.equal(recovered.event.reason, "session-error");
    assert.equal(nodeBenchmarkLedgerStatus(recovered.ledger), "refuted");
  });
});

test("a successful session with dirty postflight is discarded as environment-inconclusive", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "dirty-post-success");
    await writeCompletePhases(journal, begun.event, {
      postCalibration: dirtyCalibration("after"),
    });
    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger());
    assert.equal(recovered.event.outcome, "inconclusive");
    assert.equal(recovered.event.reason, "calibration-contaminated");
    assert.equal(nextNodeBenchmarkSlot(recovered.ledger).attemptsUsed, 1);
    assert.equal(deriveNodeBenchmarkResults(recovered.ledger)["main-interp"].runs.length, 0);
  });
});

test("a session error plus dirty postflight is terminal mixed-inconclusive", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "mixed-post-error");
    await writeCompletePhases(journal, begun.event, {
      postCalibration: dirtyCalibration("after"),
      session: null,
      sessionError: { name: "Error", message: "Node timed out" },
    });
    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger());
    assert.equal(recovered.event.outcome, "mixed-inconclusive");
    assert.equal(recovered.event.reason, "session-error-with-contaminated-calibration");
    assert.equal(nodeBenchmarkLedgerStatus(recovered.ledger), "mixed-inconclusive");
  });
});

test("a terminal post harness error recovers as a harness outcome", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "post-harness-error");
    await writeCompletePhases(journal, begun.event, {
      postCalibration: null,
      harnessError: { name: "Error", message: "browser disconnected" },
    });
    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger());
    assert.equal(recovered.event.outcome, "harness-error");
    assert.equal(recovered.event.reason, "unexpected-harness-error");
    assert.equal(nodeBenchmarkLedgerStatus(recovered.ledger), "harness-error");
  });
});

test("only genuinely incomplete phases become an orphaned attempt", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "missing-post");
    await journal.writePre(begun.event, { preCalibration: cleanCalibration("before") });
    await journal.writeSession(begun.event, { session: sessionFor(begun.event) });

    const recovered = await journal.recoverOpenAttempt(await journal.loadLedger());
    assert.equal(recovered.recoveredCompletePhases, false);
    assert.equal(recovered.event.outcome, "inconclusive");
    assert.equal(recovered.event.reason, "orphaned-attempt");
    assert.equal(nextNodeBenchmarkSlot(recovered.ledger).attemptsUsed, 1);
  });

  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "post-without-session");
    await journal.writePre(begun.event, { preCalibration: cleanCalibration("before") });
    const postPath = journal.artifactLocation(nodeAttemptPhaseArtifactName(begun.event, "post"));
    await writeJsonExclusiveAtomic(postPath.filePath, {
      identity,
      attemptId: begun.event.attemptId,
      slot: {
        id: begun.event.slotId,
        passIndex: begun.event.passIndex,
        variant: begun.event.variant,
      },
      postCalibration: cleanCalibration("after"),
      identityAfterVerified: true,
      harnessError: null,
    });
    await assert.rejects(
      journal.recoverOpenAttempt(await journal.loadLedger()),
      (error) => error.code === "EPHASEORDER",
      "contradictory phase order must not be mislabeled as an interrupted run",
    );
    assert.equal(nodeBenchmarkLedgerStatus(await journal.loadLedger()), "attempt-open");
  });
});

test("recovery validates artifact identity, attempt id, slot, and terminal post verdict", async () => {
  for (const [label, mutate, code] of [
    ["identity", (value) => { value.identity.candidate.head = "other"; }, "EIDENTITY"],
    ["attempt id", (value) => { value.attemptId = "other"; }, "EARTIFACTATTEMPT"],
    ["slot", (value) => { value.slot.variant = "worker-interp"; }, "EARTIFACTSLOT"],
  ]) {
    await withJournal(async ({ journal }) => {
      const begun = await beginPersisted(journal, `bad-${label}`);
      const location = journal.artifactLocation(nodeAttemptPhaseArtifactName(begun.event, "pre"));
      const value = {
        identity: structuredClone(identity),
        attemptId: begun.event.attemptId,
        slot: {
          id: begun.event.slotId,
          passIndex: begun.event.passIndex,
          variant: begun.event.variant,
        },
        preCalibration: cleanCalibration("before"),
        harnessError: null,
      };
      mutate(value);
      await writeJsonExclusiveAtomic(location.filePath, value);
      await assert.rejects(
        journal.recoverOpenAttempt(await journal.loadLedger()),
        (error) => error.code === code,
        label,
      );
    });
  }

  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "post-no-terminal-verdict");
    await journal.writePre(begun.event, { preCalibration: cleanCalibration("before") });
    await journal.writeSession(begun.event, { session: sessionFor(begun.event) });
    const location = journal.artifactLocation(nodeAttemptPhaseArtifactName(begun.event, "post"));
    await writeJsonExclusiveAtomic(location.filePath, {
      identity,
      attemptId: begun.event.attemptId,
      slot: {
        id: begun.event.slotId,
        passIndex: begun.event.passIndex,
        variant: begun.event.variant,
      },
      postCalibration: cleanCalibration("after"),
      identityAfterVerified: false,
      harnessError: null,
    });
    await assert.rejects(
      journal.recoverOpenAttempt(await journal.loadLedger()),
      (error) => error.code === "EPOSTNOTTERMINAL",
    );
  });
});

test("closed index heals a missing or preexisting finish sidecar and rejects conflicts", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "closed-no-sidecar");
    const input = {
      attemptId: begun.event.attemptId,
      preCalibration: cleanCalibration("before"),
      postCalibration: cleanCalibration("after"),
      session: sessionFor(begun.event),
    };
    await assert.rejects(
      journal.finishAndPersist(begun.ledger, input, {
        afterIndexClosed: () => { throw new Error("simulated crash after index close"); },
      }),
      /simulated crash/,
    );
    const closed = await journal.loadLedger();
    assert.equal(closed.events.at(-1).outcome, "accepted");
    const finishLocation = journal.artifactLocation(closed.events.at(-1).artifactName);
    await assert.rejects(readJson(finishLocation.filePath), (error) => error.code === "ENOENT");

    const firstHeal = await journal.healEventSidecars(closed);
    assert.equal(firstHeal.at(-1).created, true);
    const secondHeal = await journal.healEventSidecars(closed);
    assert.equal(secondHeal.at(-1).created, false);
  });

  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "closed-conflict");
    const finished = finishNodeBenchmarkAttempt(begun.ledger, {
      attemptId: begun.event.attemptId,
      identity,
      preCalibration: cleanCalibration("before"),
      postCalibration: cleanCalibration("after"),
      session: sessionFor(begun.event),
    });
    await journal.persistLedger(finished.ledger);
    const location = journal.artifactLocation(finished.event.artifactName);
    await writeJsonExclusiveAtomic(location.filePath, {
      kind: "e4-t32-node-attempt-finished",
      identity,
      event: { ...finished.event, reason: "tampered" },
    });
    await assert.rejects(
      journal.healEventSidecars(await journal.loadLedger()),
      (error) => error.code === "EARTIFACTMISMATCH",
    );
  });
});

test("persist refuses ledger regression after an append-only extension", async () => {
  await withJournal(async ({ journal }) => {
    const begun = await beginPersisted(journal, "persist-extension");
    const finished = finishNodeBenchmarkAttempt(begun.ledger, {
      attemptId: begun.event.attemptId,
      identity,
      preCalibration: cleanCalibration("before"),
      postCalibration: cleanCalibration("after"),
      session: sessionFor(activeNodeBenchmarkAttempt(begun.ledger)),
    });
    await journal.persistLedger(finished.ledger);
    await assert.rejects(
      journal.persistLedger(begun.ledger),
      (error) => error.code === "ELEDGERREGRESSION",
    );
  });
});
