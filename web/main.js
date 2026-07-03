// E0-T23 browser demo: load the wasm-pack module, instantiate WasmMachine, and wire its
// per-byte console callback into an xterm.js terminal. No bundler — this is an ES module
// the page imports directly; xterm.js is the UMD global `Terminal` from the pinned
// node_modules copy. Errors render IN THE TERMINAL, never only in the JS console.

import init, { WasmMachine, version, bench } from "./pkg/wasm_vm_wasm.js";
import { RISCV_TESTS } from "./riscv-tests.js";

const RAM_MIB = 128; // matches the native CLI default, so digests/retired line up.
const TEST_RAM_MIB = 16; // mirrors the native riscv-tests harness.
const TEST_MAX_INSTRS = 1_000_000;
const SYS_EXIT = 93n;

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
const versionEl = document.getElementById("version");
const suiteRunBtn = document.getElementById("suite-run");
const suiteStopBtn = document.getElementById("suite-stop");
const suiteBody = document.getElementById("suite-body");
const suiteStatus = document.getElementById("suite-status");
const suiteFilter = document.getElementById("suite-filter");
const suiteCount = document.getElementById("suite-count");
const metricTotal = document.getElementById("metric-total");
const metricPass = document.getElementById("metric-pass");
const metricFail = document.getElementById("metric-fail");
const metricDone = document.getElementById("metric-done");
const suiteProgressBar = document.getElementById("suite-progress-bar");

// A test tap: every byte delivered to the terminal is also recorded here so an automated
// check can assert byte-exact delivery independent of how xterm.js renders it (angle 5).
window.__consoleBytes = [];

let currentElf = null; // Uint8Array of the ELF to run
let currentName = "hello.elf";
let running = false; // serialize runs — overlapping clicks must not interleave output
let suiteRunning = false;
let suiteStopRequested = false;
let wasmReady = false;

const suiteRows = new Map();
const suiteResults = new Map();

function setStatus(text) {
  statusEl.textContent = text;
}

function setSuiteStatus(text) {
  suiteStatus.textContent = text;
}

function writeByte(b) {
  window.__consoleBytes.push(b);
  term.write(Uint8Array.of(b));
}

function yieldToPaint() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function resultLabel(status) {
  if (status === "pass") return "✓ Passed";
  if (status === "fail") return "× Failed";
  if (status === "error") return "! Error";
  if (status === "running") return "… Running";
  return "• Pending";
}

function renderSuiteRows() {
  suiteCount.textContent = `${RISCV_TESTS.length} riscv-tests binaries`;
  metricTotal.textContent = String(RISCV_TESTS.length);
  suiteBody.replaceChildren();
  for (const name of RISCV_TESTS) {
    const row = document.createElement("tr");
    row.dataset.status = "pending";
    row.innerHTML = `
      <td class="name"></td>
      <td class="result"><span class="badge pending">• Pending</span></td>
      <td class="retired">-</td>
      <td class="detail">-</td>
    `;
    row.children[0].textContent = name;
    suiteBody.append(row);
    suiteRows.set(name, row);
    suiteResults.set(name, { status: "pending", retired: null, detail: "" });
  }
  updateSuiteSummary();
}

function updateSuiteRow(name, result) {
  suiteResults.set(name, result);
  const row = suiteRows.get(name);
  if (!row) return;
  row.dataset.status = result.status;
  const badge = row.querySelector(".badge");
  badge.className = `badge ${result.status}`;
  badge.textContent = resultLabel(result.status);
  row.querySelector(".retired").textContent =
    result.retired == null ? "-" : result.retired.toLocaleString();
  row.querySelector(".detail").textContent = result.detail || "-";
  applySuiteFilter();
  updateSuiteSummary();
}

function resetSuiteRows() {
  for (const name of RISCV_TESTS) {
    updateSuiteRow(name, { status: "pending", retired: null, detail: "" });
  }
}

function updateSuiteSummary() {
  let pass = 0;
  let fail = 0;
  let done = 0;
  for (const result of suiteResults.values()) {
    if (result.status === "pass") pass += 1;
    if (result.status === "fail" || result.status === "error") fail += 1;
    if (result.status === "pass" || result.status === "fail" || result.status === "error") {
      done += 1;
    }
  }
  metricPass.textContent = String(pass);
  metricFail.textContent = String(fail);
  metricDone.textContent = String(done);
  suiteProgressBar.style.width = `${(done / RISCV_TESTS.length) * 100}%`;
}

function applySuiteFilter() {
  const filter = suiteFilter.value;
  for (const [name, row] of suiteRows) {
    const status = suiteResults.get(name).status;
    const visible =
      filter === "all" ||
      status === filter ||
      (filter === "fail" && status === "error");
    row.classList.toggle("hidden", !visible);
  }
}

function setInteractiveState() {
  const busy = running || suiteRunning;
  runBtn.disabled = busy || !wasmReady;
  resetBtn.disabled = busy || !wasmReady;
  benchBtn.disabled = busy || !wasmReady;
  fileInput.disabled = busy || !wasmReady;
  suiteRunBtn.disabled = busy || !wasmReady;
  suiteStopBtn.disabled = !suiteRunning;
}

function classifyRiscvTest(machine, status) {
  const retired = status.retired ?? null;
  if (status.kind === "exited") {
    if (status.code === 0) {
      return { status: "pass", retired, detail: "exit 0" };
    }
    return { status: "fail", retired, detail: `HTIF exit ${status.code}` };
  }
  if (status.kind === "trapped" && status.cause === "EcallFromM") {
    const regs = machine.registers();
    const a7 = regs[18];
    const a0 = regs[11];
    if (a7 === SYS_EXIT) {
      if (a0 === 0n) {
        return { status: "pass", retired, detail: "ecall exit 0" };
      }
      return { status: "fail", retired, detail: `case #${a0 >> 1n}` };
    }
    return { status: "fail", retired, detail: `ecall a7=${a7}` };
  }
  if (status.kind === "trapped") {
    return { status: "fail", retired, detail: `trap ${status.cause} tval=${status.tval}` };
  }
  return { status: "fail", retired, detail: "max-instrs reached" };
}

async function runRiscvTest(name) {
  updateSuiteRow(name, { status: "running", retired: null, detail: "loading" });
  await yieldToPaint();

  let machine;
  try {
    const res = await fetch(`./assets/riscv-tests/${name}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const elf = new Uint8Array(await res.arrayBuffer());
    machine = new WasmMachine(TEST_RAM_MIB);
    machine.loadElf(elf);
    updateSuiteRow(name, { status: "running", retired: null, detail: "running" });
    await yieldToPaint();
    const status = machine.run(TEST_MAX_INSTRS);
    const result = classifyRiscvTest(machine, status);
    const digest = machine.stateDigest().slice(0, 12);
    result.detail = `${result.detail}; ${digest}`;
    return result;
  } catch (e) {
    return {
      status: "error",
      retired: null,
      detail: e.message || String(e),
    };
  } finally {
    if (machine) {
      machine.free();
    }
  }
}

async function runSuite() {
  if (running || suiteRunning || !wasmReady) return;
  suiteRunning = true;
  suiteStopRequested = false;
  setInteractiveState();
  resetSuiteRows();
  term.writeln("\x1b[36mrunning riscv-tests in browser wasm\x1b[0m");
  const started = performance.now();
  try {
    for (const [index, name] of RISCV_TESTS.entries()) {
      if (suiteStopRequested) {
        setSuiteStatus(`stopped at ${index}/${RISCV_TESTS.length}`);
        break;
      }
      setSuiteStatus(`${index + 1}/${RISCV_TESTS.length} ${name}`);
      const result = await runRiscvTest(name);
      updateSuiteRow(name, result);
      if (result.status !== "pass") {
        term.writeln(`\x1b[31m${name}: ${result.detail}\x1b[0m`);
      }
    }
    if (!suiteStopRequested) {
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      const failed = Number(metricFail.textContent);
      setSuiteStatus(`complete in ${elapsed}s`);
      term.writeln(`\x1b[36mriscv-tests complete: ${metricPass.textContent} passed, ${failed} failed\x1b[0m`);
    }
  } finally {
    suiteRunning = false;
    suiteStopRequested = false;
    setInteractiveState();
  }
}

// Run the current ELF on a FRESH machine (Reset semantics are automatic: every Run builds
// a new WasmMachine, so there is no stale state to leak between runs).
async function run() {
  if (running || suiteRunning) return; // guard: ignore re-entrant/rapid clicks
  if (!currentElf) {
    setStatus("no ELF loaded");
    return;
  }
  running = true;
  setInteractiveState();
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
    setInteractiveState();
  }
}

function reset() {
  if (running || suiteRunning) return;
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

// E0-T24: MIPS baseline in the browser. Runs >= 10^7 retired instructions of loops.elf on
// the trace-off path and reports MIPS = retired / ms / 1000.
const benchBtn = document.getElementById("bench");
function runBench() {
  if (running || suiteRunning) return;
  running = true;
  setInteractiveState();
  setStatus("benchmarking…");
  // Defer so the disabled/label paint before the synchronous bench blocks the thread.
  setTimeout(() => {
    try {
      const { retired, ms } = bench(10_000_000);
      const mips = retired / ms / 1000;
      const line = `browser MIPS=${mips.toFixed(1)} (retired=${retired}, ${ms.toFixed(0)} ms)`;
      term.writeln(`\x1b[36m${line}\x1b[0m`);
      setStatus(line);
      console.debug(`[wasm-vm] bench ${line}`);
    } catch (e) {
      term.writeln(`\x1b[31mbench error: ${e.message || e}\x1b[0m`);
      setStatus("bench error");
    } finally {
      running = false;
      setInteractiveState();
    }
  }, 0);
}

runBtn.addEventListener("click", run);
resetBtn.addEventListener("click", reset);
benchBtn.addEventListener("click", runBench);
suiteRunBtn.addEventListener("click", runSuite);
suiteStopBtn.addEventListener("click", () => {
  suiteStopRequested = true;
  setSuiteStatus("stopping...");
});
suiteFilter.addEventListener("change", applySuiteFilter);
renderSuiteRows();
setInteractiveState();

// Boot: init the wasm module, then fetch the embedded default hello.elf.
(async () => {
  await init();
  wasmReady = true;
  versionEl.textContent = `core ${version()}`;
  setInteractiveState();
  setStatus(`core ${version()} — loading hello.elf…`);
  setSuiteStatus("ready");
  try {
    const res = await fetch("./assets/hello.elf");
    currentElf = new Uint8Array(await res.arrayBuffer());
    currentName = "hello.elf";
    setStatus(`ready — hello.elf`);
    window.__ready = true; // signal for automated tests
  } catch (e) {
    setStatus(`failed to load hello.elf: ${e}`);
  }
})();
