// E4-T22: cross-origin-isolation probe → CPU-backend selection.
//
// The threaded backend (CPU on a dedicated Web Worker against SharedArrayBuffer-backed guest RAM)
// is only legal when the page is cross-origin isolated: `crossOriginIsolated === true`, which the
// browser only grants under `Cross-Origin-Opener-Policy: same-origin` +
// `Cross-Origin-Embedder-Policy: require-corp` (see docs/e4-t22-cpu-worker-coop-coep.md). Without
// isolation, `SharedArrayBuffer` is undefined (or a non-shareable stub) and `Atomics.wait` cannot
// park a worker — so we MUST fall back to the single-threaded build.
//
// Discipline: selection is a PURE decision made BEFORE any wasm is fetched or instantiated. The
// caller inspects the result and loads exactly one build. There is never a half-initialized
// threaded backend that then discovers it cannot get a SharedArrayBuffer — the check happens first.

export const BACKEND_WORKER_SHARED = "worker-shared";
export const BACKEND_SINGLE_THREAD = "single-thread";

/**
 * Pure selector. Given a capability snapshot, decide which CPU backend to load. No globals, no
 * side effects — unit-testable in node.
 *
 * @param {object} env
 * @param {boolean} env.crossOriginIsolated  value of globalThis.crossOriginIsolated
 * @param {boolean} env.hasSharedArrayBuffer  typeof SharedArrayBuffer !== "undefined"
 * @param {boolean} env.hasAtomics            typeof Atomics !== "undefined"
 * @param {boolean} env.hasWorker             typeof Worker !== "undefined"
 * @param {boolean} [env.forceSingleThread]   explicit override (e.g. ?singlethread=1)
 * @returns {{backend:string, shared:boolean, wasmVariant:"shared"|"fallback", reason:string}}
 */
export function selectCpuBackend(env) {
  const {
    crossOriginIsolated = false,
    hasSharedArrayBuffer = false,
    hasAtomics = false,
    hasWorker = false,
    forceSingleThread = false,
  } = env || {};

  if (forceSingleThread) {
    return single("forced single-thread (explicit override)");
  }
  if (!hasWorker) {
    return single("no Worker constructor (non-browser or worker-less context)");
  }
  if (!crossOriginIsolated) {
    return single(
      "not cross-origin isolated (missing COOP/COEP headers); SharedArrayBuffer unavailable",
    );
  }
  if (!hasSharedArrayBuffer) {
    return single("SharedArrayBuffer undefined despite isolation (browser policy)");
  }
  if (!hasAtomics) {
    return single("Atomics unavailable; cannot park worker on WFI");
  }
  return {
    backend: BACKEND_WORKER_SHARED,
    shared: true,
    wasmVariant: "shared",
    reason: "cross-origin isolated: threaded CPU worker with SharedArrayBuffer guest RAM",
  };
}

function single(reason) {
  return { backend: BACKEND_SINGLE_THREAD, shared: false, wasmVariant: "fallback", reason };
}

/**
 * Read the live browser/globalThis capabilities into the snapshot `selectCpuBackend` consumes.
 * Kept separate so the decision logic stays pure and testable.
 * @param {object} [g] override for tests; defaults to globalThis
 */
export function probeIsolation(g = globalThis) {
  return {
    crossOriginIsolated: g.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof g.SharedArrayBuffer !== "undefined",
    hasAtomics: typeof g.Atomics !== "undefined",
    hasWorker: typeof g.Worker !== "undefined",
    forceSingleThread:
      typeof g.location !== "undefined" &&
      typeof g.location.search === "string" &&
      /(?:^|[?&])singlethread=1(?:&|$)/.test(g.location.search),
  };
}

/** Convenience: probe the live environment and select in one call, warning on fallback. */
export function chooseCpuBackend(g = globalThis) {
  const result = selectCpuBackend(probeIsolation(g));
  if (result.backend === BACKEND_SINGLE_THREAD && typeof g.console !== "undefined") {
    g.console.warn(
      `[cpu] single-threaded fallback: ${result.reason}. ` +
        `Serve with COOP:same-origin + COEP:require-corp for the threaded worker backend.`,
    );
  }
  return result;
}
