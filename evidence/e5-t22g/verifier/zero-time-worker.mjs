import init, { WasmMachine } from "/pkg/wasm_vm_wasm.js";

const PHASE_RUNS = 8;
const RUN_BUDGET = 50_000;
const NS_KEYS = ["stateCopyNs", "engineEntryNs", "deviceBoundaryNs"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function entry(machine) {
  return machine.jitStats().entryCost;
}

function delta(after, before, key) {
  return Number(after[key] ?? 0) - Number(before[key] ?? 0);
}

function encodeJal(offset) {
  const bits = offset >>> 0;
  return (
    (((bits >>> 20) & 1) << 31)
    | (((bits >>> 1) & 0x3ff) << 21)
    | (((bits >>> 11) & 1) << 20)
    | (((bits >>> 12) & 0xff) << 12)
    | 0x6f
  ) >>> 0;
}

function hotLoopElf(source) {
  const elf = new Uint8Array(source);
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  invariant(view.getUint32(0, true) === 0x464c457f, "fixture is not ELF");
  const entryPc = Number(view.getBigUint64(24, true));
  const phoff = Number(view.getBigUint64(32, true));
  const phentsize = view.getUint16(54, true);
  const phnum = view.getUint16(56, true);
  let codeOffset = null;
  for (let index = 0; index < phnum; index += 1) {
    const header = phoff + index * phentsize;
    if (view.getUint32(header, true) !== 1) continue;
    const fileOffset = Number(view.getBigUint64(header + 8, true));
    const virtualAddress = Number(view.getBigUint64(header + 16, true));
    const fileSize = Number(view.getBigUint64(header + 32, true));
    if (entryPc >= virtualAddress && entryPc + 12 <= virtualAddress + fileSize) {
      codeOffset = fileOffset + entryPc - virtualAddress;
      break;
    }
  }
  invariant(Number.isSafeInteger(codeOffset), "entry point is not loadable");
  view.setUint32(codeOffset, 0x00128293, true);
  view.setUint32(codeOffset + 4, 0x00330313, true);
  view.setUint32(codeOffset + 8, encodeJal(-8), true);
  return elf;
}

function runPhase(machine) {
  let retired = 0;
  for (let index = 0; index < PHASE_RUNS; index += 1) {
    const outcome = machine.run(RUN_BUDGET);
    invariant(outcome.kind === "max", `unexpected outcome ${JSON.stringify(outcome)}`);
    invariant(Number(outcome.retired) === RUN_BUDGET, "short retirement");
    retired += Number(outcome.retired);
  }
  return retired;
}

function timingDelta(after, before) {
  return {
    timingEnabled: after.timingEnabled,
    timerReads: delta(after, before, "timerReads"),
    hostEntries: delta(after, before, "hostEntries"),
    stateCopyCalls: delta(after, before, "stateCopyCalls"),
    stateCopyBytes: delta(after, before, "stateCopyBytes"),
    stateCopyNs: delta(after, before, "stateCopyNs"),
    engineEntryNs: delta(after, before, "engineEntryNs"),
    deviceBoundaryNs: delta(after, before, "deviceBoundaryNs"),
  };
}

async function verify() {
  Object.defineProperty(Object.getPrototypeOf(performance), "now", {
    configurable: true,
    value: () => 0,
  });
  invariant(performance.now() === 0, "zero timer override did not install");
  await init();
  const response = await fetch("/assets/loops.elf", { cache: "no-store" });
  invariant(response.ok, `loops fixture HTTP ${response.status}`);
  const elf = hotLoopElf(new Uint8Array(await response.arrayBuffer()));

  const machine = new WasmMachine(8);
  machine.loadElf(elf);
  machine.enableJit(1);
  runPhase(machine);

  // Novel boundary: replace an already-installed executor while profiling remains off.
  machine.enableJit(1);
  const replacementBefore = entry(machine);
  invariant(replacementBefore.timingEnabled === false, "off replacement armed timing");
  invariant(replacementBefore.timerReads === 0, "off replacement inherited samples");
  const replacementRetired = runPhase(machine);
  const replacementOff = timingDelta(entry(machine), replacementBefore);
  invariant(replacementOff.hostEntries > 0, "off replacement did not execute compiled code");
  invariant(replacementOff.timerReads === 0, "off replacement read timer");
  invariant(NS_KEYS.every((key) => replacementOff[key] === 0), "off replacement accrued ns");

  invariant(machine.setProfiling(true) === true, "could not enable profiling");
  const enabledBefore = entry(machine);
  const enabledRetired = runPhase(machine);
  const enabledZeroTime = timingDelta(entry(machine), enabledBefore);
  invariant(enabledZeroTime.timerReads > 0, "zero-valued timer reads were not counted");
  invariant(NS_KEYS.every((key) => enabledZeroTime[key] === 0), "zero timer accrued nanoseconds");

  invariant(machine.setProfiling(false) === true, "could not disable profiling");
  const disabledBefore = entry(machine);
  const disabledRetired = runPhase(machine);
  const disabledAgain = timingDelta(entry(machine), disabledBefore);
  invariant(disabledAgain.hostEntries > 0, "disabled phase lost compiled execution");
  invariant(disabledAgain.timerReads === 0, "disabled phase read timer");
  invariant(NS_KEYS.every((key) => disabledAgain[key] === 0), "disabled phase accrued ns");

  invariant(machine.setProfiling(true) === true, "could not re-enable profiling");
  const reenabledBefore = entry(machine);
  const reenabledRetired = runPhase(machine);
  const reenabledZeroTime = timingDelta(entry(machine), reenabledBefore);
  invariant(reenabledZeroTime.timerReads > 0, "second zero-valued timer boundary was not counted");
  invariant(NS_KEYS.every((key) => reenabledZeroTime[key] === 0), "second zero timer accrued ns");
  invariant(new Set([replacementRetired, enabledRetired, disabledRetired, reenabledRetired]).size === 1,
    "toggle changed fixed retirement");

  return {
    realm: "dedicated-worker",
    performanceNow: performance.now(),
    fixedRetiredPerPhase: replacementRetired,
    replacementOff,
    enabledZeroTime,
    disabledAgain,
    reenabledZeroTime,
  };
}

self.onmessage = async (event) => {
  if (event.data !== "verify") return;
  try {
    self.postMessage({ ok: true, result: await verify() });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.stack || String(error) });
  }
};
