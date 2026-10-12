// E3-T24a: a typed, honest, monotonic boot-progress model.
//
// The one rule this module exists to enforce: the displayed bar only ever moves in response to a
// REAL event — bytes actually fetched, or a stage actually reaching a milestone — never a timer and
// never an inferred "creep toward 99%". Measurable phases (kernel, chunk) are byte-weighted; the
// unmeasurable phases (wasm instantiate, manifest fetch, and the kernel's own boot-to-login) are
// EXPLICITLY indeterminate — the bar holds at its last determinate value and the surface says
// "working", rather than faking a percentage. 100% is reached only when the guest is actually usable
// (the `ready` event, i.e. the login prompt), so completion cannot precede the prompt.
//
// It is a pure reducer: `applyEvent` takes the current immutable state + one typed event and returns
// the next state. No DOM, no clock, no globals — so it is exhaustively testable headlessly (reorder,
// duplicate, omit, delay, and fail every event) and reused verbatim by the browser surface.

/** The ordered boot stages. `measurable` phases advance by observed bytes; the rest are indeterminate
 * (shown as an explicit "working" state, never a fabricated percentage). `weight` is the stage's
 * share of the overall 0..1 bar; the weights sum to 1. */
export const STAGES = [
  { id: "wasm", label: "Loading engine", measurable: false, weight: 0.05 },
  { id: "manifest", label: "Reading manifest", measurable: false, weight: 0.05 },
  { id: "kernel", label: "Fetching kernel", measurable: true, weight: 0.15 },
  { id: "chunk", label: "Fetching disk image", measurable: true, weight: 0.55 },
  { id: "login", label: "Booting to login", measurable: false, weight: 0.20 },
];

const STAGE_INDEX = new Map(STAGES.map((s, i) => [s.id, i]));

/** The typed event contract. Every producer emits exactly these shapes:
 *  - { kind: "enter", stage }                 a stage became active (indeterminate phases show "working")
 *  - { kind: "bytes", stage, loaded, total }  observed bytes for a measurable stage (total null ⇒ indeterminate)
 *  - { kind: "complete", stage }              a stage finished (its full weight lands)
 *  - { kind: "ready" }                        the guest is usable (login prompt) ⇒ overall reaches 100%
 *  - { kind: "error", stage, message }        a stage failed ⇒ a stage-named error, never an endless spinner
 * Unknown kinds / unknown stage ids are ignored (a producer from a newer build cannot corrupt the bar). */
export function isValidEvent(evt) {
  if (!evt || typeof evt.kind !== "string") return false;
  if (evt.kind === "ready") return true;
  if (typeof evt.stage !== "string" || !STAGE_INDEX.has(evt.stage)) return false;
  if (evt.kind === "bytes") {
    return (
      Number.isFinite(evt.loaded) &&
      evt.loaded >= 0 &&
      (evt.total == null || (Number.isFinite(evt.total) && evt.total >= 0))
    );
  }
  return evt.kind === "enter" || evt.kind === "complete" || evt.kind === "error";
}

/** The initial state. `overall` is the monotonic 0..1 bar; `indeterminate` is true while the active
 * stage cannot report bytes (the surface must show "working", not a number that appears stalled). */
export function initialProgress() {
  const stages = {};
  for (const s of STAGES) {
    stages[s.id] = { state: "pending", loaded: 0, total: null, fraction: 0 };
  }
  return {
    overall: 0,
    activeStage: null,
    label: "Starting",
    indeterminate: true,
    ready: false,
    error: null,
    stages,
  };
}

// The overall bar = sum over stages of weight × fraction, where a measurable stage's fraction is
// bytes-based and an indeterminate stage contributes only 0 (active/pending) or 1 (complete). This is
// what keeps it honest: an active indeterminate phase adds NOTHING to the number — the bar simply
// holds — so there is no fabricated intra-phase creep.
function computeOverall(stages, ready) {
  if (ready) return 1;
  let sum = 0;
  for (const s of STAGES) {
    sum += s.weight * stages[s.id].fraction;
  }
  // Clamp strictly below 1 until `ready`: fetching everything must not read as "done" while the
  // guest is still booting to a prompt. (Weights already leave the login stage's share unfilled, but
  // this makes the invariant explicit and mutation-testable.)
  return Math.min(sum, 0.99);
}

/** Apply one typed event, returning the next state. Pure and monotonic: `overall` never decreases and
 * a completed stage never reopens, so out-of-order / duplicated / delayed events cannot rewind the bar. */
export function applyProgress(prev, evt) {
  if (!isValidEvent(evt)) return prev;
  const stages = { ...prev.stages };
  const clone = (id) => (stages[id] = { ...stages[id] });
  let ready = prev.ready;
  let error = prev.error;
  let activeStage = prev.activeStage;

  switch (evt.kind) {
    case "ready": {
      ready = true;
      // Every stage is implicitly complete once the guest is usable.
      for (const s of STAGES) {
        clone(s.id);
        if (stages[s.id].state !== "error") {
          stages[s.id].state = "complete";
          stages[s.id].fraction = 1;
        }
      }
      activeStage = "login";
      break;
    }
    case "enter": {
      clone(evt.stage);
      // A stage never leaves a terminal state (complete/error) on a late/duplicate "enter".
      if (stages[evt.stage].state === "pending") stages[evt.stage].state = "active";
      // Entering a later stage implies the earlier measurable ones delivered their bytes; fill any
      // still-open earlier stage so a dropped "complete" can't strand the bar behind reality.
      const here = STAGE_INDEX.get(evt.stage);
      for (const s of STAGES) {
        if (STAGE_INDEX.get(s.id) < here && stages[s.id].state !== "error") {
          clone(s.id);
          stages[s.id].state = "complete";
          stages[s.id].fraction = 1;
        }
      }
      if (activeStage == null || STAGE_INDEX.get(evt.stage) >= STAGE_INDEX.get(activeStage)) {
        activeStage = evt.stage;
      }
      break;
    }
    case "bytes": {
      clone(evt.stage);
      const st = stages[evt.stage];
      if (st.state !== "complete" && st.state !== "error") st.state = "active";
      st.loaded = Math.max(st.loaded, evt.loaded); // observed bytes only grow within a stage
      if (evt.total != null) st.total = evt.total;
      // Fraction is monotonic per stage: a smaller/duplicate reading can't shrink it.
      const frac = st.total ? Math.min(1, st.loaded / st.total) : st.fraction;
      st.fraction = Math.max(st.fraction, frac);
      if (activeStage == null || STAGE_INDEX.get(evt.stage) >= STAGE_INDEX.get(activeStage)) {
        activeStage = evt.stage;
      }
      break;
    }
    case "complete": {
      clone(evt.stage);
      if (stages[evt.stage].state !== "error") {
        stages[evt.stage].state = "complete";
        stages[evt.stage].fraction = 1;
      }
      break;
    }
    case "error": {
      clone(evt.stage);
      stages[evt.stage].state = "error";
      error = { stage: evt.stage, label: stageLabel(evt.stage), message: String(evt.message ?? "failed") };
      activeStage = evt.stage;
      break;
    }
    default:
      return prev;
  }

  const overall = error ? prev.overall : Math.max(prev.overall, computeOverall(stages, ready));
  const active = activeStage ? STAGES[STAGE_INDEX.get(activeStage)] : null;
  const indeterminate = Boolean(
    !ready && !error && active && (!active.measurable || stages[activeStage].total == null),
  );
  const label = error
    ? `${error.label} failed: ${error.message}`
    : ready
      ? "Ready"
      : active
        ? active.label
        : "Starting";

  return { overall, activeStage, label, indeterminate, ready, error, stages };
}

/** Fold a whole event sequence (test/replay helper). */
export function reduceProgress(events, start = initialProgress()) {
  return events.reduce(applyProgress, start);
}

export function stageLabel(id) {
  const i = STAGE_INDEX.get(id);
  return i == null ? id : STAGES[i].label;
}

/** Integer percent for display/assertions. */
export function percent(state) {
  return Math.round(state.overall * 100);
}
