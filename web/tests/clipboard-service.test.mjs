// E5-T24c — host clipboard service, focus privacy, gesture staging, and echo ordering.
// Run from the repository root with: node --test web/tests/clipboard-service.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import {
  CAP_CLIPBOARD,
  MAX_CLIPBOARD_BYTES,
  TYPE_CLIP_SET,
  encodeClipboardText,
} from "../agent-channel.js";
import {
  CLIPBOARD_DIRECTION,
  CLIPBOARD_PERMISSION,
  CLIPBOARD_STATE,
  ClipboardService,
  MAX_ECHO_HISTORY,
} from "../clipboard-service.js";

class FakeChannel {
  constructor({ supportsClipboard = true } = {}) {
    this.supportsClipboard = supportsClipboard;
    this.sent = [];
    this.listeners = new Map();
    this.stateListeners = new Set();
    this.sendImpl = () => Promise.resolve(true);
  }

  supports(capability) {
    return capability === CAP_CLIPBOARD ? this.supportsClipboard : true;
  }

  send(type, payload, options) {
    const bytes = new Uint8Array(payload);
    this.sent.push({ type, bytes, options });
    return this.sendImpl({ type, bytes, options });
  }

  subscribe(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      listeners.delete(listener);
      return true;
    };
  }

  subscribeState(listener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  emitClipboard(text, generation = 1) {
    const frame = { type: TYPE_CLIP_SET, payload: encodeClipboardText(text), generation };
    return Promise.all([...this.listeners.get(TYPE_CLIP_SET) ?? []].map((listener) => listener(frame)));
  }

  emitState(state, generation = 1) {
    for (const listener of [...this.stateListeners]) listener({ state, generation });
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.addCalls = new Map();
    this.removeCalls = new Map();
  }

  addEventListener(type, listener) {
    this.addCalls.set(type, (this.addCalls.get(type) ?? 0) + 1);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.removeCalls.set(type, (this.removeCalls.get(type) ?? 0) + 1);
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function pasteEvent(text, { onDataRead = null } = {}) {
  let dataRead = false;
  const event = {
    preventDefaultCalled: false,
    stopImmediatePropagationCalled: false,
    preventDefault() { this.preventDefaultCalled = true; },
    stopImmediatePropagation() { this.stopImmediatePropagationCalled = true; },
  };
  Object.defineProperty(event, "clipboardData", {
    get() {
      dataRead = true;
      onDataRead?.();
      return { getData: (kind) => kind === "text/plain" ? text : "" };
    },
  });
  Object.defineProperty(event, "dataRead", { get: () => dataRead });
  return event;
}

test("guest CLIP_SET writes when allowed, stages denial, and flushes only from a gesture", async () => {
  const channel = new FakeChannel();
  const status = { dataset: {}, attributes: {}, textContent: "", setAttribute(name, value) { this.attributes[name] = value; } };
  const writes = [];
  let allow = false;
  const service = new ClipboardService({
    channel,
    statusElement: status,
    writeClipboard: (text) => {
      if (!allow) {
        const error = new Error("permission denied");
        error.name = "NotAllowedError";
        return Promise.reject(error);
      }
      writes.push(text);
      return Promise.resolve();
    },
    autoAttach: false,
  });

  const first = await service.handleGuestFrame({ payload: encodeClipboardText("guest-copy") });
  assert.equal(first.ok, false);
  assert.equal(first.staged, true);
  assert.equal(service.state, CLIPBOARD_STATE.DENIED);
  assert.equal(service.permission, CLIPBOARD_PERMISSION.DENIED);
  assert.equal(service.pendingBytes, new TextEncoder().encode("guest-copy").byteLength);
  assert.equal(status.dataset.state, CLIPBOARD_STATE.DENIED);
  assert.match(status.textContent, /blocked/);

  allow = true;
  const flushed = await service.flushStaged();
  assert.deepEqual(flushed, { ok: true, text: "guest-copy" });
  assert.deepEqual(writes, ["guest-copy"]);
  assert.equal(service.state, CLIPBOARD_STATE.SYNCED);
  assert.equal(service.pending, false);
});

test("focused paste sends CLIP_SET before the key-ready barrier and unfocused paste never reads data", async () => {
  const channel = new FakeChannel();
  const target = new FakeTarget();
  let focused = false;
  const order = [];
  let resolveSend;
  channel.sendImpl = () => {
    order.push("send");
    return new Promise((resolve) => { resolveSend = resolve; });
  };
  const service = new ClipboardService({
    channel,
    target,
    isFocused: () => focused,
    onPasteReady: () => order.push("key-ready"),
  });
  assert.equal(target.count("paste"), 1);

  const unfocused = pasteEvent("private", { onDataRead: () => { throw new Error("read while unfocused"); } });
  const ignored = await service.handlePasteEvent(unfocused);
  assert.deepEqual(ignored, { ok: false, handled: false, reason: "unfocused" });
  assert.equal(unfocused.dataRead, false);
  assert.equal(channel.sent.length, 0);

  focused = true;
  const event = pasteEvent("host-copy");
  const pending = service.handlePasteEvent(event);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.stopImmediatePropagationCalled, true);
  assert.equal(event.dataRead, true);
  assert.deepEqual(order, ["send"]);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].type, TYPE_CLIP_SET);
  assert.equal(channel.sent[0].options.capability, CAP_CLIPBOARD);

  resolveSend(true);
  assert.deepEqual(await pending, { ok: true, text: "host-copy", handled: true });
  assert.deepEqual(order, ["send", "key-ready"]);
  assert.deepEqual(service.snapshot().sentFrames, 1);
});

test("host and guest directions use bounded, generation-aware echo history", async () => {
  const channel = new FakeChannel();
  let now = 0;
  const writes = [];
  const service = new ClipboardService({
    channel,
    now: () => now,
    echoWindowMs: 50,
    writeClipboard: (text) => { writes.push(text); },
    autoAttach: false,
  });

  // A host paste is one frame. The matching guest return is consumed as the expected echo, not
  // written back to the host and not sent into another frame.
  const host = await service.sendHostText("same");
  assert.equal(host.ok, true);
  const echo = await service.handleGuestFrame({ payload: encodeClipboardText("same"), generation: 0 });
  assert.deepEqual(echo, { ok: true, suppressed: true, text: "same" });
  assert.deepEqual(writes, []);
  assert.equal(service.suppressedEchoes, 1);
  assert.equal(service.sentFrames, 1);

  // A different guest copy still synchronizes even though the previous direction carried the same
  // text. This is the pathological identical/different alternation that a content-only guard misses.
  now = 10;
  await service.handleGuestFrame({ payload: encodeClipboardText("different"), generation: 0 });
  assert.deepEqual(writes, ["different"]);
  now = 20;
  await service.sendHostText("different");
  assert.equal(service.sentFrames, 2);
  await service.handleGuestFrame({ payload: encodeClipboardText("different"), generation: 0 });
  assert.deepEqual(writes, ["different"]);

  // Once the echo window expires, an identical guest user action is a new copy and is accepted.
  now = 100;
  await service.handleGuestFrame({ payload: encodeClipboardText("same"), generation: 0 });
  assert.deepEqual(writes, ["different", "same"]);
  assert.ok(service.snapshot().historyDepth <= MAX_ECHO_HISTORY);
});

test("100 immediate host-copy/guest-echo pairs emit once per action without feedback", async () => {
  const channel = new FakeChannel();
  const service = new ClipboardService({
    channel,
    isFocused: () => true,
    autoAttach: false,
  });

  for (let index = 0; index < 100; index += 1) {
    const text = index % 2 === 0 ? "identical" : `different-${index}`;
    const result = await service.handlePasteEvent(pasteEvent(text));
    assert.equal(result.ok, true);
    const echo = await service.handleGuestFrame({
      payload: encodeClipboardText(text),
      generation: 0,
    });
    assert.equal(echo.suppressed, true);
  }

  assert.equal(channel.sent.length, 100, "one CLIP_SET frame per focused paste action");
  assert.equal(service.sentFrames, 100);
  assert.equal(service.suppressedEchoes, 100);
  assert.equal(service.pending, false);
  assert.equal(service.snapshot().historyDepth, 0, "consumed echoes do not accumulate history");
});

test("paste and guest payload limits reject without reading navigator.clipboard or throwing", async () => {
  const channel = new FakeChannel();
  const errors = [];
  const service = new ClipboardService({
    channel,
    isFocused: () => true,
    onError: (error) => errors.push(error.code),
    autoAttach: false,
  });

  const tooLarge = await service.sendHostText("a".repeat(MAX_CLIPBOARD_BYTES + 1));
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.reason, "invalid");
  assert.equal(channel.sent.length, 0);

  const invalid = await service.handleGuestFrame({ payload: Uint8Array.of(0xff) });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid");
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(errors, ["CLIPBOARD_TOO_LARGE", "CLIPBOARD_INVALID_UTF8"]);

  const event = pasteEvent("a");
  const accepted = await service.handlePasteEvent(event);
  assert.equal(accepted.ok, true);
  assert.equal(channel.sent.length, 1);
  assert.equal(service.snapshot().guestFrames, 1);
});

test("gesture listeners are idempotent and detach preserves the caller-owned channel", async () => {
  const channel = new FakeChannel();
  const target = new FakeTarget();
  let focused = true;
  let allow = false;
  const service = new ClipboardService({
    channel,
    target,
    isFocused: () => focused,
    writeClipboard: () => {
      if (!allow) return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
      return Promise.resolve();
    },
  });
  service.attach();
  assert.equal(target.addCalls.get("paste"), 1);
  assert.equal(target.addCalls.get("pointerdown"), 1);
  assert.equal(target.addCalls.get("keydown"), 1);

  await service.handleGuestFrame({ payload: encodeClipboardText("staged") });
  assert.equal(service.state, CLIPBOARD_STATE.DENIED);
  allow = true;
  target.dispatch("pointerdown");
  await service.flushStaged();
  assert.equal(service.state, CLIPBOARD_STATE.SYNCED);
  assert.equal(service.snapshot().attached, true);
  assert.equal(service.detach(), true);
  assert.equal(service.detach(), false);
  assert.equal(target.count("paste"), 0);
  assert.equal(target.count("pointerdown"), 0);
  assert.equal(target.count("keydown"), 0);
  assert.equal(channel.sent.length, 0, "guest-to-host writes never use the agent frame path");
  assert.equal(focused, true);
});

test("channel generation changes invalidate a stale expected echo", async () => {
  const channel = new FakeChannel();
  const writes = [];
  const service = new ClipboardService({
    channel,
    writeClipboard: (text) => writes.push(text),
    autoAttach: true,
  });
  await service.sendHostText("old-generation");
  channel.emitState("disconnected", 0);
  channel.emitState("ready", 2);
  const result = await service.handleGuestFrame({ payload: encodeClipboardText("old-generation"), generation: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.suppressed, undefined);
  assert.deepEqual(writes, ["old-generation"]);
  assert.equal(service.generation, 2);
  assert.equal(service._history?.length ?? 0, 1, "only the new guest direction is retained");
  assert.equal(CLIPBOARD_DIRECTION.GUEST_TO_HOST, "guest-to-host");
});
