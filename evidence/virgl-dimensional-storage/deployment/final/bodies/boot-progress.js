// E3-T24a: binds the pure boot-progress model (progress.js) to an accessible DOM surface and
// translates the loader's existing callbacks (onState / onProgress / onOutput / onError) plus the
// pollable chunk-fetch counter into the typed event stream the model consumes. Kept separate from
// the model so the invariants stay headlessly testable and the DOM here stays a thin renderer.

import { applyProgress, initialProgress, percent } from "./progress.js";

// onState string → typed events. The loader's six states map onto stage milestones; entering a later
// stage fills the earlier ones in the model, so a skipped state cannot strand the bar.
const STATE_EVENTS = {
  fetching: [
    { kind: "complete", stage: "wasm" },
    { kind: "complete", stage: "manifest" },
    { kind: "enter", stage: "kernel" },
  ],
  verifying: [
    { kind: "complete", stage: "kernel" },
    { kind: "complete", stage: "chunk" },
  ],
  instantiating: [{ kind: "complete", stage: "wasm" }],
  booting: [{ kind: "enter", stage: "login" }],
  // `done` = guest halt, NOT prompt-usable, so it is deliberately NOT a `ready`.
};

// onProgress role → measurable stage.
const ROLE_STAGE = { kernel: "kernel", rootfs: "chunk", initramfs: "chunk" };

// Terminal markers that mean "the prompt is usable" — the honest definition of 100%. These are the
// exact banners the existing boot tests treat as "booted" (chunked-boot waits on `login:`, the
// busybox cold boot on `userland up`). Deliberately specific: a looser generic-shell-prompt regex
// matches kernel-log noise mid-boot and would fire 100% early, so it is NOT used.
const READY_MARKERS = [/login:/, /userland up/];

/** Bind a progress surface to its DOM. `bar` is the role="progressbar" element, `label` the
 * aria-live status element, `detail` an optional per-role byte-text element (back-compat). */
export function createBootProgressSurface({ bar, label, root }) {
  let state = initialProgress();

  function render() {
    const pct = percent(state);
    if (bar) {
      bar.setAttribute("aria-valuenow", String(pct));
      bar.setAttribute("aria-valuetext", state.error ? state.label : `${state.label} — ${pct}%`);
      bar.dataset.indeterminate = state.indeterminate ? "true" : "false";
      bar.dataset.error = state.error ? "true" : "false";
      bar.dataset.ready = state.ready ? "true" : "false";
      const fill = bar.querySelector(".bp-fill");
      if (fill) fill.style.width = `${pct}%`;
    }
    if (label) label.textContent = state.label;
    if (root) root.hidden = false;
  }

  function dispatch(evt) {
    const next = applyProgress(state, evt);
    if (next !== state) {
      state = next;
      render();
    }
    return state;
  }

  return {
    /** Reset for a fresh boot and show the surface at 0%. */
    begin() {
      state = initialProgress();
      dispatch({ kind: "enter", stage: "wasm" });
      render();
    },
    dispatch,
    onState(s) {
      for (const evt of STATE_EVENTS[s] ?? []) dispatch(evt);
    },
    onProgress(role, loaded, total) {
      const stage = ROLE_STAGE[role];
      if (!stage) return;
      if (stage === "chunk") dispatch({ kind: "complete", stage: "kernel" });
      dispatch({ kind: "bytes", stage, loaded, total: total ?? null });
    },
    /** Emit measured chunk bytes for a lazy/chunked image (no per-fetch callback exists; the loader
     * exposes a running byte counter instead). `total` is the full image length — honest "fraction of
     * the image fetched", capped at 1. */
    onChunkBytes(loaded, total) {
      dispatch({ kind: "complete", stage: "kernel" });
      dispatch({ kind: "bytes", stage: "chunk", loaded, total: total ?? null });
    },
    /** Scan guest console bytes for a usable-prompt marker; the first match completes the bar. */
    scanOutput(text) {
      if (state.ready) return;
      if (READY_MARKERS.some((re) => re.test(text))) dispatch({ kind: "ready" });
    },
    fail(message) {
      dispatch({ kind: "error", stage: state.activeStage ?? "wasm", message });
    },
    get state() {
      return state;
    },
  };
}

export { READY_MARKERS };
