// E5-T26k: one explicit capacity selection; omission preserves the machine's default/state.
// E4-T40d: 262144 joins the list for the Replay desktop, whose interactive paths touch about
// 200,000 distinct blocks. Must match DECODED_CACHE_SIZES in crates/core.
export const DECODED_CACHE_SIZES = Object.freeze([4096, 16384, 262144]);
const SIZE_STRINGS = Object.freeze(DECODED_CACHE_SIZES.map(String));

export function validateDecodedCacheEntries(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number" && DECODED_CACHE_SIZES.includes(value)) return value;
  if (typeof value === "string" && SIZE_STRINGS.includes(value)) return Number(value);
  throw new RangeError("decodedCacheEntries must be 4096, 16384 or 262144 (number or exact decimal string)");
}

// Called after initial snapshot restoration, before any guest pump. Do not put this
// fail-closed configuration inside the optional JIT-enable fallback catch.
export function applyDecodedCacheEntries(machine, value) {
  const entries = validateDecodedCacheEntries(value);
  if (entries === undefined) return;
  for (const method of ["setDecodedCacheEntries", "jitStats"]) {
    if (typeof machine?.[method] !== "function") {
      throw new Error(`decodedCacheEntries requires WASM ${method}`);
    }
  }
  const actual = machine.jitStats()?.decodedCacheEntries;
  if (typeof actual !== "number" || !DECODED_CACHE_SIZES.includes(actual)) {
    throw new Error("decodedCacheEntries requires actual supported cache capacity");
  }
  if (actual === entries) return; // No resize/invalidation for an explicit same-size selection.
  machine.setDecodedCacheEntries(entries);
  if (machine.jitStats()?.decodedCacheEntries !== entries) {
    throw new Error("decodedCacheEntries selection did not reach the actual machine");
  }
}
