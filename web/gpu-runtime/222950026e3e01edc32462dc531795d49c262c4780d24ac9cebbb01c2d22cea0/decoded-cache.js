// E5-T26k: one explicit capacity experiment; omission preserves the machine's default/state.
export function validateDecodedCacheEntries(value) {
  if (value === undefined) return undefined;
  if (value === 4096 || value === 16384) return value;
  if (value === "4096" || value === "16384") return Number(value);
  throw new RangeError("decodedCacheEntries must be 4096 or 16384 (number or exact decimal string)");
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
  if (actual !== 4096 && actual !== 16384) {
    throw new Error("decodedCacheEntries requires actual supported cache capacity");
  }
  if (actual === entries) return; // No resize/invalidation for an explicit same-size selection.
  machine.setDecodedCacheEntries(entries);
  if (machine.jitStats()?.decodedCacheEntries !== entries) {
    throw new Error("decodedCacheEntries selection did not reach the actual machine");
  }
}
