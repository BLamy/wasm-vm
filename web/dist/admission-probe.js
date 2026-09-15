// Local diagnostic only: arm after restore, before the first execution slice.
// Never enables profiling, changes admission policy, or exposes a mutation RPC.
export function applyAdmissionProbe(machine, requested = false) {
  if (typeof requested !== "boolean") throw new TypeError("jitAdmissionProbe must be boolean");
  if (!requested) return;
  for (const method of ["setAdmissionProbe", "jitStats"]) {
    if (typeof machine?.[method] !== "function") throw new Error(`jitAdmissionProbe requires WASM ${method}`);
  }
  if (machine.jitStats()?.hasExecutor !== true) throw new Error("jitAdmissionProbe requires an actual JIT executor");
  machine.setAdmissionProbe(true);
  if (machine.jitStats()?.admissionProbe?.enabled !== true) {
    throw new Error("jitAdmissionProbe did not reach the actual machine");
  }
}
