// E4-T22: page-side registration for the COOP/COEP header-injection shim (coi-serviceworker.js).
//
// On a header-LESS host (GitHub Pages), the first load is not yet cross-origin isolated. This
// registers the shim SW and, once it controls the client, reloads ONCE so the reloaded document is
// served through the SW's synthesized COOP/COEP headers → crossOriginIsolated === true. On a host
// that already sends the headers (our dev server, or a proper prod config), it is a no-op.
//
// Discipline (no half-init): if isolation cannot be achieved, this resolves to `false` and the
// caller selects the single-threaded fallback via cpu-isolation.selectCpuBackend — never a
// partially-started threaded backend.

const RELOAD_FLAG = "__coi_reloaded";
const SW_READY_TIMEOUT_MS = 5_000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), SW_READY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ensure the page is cross-origin isolated, registering the shim if needed.
 * @param {object} [opts]
 * @param {string} [opts.swUrl] URL of coi-serviceworker.js (default "./coi-serviceworker.js")
 * @param {boolean} [opts.allowReload] permit the one-time reload (default true)
 * @returns {Promise<boolean>} whether the page is (now) cross-origin isolated
 */
export async function ensureCrossOriginIsolated(opts = {}) {
  const { swUrl = "./coi-serviceworker.js", allowReload = true } = opts;

  if (globalThis.crossOriginIsolated === true) return true;
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
  // Avoid an infinite reload loop: if we already reloaded once and are still not isolated, give up.
  if (sessionStorage.getItem(RELOAD_FLAG) === "1") {
    sessionStorage.removeItem(RELOAD_FLAG);
    return globalThis.crossOriginIsolated === true;
  }

  try {
    const reg = await withTimeout(
      navigator.serviceWorker.register(swUrl, { scope: "./" }),
      "service-worker registration",
    );
    await withTimeout(navigator.serviceWorker.ready, "service-worker activation");
    // If the SW is now controlling this client, a reload will be served through its headers.
    if (navigator.serviceWorker.controller && allowReload) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      location.reload();
      return false; // unreachable after reload; the reloaded page re-runs this and sees isolation
    }
    // Freshly installed but not yet controlling → reload once to let it take control.
    if (reg.active && !navigator.serviceWorker.controller && allowReload) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      location.reload();
      return false;
    }
  } catch (err) {
    console.warn("[coi] header-injection SW registration failed; single-thread fallback", err);
    return false;
  }
  return globalThis.crossOriginIsolated === true;
}
