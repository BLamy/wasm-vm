// E5-T14b: browser pointer routing for the T14a virtio tablet/mouse pair.
//
// This module is intentionally JavaScript-compatible TypeScript. The demo has no bundler, so
// pointer.js is a byte-identical projection consumed by the page and by the Node fixtures. All
// coordinate math stays in CSS pixels; the guest's 0..32767 tablet range never sees a canvas
// backing-pixel dimension or a devicePixelRatio multiplier.

export const EV_SYN = 0;
export const SYN_REPORT = 0;
export const EV_KEY = 1;
export const EV_REL = 2;
export const EV_ABS = 3;

export const ABS_X = 0;
export const ABS_Y = 1;
export const REL_X = 0;
export const REL_Y = 1;
export const REL_HWHEEL = 6;
export const REL_WHEEL = 8;

export const WHEEL_DELTA_MODES = Object.freeze({
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
});
// Keep one normalized accumulator unit equal to one CSS pixel. A line is treated as 40 pixels and
// a page as one detent (120 pixels), matching the browser-independent contract in docs/input.md.
export const WHEEL_DETENT_UNITS = 120;
export const WHEEL_MAX_INPUT = 1_000_000;

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;
export const BTN_SIDE = 0x113;
export const BTN_EXTRA = 0x114;

export const ABS_MIN = 0;
export const ABS_MAX = 32767;

export const POINTER_MODES = Object.freeze({
  ABSOLUTE: "absolute",
  RELATIVE: "relative",
});

/** Browser PointerEvent.button → the T14a evdev button code. */
export const POINTER_BUTTON_CODES = Object.freeze({
  0: BTN_LEFT, // primary
  1: BTN_MIDDLE, // auxiliary/middle
  2: BTN_RIGHT, // secondary
  3: BTN_SIDE, // back
  4: BTN_EXTRA, // forward
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeCallback(callback, value) {
  try { callback(value); } catch { /* diagnostics and telemetry never break input */ }
}

function eventCoordinate(event, axis, rect) {
  const client = finiteNumber(event?.[axis]);
  if (client !== null) return client;
  const offsetName = axis === "clientX" ? "offsetX" : "offsetY";
  const offset = finiteNumber(event?.[offsetName]);
  if (offset !== null) return finiteNumber(rect?.[axis === "clientX" ? "left" : "top"]) + offset;
  return null;
}

/** Convert a PointerEvent-shaped value to the guest's absolute tablet range. */
export function absoluteCoordinatesFromEvent(event, rect) {
  const left = finiteNumber(rect?.left);
  const top = finiteNumber(rect?.top);
  const width = finiteNumber(rect?.width);
  const height = finiteNumber(rect?.height);
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  const clientX = eventCoordinate(event, "clientX", rect);
  const clientY = eventCoordinate(event, "clientY", rect);
  if (clientX === null || clientY === null) return null;
  return {
    x: clamp(Math.round(((clientX - left) / width) * ABS_MAX), ABS_MIN, ABS_MAX),
    y: clamp(Math.round(((clientY - top) / height) * ABS_MAX), ABS_MIN, ABS_MAX),
  };
}

export function evdevForPointerButton(button) {
  const number = finiteNumber(button);
  if (number === null || !Number.isInteger(number)) return null;
  return Object.hasOwn(POINTER_BUTTON_CODES, number) ? POINTER_BUTTON_CODES[number] : null;
}

/** Adapt a direct WasmLinux controller or the whole-machine-worker proxy. */
export function createWasmPointerAdapter(controller) {
  const methods = ["sendTabletEvent", "syncTablet", "sendMouseEvent", "syncMouse"];
  for (const method of methods) {
    if (typeof controller?.[method] !== "function") {
      throw new TypeError(`pointer adapter requires ${method}`);
    }
  }
  return {
    sendTabletEvent: (...args) => controller.sendTabletEvent(...args),
    syncTablet: () => controller.syncTablet(),
    sendMouseEvent: (...args) => controller.sendMouseEvent(...args),
    syncMouse: () => controller.syncMouse(),
  };
}

function pointerEventKey(event, button) {
  const pointerId = finiteNumber(event?.pointerId);
  return pointerId === null ? `button:${button}` : `pointer:${pointerId}:${button}`;
}

function eventRecord(eventType, code, value) {
  return { eventType, code, value };
}

/**
 * Build the absolute-tablet/relative-mouse state machine.
 *
 * `setMode("relative")` makes the mode change explicit immediately, then requests Pointer Lock.
 * A rejected request or a later lock-loss event returns to absolute mode and releases every held
 * button on the device that originally received its make. This makes a lock denial safe even when
 * the browser delivers a late pointerup for the old mode.
 */
export function createPointerBridge(
  adapter,
  {
    target = null,
    documentTarget = globalThis.document,
    getRect = () => target?.getBoundingClientRect?.() ?? null,
    isReady = () => true,
    onDiagnostic = () => {},
    onFrame = () => {},
    onStateChange = () => {},
    absoluteButtonDevice = "tablet",
    serializeTransport = false,
  } = {},
) {
  if (typeof adapter?.sendTabletEvent !== "function" || typeof adapter?.syncTablet !== "function") {
    throw new TypeError("pointer bridge requires tablet event and sync methods");
  }
  if (typeof adapter?.sendMouseEvent !== "function" || typeof adapter?.syncMouse !== "function") {
    throw new TypeError("pointer bridge requires mouse event and sync methods");
  }
  if (absoluteButtonDevice !== "tablet" && absoluteButtonDevice !== "mouse") {
    throw new TypeError(`unknown absolute button device: ${String(absoluteButtonDevice)}`);
  }
  if (typeof serializeTransport !== "boolean") {
    throw new TypeError("serializeTransport must be boolean");
  }

  let pointerTarget = target;
  let pointerDocument = documentTarget;
  let mode = POINTER_MODES.ABSOLUTE;
  let pointerLockRequested = false;
  let sequence = 0;
  let modeChanges = 0;
  let pointerLockChanges = 0;
  const heldButtons = new Map();
  let wheelRemainders = { horizontal: 0, vertical: 0 };
  let transportTail = Promise.resolve();

  function diagnostic(reason, extra = {}) {
    safeCallback(onDiagnostic, { reason, mode, ...extra });
  }

  function pointerLocked() {
    return Boolean(pointerTarget && pointerDocument?.pointerLockElement === pointerTarget);
  }

  function snapshot(reason = "state") {
    return {
      mode,
      pointerLocked: pointerLocked(),
      pointerLockRequested,
      heldButtons: [...heldButtons.values()].map((entry) => ({ ...entry })),
      wheelRemainders: { ...wheelRemainders },
      modeChanges,
      pointerLockChanges,
      reason,
    };
  }

  function notify(reason) {
    safeCallback(onStateChange, snapshot(reason));
  }

  function ready() {
    try { return Boolean(isReady()); } catch (error) {
      diagnostic("ready-check-error", { error: error?.message || String(error) });
      return false;
    }
  }

  function publish(device, events, metadata = {}) {
    if (!events || events.length === 0) return null;
    if (!ready()) {
      diagnostic("controller-unavailable", { device, eventCount: events.length });
      return null;
    }
    const send = device === "tablet"
      ? adapter.sendTabletEvent
      : adapter.sendMouseEvent;
    const sync = device === "tablet" ? adapter.syncTablet : adapter.syncMouse;
    const frame = {
      sequence: ++sequence,
      device,
      mode,
      events: events.map((event) => ({ ...event })),
      sync: SYN_REPORT,
      ...metadata,
    };
    const transmit = () => {
      try {
        for (const event of events) send(event.eventType, event.code, event.value);
        sync();
      } catch (error) {
        diagnostic("pointer-send-error", { device, error: error?.message || String(error) });
        return false;
      }
      safeCallback(onFrame, frame);
      return true;
    };
    const transmitSerialized = async () => {
      try {
        for (const event of events) await send(event.eventType, event.code, event.value);
        await sync();
      } catch (error) {
        diagnostic("pointer-send-error", { device, error: error?.message || String(error) });
        return false;
      }
      safeCallback(onFrame, frame);
      return true;
    };
    if (serializeTransport) {
      transportTail = transportTail.then(transmitSerialized, transmitSerialized);
    } else {
      transmit();
    }
    return frame;
  }

  function releaseAll(reason = "release-all", { emit = true } = {}) {
    if (heldButtons.size === 0) return [];
    const byDevice = new Map();
    for (const entry of [...heldButtons.values()].reverse()) {
      if (!byDevice.has(entry.device)) byDevice.set(entry.device, []);
      byDevice.get(entry.device).push(eventRecord(EV_KEY, entry.evdev, 0));
    }
    const frames = [];
    if (emit) {
      for (const [device, events] of byDevice) {
        const frame = publish(device, events, { reason });
        if (frame) frames.push(frame);
      }
    }
    heldButtons.clear();
    return frames;
  }

  function exitPointerLock() {
    try { pointerDocument?.exitPointerLock?.(); } catch (error) {
      diagnostic("pointerlock-exit-error", { error: error?.message || String(error) });
    }
  }

  function makeAbsolute(reason, { exitLock = true } = {}) {
    pointerLockRequested = false;
    releaseAll(reason);
    const changed = mode !== POINTER_MODES.ABSOLUTE;
    mode = POINTER_MODES.ABSOLUTE;
    if (changed) modeChanges += 1;
    notify(reason);
    if (exitLock && pointerLocked()) exitPointerLock();
    return mode;
  }

  function lockFailure(reason, error = undefined) {
    pointerLockRequested = false;
    diagnostic(reason, error ? { error: error?.message || String(error) } : {});
    makeAbsolute(reason, { exitLock: false });
    return false;
  }

  function requestPointerLock() {
    if (!pointerTarget || typeof pointerTarget.requestPointerLock !== "function") {
      return lockFailure("pointerlock-unavailable");
    }
    try {
      let result;
      try {
        result = pointerTarget.requestPointerLock({ unadjustedMovement: true });
      } catch (error) {
        // Older browsers expose the legacy no-argument form. Retry only for an options-shape
        // TypeError; permission and policy errors must fail closed into absolute mode.
        if (error?.name !== "TypeError") throw error;
        result = pointerTarget.requestPointerLock();
      }
      if (result === false) return lockFailure("pointerlock-denied");
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch((error) => lockFailure("pointerlock-denied", error));
      }
      return true;
    } catch (error) {
      return lockFailure("pointerlock-denied", error);
    }
  }

  function setMode(nextMode, { requestLock = true, reason = "mode-change" } = {}) {
    if (nextMode !== POINTER_MODES.ABSOLUTE && nextMode !== POINTER_MODES.RELATIVE) {
      throw new TypeError(`unknown pointer mode: ${String(nextMode)}`);
    }
    if (nextMode === POINTER_MODES.ABSOLUTE) {
      return makeAbsolute(reason);
    }
    pointerLockRequested = requestLock;
    releaseAll(reason);
    if (mode !== POINTER_MODES.RELATIVE) {
      mode = POINTER_MODES.RELATIVE;
      modeChanges += 1;
      notify(reason);
    } else if (!requestLock) {
      notify(reason);
    }
    if (requestLock) requestPointerLock();
    return mode;
  }

  function toggleMode(options = {}) {
    return setMode(
      mode === POINTER_MODES.ABSOLUTE ? POINTER_MODES.RELATIVE : POINTER_MODES.ABSOLUTE,
      options,
    );
  }

  function handlePointerLockChange() {
    pointerLockChanges += 1;
    if (pointerLocked()) {
      if (mode === POINTER_MODES.RELATIVE || pointerLockRequested) {
        pointerLockRequested = false;
        if (mode !== POINTER_MODES.RELATIVE) {
          releaseAll("pointerlock-acquired");
          mode = POINTER_MODES.RELATIVE;
          modeChanges += 1;
        }
        notify("pointerlock-acquired");
      }
      return snapshot("pointerlock-acquired");
    }
    if (mode === POINTER_MODES.RELATIVE || pointerLockRequested) {
      makeAbsolute("pointerlock-lost", { exitLock: false });
    }
    return snapshot("pointerlock-change");
  }

  function handlePointerLockError(event) {
    return lockFailure("pointerlock-error", event);
  }

  function currentDevice() {
    return mode === POINTER_MODES.ABSOLUTE ? absoluteButtonDevice : "mouse";
  }

  function wheelScale(deltaMode) {
    switch (deltaMode) {
      case WHEEL_DELTA_MODES.PIXEL: return 1;
      case WHEEL_DELTA_MODES.LINE: return 40;
      case WHEEL_DELTA_MODES.PAGE: return WHEEL_DETENT_UNITS;
      default: return null;
    }
  }

  function wholeWheelDetents(units) {
    const ratio = units / WHEEL_DETENT_UNITS;
    // A tiny tolerance makes repeated fractional WheelEvent values deterministic at an exact
    // detent boundary without ever changing the sign of an emitted event.
    if (ratio > 0) return Math.floor(ratio + 1e-9);
    if (ratio < 0) return Math.ceil(ratio - 1e-9);
    return 0;
  }

  function handleWheel(event) {
    const rawMode = event?.deltaMode ?? WHEEL_DELTA_MODES.PIXEL;
    const deltaMode = finiteNumber(rawMode);
    const scale = deltaMode !== null && Number.isInteger(deltaMode) ? wheelScale(deltaMode) : null;
    if (scale === null) {
      diagnostic("unsupported-wheel-mode", { deltaMode: rawMode });
      return { forwarded: false, consumed: false, reason: "unsupported-wheel-mode" };
    }

    const axes = [
      // Browser deltaX grows to the right; REL_HWHEEL keeps that natural horizontal sign.
      { name: "horizontal", value: finiteNumber(event?.deltaX ?? 0), code: REL_HWHEEL, direction: 1 },
      // Browser deltaY grows down; evdev REL_WHEEL +1 means up/away, so invert it.
      { name: "vertical", value: finiteNumber(event?.deltaY ?? 0), code: REL_WHEEL, direction: -1 },
    ];
    if (axes.some((axis) => axis.value === null)) {
      diagnostic("invalid-wheel-delta", { deltaMode });
      return { forwarded: false, consumed: false, reason: "invalid-wheel-delta" };
    }

    const nextRemainders = { ...wheelRemainders };
    const detents = { horizontal: 0, vertical: 0 };
    const events = [];
    let consumed = false;
    for (const axis of axes) {
      if (axis.value === 0) continue;
      consumed = true;
      const bounded = clamp(axis.value, -WHEEL_MAX_INPUT, WHEEL_MAX_INPUT);
      if (bounded !== axis.value) diagnostic("wheel-delta-clamped", { axis: axis.name, delta: axis.value });
      const combined = nextRemainders[axis.name] + bounded * scale * axis.direction;
      const whole = wholeWheelDetents(combined);
      nextRemainders[axis.name] = combined - whole * WHEEL_DETENT_UNITS;
      detents[axis.name] = whole;
      if (whole !== 0) events.push(eventRecord(EV_REL, axis.code, whole));
    }
    if (!consumed) return { forwarded: false, consumed: false, reason: "zero-wheel" };

    // Commit the bounded remainder even when the guest is not ready. There is no guest frame to
    // replay in that state, and retaining only the fractional detent avoids an unbounded pre-boot
    // accumulator while keeping the next live wheel event deterministic.
    wheelRemainders = nextRemainders;
    if (events.length === 0) {
      notify("wheel-accumulating");
      return { forwarded: false, consumed: true, reason: "wheel-accumulating", detents, remainders: { ...wheelRemainders } };
    }
    const frame = publish("mouse", events, { source: "wheel", deltaMode, detents });
    if (!frame) {
      notify("wheel-dropped");
      return { forwarded: false, consumed: true, reason: "not-forwarded", detents, remainders: { ...wheelRemainders } };
    }
    return { forwarded: true, consumed: true, frame, detents, remainders: { ...wheelRemainders } };
  }

  function handleFocusLoss(reason = "focus-loss") {
    const released = heldButtons.size;
    makeAbsolute(reason);
    return { mode, released, pointerLocked: pointerLocked(), heldButtons: snapshot(reason).heldButtons };
  }

  function handlePointerMove(event) {
    if (mode === POINTER_MODES.RELATIVE) {
      const movementX = finiteNumber(event?.movementX);
      const movementY = finiteNumber(event?.movementY);
      if (movementX === null || movementY === null) {
        diagnostic("invalid-relative-move", { eventType: event?.type ?? "" });
        return { forwarded: false, reason: "invalid-relative-move" };
      }
      const events = [];
      if (movementX !== 0) events.push(eventRecord(EV_REL, REL_X, Math.round(movementX)));
      if (movementY !== 0) events.push(eventRecord(EV_REL, REL_Y, Math.round(movementY)));
      const frame = publish("mouse", events, { source: "pointermove" });
      return frame ? { forwarded: true, frame } : { forwarded: false, reason: "not-forwarded" };
    }
    const coordinates = absoluteCoordinatesFromEvent(event, getRect());
    if (!coordinates) {
      diagnostic("invalid-absolute-rect", { eventType: event?.type ?? "" });
      return { forwarded: false, reason: "invalid-absolute-rect" };
    }
    const frame = publish("tablet", [
      eventRecord(EV_ABS, ABS_X, coordinates.x),
      eventRecord(EV_ABS, ABS_Y, coordinates.y),
    ], { source: "pointermove", coordinates });
    return frame ? { forwarded: true, frame, coordinates } : { forwarded: false, reason: "not-forwarded" };
  }

  function handlePointerDown(event) {
    const button = finiteNumber(event?.button);
    const evdev = evdevForPointerButton(button);
    if (evdev === null) {
      diagnostic("unsupported-pointer-button", { button });
      return { forwarded: false, reason: "unsupported-pointer-button" };
    }
    const key = pointerEventKey(event, button);
    if (heldButtons.has(key)) {
      diagnostic("duplicate-pointer-down", { button, pointerId: event?.pointerId });
      return { forwarded: false, reason: "duplicate-pointer-down", evdev };
    }
    const device = currentDevice();
    const frame = publish(device, [eventRecord(EV_KEY, evdev, 1)], {
      source: "pointerdown",
      button,
      evdev,
    });
    if (!frame) return { forwarded: false, reason: "not-forwarded", evdev };
    heldButtons.set(key, { key, button, evdev, device, pointerId: event?.pointerId ?? null });
    return { forwarded: true, frame, evdev };
  }

  function findHeldButton(event) {
    const button = finiteNumber(event?.button);
    const exact = pointerEventKey(event, button);
    if (heldButtons.has(exact)) return [exact, heldButtons.get(exact)];
    for (const [key, entry] of heldButtons) {
      if (entry.button === button) return [key, entry];
    }
    return [null, null];
  }

  function handlePointerUp(event) {
    const [key, entry] = findHeldButton(event);
    if (!entry) {
      diagnostic("orphan-pointer-up", { button: event?.button, pointerId: event?.pointerId });
      return { forwarded: false, reason: "orphan-pointer-up" };
    }
    const frame = publish(entry.device, [eventRecord(EV_KEY, entry.evdev, 0)], {
      source: "pointerup",
      button: entry.button,
      evdev: entry.evdev,
    });
    if (!frame) return { forwarded: false, reason: "not-forwarded", evdev: entry.evdev };
    heldButtons.delete(key);
    return { forwarded: true, frame, evdev: entry.evdev };
  }

  function handlePointerCancel(event) {
    const frames = releaseAll("pointercancel");
    if (mode === POINTER_MODES.RELATIVE || pointerLockRequested) {
      makeAbsolute("pointercancel");
    } else {
      notify("pointercancel");
    }
    return { forwarded: frames.length > 0, frames, mode };
  }

  function handleContextMenu(event) {
    try { event?.preventDefault?.(); } catch (error) {
      diagnostic("contextmenu-prevent-error", { error: error?.message || String(error) });
    }
    return true;
  }

  function reset({ emit = false, exitLock = true } = {}) {
    if (emit) releaseAll("reset");
    else heldButtons.clear();
    pointerLockRequested = false;
    mode = POINTER_MODES.ABSOLUTE;
    wheelRemainders = { horizontal: 0, vertical: 0 };
    if (exitLock && pointerLocked()) exitPointerLock();
    notify("reset");
  }

  return {
    setTarget(value) { pointerTarget = value; },
    setDocumentTarget(value) { pointerDocument = value; },
    mode: () => mode,
    state: () => snapshot(),
    isPointerLocked: pointerLocked,
    setMode,
    toggleMode,
    requestRelative: () => setMode(POINTER_MODES.RELATIVE),
    exitRelative: () => setMode(POINTER_MODES.ABSOLUTE, { reason: "relative-cancelled" }),
    handlePointerLockChange,
    handlePointerLockError,
    handlePointerMove,
    handleWheel,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    handleFocusLoss,
    handleContextMenu,
    wheelRemainders: () => ({ ...wheelRemainders }),
    releaseAll,
    reset,
    heldButtons: () => [...heldButtons.values()].map((entry) => ({ ...entry })),
  };
}

/** Attach the bridge to a DOM pointer surface and its Pointer Lock lifecycle. */
export function attachPointerBridge(
  target,
  bridge,
  {
    documentTarget = globalThis.document,
    windowTarget = globalThis.window,
    capture = true,
    preventDefault = true,
  } = {},
) {
  if (!target || typeof target.addEventListener !== "function") {
    throw new TypeError("pointer bridge target must support addEventListener");
  }
  if (typeof bridge?.handlePointerMove !== "function") {
    throw new TypeError("pointer bridge requires handlePointerMove");
  }
  bridge.setTarget?.(target);
  bridge.setDocumentTarget?.(documentTarget);
  const options = { capture, passive: false };
  const onMove = (event) => {
    const result = bridge.handlePointerMove(event);
    if (preventDefault && result?.forwarded) event.preventDefault?.();
  };
  const onWheel = (event) => {
    const result = bridge.handleWheel?.(event);
    if (preventDefault && result?.consumed) event.preventDefault?.();
  };
  const onDown = (event) => {
    const result = bridge.handlePointerDown(event);
    if (!result?.forwarded) return;
    if (preventDefault) event.preventDefault?.();
    try { target.setPointerCapture?.(event.pointerId); } catch { /* capture is an enhancement */ }
  };
  const onUp = (event) => {
    const result = bridge.handlePointerUp(event);
    if (preventDefault && result?.forwarded) event.preventDefault?.();
    try { target.releasePointerCapture?.(event.pointerId); } catch { /* capture is an enhancement */ }
  };
  const onCancel = (event) => {
    const result = bridge.handlePointerCancel(event);
    if (preventDefault && result?.forwarded) event.preventDefault?.();
    try { target.releasePointerCapture?.(event.pointerId); } catch { /* capture is an enhancement */ }
  };
  const onContextMenu = (event) => bridge.handleContextMenu(event);
  const onLockChange = () => bridge.handlePointerLockChange();
  const onLockError = (event) => bridge.handlePointerLockError(event);
  const onBlur = () => bridge.handleFocusLoss?.("blur");
  const onVisibilityChange = () => {
    if (documentTarget?.hidden === true || documentTarget?.visibilityState === "hidden") {
      bridge.handleFocusLoss?.("visibility-hidden");
    }
  };
  const viewTarget = windowTarget ?? documentTarget;
  const onViewToggle = () => bridge.handleFocusLoss?.("view-toggle");
  target.addEventListener("pointermove", onMove, options);
  target.addEventListener("wheel", onWheel, options);
  target.addEventListener("pointerdown", onDown, options);
  target.addEventListener("pointerup", onUp, options);
  target.addEventListener("pointercancel", onCancel, options);
  target.addEventListener("contextmenu", onContextMenu, options);
  documentTarget?.addEventListener?.("pointerlockchange", onLockChange, options);
  documentTarget?.addEventListener?.("pointerlockerror", onLockError, options);
  windowTarget?.addEventListener?.("blur", onBlur, options);
  documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange, options);
  viewTarget?.addEventListener?.("wvm:reserved-view-toggle", onViewToggle, options);
  return () => {
    target.removeEventListener?.("pointermove", onMove, options);
    target.removeEventListener?.("wheel", onWheel, options);
    target.removeEventListener?.("pointerdown", onDown, options);
    target.removeEventListener?.("pointerup", onUp, options);
    target.removeEventListener?.("pointercancel", onCancel, options);
    target.removeEventListener?.("contextmenu", onContextMenu, options);
    documentTarget?.removeEventListener?.("pointerlockchange", onLockChange, options);
    documentTarget?.removeEventListener?.("pointerlockerror", onLockError, options);
    windowTarget?.removeEventListener?.("blur", onBlur, options);
    documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange, options);
    viewTarget?.removeEventListener?.("wvm:reserved-view-toggle", onViewToggle, options);
    bridge.reset?.({ emit: false, exitLock: true });
  };
}
