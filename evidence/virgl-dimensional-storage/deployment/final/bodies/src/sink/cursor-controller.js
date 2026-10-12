// E5-T15c: cursor presentation mode and DOM lifecycle.
//
// CursorSink owns resource conversion. This controller owns the page's one optional overlay,
// absolute/relative mode policy, and transform-only MOVE_CURSOR handling. The move path never
// calls a layout API or touches the PNG/data URL; it only updates the current position and, when
// needed, the overlay's transform.

import { CursorSink } from "./cursor.js";

export const CURSOR_MODES = Object.freeze({
  ABSOLUTE: "absolute",
  RELATIVE: "relative",
});

export const CURSOR_EVENTS = Object.freeze({
  UPDATE: "cursor-update",
  MOVE: "cursor-move",
});

const MAX_U32 = 0xffff_ffff;

function checkedU32(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_U32) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
  return number;
}

function checkedScale(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return number;
}

/** Normalize the Rust/worker cursor state without retaining any borrowed guest object. */
export function normalizeCursorState(state) {
  if (state === null || typeof state !== "object") throw new TypeError("cursor state is missing");
  const pos = state.pos && typeof state.pos === "object"
    ? state.pos
    : state.position && typeof state.position === "object"
      ? state.position
      : state;
  return Object.freeze({
    resourceId: checkedU32(state.resourceId ?? state.resource_id, "cursor resource id"),
    hotX: checkedU32(state.hotX ?? state.hot_x, "cursor hot_x"),
    hotY: checkedU32(state.hotY ?? state.hot_y, "cursor hot_y"),
    scanout: checkedU32(pos.scanout ?? pos.scanoutId ?? pos.scanout_id, "cursor scanout"),
    x: checkedU32(pos.x, "cursor x"),
    y: checkedU32(pos.y, "cursor y"),
  });
}

function safeCallback(callback, value) {
  try { callback(value); } catch { /* diagnostics never break guest execution */ }
}

function eventType(event) {
  return event?.type ?? event?.event ?? event?.kind ?? CURSOR_EVENTS.UPDATE;
}

function stateForSink(state) {
  return {
    resourceId: state.resourceId,
    hotX: state.hotX,
    hotY: state.hotY,
    pos: {
      scanoutId: state.scanout,
      x: state.x,
      y: state.y,
    },
  };
}

/**
 * Own the current cursor asset and its optional DOM overlay.
 *
 * The target is the same surface used by the pointer bridge. The controller does not create an
 * element or write target styles until a cursor resource is actually published, so software-fbcon
 * boots with no cursorq traffic leave the browser's default cursor untouched.
 */
export class CursorController {
  constructor({
    target = null,
    documentTarget = globalThis.document,
    overlayParent = target,
    cssMaxDimension,
    positionScaleX = 1,
    positionScaleY = 1,
    onDiagnostic = () => {},
    onStateChange = () => {},
  } = {}) {
    if (target !== null && (typeof target !== "object" || !target.style)) {
      throw new TypeError("cursor target must expose a style object");
    }
    if (overlayParent !== null && (typeof overlayParent !== "object" || typeof overlayParent.appendChild !== "function")) {
      throw new TypeError("cursor overlay parent must support appendChild");
    }
    if (typeof onDiagnostic !== "function") throw new TypeError("cursor onDiagnostic must be a function");
    if (typeof onStateChange !== "function") throw new TypeError("cursor onStateChange must be a function");
    this.target = target;
    this.documentTarget = documentTarget;
    this.overlayParent = overlayParent;
    this._positionScaleX = checkedScale(positionScaleX, "cursor x scale");
    this._positionScaleY = checkedScale(positionScaleY, "cursor y scale");
    this._onDiagnostic = onDiagnostic;
    this._onStateChange = onStateChange;
    this._sink = new CursorSink({ cssMaxDimension });
    this._descriptor = null;
    this._state = null;
    this._mode = CURSOR_MODES.ABSOLUTE;
    this._pointerLocked = false;
    this._overlay = null;
    this._savedHostCursor = null;
    this._hostCursorOwned = false;
    this._hostCursorHidden = false;
    this._targetPositionOwned = false;
    this._savedTargetPosition = null;
    this._updates = 0;
    this._moves = 0;
    this._modeChanges = 0;
    this._transformWrites = 0;
    this._styleWrites = 0;
    this._diagnostics = 0;
    this._disposed = false;
  }

  _diagnostic(reason, error = undefined) {
    this._diagnostics += 1;
    safeCallback(this._onDiagnostic, {
      reason,
      mode: this._mode,
      resourceId: this._state?.resourceId ?? 0,
      error: error ? String(error?.message || error) : undefined,
    });
  }

  _notify(reason) {
    safeCallback(this._onStateChange, this.snapshot(reason));
  }

  _captureHostCursor() {
    if (this._hostCursorOwned || !this.target?.style) return;
    this._savedHostCursor = this.target.style.cursor ?? "";
    this._hostCursorOwned = true;
  }

  _setHostCursor(value, { hidden = false } = {}) {
    if (!this.target?.style) return;
    this._captureHostCursor();
    if (this.target.style.cursor !== value) {
      this.target.style.cursor = value;
      this._styleWrites += 1;
    }
    this._hostCursorHidden = hidden;
  }

  _restoreHostCursor() {
    if (!this._hostCursorOwned || !this.target?.style) return;
    if (this.target.style.cursor !== this._savedHostCursor) {
      this.target.style.cursor = this._savedHostCursor;
      this._styleWrites += 1;
    }
    this._hostCursorOwned = false;
    this._hostCursorHidden = false;
    this._savedHostCursor = null;
  }

  _captureTargetPosition() {
    if (this._targetPositionOwned || this.overlayParent !== this.target || !this.target?.style) return;
    this._savedTargetPosition = this.target.style.position ?? "";
    if (!this._savedTargetPosition) {
      this.target.style.position = "relative";
      this._styleWrites += 1;
      this._targetPositionOwned = true;
    }
  }

  _restoreTargetPosition() {
    if (!this._targetPositionOwned || !this.target?.style) return;
    if (this.target.style.position !== this._savedTargetPosition) {
      this.target.style.position = this._savedTargetPosition;
      this._styleWrites += 1;
    }
    this._targetPositionOwned = false;
    this._savedTargetPosition = null;
  }

  _ensureOverlay() {
    if (this._overlay) return this._overlay;
    if (!this.overlayParent || typeof this.documentTarget?.createElement !== "function") {
      throw new Error("cursor overlay DOM is unavailable");
    }
    const overlay = this.documentTarget.createElement("img");
    if (!overlay || !overlay.style) throw new TypeError("cursor overlay element is invalid");
    overlay.className = "wvm-cursor-overlay";
    overlay.alt = "";
    overlay.draggable = false;
    overlay.setAttribute?.("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.pointerEvents = "none";
    overlay.style.userSelect = "none";
    overlay.style.willChange = "transform";
    overlay.style.transformOrigin = "0 0";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "block";
    this._captureTargetPosition();
    try {
      this.overlayParent.appendChild(overlay);
    } catch (error) {
      this._restoreTargetPosition();
      throw error;
    }
    this._overlay = overlay;
    return overlay;
  }

  _removeOverlay() {
    if (!this._overlay) {
      this._restoreTargetPosition();
      return;
    }
    const overlay = this._overlay;
    let removed = false;
    try {
      if (typeof this.overlayParent?.removeChild === "function") {
        this.overlayParent.removeChild(overlay);
        removed = true;
      }
    } catch (error) {
      this._diagnostic("overlay-remove-error", error);
    }
    if (!removed) {
      try {
        overlay.remove?.();
        removed = true;
      } catch (error) {
        this._diagnostic("overlay-remove-error", error);
      }
    }
    this._overlay = null;
    this._restoreTargetPosition();
  }

  /** Write only the transform for a cursor position; this method performs no layout reads. */
  _applyPositionOnly() {
    if (!this._overlay || !this._state || !this._descriptor) return;
    const x = this._state.x * this._positionScaleX - this._descriptor.hotX;
    const y = this._state.y * this._positionScaleY - this._descriptor.hotY;
    this._overlay.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this._transformWrites += 1;
  }

  _showOverlay() {
    const descriptor = this._descriptor;
    if (!descriptor || descriptor.kind === "hidden") return;
    const overlay = this._ensureOverlay();
    const source = descriptor.src ?? descriptor.dataUrl;
    overlay.src = source;
    overlay.style.width = `${descriptor.width}px`;
    overlay.style.height = `${descriptor.height}px`;
    overlay.style.display = "block";
    this._applyPositionOnly();
  }

  _applyAsset() {
    const descriptor = this._descriptor;
    if (!descriptor || descriptor.kind === "hidden" || this._state?.resourceId === 0) {
      this._removeOverlay();
      this._restoreHostCursor();
      return;
    }

    if (this._mode === CURSOR_MODES.ABSOLUTE && descriptor.kind === "css") {
      this._removeOverlay();
      this._setHostCursor(descriptor.css);
      return;
    }

    // Relative mode always uses the overlay. A large absolute-mode cursor also uses the overlay
    // because browsers reject CSS cursor images above the bounded CSS dimension.
    this._showOverlay();
    if (this._mode === CURSOR_MODES.RELATIVE) {
      if (this._pointerLocked) this._setHostCursor("none", { hidden: true });
      else this._restoreHostCursor();
    } else {
      this._setHostCursor("none", { hidden: true });
    }
  }

  _applySafely(reason) {
    try {
      this._applyAsset();
    } catch (error) {
      this._diagnostic(reason, error);
    }
  }

  /** Apply one cursor resource callback, copying all guest-backed bytes through CursorSink. */
  handleUpdate(event) {
    if (this._disposed) return false;
    let state;
    try {
      state = normalizeCursorState(event?.state ?? event?.cursorState ?? event);
      const descriptor = this._sink.update(
        stateForSink(state),
        event?.format,
        event?.resourceWidth,
        event?.resourceHeight,
        event?.pixels ?? [],
      );
      this._state = state;
      this._descriptor = descriptor;
      this._updates += 1;
      this._applySafely("cursor-update-dom-error");
      this._notify("cursor-update");
      return this.snapshot("cursor-update");
    } catch (error) {
      this._diagnostic("cursor-update-rejected", error);
      return false;
    }
  }

  /**
   * Apply MOVE_CURSOR without touching the copied resource or invoking any layout API.
   * A move before a matching update is rejected rather than accidentally displaying stale data.
   */
  handleMove(event) {
    if (this._disposed) return false;
    try {
      const state = normalizeCursorState(event?.state ?? event?.cursorState ?? event);
      if (state.resourceId === 0) {
        this._state = state;
        this._descriptor = null;
        this._removeOverlay();
        this._restoreHostCursor();
        this._moves += 1;
        this._notify("cursor-move-hidden");
        return this.snapshot("cursor-move-hidden");
      }
      if (!this._descriptor || this._descriptor.kind === "hidden" ||
          this._state?.resourceId !== state.resourceId) {
        throw new RangeError("cursor move has no matching copied resource");
      }
      if (state.hotX !== this._descriptor.hotX || state.hotY !== this._descriptor.hotY) {
        throw new RangeError("cursor move cannot change the active hotspot");
      }
      if (state.hotX >= this._descriptor.width || state.hotY >= this._descriptor.height) {
        throw new RangeError("cursor move hotspot is outside the active resource");
      }
      this._state = state;
      this._moves += 1;
      // This is the only DOM operation on the high-frequency move path.
      this._applyPositionOnly();
      return this.snapshot("cursor-move");
    } catch (error) {
      this._diagnostic("cursor-move-rejected", error);
      return false;
    }
  }

  /** Dispatch a typed callback from the direct wasm path or the whole-machine worker. */
  handle(event) {
    switch (eventType(event)) {
      case CURSOR_EVENTS.UPDATE: return this.handleUpdate(event);
      case CURSOR_EVENTS.MOVE: return this.handleMove(event);
      default:
        this._diagnostic("unknown-cursor-event");
        return false;
    }
  }

  /** Follow the pointer bridge's mode/Pointer Lock state without coupling to its event routing. */
  setPointerState(state = {}) {
    const mode = state.mode ?? CURSOR_MODES.ABSOLUTE;
    if (mode !== CURSOR_MODES.ABSOLUTE && mode !== CURSOR_MODES.RELATIVE) {
      throw new TypeError(`unknown cursor mode: ${String(mode)}`);
    }
    const locked = state.pointerLocked === true;
    const changed = mode !== this._mode || locked !== this._pointerLocked;
    this._mode = mode;
    this._pointerLocked = locked;
    if (changed) {
      this._modeChanges += 1;
      this._applySafely("cursor-mode-dom-error");
      this._notify("pointer-state");
    }
    return this.snapshot("pointer-state");
  }

  /** Set guest-to-surface scale without measuring during MOVE_CURSOR delivery. */
  setPositionScale(scaleX, scaleY = scaleX) {
    this._positionScaleX = checkedScale(scaleX, "cursor x scale");
    this._positionScaleY = checkedScale(scaleY, "cursor y scale");
    if (this._overlay) this._applyPositionOnly();
    this._notify("position-scale");
    return this.snapshot("position-scale");
  }

  /** Return a private snapshot of the current converted asset for diagnostics and integration tests. */
  descriptor() {
    return Object.freeze(this._descriptor ? { ...this._descriptor } : { kind: "hidden" });
  }

  /** Hide the resource and remove all DOM owned by this controller. */
  reset() {
    if (this._disposed) return this.snapshot("reset");
    try {
      this._sink.hide({ resourceId: 0, hotX: 0, hotY: 0, scanout: 0, x: 0, y: 0 });
    } catch (error) {
      this._diagnostic("cursor-reset-sink-error", error);
    }
    this._descriptor = null;
    this._state = null;
    this._mode = CURSOR_MODES.ABSOLUTE;
    this._pointerLocked = false;
    this._removeOverlay();
    this._restoreHostCursor();
    this._notify("reset");
    return this.snapshot("reset");
  }

  dispose() {
    if (!this._disposed) this.reset();
    this._disposed = true;
    return this.snapshot("dispose");
  }

  snapshot(reason = "state") {
    return Object.freeze({
      mode: this._mode,
      pointerLocked: this._pointerLocked,
      resourceId: this._state?.resourceId ?? 0,
      kind: this._descriptor?.kind ?? "hidden",
      width: this._descriptor?.width ?? 0,
      height: this._descriptor?.height ?? 0,
      hotX: this._descriptor?.hotX ?? 0,
      hotY: this._descriptor?.hotY ?? 0,
      overlayAttached: this._overlay !== null,
      hostCursorOwned: this._hostCursorOwned,
      hostCursorHidden: this._hostCursorHidden,
      updates: this._updates,
      moves: this._moves,
      modeChanges: this._modeChanges,
      transformWrites: this._transformWrites,
      styleWrites: this._styleWrites,
      diagnostics: this._diagnostics,
      reason,
    });
  }
}
