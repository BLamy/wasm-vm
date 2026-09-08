import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  LINUX_CONTROLLER_METHODS,
  createLinuxWorkerClient,
  createLinuxWorkerRuntime,
} from "../../web/linux-worker-protocol.js";

// Execute the actual loader's restore and fallback boundary, without importing
// boot assets or running a guest. The linked protocol tests below use that getter.
const loader = readFileSync(new URL("../../web/loader.js", import.meta.url), "utf8");
const start = loader.indexOf("    // E3-T12d persistent snapshot restore:");
const end = loader.indexOf("    let stopped = false;", start);
assert.ok(start >= 0 && end > start, "actual initial restore boundary exists");
const boundary = loader.slice(start, end);
const property = (name) => {
  const source = loader.match(new RegExp(`^      ${name}: .*,$`, "m"))?.[0];
  assert.ok(source, `actual ${name} getter exists`);
  return source;
};
const method = (name) => {
  const source = loader.match(new RegExp(`^      ${name}: (?:async )?\\(\\) => \\{[\\s\\S]*?^      \\},`, "m"))?.[0];
  assert.ok(source, `actual ${name} method exists`);
  return source;
};
const boot = new vm.Script(`(async () => {
  ${boundary}
  return {
    restoredFromStoredSnapshot,
    observation: () => storedSnapshotRestoreObservation,
    controller: {
      ${property("storedSnapshotRestoreEvidence")}
      ${property("restoredFromBootSnapshot")}
      ${property("snapshotGeneration")}
      ${method("snapshotDecision")}
      ${method("snapshotRestore")}
    },
  };
})()`);
const plain = (value) => ({ ...value });
const receipt = (attempted, decision, overlayGeneration) => ({ attempted, decision, overlayGeneration });

function fixture({ decision = "resume", usePersist = true, restoreError = false,
  generationError = false, generation = 621, gate, fallback = false, restoreMethod = true } = {}) {
  const calls = [], states = [], warnings = [];
  const live = { decision, generation, storedReads: 0, generationReads: 0, restores: 0 };
  const fallbackBlob = Uint8Array.of(7, 9);
  const machine = {
    async restoreStoredSnapshot() {
      live.restores += 1;
      calls.push("restore:start");
      if (gate) await gate;
      if (restoreError) throw new Error("storage read refused");
      calls.push(`restore:return:${live.decision}`);
      return live.decision;
    },
    overlayGeneration() {
      live.generationReads += 1;
      calls.push(`generation:${live.generation}`);
      if (generationError) throw new Error("metadata unavailable");
      return live.generation;
    },
    readStoredSnapshot() {
      live.storedReads += 1;
      throw new Error("receipt must not read the stored blob");
    },
    restoreDecisionCode(blob, currentGeneration) {
      assert.equal(fallback, true, "initial receipt must use the actual restore result");
      assert.equal(blob, fallbackBlob);
      assert.equal(currentGeneration, live.generation);
      calls.push("fallback:decision");
      return "resume";
    },
    loadSnapshotBlob(blob) {
      assert.equal(blob, fallbackBlob);
      calls.push("fallback:load");
    },
    runChunk() { assert.fail("receipt boundary must not run guest instructions"); },
  };
  if (!restoreMethod) delete machine.restoreStoredSnapshot;
  const result = boot.runInNewContext({
    machine, usePersist,
    alpineOverlaySeeded: false, bootSnap: null, opts: { bootSnapshot: false },
    alpineRamBlob: fallback ? fallbackBlob : null, mode: "chunked", guestClock: "icount",
    createGuestClockLifecycle(actualMachine, mode) {
      assert.equal(actualMachine, machine);
      assert.equal(mode, "icount");
      calls.push("clock:selection");
      return {};
    },
    onState(state) { states.push(state); calls.push(`state:${state}`); },
    console: { warn: (...args) => warnings.push(args) },
  });
  return { result, calls, states, warnings, machine, live };
}

test("receipt capture is before decision branching, fallback and the first guest pump", () => {
  const awaited = boundary.indexOf("const decision = await machine.restoreStoredSnapshot();");
  const captured = boundary.indexOf("storedSnapshotRestoreObservation = Object.freeze({ attempted: true, decision, overlayGeneration });");
  const branch = boundary.indexOf('if (decision === "resume")');
  const fallback = boundary.indexOf("// The shipped Alpine RAM image");
  assert.ok(awaited >= 0 && awaited < captured && captured < branch && branch < fallback);
  const run = loader.indexOf("res = machine.runChunk(", end);
  const pump = loader.indexOf("    schedule();\n\n    return {", run);
  assert.ok(end < run && run < pump, "receipt is established before the scheduler can run guest code");
});

for (const options of [{ usePersist: false }, { restoreMethod: false }]) {
  test(`no attempted restore keeps the frozen null default: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const { controller, observation } = await f.result;
    assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(false, null, null));
    assert.equal(Object.isFrozen(observation()), true);
    assert.equal(f.live.restores, 0);
    assert.equal(f.live.generationReads, 0);
    assert.equal(controller.restoredFromBootSnapshot(), false);
    assert.deepEqual(f.states, ["booting"]);
    assert.deepEqual(f.warnings, []);
  });
}

for (const decision of ["resume", "missing", "corrupt", "stale", "foreign_build", "foreign_image"]) {
  test(`actual stored-restore ${decision} is retained verbatim with its actual generation`, async () => {
    const f = fixture({ decision, generation: 0 });
    const { controller, observation, restoredFromStoredSnapshot } = await f.result;
    assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(true, decision, 0));
    assert.equal(Object.isFrozen(observation()), true);
    assert.equal(restoredFromStoredSnapshot, decision === "resume");
    assert.equal(controller.restoredFromBootSnapshot(), decision === "resume");
    assert.deepEqual(f.states, [decision === "resume" ? "restored" : "booting"]);
    assert.equal(f.warnings.length, ["resume", "missing"].includes(decision) ? 0 : 1);
    assert.equal(f.live.restores, 1);
    assert.equal(f.live.generationReads, 1);
    assert.equal(f.live.storedReads, 0);
    assert.deepEqual(f.calls.slice(0, 3), ["restore:start", `restore:return:${decision}`, "generation:0"]);
  });
}

test("a thrown stored restore records error and preserves the cold fallback", async () => {
  const f = fixture({ restoreError: true });
  const { controller, observation, restoredFromStoredSnapshot } = await f.result;
  assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(true, "error", null));
  assert.equal(Object.isFrozen(observation()), true);
  assert.equal(restoredFromStoredSnapshot, false);
  assert.equal(controller.restoredFromBootSnapshot(), false);
  assert.equal(f.live.generationReads, 0);
  assert.deepEqual(f.states, ["booting"]);
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0].join(" "), /storage read refused/);
});

for (const decision of ["resume", "stale"]) {
  test(`metadata-read failure cannot replace the actual ${decision} result or alter fallback`, async () => {
    const f = fixture({ decision, generationError: true });
    const { controller } = await f.result;
    assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(true, decision, null));
    assert.equal(controller.restoredFromBootSnapshot(), decision === "resume");
    assert.deepEqual(f.states, [decision === "resume" ? "restored" : "booting"]);
    assert.equal(f.warnings.length, decision === "resume" ? 0 : 1);
    assert.equal(f.live.generationReads, 1);
  });
}

test("successful shipped fallback does not overwrite a refused stored-restore receipt", async () => {
  for (const options of [{ decision: "missing" }, { decision: "stale" }, { restoreError: true }]) {
    const f = fixture({ ...options, fallback: true });
    const { controller, restoredFromStoredSnapshot } = await f.result;
    assert.equal(restoredFromStoredSnapshot, false);
    assert.equal(controller.restoredFromBootSnapshot(), true);
    assert.deepEqual(f.states, ["restored"]);
    assert.ok(f.calls.includes("fallback:load"));
    assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(
      true, options.restoreError ? "error" : options.decision, options.restoreError ? null : 621,
    ));
  }
});

test("generation is sampled after the awaited restore settles, never before", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ gate, generation: 17 });
  assert.deepEqual(f.calls, ["restore:start"]);
  f.live.generation = 902;
  release();
  const { controller } = await f.result;
  assert.deepEqual(f.calls, ["restore:start", "restore:return:resume", "generation:902", "state:restored", "clock:selection"]);
  assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(true, "resume", 902));
});

test("getter returns independent copies while the actual observation stays frozen", async () => {
  for (const usePersist of [false, true]) {
    const f = fixture({ usePersist });
    const { controller, observation } = await f.result;
    const expected = usePersist ? receipt(true, "resume", 621) : receipt(false, null, null);
    const first = controller.storedSnapshotRestoreEvidence();
    assert.notEqual(first, observation());
    assert.notEqual(first, controller.storedSnapshotRestoreEvidence());
    first.attempted = "tampered";
    first.decision = "stale";
    first.overlayGeneration = -1;
    first.extra = true;
    assert.equal(Reflect.set(observation(), "decision", "tampered"), false);
    assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), expected);
    assert.equal(f.live.generationReads, usePersist ? 1 : 0);
    assert.equal(f.live.storedReads, 0);
  }
});

test("later live generation, coherence queries and explicit restores cannot rewrite initial evidence", async () => {
  const f = fixture();
  const { controller } = await f.result;
  f.live.generation = 625;
  assert.equal(controller.snapshotGeneration(), 625);
  const currentBlob = Uint8Array.of(1, 2, 3);
  f.machine.readStoredSnapshot = async () => currentBlob;
  f.machine.restoreDecisionCode = (blob, gen) => {
    assert.equal(blob, currentBlob);
    assert.equal(gen, 625);
    return "stale";
  };
  assert.equal(await controller.snapshotDecision(), "stale");
  f.live.decision = "foreign_image";
  assert.equal(await controller.snapshotRestore(), "foreign_image");
  f.machine.overlayGeneration = () => { assert.fail("historical getter read live generation"); };
  f.machine.readStoredSnapshot = () => { assert.fail("historical getter read a later snapshot"); };
  assert.deepEqual(plain(controller.storedSnapshotRestoreEvidence()), receipt(true, "resume", 621));
});

// Real client/runtime transport with the same structured-clone message boundary
// used by web/tests/e4-t32-worker-protocol.test.mjs; no fabricated RPC dispatcher.
function endpointPair(messages) {
  let closed = false;
  const make = (name) => ({
    name, listeners: new Set(),
    addEventListener(type, fn) { if (type === "message") this.listeners.add(fn); },
    removeEventListener(type, fn) { if (type === "message") this.listeners.delete(fn); },
    terminate() { closed = true; },
  });
  const page = make("page"), worker = make("worker");
  for (const [sender, receiver] of [[page, worker], [worker, page]]) {
    sender.postMessage = (message, transfer = []) => {
      if (closed) return;
      const cloned = structuredClone(message, { transfer });
      messages.push({ sender: sender.name, message: cloned, transfers: transfer.length });
      queueMicrotask(() => {
        if (!closed) for (const listener of receiver.listeners) listener({ data: cloned });
      });
    };
  }
  return { page, worker };
}

for (const options of [{}, { usePersist: false }, { restoreError: true }]) {
  test(`actual initial receipt crosses the linked worker protocol: ${JSON.stringify(options)}`, async () => {
    assert.ok(LINUX_CONTROLLER_METHODS.includes("storedSnapshotRestoreEvidence"));
    const messages = [];
    const { page, worker } = endpointPair(messages);
    const f = fixture(options);
    const inner = (await f.result).controller;
    let stopCalls = 0;
    createLinuxWorkerRuntime(worker, {
      startBoot: async () => ({ ...inner, stop() { stopCalls += 1; } }),
    });
    const client = createLinuxWorkerClient(page);
    const controller = await client.boot({});
    try {
      const expected = options.usePersist === false ? receipt(false, null, null)
        : options.restoreError ? receipt(true, "error", null) : receipt(true, "resume", 621);
      const first = await controller.storedSnapshotRestoreEvidence();
      assert.deepEqual(first, expected);
      first.decision = "tampered";
      first.overlayGeneration = -1;
      f.live.generation = 900;
      assert.equal(await controller.snapshotGeneration(), 900);
      assert.deepEqual(await controller.storedSnapshotRestoreEvidence(), expected);
      assert.deepEqual(plain(inner.storedSnapshotRestoreEvidence()), expected);
      const calls = messages.filter(({ sender, message }) => sender === "page"
        && message.type === "call" && message.method === "storedSnapshotRestoreEvidence");
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.deepEqual(call.message.args, []);
        const reply = messages.find(({ sender, message }) => sender === "worker"
          && message.type === "result" && message.id === call.message.id);
        assert.ok(reply, "real runtime returned a correlated scalar result");
        assert.equal(reply.transfers, 0);
        assert.equal(reply.message.bytes, undefined);
        assert.equal(reply.message.error, undefined);
      }
      assert.equal(f.live.restores, options.usePersist === false ? 0 : 1);
      assert.equal(f.live.storedReads, 0);
    } finally {
      assert.equal(await controller.stop(), "stopped");
    }
    assert.equal(stopCalls, 1);
  });
}
