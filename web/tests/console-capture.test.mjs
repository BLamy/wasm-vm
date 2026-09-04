// E5-T08 — host view switching and bounded canvas recorder.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanvasRecorder,
  createHostViewController,
  supportedRecordingMimeType,
} from "../src/host/console-capture.js";

class FakeElement {
  constructor() {
    this.hidden = false;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle: (name, value) => { this.dataset[name] = String(value); } };
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  click() { this.listeners.get("click")?.(); }
}

test("view tabs switch visibility without adding listeners per transition", () => {
  const displayPanel = new FakeElement();
  const serialPanel = new FakeElement();
  const displayButton = new FakeElement();
  const serialButton = new FakeElement();
  const owner = { textContent: "" };
  const changes = [];
  const views = createHostViewController({
    displayPanel,
    serialPanel,
    displayButton,
    serialButton,
    ownerElement: owner,
    onViewChange: (change) => changes.push(change),
  });

  assert.equal(views.activeView(), "display");
  assert.equal(displayPanel.hidden, false);
  assert.equal(serialPanel.hidden, true);
  assert.equal(views.snapshot().listenerCount, 2);

  for (let index = 0; index < 25; index += 1) {
    serialButton.click();
    displayButton.click();
  }
  assert.equal(views.activeView(), "display");
  assert.equal(views.snapshot().transitions, 50);
  assert.equal(views.snapshot().listenerCount, 2);
  assert.equal(changes.length, 51); // initial state + 50 button transitions
  assert.equal(owner.textContent, "Keyboard: display");

  views.dispose();
  assert.equal(displayButton.listeners.size, 0);
  assert.equal(serialButton.listeners.size, 0);
});

class FakeRecorder {
  static isTypeSupported(type) { return type === "video/webm;codecs=vp8" || type === "video/webm"; }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || "video/webm";
    this.state = "inactive";
    this.listeners = new Map();
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, event = {}) { this.listeners.get(type)?.(event); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.emit("dataavailable", { data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.emit("stop");
  }
}

test("recorder chooses WebM, stops tracks, and resolves an exact result", async () => {
  let captureRate = null;
  let stoppedTracks = 0;
  const canvas = {
    captureStream(rate) {
      captureRate = rate;
      return { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
    },
  };
  const states = [];
  const recorder = createCanvasRecorder(canvas, {
    frameRate: 24,
    maxDurationMs: 1000,
    MediaRecorderCtor: FakeRecorder,
    onStateChange: (change) => states.push(change.state),
  });

  assert.equal(supportedRecordingMimeType(FakeRecorder), "video/webm;codecs=vp8");
  recorder.start();
  assert.equal(captureRate, 24);
  assert.equal(recorder.isRecording(), true);
  assert.throws(() => recorder.start(), /already active/);
  const result = await recorder.stop("manual");
  assert.equal(result.stopReason, "manual");
  assert.equal(result.blobSize, 3);
  assert.equal(result.mimeType, "video/webm;codecs=vp8");
  assert.equal(recorder.isRecording(), false);
  assert.equal(stoppedTracks, 1);
  assert.deepEqual(states, ["recording", "idle"]);
});

test("recorder duration cap stops an active session", async () => {
  const canvas = {
    captureStream() { return { getTracks: () => [{ stop() {} }] }; },
  };
  const recorder = createCanvasRecorder(canvas, {
    maxDurationMs: 5,
    MediaRecorderCtor: FakeRecorder,
  });
  recorder.start();
  const result = await new Promise((resolve) => {
    const poll = () => {
      const done = recorder.lastResult();
      if (done) resolve(done);
      else setTimeout(poll, 2);
    };
    poll();
  });
  assert.equal(result.stopReason, "duration-cap");
  assert.equal(recorder.isRecording(), false);
});
