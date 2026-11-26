// E5-T15c: cursor presentation mode and DOM lifecycle.
//
// CursorSink owns resource conversion. This controller owns the page's one optional overlay,
// absolute/relative mode policy, and transform-only MOVE_CURSOR handling. The move path never
// calls a layout API or touches the PNG/data URL; it only updates the current position and, when
// needed, the overlay's transform.

import { CursorSink, cssCursorDescriptor } from "./cursor.js";
import { CursorHotspotEstimator } from "./cursor-hotspot.js";

// E5-T36a hotspot inference timing (see cursor-hotspot.js).
// Quiet on the page — no position sent, no cursor event — before the guest is asked whether it
// has caught up. Quiet alone proves nothing: a busy guest leaves the plane behind for longer.
export const HOTSPOT_REST_MS = 150;
// "Caught up" is the guest having been idle after everything sent so far was delivered. It is
// read off a counter of the guest's idle waits (the paced clock's): polled this often, for at
// most this long a question. Without that counter (no paced clock) the page is never told, and
// infers nothing; it looks for a counter again after the same time.
export const HOTSPOT_POLL_MS = 40;
export const HOTSPOT_CAUGHT_UP_TIMEOUT_MS = 2000;

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
    hotspotEstimator = new CursorHotspotEstimator(),
    hotspotRestMs = HOTSPOT_REST_MS,
    // async () => number | null: how many idle waits the guest has taken so far, read AFTER
    // everything sent before the call was delivered to it; null when that is not known.
    guestIdleCount = null,
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (handle) => globalThis.clearTimeout(handle),
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
    // E5-T36: a device that reports no hotspot (legacy KMS places the plane at pointer minus
    // hotspot instead) gets it inferred for the CSS cursor, which the browser draws at the
    // real pointer. `_imageKey` names the image being inferred for (null when there is nothing
    // to infer); `_cssHot` is its inferred hotspot, or null while it is not known.
    if (!(hotspotRestMs > 0)) throw new RangeError("cursor hotspotRestMs must be positive");
    if (guestIdleCount !== null && typeof guestIdleCount !== "function") throw new TypeError("cursor guestIdleCount must be a function");
    this._hotspots = hotspotEstimator;
    this._hotspotRestMs = hotspotRestMs;
    this._guestIdleCount = guestIdleCount;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._restTimer = null;
    // Waits of the asynchronous parts of inference, so that a reset can end them at once.
    this._waits = new Set();
    // Bumped whenever inference starts over; an asynchronous step of an older epoch gives up.
    this._hotspotEpoch = 0;
    // True while the page does not know that the guest's pointer stands on a position it
    // remembers sending: from the start, after a guest reset, after the pointer mode or the
    // output size changed, and when a cursor appears where none was shown (the positions sent
    // before are forgotten then). A cursor move reported in that state may stand for a
    // position the page does not have — the device reports the plane's place on every commit,
    // also where it already stood — so it is not evidence. It ends when the guest has been
    // idle after a position sent since that it acts on (see `notePointer`): its pointer is
    // then on that position or a later one, and stays on remembered ones.
    this._hotspotSettling = true;
    // The epoch whose settling question is being asked (one loop of questions per epoch).
    this._settleEpoch = -1;
    this._imageKey = null;
    this._cssHot = null;
    // The guest output size the sent pointer positions were last computed for.
    this._pointerOutput = null;
    // The last absolute position sent and the output size it was computed for: what the
    // guest's tablet device holds, whatever has moved the guest's pointer since.
    this._lastPointer = null;
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
      this._setHostCursor(this._cssHot
        ? cssCursorDescriptor(descriptor.dataUrl, this._cssHot.x, this._cssHot.y, descriptor.width, descriptor.height)
        : descriptor.css);
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
      const wasShown = this._descriptor !== null && this._descriptor.kind !== "hidden";
      this._state = state;
      this._descriptor = descriptor;
      this._updates += 1;
      // A cursor appears where none was shown. A compositor that has just started puts its
      // pointer where it likes and has read nothing of what the tablet was sent; and while a
      // client hid the cursor the page saw nothing of where the pointer went. Either way the
      // page no longer knows where the guest's pointer stands.
      if (!wasShown && descriptor.kind !== "hidden") this._restartHotspotInference();
      this._trackHotspot(state, descriptor);
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
        this._trackHotspot(state, null); // no image: nothing to infer for or to wait for
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
      // A move is the one cursor event whose position was computed with this image's hotspot:
      // evidence, while the guest's pointer is known to stand on a remembered position.
      // (A style write follows only when the answer changes: once per image, normally.)
      if (!this._hotspotSettling) {
        this._inferHotspot(() => this._hotspots.noteMove(
          this._imageKey, this._descriptor.width, this._descriptor.height, state.x, state.y));
      }
      return this.snapshot("cursor-move");
    } catch (error) {
      this._diagnostic("cursor-move-rejected", error);
      return false;
    }
  }

  /**
   * A guest-space pointer position the page has just sent to the guest (E5-T36), and the guest
   * output size it was computed for. Only absolute positions are sent here. A change of output
   * size makes earlier positions incomparable with what the guest reports: inference starts over.
   *
   * Not every position sent is one the guest acts on. Its kernel passes on only the axes whose
   * value changed, so a position equal to the tablet's last one reaches nobody and moves
   * nothing. That is harmless while the guest's pointer stands there — and it does not after
   * relative motion (another device), which leaves the tablet's values where they were. So a
   * position counts as "the guest will put its pointer here" only if it differs from the one
   * sent before it; the first of a page or after a guest reset (the tablet's values are not
   * known) and the first at another output size (pixels of two sizes do not compare) never do.
   */
  notePointer(x, y, outputWidth = null, outputHeight = null) {
    // Outside absolute mode nothing sent is a position the guest's plane could stand for.
    if (this._disposed || this._mode !== CURSOR_MODES.ABSOLUTE) return;
    try {
      if (outputWidth !== null && outputHeight !== null) {
        const previous = this._pointerOutput;
        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();
        this._pointerOutput = { width: outputWidth, height: outputHeight };
      }
      this._hotspots.notePointer(x, y);
      const last = this._lastPointer;
      const now = { x: Number(x) | 0, y: Number(y) | 0, width: outputWidth, height: outputHeight };
      this._lastPointer = now;
      const acted = last !== null && last.width === now.width && last.height === now.height &&
        (last.x !== now.x || last.y !== now.y);
      if (!this._hotspotSettling) this._armHotspotRest();
      // A remembered position the guest acts on is on its way to it: now it can be asked.
      else if (acted) this._settleHotspots();
    } catch (error) {
      this._diagnostic("cursor-hotspot-pointer-error", error);
    }
  }

  /**
   * Forget every inferred hotspot, so that each image is inferred as if met for the first time
   * (a proof script's hook; nothing in the page needs to forget what it has settled). The
   * positions sent are kept — the guest's pointer still stands on one of them — so nothing has
   * to be waited for.
   */
  resetHotspotInference() {
    try {
      this._hotspots.forget();
    } catch (error) {
      this._diagnostic("cursor-hotspot-error", error);
    }
    // (Nothing is known about the image shown until its plane is reported again.)
    this._setCssHot(null);
  }

  /**
   * Start inference over: what the page sent before this moment no longer compares with what
   * the guest reports (the pointer mode or the output size changed, or a cursor appeared where
   * none was shown). The positions sent and
   * everything not settled are forgotten; hotspots already settled belong to their images and
   * stay, on the page too. The guest's pointer now stands on a position the page has
   * forgotten, so its cursor moves are not evidence again until it has acted on a position
   * sent from here on.
   */
  _restartHotspotInference() {
    this._endHotspotWaits();
    try {
      this._hotspots.restart();
    } catch (error) {
      this._diagnostic("cursor-hotspot-error", error);
    }
    this._hotspotSettling = true;
  }

  /**
   * While settling, and with a position sent since it began that the guest acts on: ask the
   * guest until it has been idle after that position reached it. Every question of this loop
   * starts after the position was sent, so "caught up" means the guest's pointer stands on it
   * or on a later one.
   */
  async _settleHotspots() {
    const epoch = this._hotspotEpoch;
    if (this._settleEpoch === epoch || typeof this._guestIdleCount !== "function") return;
    this._settleEpoch = epoch;
    for (;;) {
      const caughtUp = await this._guestCaughtUp(epoch);
      if (epoch !== this._hotspotEpoch) return;
      if (caughtUp === true) break;
      // A guest never idle within the timeout is asked again at once. No counter to ask (no
      // paced clock, or not yet): look again later; until there is one nothing is inferred.
      if (caughtUp === null && !(await this._hotspotWait(HOTSPOT_CAUGHT_UP_TIMEOUT_MS))) return;
    }
    // (No rest wait to arm: nothing is known about any image until it is reported again, and
    // that report arms one.)
    this._hotspotSettling = false;
  }

  /**
   * Has the guest been idle after everything sent before this call was delivered? `true` when
   * its idle counter moved on, `false` when it did not within the timeout (or this epoch
   * ended), `null` when there is no counter to ask.
   */
  async _guestCaughtUp(epoch) {
    const count = async () => {
      try {
        const value = await this._guestIdleCount();
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      } catch (error) {
        this._diagnostic("cursor-hotspot-idle-error", error);
        return null;
      }
    };
    const first = await count();
    if (first === null) return null;
    for (let waited = 0; waited < HOTSPOT_CAUGHT_UP_TIMEOUT_MS; waited += HOTSPOT_POLL_MS) {
      // (The epoch may have ended while a reading was on its way: no wait is begun for it. One
      // that ends during a wait ends the wait.)
      if (epoch !== this._hotspotEpoch || !(await this._hotspotWait(HOTSPOT_POLL_MS))) return false;
      const now = await count();
      if (now === null) return null;
      if (now > first) return true;
    }
    return false;
  }

  /** A cancellable wait; resolves `true` when it elapsed, `false` when inference was reset. */
  _hotspotWait(ms) {
    return new Promise((resolve) => {
      const wait = { resolve, timer: null };
      wait.timer = this._setTimer(() => {
        if (!this._waits.delete(wait)) return;
        resolve(true);
      }, ms);
      this._waits.add(wait);
    });
  }

  /** End every asynchronous step of inference in flight and start a new epoch. */
  _endHotspotWaits() {
    this._cancelHotspotRest();
    this._hotspotEpoch += 1;
    for (const wait of this._waits) { this._clearTimer(wait.timer); wait.resolve(false); }
    this._waits.clear();
  }

  /**
   * Start (or resume) hotspot inference for the image a cursor update just installed. The
   * update's own position is NOT evidence: a legacy-KMS commit sets the image at the plane's
   * previous position, which was computed with the previous image's hotspot, and moves it after.
   */
  _trackHotspot(state, descriptor) {
    const previousKey = this._imageKey;
    this._imageKey = null;
    this._cssHot = null;
    this._cancelHotspotRest();
    // Only a CSS cursor is drawn at the host pointer, and only a device that reports no
    // hotspot leaves one to infer. (An overlay follows the reported plane position as is.)
    if (descriptor?.kind !== "css" || state.hotX !== 0 || state.hotY !== 0) return;
    this._imageKey = descriptor.dataUrl;
    try {
      // The guest sets its image again and again without changing it (sway does on most
      // commits); only a CHANGE of image makes the plane position remembered for it stale.
      if (previousKey !== this._imageKey) this._hotspots.noteInstall(this._imageKey);
      this._cssHot = this._hotspots.hotspot(this._imageKey);
    } catch (error) {
      this._diagnostic("cursor-hotspot-error", error);
    }
    this._armHotspotRest();
  }

  /**
   * Take the estimator's answer for the current image after one piece of evidence. (In
   * relative mode there is nothing to compare a move with: inference was reset on entering it
   * and no position is noted while it lasts.)
   */
  _inferHotspot(evidence) {
    if (this._imageKey === null) return;
    try {
      this._setCssHot(evidence());
    } catch (error) {
      this._diagnostic("cursor-hotspot-error", error);
    }
    this._armHotspotRest();
  }

  /** Show `hot` (or no hotspot) for the current image; one style write, only on a change. */
  _setCssHot(hot) {
    const now = this._cssHot;
    if ((hot === null && now === null) || (hot !== null && now !== null && hot.x === now.x && hot.y === now.y)) return;
    this._cssHot = hot;
    this._applySafely("cursor-hotspot-dom-error");
  }

  /**
   * While the current image's hotspot is unknown, watch for the pointer coming to rest: no
   * position sent and no cursor event for `hotspotRestMs`, and then the guest idle after the
   * last position reached it. Only then is the plane where the guest put it for that position,
   * which settles the hotspot without a second move. (Settling ends only in absolute mode and
   * with an idle counter, so neither needs asking for here.)
   */
  _armHotspotRest() {
    this._cancelHotspotRest();
    if (this._imageKey === null || this._cssHot !== null || this._hotspotSettling) return;
    const timer = this._setTimer(() => {
      if (this._restTimer !== timer) return;
      this._restTimer = null;
      this._restHotspot();
    }, this._hotspotRestMs);
    this._restTimer = timer;
  }

  async _restHotspot() {
    const epoch = this._hotspotEpoch;
    const key = this._imageKey;
    let sends;
    try { sends = this._hotspots.sends; } catch (error) { this._diagnostic("cursor-hotspot-error", error); return; }
    if ((await this._guestCaughtUp(epoch)) !== true) return;
    // A different image by now (or none: a reset) has armed a wait of its own, and the answer
    // was not about it. (Inference started over meanwhile needs no check: every image without
    // an answer was forgotten, and the estimator has none to give.)
    if (key !== this._imageKey) return;
    try {
      // A position sent meanwhile: the pointer was not at rest.
      if (this._hotspots.sends !== sends) return;
      this._setCssHot(this._hotspots.noteRest(key, this._descriptor.width, this._descriptor.height));
    } catch (error) {
      this._diagnostic("cursor-hotspot-error", error);
    }
  }

  _cancelHotspotRest() {
    if (this._restTimer === null) return;
    const timer = this._restTimer;
    this._restTimer = null;
    this._clearTimer(timer);
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
    // Leaving or entering absolute mode: positions sent before and plane positions reported
    // after no longer belong together.
    if (mode !== this._mode) {
      this._mode = mode;
      this._restartHotspotInference();
    }
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
    // A reset guest has nothing of ours on its way to it, and its pointer stands where the
    // page has never sent it.
    this._endHotspotWaits();
    this._hotspotSettling = true;
    this._imageKey = null;
    this._cssHot = null;
    this._pointerOutput = null;
    this._lastPointer = null;
    try { this._hotspots.reset(); } catch (error) { this._diagnostic("cursor-hotspot-error", error); }
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
      inferredHotX: this._cssHot?.x ?? null,
      inferredHotY: this._cssHot?.y ?? null,
      hotspotSettling: this._hotspotSettling,
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
