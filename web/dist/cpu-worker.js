// E4-T22: dedicated CPU Web Worker. The interpreter (and, once E4-T10 lands, the JIT runtime)
// runs HERE, against a shared `WebAssembly.Memory` imported at instantiate time. The main thread
// keeps the DOM / xterm.js / devices and never runs the dispatch loop.
//
// Handshake (main → worker `postMessage`):
//   { type:"boot", wasmModule, sharedMemory, controlSab, bootParams }
//     wasmModule    – a WebAssembly.Module compiled main-side (structured-cloneable) OR a URL to
//                     compile in-worker via WebAssembly.compileStreaming.
//     sharedMemory  – a descriptor {initial, maximum, shared:true}. Chromium does not clone a
//                     WebAssembly.Memory object, so the worker constructs the imported memory and
//                     returns its SAB in `ready.memoryBuffer` for host-side views.
//     controlSab    – the small control-block SharedArrayBuffer (IRQ / MMIO cells).
//     bootParams    – kernel/initramfs/dtb offsets, RAM size, etc.
// Replies (worker → main): {type:"ready",memoryBuffer}, {type:"log"}, {type:"halted"},
// {type:"fatal",error}.
//
// Atomics.wait is legal on this thread — WFI parks here (cpu-control-block.wfiPark). The single-
// threaded fallback path never loads this file.

import {
  attachControlBlock,
  wfiPark,
  irqCount,
  mmioRequest,
  CELL,
  STATE,
  CONTROL_BYTES,
} from "./cpu-control-block.js";
import { selectJitBackend, probeIsolation } from "./cpu-isolation.js";

let cells = null;
let running = false;
let bootStarted = false;
let terminal = false;
// E4-T29 Phase 2: the JIT gate for this worker, decided ONCE at boot from the isolation snapshot.
let jitPlan = { jit: false, threshold: 0, reason: "undecided" };

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "boot") return;
  boot(msg).catch((err) => fatal(err));
});

self.addEventListener("messageerror", () => fatal(new Error("worker got an un-clonable message")));

async function boot({ wasmModule, wasmUrl, sharedMemory, controlSab, bootParams }) {
  if (bootStarted) throw new Error("duplicate CPU worker boot");
  bootStarted = true;
  if (terminal) throw new Error("CPU worker is already terminal");

  if (!(controlSab instanceof SharedArrayBuffer) || controlSab.byteLength < CONTROL_BYTES) {
    throw new Error(`invalid CPU control block: expected a SharedArrayBuffer of at least ${CONTROL_BYTES} bytes`);
  }
  cells = attachControlBlock(controlSab);
  Atomics.store(cells, CELL.STATE, STATE.BOOT);

  if (!(wasmModule instanceof WebAssembly.Module) && typeof wasmUrl !== "string") {
    throw new Error("CPU worker boot requires a cloned WebAssembly.Module or wasmUrl");
  }
  const memory = createImportedSharedMemory(sharedMemory);

  // Compile worker-side if given a URL; otherwise use the pre-compiled Module. Instantiate against
  // the worker-owned IMPORTED shared memory — the module's `env.memory` import (see
  // tools/build-web-shared.sh). Its SAB is returned in the ready message because a WebAssembly.Memory
  // object itself is not structured-cloneable in Chromium.
  const module =
    wasmModule ?? (await WebAssembly.compileStreaming(fetch(wasmUrl)));
  const imports = makeImports(memory);
  const instance = await WebAssembly.instantiate(module, imports);
  if (terminal) return;

  // E4-T29 Phase 2: decide the JIT gate. The worker only runs at all when the page is cross-origin
  // isolated (E4-T22), so `selectJitBackend` returns jit:true here unless the guest opted out
  // (bootParams.jit === false). When jit is false — or if this ever runs un-isolated — the guest
  // stays on the interpreter with NO executor attached (clean fallback, no half-init). The actual
  // `WasmMachine.enableJit(threshold)` call is made by the shared-pkg dispatch init once its entry
  // point lands (E4-T10/T11 wiring); the plan is decided and surfaced here.
  jitPlan = selectJitBackend({
    ...probeIsolation(self),
    jit: bootParams ? bootParams.jit : undefined,
    jitThreshold: bootParams ? bootParams.jitThreshold : undefined,
  });
  // The shared-pkg dispatch init installs `self.enableJitOnInstance` (calls
  // `WasmMachine.enableJit(threshold)` under the hood). Until that entry point lands it is absent, so
  // this is a clean no-op — never a half-attached executor.
  if (jitPlan.jit && typeof self.enableJitOnInstance === "function") {
    self.enableJitOnInstance(instance, jitPlan.threshold);
  }

  // The wasm-bindgen glue for the shared build initialises against this same instance/memory.
  // (Wiring the generated `initSync(module, memory)` entry point is done by the loader that
  // imports the shared pkg; here we hold the raw instance for the dispatch loop.)
  self.postMessage({
    type: "ready",
    protocol: 1,
    dispatchExport: bootParams?.dispatchExport ?? "run_slice",
    memoryShared: true,
    memoryInitial: memory.buffer.byteLength / 65_536,
    memoryBuffer: memory.buffer,
    jit: jitPlan.jit,
    jitReason: jitPlan.reason,
  });

  runLoop(instance, bootParams ?? {});
}

function createImportedSharedMemory(descriptor) {
  if (!descriptor || descriptor.shared !== true) {
    throw new Error("CPU worker requires a shareable memory descriptor");
  }
  const { initial, maximum } = descriptor;
  if (!Number.isInteger(initial) || initial < 0 || !Number.isInteger(maximum) || maximum < initial) {
    throw new Error("CPU worker received invalid shared memory limits");
  }
  let memory;
  try {
    memory = new WebAssembly.Memory({ initial, maximum, shared: true });
  } catch (err) {
    throw new Error(`CPU worker could not create shared memory: ${err?.message || err}`);
  }
  if (!(memory.buffer instanceof SharedArrayBuffer)) {
    throw new Error("CPU worker created a non-shareable WebAssembly.Memory");
  }
  return memory;
}

// Minimal import object. The shared memory is injected as env.memory; MMIO traps route through the
// interim blocking stub until E4-T23 swaps in the async device proxy.
function makeImports(sharedMemory) {
  return {
    env: {
      memory: sharedMemory,
      // Interim synchronous MMIO: the wasm dispatch calls these on a device-region access; they
      // block the worker until the main thread services the request. E4-T23 replaces this.
      mmio_load: (addrLo, addrHi, width) =>
        Number(
          mmioRequest(cells, {
            addr: (BigInt(addrHi >>> 0) << 32n) | BigInt(addrLo >>> 0),
            width,
            write: false,
          }) & 0xffff_ffffn,
        ),
      mmio_store: (addrLo, addrHi, width, valLo, valHi) =>
        void mmioRequest(cells, {
          addr: (BigInt(addrHi >>> 0) << 32n) | BigInt(addrLo >>> 0),
          width,
          write: true,
          value: (BigInt(valHi >>> 0) << 32n) | BigInt(valLo >>> 0),
        }),
    },
  };
}

// The dispatch loop. Runs a bounded slice of guest instructions, then, when the guest executes WFI
// (or the slice budget is exhausted with nothing to do), parks in Atomics.wait until the next timer
// deadline or an interrupt notify. This keeps an idle guest at ~0% host CPU (AC: <2% idle).
function runLoop(instance, bootParams) {
  if (terminal) return;
  running = true;
  Atomics.store(cells, CELL.STATE, STATE.RUNNING);
  const step = () => {
    if (!running) return;
    // `run_slice` returns a status: 0 = keep running, >0 = WFI with a timeout hint (ms until the
    // next mtimecmp), <0 = halted. (Bound left to the core; wired when the shared export lands.)
    let status = 0;
    try {
      status = runSlice(instance, bootParams);
    } catch (err) {
      return fatal(err);
    }
    if (status < 0) {
      running = false;
      terminal = true;
      Atomics.store(cells, CELL.STATE, STATE.BOOT);
      self.postMessage({ type: "halted" });
      return;
    }
    if (status > 0) {
      // WFI: park until IRQ or the timer deadline. `status` is the ms timeout hint.
      const seen = irqCount(cells);
      Atomics.store(cells, CELL.STATE, STATE.PARKED);
      wfiPark(cells, seen, status === 0 ? Infinity : status);
      Atomics.store(cells, CELL.STATE, STATE.RUNNING);
    }
    // Yield to the worker event loop so postMessage (log flush) and MMIO responses drain.
    setTimeout(step, 0);
  };
  step();
}

// The raw worker ABI is intentionally tiny: a synchronous export returns 0 to continue, a positive
// timeout in milliseconds to park for WFI, and a negative value to halt. A caller can name an
// equivalent export while the generated WasmLinux glue is being wired, but the default is the
// stable `run_slice` fixture/core ABI.
function runSlice(instance, bootParams) {
  const exportName = bootParams?.dispatchExport ?? "run_slice";
  const fn = instance.exports[exportName];
  if (typeof fn !== "function") {
    throw new Error(`shared core module exposes no ${exportName} dispatch export`);
  }
  const budget = bootParams?.sliceInstrs;
  const result = Number.isInteger(budget) && budget > 0 ? fn(budget) : fn();
  if (!Number.isFinite(result) || !Number.isInteger(result)) {
    throw new Error(`dispatch export ${exportName} returned a non-integer status`);
  }
  return result;
}

function fatal(err) {
  if (terminal) return;
  terminal = true;
  running = false;
  if (cells) Atomics.store(cells, CELL.STATE, STATE.FATAL);
  self.postMessage({ type: "fatal", error: String(err && err.stack ? err.stack : err) });
}
