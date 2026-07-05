// E0-T23 browser demo: load the wasm-pack module, instantiate WasmMachine, and wire its
// per-byte console callback into an xterm.js terminal. No bundler — this is an ES module
// the page imports directly; xterm.js is the UMD global `Terminal` from the pinned
// node_modules copy. Errors render IN THE TERMINAL, never only in the JS console.

import init, { WasmMachine, version } from "./pkg/wasm_vm_wasm.js";

const RAM_MIB = 128; // matches the native CLI default, so digests/retired line up.

const term = new Terminal({
  convertEol: true, // a bare \n from the guest moves to column 0 (raw UART has no \r)
  fontFamily: "ui-monospace, monospace",
  fontSize: 13,
  theme: { background: "#0b0e14", foreground: "#cdd6f4" },
});
term.open(document.getElementById("term"));

const runBtn = document.getElementById("run");
const resetBtn = document.getElementById("reset");
const fileInput = document.getElementById("file");
const statusEl = document.getElementById("status");

// A test tap: every byte delivered to the terminal is also recorded here so an automated
// check can assert byte-exact delivery independent of how xterm.js renders it (angle 5).
window.__consoleBytes = [];

let currentElf = null; // Uint8Array of the ELF to run
let currentName = "hello.elf";
let running = false; // serialize runs — overlapping clicks must not interleave output

function setStatus(text) {
  statusEl.textContent = text;
}

function writeByte(b) {
  window.__consoleBytes.push(b);
  term.write(Uint8Array.of(b));
}

// Run the current ELF on a FRESH machine (Reset semantics are automatic: every Run builds
// a new WasmMachine, so there is no stale state to leak between runs).
async function run() {
  if (running) return; // guard: ignore re-entrant/rapid clicks
  if (!currentElf) {
    setStatus("no ELF loaded");
    return;
  }
  running = true;
  runBtn.disabled = true;
  resetBtn.disabled = true;
  try {
    let machine;
    try {
      machine = new WasmMachine(RAM_MIB);
    } catch (e) {
      term.writeln(`\x1b[31mcannot create machine: ${e}\x1b[0m`);
      return;
    }
    machine.setConsole(writeByte);
    try {
      machine.loadElf(currentElf);
    } catch (e) {
      // Bad ELF → render the loader error IN THE TERMINAL, keep the page usable.
      term.writeln(`\x1b[31m${currentName}: ${e.message || e}\x1b[0m`);
      setStatus(`load error`);
      machine.free();
      return;
    }
    let status;
    try {
      status = machine.run(100_000_000);
    } catch (e) {
      term.writeln(`\x1b[31mrun error: ${e.message || e}\x1b[0m`);
      setStatus("run error");
      machine.free();
      return;
    }
    const digest = machine.stateDigest();
    machine.free();
    if (status.kind === "exited") {
      setStatus(`exited code=${status.code} retired=${status.retired}`);
    } else if (status.kind === "trapped") {
      term.writeln(`\x1b[33mtrap: ${status.cause} (tval=${status.tval})\x1b[0m`);
      setStatus(`trapped ${status.cause} retired=${status.retired}`);
    } else {
      setStatus(`max-instrs reached retired=${status.retired}`);
    }
    console.debug(`[wasm-vm] ${currentName} digest=${digest}`);
  } finally {
    running = false;
    runBtn.disabled = false;
    resetBtn.disabled = false;
  }
}

function reset() {
  if (running) return;
  term.reset();
  window.__consoleBytes = [];
  setStatus(`ready — ${currentName}`);
}

fileInput.addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    currentElf = new Uint8Array(await file.arrayBuffer());
    currentName = file.name;
    term.reset();
    window.__consoleBytes = [];
    setStatus(`loaded ${currentName} (${currentElf.length} bytes) — click Run`);
  } catch (e) {
    term.writeln(`\x1b[31mcould not read ${file.name}: ${e}\x1b[0m`);
  }
});

runBtn.addEventListener("click", run);
resetBtn.addEventListener("click", reset);

// Boot: init the wasm module, then fetch the embedded default hello.elf.
(async () => {
  await init();
  setStatus(`core ${version()} — loading hello.elf…`);
  try {
    const res = await fetch("./assets/hello.elf");
    currentElf = new Uint8Array(await res.arrayBuffer());
    currentName = "hello.elf";
    setStatus(`ready — hello.elf — click Run`);
    window.__ready = true; // signal for automated tests
  } catch (e) {
    setStatus(`failed to load hello.elf: ${e}`);
  }
})();
