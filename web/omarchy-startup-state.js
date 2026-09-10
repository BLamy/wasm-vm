// Pure presentation policy for the Omarchy startup overlay. The loader owns the lifecycle
// events and the real desktop-readiness probe; this module only makes those events honest and
// keeps the bounded guest-response wait deterministic in tests.

export const OMARCHY_GUEST_RESPONSE_WAIT_MS = 15_000;

const ROLE_LABELS = Object.freeze({
  kernel: "kernel",
  chunkManifest: "chunk manifest",
  overlayDelta: "overlay delta",
  bootSnapshot: "boot snapshot",
});

const PHASE_LABELS = Object.freeze({
  downloading: "Downloading",
  "reading cache": "Reading cache for",
  unpacking: "Unpacking",
});

const STATE_LABELS = Object.freeze({
  fetching: "Fetching Omarchy image…",
  verifying: "Verifying Omarchy image…",
  instantiating: "Starting Omarchy VM…",
  restoring: "Restoring Omarchy desktop…",
  restored: "Desktop restored; waiting for guest response…",
  booting: "Booting Omarchy…",
  done: "Guest finished; desktop readiness is not confirmed.",
});

function humanizeRole(role) {
  const value = String(role ?? "").trim();
  if (ROLE_LABELS[value]) return ROLE_LABELS[value];
  if (!value) return "guest asset";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function omarchyGuestStateLabel(state) {
  return STATE_LABELS[state] || null;
}

export function formatOmarchyProgress(detail = {}) {
  const rawPhase = String(detail.phase ?? "").trim();
  const match = /^(.+?)\s*:\s*(downloading|reading cache|unpacking)(?:\s*\(([^)]+)\))?$/i.exec(rawPhase);
  const role = match ? match[1].trim() : rawPhase;
  const phase = match ? match[2].toLowerCase() : null;
  const note = match?.[3]?.trim().toLowerCase() || null;
  const roleLabel = humanizeRole(role);
  const loaded = finiteNumber(detail.loaded);
  const total = finiteNumber(detail.total);
  const determinate = phase !== "unpacking" && total !== null && total > 0 && loaded !== null && loaded >= 0;

  let text;
  if (phase && PHASE_LABELS[phase]) {
    text = `${PHASE_LABELS[phase]} ${roleLabel}${note ? ` (${note})` : ""}…`;
  } else if (role) {
    text = `Loading ${roleLabel}…`;
  } else {
    text = "Loading guest…";
  }

  return {
    text,
    role,
    roleLabel,
    phase,
    note,
    loaded,
    total,
    determinate,
  };
}

export function createOmarchyStartupLifecycle({
  onWaiting = () => {},
  waitMs = OMARCHY_GUEST_RESPONSE_WAIT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let timer = null;
  let generation = 0;
  let desktopReady = false;

  const cancelWait = () => {
    generation += 1;
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  };

  const armGuestResponseWait = () => {
    if (desktopReady) return;
    if (timer !== null) clearTimeoutFn(timer);
    generation += 1;
    const token = generation;
    timer = setTimeoutFn(() => {
      timer = null;
      if (token !== generation || desktopReady) return;
      onWaiting();
    }, waitMs);
  };

  return {
    booting() {
      desktopReady = false;
      cancelWait();
    },
    state(state) {
      if (state === "restored") armGuestResponseWait();
    },
    guestReady() {
      armGuestResponseWait();
    },
    desktopReady() {
      desktopReady = true;
      cancelWait();
    },
    error() {
      cancelWait();
    },
    halted() {
      cancelWait();
    },
    isDesktopReady() {
      return desktopReady;
    },
  };
}
