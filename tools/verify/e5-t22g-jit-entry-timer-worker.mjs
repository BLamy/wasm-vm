import init, { WasmMachine } from "/pkg/wasm_vm_wasm.js";

const PHASE_RUNS = 8;
const RUN_BUDGET = 50_000;
const NS_KEYS = ["stateCopyNs", "engineEntryNs", "deviceBoundaryNs"];
const sabotageDefaultOn = new URL(import.meta.url).searchParams.get("sabotage-default-on") === "1";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function entry(machine) {
  return machine.jitStats().entryCost;
}

function delta(after, before, key) {
  return Number(after[key] ?? 0) - Number(before[key] ?? 0);
}

function assertStructuralWork(after, before, label) {
  invariant(delta(after, before, "hostEntries") > 0, `${label}: no compiled host entries`);
  invariant(delta(after, before, "stateCopyCalls") > 0, `${label}: no state-copy calls`);
  invariant(delta(after, before, "stateCopyBytes") > 0, `${label}: no state-copy bytes`);
}

function assertNoTiming(after, before, label) {
  invariant(after.timingEnabled === false, `${label}: timing unexpectedly enabled`);
  invariant(delta(after, before, "timerReads") === 0, `${label}: host clock was read`);
  for (const key of NS_KEYS) {
    invariant(delta(after, before, key) === 0, `${label}: ${key} changed while disabled`);
  }
}

function assertTiming(after, before, label) {
  invariant(after.timingEnabled === true, `${label}: timing not enabled`);
  invariant(delta(after, before, "timerReads") > 0, `${label}: no host clock reads`);
  invariant(
    NS_KEYS.some((key) => delta(after, before, key) > 0),
    `${label}: timer reads produced no measured duration`,
  );
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
  invariant(view.getUint32(0, true) === 0x464c457f, "fixture is not little-endian ELF");
  invariant(elf[4] === 2 && elf[5] === 1, "fixture must be ELF64 little-endian");
  const entry = Number(view.getBigUint64(24, true));
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
    if (entry >= virtualAddress && entry + 12 <= virtualAddress + fileSize) {
      codeOffset = fileOffset + entry - virtualAddress;
      break;
    }
  }
  invariant(Number.isSafeInteger(codeOffset), "entry point is not inside a loadable segment");
  view.setUint32(codeOffset, 0x00128293, true); // addi x5,x5,1
  view.setUint32(codeOffset + 4, 0x00330313, true); // addi x6,x6,3
  view.setUint32(codeOffset + 8, encodeJal(-8), true); // jal x0,entry
  return elf;
}

async function runBatch(machine, count = PHASE_RUNS) {
  let retired = 0;
  for (let index = 0; index < count; index += 1) {
    const outcome = machine.run(RUN_BUDGET);
    invariant(outcome.kind === "max", `hot-loop run ${index}: ${JSON.stringify(outcome)}`);
    invariant(Number(outcome.retired) === RUN_BUDGET, `hot-loop run ${index}: short retirement`);
    retired += Number(outcome.retired);
  }
  return retired;
}

function snapshot(machine) {
  return {
    registers: Array.from(machine.registers(), (value) => value.toString(16).padStart(16, "0")),
    ramDigest: machine.stateDigest(),
    retired: Number(machine.getStats().retired),
    jit: machine.jitStats(),
  };
}

async function verify() {
  await init();
  invariant(self instanceof WorkerGlobalScope, "fixture must run in a Web Worker");
  const response = await fetch("/assets/loops.elf", { cache: "no-store" });
  invariant(response.ok, `loops fixture HTTP ${response.status}`);
  const elf = hotLoopElf(new Uint8Array(await response.arrayBuffer()));

  const toggled = new WasmMachine(8);
  toggled.loadElf(elf);
  toggled.enableJit(1);
  if (sabotageDefaultOn) {
    invariant(toggled.setProfiling(true) === true, "sabotage could not arm default timing");
  }

  const defaultBefore = entry(toggled);
  const defaultRetired = await runBatch(toggled);
  const defaultAfter = entry(toggled);
  assertStructuralWork(defaultAfter, defaultBefore, "default-off");
  assertNoTiming(defaultAfter, defaultBefore, "default-off");
  invariant(toggled.jitStats().executedBlocks > 0, "default-off: compiled blocks never executed");

  invariant(toggled.setProfiling(true) === true, "profile-after-executor could not arm");
  const enabledBefore = entry(toggled);
  const enabledRetired = await runBatch(toggled);
  const enabledAfter = entry(toggled);
  assertStructuralWork(enabledAfter, enabledBefore, "enabled-after-executor");
  assertTiming(enabledAfter, enabledBefore, "enabled-after-executor");

  invariant(toggled.setProfiling(false) === true, "profiling disable failed");
  const disabledBefore = entry(toggled);
  const disabledRetired = await runBatch(toggled);
  const disabledAfter = entry(toggled);
  assertStructuralWork(disabledAfter, disabledBefore, "disabled-after-enable");
  assertNoTiming(disabledAfter, disabledBefore, "disabled-after-enable");

  invariant(toggled.setProfiling(true) === true, "profiling re-enable failed");
  const reenabledBefore = entry(toggled);
  const reenabledRetired = await runBatch(toggled);
  const reenabledAfter = entry(toggled);
  assertStructuralWork(reenabledAfter, reenabledBefore, "re-enabled");
  assertTiming(reenabledAfter, reenabledBefore, "re-enabled");
  invariant(
    new Set([defaultRetired, enabledRetired, disabledRetired, reenabledRetired]).size === 1,
    "timing mode changed fixed-work retirement",
  );

  const control = new WasmMachine(8);
  control.loadElf(elf);
  control.enableJit(1);
  await runBatch(control, PHASE_RUNS * 4);
  const toggledSnapshot = snapshot(toggled);
  const controlSnapshot = snapshot(control);
  invariant(
    JSON.stringify(toggledSnapshot.registers) === JSON.stringify(controlSnapshot.registers),
    "timing mode changed architectural registers",
  );
  invariant(toggledSnapshot.ramDigest === controlSnapshot.ramDigest, "timing mode changed RAM digest");
  invariant(toggledSnapshot.retired === controlSnapshot.retired, "timing mode changed total retirement");
  assertNoTiming(entry(control), {
    timingEnabled: false,
    timerReads: 0,
    stateCopyNs: 0,
    engineEntryNs: 0,
    deviceBoundaryNs: 0,
  }, "always-off-control");

  const beforeAttach = new WasmMachine(8);
  beforeAttach.loadElf(elf);
  invariant(beforeAttach.setProfiling(true) === true, "profile-before-executor could not arm");
  beforeAttach.enableJit(1);
  invariant(entry(beforeAttach).timingEnabled === true, "new executor did not inherit profiling=true");
  const beforeAttachStart = entry(beforeAttach);
  await runBatch(beforeAttach);
  const beforeAttachEnd = entry(beforeAttach);
  assertTiming(beforeAttachEnd, beforeAttachStart, "enabled-before-executor");

  beforeAttach.enableJit(1);
  const replacementStart = entry(beforeAttach);
  invariant(replacementStart.timingEnabled === true, "replacement did not inherit profiling=true");
  invariant(replacementStart.timerReads === 0, "replacement inherited prior timer samples");
  await runBatch(beforeAttach);
  const replacementEnd = entry(beforeAttach);
  assertStructuralWork(replacementEnd, replacementStart, "replacement-enabled");
  assertTiming(replacementEnd, replacementStart, "replacement-enabled");

  invariant(beforeAttach.setProfiling(false) === true, "replacement disable failed");
  const replacementOffStart = entry(beforeAttach);
  await runBatch(beforeAttach);
  const replacementOffEnd = entry(beforeAttach);
  assertStructuralWork(replacementOffEnd, replacementOffStart, "replacement-disabled");
  assertNoTiming(replacementOffEnd, replacementOffStart, "replacement-disabled");

  return {
    realm: "dedicated-worker",
    phaseRuns: PHASE_RUNS,
    runBudget: RUN_BUDGET,
    fixedRetiredPerPhase: defaultRetired,
    defaultOff: { before: defaultBefore, after: defaultAfter },
    enabledAfterExecutor: { before: enabledBefore, after: enabledAfter },
    disabledAfterEnable: { before: disabledBefore, after: disabledAfter },
    reenabled: { before: reenabledBefore, after: reenabledAfter },
    finalParity: { toggled: toggledSnapshot, control: controlSnapshot },
    enabledBeforeExecutor: { before: beforeAttachStart, after: beforeAttachEnd },
    replacementEnabled: { before: replacementStart, after: replacementEnd },
    replacementDisabled: { before: replacementOffStart, after: replacementOffEnd },
  };
}

self.onmessage = async (event) => {
  if (event.data !== "verify") return;
  try {
    self.postMessage({ ok: true, result: await verify() });
  } catch (error) {
    const message = error?.message || String(error);
    const stack = error?.stack || "";
    self.postMessage({ ok: false, error: stack.includes(message) ? stack : `${message}\n${stack}` });
  }
};
