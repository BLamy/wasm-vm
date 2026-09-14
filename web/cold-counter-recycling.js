// Local experiment only: arm after restore, before the first execution slice.
// Never enables JIT, changes any other admission policy, or exposes a controller mutation RPC.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Return whether a browser location is an HTTP(S) loopback origin. */
export function isLoopbackOrigin(locationLike = globalThis.location) {
  const origin = typeof locationLike === "string"
    ? locationLike
    : locationLike?.origin ?? locationLike?.href;
  if (typeof origin !== "string") return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/** Arm the actual WASM machine and verify the actual report. */
export function applyColdCounterRecycling(machine, requested = false) {
  if (typeof requested !== "boolean") {
    throw new TypeError("jitColdCounterRecycling must be boolean");
  }
  if (!requested) return;
  for (const method of ["setColdCounterRecycling", "jitStats"]) {
    if (typeof machine?.[method] !== "function") {
      throw new Error(`jitColdCounterRecycling requires WASM ${method}`);
    }
  }
  if (machine.jitStats()?.hasExecutor !== true) {
    throw new Error("jitColdCounterRecycling requires an actual JIT executor");
  }
  machine.setColdCounterRecycling(true);
  const report = machine.jitStats()?.coldCounterRecycling;
  if (report?.enabled !== true) {
    throw new Error("jitColdCounterRecycling did not reach the actual machine");
  }
  return report;
}
