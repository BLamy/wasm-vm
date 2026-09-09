import assert from "node:assert/strict";
import test from "node:test";

import {
  createLinuxWorkerClient,
  createLinuxWorkerRuntime,
} from "../../../web/linux-worker-protocol.js";

function endpointPair() {
  const connection = { closed: false };
  const make = () => ({
    listeners: new Set(),
    addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); },
    terminate() { connection.closed = true; },
  });
  const page = make();
  const worker = make();
  page.peer = worker;
  worker.peer = page;
  for (const endpoint of [page, worker]) {
    endpoint.postMessage = (message, transfer = []) => {
      if (connection.closed) return;
      const cloned = structuredClone(message, { transfer });
      queueMicrotask(() => {
        if (connection.closed) return;
        for (const listener of endpoint.peer.listeners) listener({ data: cloned });
      });
    };
  }
  return { page, worker };
}

test("restore RPC owns an exact non-zero-offset byte view", async () => {
  const { page, worker } = endpointPair();
  let finish;
  const whenDone = new Promise((resolve) => { finish = resolve; });
  let observed = null;

  createLinuxWorkerRuntime(worker, {
    startBoot: async () => ({
      whenDone,
      restoredFromBootSnapshot: () => false,
      jitStats: () => null,
      schedulerStats: () => null,
      restoreDesktopSnapshot(bytes, width, height) {
        observed = { bytes: [...bytes], width, height };
        return { hostViewport: { width, height } };
      },
      async stop() { finish("stopped"); },
      async releaseWriterLock() {},
      async closeStorage() {},
    }),
  });

  const controller = await createLinuxWorkerClient(page).boot({});
  const backing = Uint8Array.from([0xaa, 1, 2, 3, 0xbb]);
  const view = backing.subarray(1, 4);
  const pending = controller.restoreDesktopSnapshot(view, 1024, 768);
  view.fill(9);

  const report = await pending;
  assert.deepEqual(observed, { bytes: [1, 2, 3], width: 1024, height: 768 });
  assert.deepEqual([...backing], [0xaa, 9, 9, 9, 0xbb]);
  assert.equal(backing.byteLength, 5, "the caller's backing buffer must not detach");
  assert.deepEqual(report.hostViewport, { width: 1024, height: 768 });

  await controller.stop();
});
