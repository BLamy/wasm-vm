import assert from "node:assert/strict";
import { decodeInputEvents, assertOriginalInputGeometry } from "./omarchy-compositor-input-capture.mjs";
import { auditInputReport } from "./omarchy-input-audit.mjs";
import { PREPARED_DIRECT_COMMAND, assertPreparedDirectProperties } from "./omarchy-prepared-direct-state.mjs";

export function auditObserverTrace(text, pid, tracerPid) {
  assert.ok(text.endsWith("\n"));
  const rows = text.trimEnd().split("\n").map(line => JSON.parse(line));
  const errors = rows.filter(row => row.kind === "error");
  const ready = rows.filter(row => row.kind === "ready");
  assert.equal(ready.length, 1); assert.equal(ready[0].pid, pid); assert.equal(ready[0].tracerPid, tracerPid);
  const identities = rows.filter(row => row.kind === "process-identity");
  assert.ok(identities.length >= ready[0].threads);
  for (const id of identities) {
    assert.equal(id.tgid, pid); assert.equal(id.tracerPid, tracerPid); assert.match(id.startTime, /^\d+$/u);
    assert.ok(id.exe.startsWith("/"));
  }
  const finished = rows.filter(row => row.kind === "finished"); assert.equal(finished.length, 1);
  assert.equal(rows.at(-1), finished[0]);
  assert.ok(finished[0].observationEndMonotonicMs >= ready[0].monotonicMs);
  assert.ok(finished[0].cleanupEndMonotonicMs >= finished[0].observationEndMonotonicMs);
  const reads = rows.filter(row => row.kind === "read"), streams = new Map();
  assert.equal(reads.length, finished[0].reads);
  for (const row of reads) {
    const entries = rows.filter(e => e.kind === "read-entry" && e.sequence === row.entrySequence);
    assert.equal(entries.length, 1);
    const entry = entries[0];
    for (const field of ["tid", "fd", "nr"]) assert.equal(entry[field], row[field]);
    assert.ok(entry.sequence < row.sequence); assert.equal(entry.op, "ENTRY"); assert.equal(row.op, "EXIT");
    assert.ok([63, 65].includes(row.nr)); // Native 64-bit AArch64/RISC-V read/readv.
    assert.ok([0xc00000b7, 0xc00000f3].includes(entry.arch));
    assert.ok(identities.some(id => id.tid === row.tid));
    assert.match(row.hex, /^(?:[0-9a-f]{2})*$/u);
    if (row.returned <= 0) assert.equal(row.hex, "");
    assert.ok(row.hex.length / 2 <= Math.max(0, row.returned));
    if (row.captureComplete) assert.equal(row.hex.length / 2, Math.max(0, row.returned));
    if (!row.evdev) continue;
    assert.ok(row.identityStable);
    for (const id of [row.entry, row.exit]) {
      assert.ok(id.valid && id.input); assert.equal(id.mode & 0o170000, 0o020000);
      assert.match(id.path, /^\/dev\/input\/event[0-9]+$/u); assert.ok(id.subsystem.endsWith("/input"));
    }
    for (const field of ["dev", "inode", "rdev", "mode", "path"]) assert.equal(row.entry[field], row.exit[field]);
    const key = `${row.entry.path}:${row.entry.dev}:${row.entry.inode}:${row.entry.rdev}`;
    if (!streams.has(key)) streams.set(key, { identity: row.entry, reads: [], events: [], incomplete: [] });
    const stream = streams.get(key), decoded = decodeInputEvents(row.hex);
    stream.reads.push({ sequence: row.sequence, tid: row.tid, requested: row.requested, returned: row.returned,
      complete: row.captureComplete });
    stream.events.push(...decoded.events.map(event => ({ sequence: row.sequence, tid: row.tid, ...event })));
    if (decoded.trailingHex || !row.captureComplete) stream.incomplete.push({ sequence: row.sequence, trailingHex: decoded.trailingHex });
  }
  const owned = new Set(rows.filter(row => ["seized", "clone"].includes(row.kind)).map(row => row.tid));
  const released = new Set(rows.filter(row => ["detached", "thread-exit"].includes(row.kind)).map(row => row.tid));
  const unreleased = [...owned].filter(tid => !released.has(tid));
  return { rows: rows.length, errors, ready: ready[0], finished: finished[0], identities,
    reads: reads.length, orphanExits: finished[0].orphanExits, unreleased, streams: [...streams.values()] };
}

export function auditCompositorInput(report, receipt, trace) {
  const r = report.inputObserver;
  assert.equal(r.acceptanceClaim, false); assert.equal(r.schedulingPerturbed, true);
  assert.equal(r.binarySha256, receipt.observerSha256);
  const commands = r.commands.map(row => row.command);
  for (const row of r.commands) {
    assert.match(row.stage, /^input-observer:/u);
    if (report.keyboard) assert.ok(!row.command.includes(report.keyboard.nonce) && !row.command.includes(report.keyboard.guestFile));
  }
  const input = auditInputReport(report, { head: receipt.head, wasmSha256: receipt.wasmSha256,
    arm: "candidate", preparedDirect: true, preparedRecycling: true, startupCommands: [PREPARED_DIRECT_COMMAND, ...commands] });
  assert.deepEqual(assertPreparedDirectProperties(report.preparedDirect.response), report.preparedDirect.foot);
  report.observations.filter(row => row.runtime).forEach(row => assertOriginalInputGeometry(row.runtime.presentation));
  assert.equal(r.collection.status, "collected-and-detached");
  assert.ok(Date.parse(r.collection.finishedAt) <= Date.parse(r.collection.deadlineAt));
  assert.ok(Date.parse(r.attachedAt) <= Date.parse(report.keyboard.startedAt));
  assert.ok(Date.parse(r.attachedAt) <= Date.parse(report.startup.deadlineAt));
  assert.ok(Date.parse(r.collection.startedAt) >= Date.parse(report.keyboard.failedAt ?? report.keyboard.completedAt));
  assert.ok(r.after.statuses.every(row => row.tracerPid === 0));
  const observed = auditObserverTrace(trace, r.pid, r.tracerPid);
  observed.coveredThroughReadback = observed.finished.stopSignal === 15 && !observed.finished.failed
    && !observed.finished.stopBudgetReached && observed.unreleased.length === 0;
  const identities = new Map(observed.identities.map(row => [row.tid, row]));
  for (const task of r.attached.stats) assert.equal(identities.get(task.tid)?.startTime, task.starttime);
  const expected = report.workerTraffic.filter(row => row.type === "worker-call" && row.method === "sendKeyboardEvent")
    .map(row => ({ type: row.args[0], code: row.args[1], value: row.args[2] }));
  for (const stream of observed.streams) {
    const keys = stream.events.filter(event => event.type === 1).map(({ type, code, value }) => ({ type, code, value }));
    stream.keyEvents = keys.length; stream.synReports = stream.events.filter(e => e.type === 0 && e.code === 0).length;
    stream.synDropped = stream.events.filter(e => e.type === 0 && e.code === 3).length;
    stream.matchesEntirePhysicalSequence = JSON.stringify(keys) === JSON.stringify(expected);
  }
  return { diagnosticOnly: true, desktopResponsive: false, input, observed, expectedKeys: expected,
    limitation: "ptrace changes scheduling. A missing read is a missing observation; SYN_DROPPED alone does not uniquely establish overflow." };
}
