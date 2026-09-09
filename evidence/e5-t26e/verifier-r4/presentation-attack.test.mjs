import assert from "node:assert/strict";
import test from "node:test";

import { restoreDesktopThroughHost } from "../../../web/desktop-restore.js";
import { PresentationController } from "../../../web/src/sink/presentation.js";

class Canvas {
  constructor() {
    this.width = 640;
    this.height = 480;
    this.style = {};
  }
  getContext() { return null; }
  addEventListener() {}
  removeEventListener() {}
}

class Backend {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.resizes = [];
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.resizes.push([width, height]);
  }
  present() {}
  dispose() {}
}

function liveOwner() {
  let backend;
  const presentation = new PresentationController(new Canvas(), {
    backendFactories: {
      canvas2d: (canvas) => (backend = new Backend(canvas)),
      webgl2: () => { throw new Error("not selected"); },
    },
  });
  presentation.present({
    scanout: 0,
    format: 1,
    rect: { x: 0, y: 0, width: 2, height: 2 },
    resourceWidth: 2,
    resourceHeight: 2,
    pixels: new Uint32Array(4).fill(0xff112233),
  });
  return { presentation, backend };
}

test("real T22 owner receives retained host viewport and loses dirty frame", async () => {
  const { presentation, backend } = liveOwner();
  let styleApplications = 0;
  const result = await restoreDesktopThroughHost({
    controller: {
      async confirmAgentHello() { return true; },
      async restoreDesktopSnapshot(_bytes, width, height) {
        return {
          scanout: { width: 1280, height: 720 },
          hostViewport: { width, height },
          viewport: "letterbox",
          fullRepairFrame: true,
        };
      },
    },
    agentChannel: {
      state: "ready",
      async rehandshake() { return { generation: 2, version: 1 }; },
    },
    presentation,
    viewportController: { applyCanvasStyle() { styleApplications += 1; } },
  }, Uint8Array.of(1, 2, 3), { width: 1024, height: 768 });

  assert.equal(result.report.viewport, "letterbox");
  assert.deepEqual(result.report.scanout, { width: 1280, height: 720 });
  assert.deepEqual(result.appliedViewport, { width: 1024, height: 768 });
  assert.equal(presentation.snapshot().width, 1024);
  assert.equal(presentation.snapshot().height, 768);
  assert.equal(presentation.snapshot().fixedViewport, true);
  assert.equal(presentation.snapshot().latest, null);
  assert.deepEqual(backend.resizes.at(-1), [1024, 768]);
  assert.equal(styleApplications, 1);
  presentation.dispose();
});

test("mismatched core viewport clears the real T22 owner", async () => {
  const { presentation } = liveOwner();
  await assert.rejects(restoreDesktopThroughHost({
    controller: {
      async confirmAgentHello() { return true; },
      async restoreDesktopSnapshot() {
        return { hostViewport: { width: 800, height: 600 } };
      },
    },
    agentChannel: {
      state: "ready",
      async rehandshake() { return { generation: 2, version: 1 }; },
    },
    presentation,
  }, Uint8Array.of(4), { width: 1024, height: 768 }), /different host viewport/);
  assert.equal(presentation.snapshot().latest, null);
  assert.equal(presentation.snapshot().width, 1024);
  assert.equal(presentation.snapshot().height, 768);
  presentation.dispose();
});
