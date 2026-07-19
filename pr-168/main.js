// E0-T23 browser demo: load the wasm-pack module, instantiate WasmMachine, and wire its
// per-byte console callback into an xterm.js terminal. No bundler — this is an ES module
// the page imports directly; xterm.js is the UMD global `Terminal` from the pinned
// node_modules copy. Errors render IN THE TERMINAL, never only in the JS console.

import init, { WasmMachine, version, bench } from "./pkg/wasm_vm_wasm.js";
import { RISCV_TESTS } from "./riscv-tests.js";
import { ROADMAP } from "./roadmap.js";
import { startLinuxBoot, resetDisk } from "./loader.js";
import { createLinuxTerminal } from "./terminal.js";

const RAM_MIB = 128; // matches the native CLI default, so digests/retired line up.
const TEST_RAM_MIB = 16; // mirrors the native riscv-tests harness.
const TEST_MAX_INSTRS = 1_000_000;
const SYS_EXIT = 93n;

// E2-T22: the terminal + its UART input bridge (fit addon, backpressure queue, key policy) live
// in terminal.js. `term` is the raw xterm.js instance the ELF-console paths keep writing to.
const ui = createLinuxTerminal(document.getElementById("term"));
const term = ui.term;

const runBtn = document.getElementById("run");
const resetBtn = document.getElementById("reset");
const fileInput = document.getElementById("file");

// E2-T21: boot unmodified Linux in the browser via the loading pipeline (loader.js).
const bootLinuxBtn = document.getElementById("boot-linux");
const bootProgressEl = document.getElementById("boot-progress");
// E2-T26: a second "Boot Alpine" button boots the full Alpine ext4 rootfs over virtio-blk
// (mode "disk", a separate local-only manifest) — shared boot path with the busybox button.
const bootAlpineBtn = document.getElementById("boot-alpine");
// E3-T02: boot the same Alpine rootfs but fetched lazily as E3-T01 chunks over HTTP.
const bootAlpineChunkedBtn = document.getElementById("boot-alpine-chunked");
let linuxCtl = null;
const bootBtns = [bootLinuxBtn, bootAlpineBtn, bootAlpineChunkedBtn];
async function runLinuxBoot(opts, banner) {
  if (linuxCtl) return; // already booting
  bootBtns.forEach((b) => b && (b.disabled = true));
  term.reset();
  term.writeln(`\x1b[36m${banner}\x1b[0m`);
  const query = new URLSearchParams(location.search);
  const slirpRelay = opts.slirpRelay ?? query.get("slirpRelay") ?? "";
  if (slirpRelay) {
    term.writeln(`\x1b[90m[network: slirp outbound via ${slirpRelay}]\x1b[0m`);
  }
  const pct = {};
  try {
    linuxCtl = await startLinuxBoot({
      ...opts,
      // E3-net: `?slirpNet` in the URL boots with the slirp local stack (real DHCP/ARP/ICMP) instead
      // of the loopback backend — so the guest can pull a real IP and reach the gateway.
      slirpNet: opts.slirpNet ?? (query.has("slirpNet") || !!slirpRelay),
      slirpRelay,
      onState: (s) => setStatus(`linux: ${s}`),
      onProgress: (role, loaded, total) => {
        pct[role] = total ? `${((loaded / total) * 100) | 0}%` : `${(loaded / 1048576).toFixed(1)}MB`;
        bootProgressEl.textContent = Object.entries(pct).map(([k, v]) => `${k} ${v}`).join("  ");
      },
      onOutput: (u8) => { ui.write(u8); emitConsole(u8); },
      onError: (e) => term.writeln(`\x1b[31mboot error: ${e.message || e}\x1b[0m`),
      // E3-T10: storage indicator (usage/quota/persist grant) at boot.
      onStorage: ({ usage, quota, granted }) => {
        const el = document.getElementById("storage-indicator");
        if (el && quota != null) {
          const mb = (n) => (n / 1048576).toFixed(0);
          el.textContent = `storage ${mb(usage)}/${mb(quota)} MB${granted ? " (persistent)" : " (best-effort)"}`;
          el.style.display = "inline";
        }
        term.writeln(`\x1b[90m[storage: ${quota != null ? `${((usage / quota) * 100) | 0}% of ${(quota / 1048576) | 0}MB` : "n/a"}, persist=${granted}]\x1b[0m`);
      },
      // E3-T10: storage quota hit — the VM is PAUSED; show the actionable dialog. The three
      // choices map to loader controller actions (retry after freeing space / continue
      // read-only / reset disk). No option silently drops a durable write.
      onQuota: ({ usage, quota, unsaved }) => {
        const el = document.getElementById("quota-dialog");
        if (!el) return;
        const pct = quota ? `${((usage / quota) * 100) | 0}%` : "full";
        el.style.display = "block";
        // Honest copy (critic BUG-1): writes the guest already ACKed but that never reached disk
        // stay pending — "Free space & retry" saves them; "Continue read-only" keeps trying in the
        // background but they are NOT durable until space frees (a reload before then loses them).
        const warn = unsaved
          ? ' <b>Some acknowledged writes are not yet saved</b> — free space and Retry to persist them; a reload before then loses them.'
          : "";
        el.innerHTML =
          `<b>Storage full</b> (${pct} of ${(quota / 1048576) | 0}MB). The VM is paused.${warn} ` +
          '<button id="q-retry">Free space in guest & retry</button> ' +
          '<button id="q-ro">Continue read-only</button> ' +
          '<button id="q-reset">Reset disk…</button>';
        term.writeln("\r\n\x1b[7m STORAGE FULL — VM paused. Free space (rm + sync) then Retry, or Continue read-only. \x1b[0m");
        document.getElementById("q-retry").onclick = () => { el.style.display = "none"; linuxCtl?.resumeAfterQuota?.(); };
        document.getElementById("q-ro").onclick = () => {
          el.style.display = "none";
          linuxCtl?.continueReadOnly?.();
          const ro = document.getElementById("ro-banner");
          if (ro) { ro.style.display = "block"; ro.textContent = "read-only: storage full — new guest writes return I/O errors; pending writes save if you free space"; }
        };
        document.getElementById("q-reset").onclick = async () => {
          const typed = prompt('This deletes every saved change to the Alpine disk. Type RESET to confirm:');
          if (typed !== "RESET") return;
          el.style.display = "none";
          // Critic BUG-4: close THIS tab's IndexedDB connection before deleteDatabase, or the
          // delete blocks forever. stop() halts the run loop; closeStorage() drops the handle.
          if (linuxCtl) {
            try { linuxCtl.closeStorage(); } catch {}
            try { linuxCtl.stop(); } catch {}
            linuxCtl = null;
          }
          try {
            await resetDisk();
            term.writeln("\r\n\x1b[33mdisk reset — reboot for a pristine filesystem\x1b[0m");
            setStatus("disk reset — click Boot to start fresh");
            bootBtns.forEach((b) => b && !b.dataset.unavailable && (b.disabled = false));
          } catch (e) {
            term.writeln(`\r\n\x1b[31mreset failed: ${e.message || e}\x1b[0m`);
          }
        };
      },
      // E3-T09: single-writer status. RO → banner + a retry-as-writer affordance (reboot;
      // the Web Lock is re-probed — succeeds once the writer tab is gone).
      onWriterStatus: ({ readOnly }) => {
        const el = document.getElementById("ro-banner");
        if (!el) return;
        if (readOnly) {
          el.style.display = "block";
          el.innerHTML =
            'read-only: disk in use by another tab — writes are rejected (guest mounts / ro). ' +
            '<button id="ro-retry">retry as writer</button>';
          document.getElementById("ro-retry").addEventListener("click", async () => {
            // Stop the RO machine and reboot; the lock probe runs again at boot.
            if (linuxCtl) { try { linuxCtl.stop(); } catch {} linuxCtl = null; }
            el.style.display = "none";
            bootBtns.forEach((b) => b && !b.dataset.unavailable && (b.disabled = false));
            setStatus("retrying as writer — click the boot button again");
            term.writeln("\r\n\x1b[33mretry-as-writer: click the Boot button again (lock re-probed at boot)\x1b[0m");
          });
          term.writeln("\x1b[33mREAD-ONLY: another tab holds the disk — guest will mount / ro\x1b[0m");
        } else {
          el.style.display = "none";
        }
      },
    });
    const ctlForRelease = linuxCtl;
    linuxCtl.whenDone.then((state) => {
      // E3-T09 (critic NOTE-1): release the writer lock on EVERY terminal outcome (halt,
      // error, stop) — release is idempotent, and a future writer-stop UI path must not
      // strand the lock until tab close.
      try { ctlForRelease?.releaseWriterLock?.(); } catch {}
      ui.detachSink();
      bootBtns.forEach((b) => b && !b.dataset.unavailable && (b.disabled = false));
      linuxCtl = null;
      // E2-T26: surface the T17 terminal ExitReason as a distinct HALTED state, not just a status
      // string — the machine is gone; you must re-boot from a fresh Machine.
      const halt = { poweroff: "powered off", reboot: "rebooted (halted)", error: "error" };
      const reason = halt[state] || (state?.startsWith?.("exited") ? state : state?.startsWith?.("fail") ? state : null);
      if (reason) {
        setStatus(`⏻ machine halted — ${reason}`);
        term.writeln(`\r\n\x1b[7m machine halted (${reason}) — click "Boot Linux"/"Boot Alpine" to boot a fresh machine \x1b[0m`);
      } else {
        setStatus(`linux: ${state}`);
      }
    });
    // Route terminal keystrokes/paste to the guest's ttyS0 via the backpressure bridge.
    ui.attachSink((bytes) => {
      // Defense-in-depth: the wasm machine rejects re-entrant sendInput (a console/output callback
      // must not drive the machine — it throws while runChunk holds the borrow). If that throw were
      // allowed to unwind through the terminal's pump(), pump would skip resetting `draining` and the
      // input queue would jam permanently — bricking the terminal. Contain it here so pump completes.
      // Well-behaved callers (docker.js) already defer input out of the callback; this is the net.
      // Logged at error level so the Playwright console-error gate catches any future callback-driven
      // input regression instead of it failing silently.
      if (!linuxCtl) return;
      try {
        linuxCtl.sendInput(bytes);
      } catch (e) {
        console.error("dropped a terminal input chunk:", e?.message || e);
      }
    });
    // Fit the rendered grid to the page now that the terminal is the active view, and print
    // the matching stty hint so the guest can be told its real window size (serial has no winsize).
    const { cols, rows } = ui.fitNow();
    term.writeln(`\x1b[90m[terminal ${cols}x${rows} — click "Fit" then run: ${ui.sttyHint()}]\x1b[0m`);
    // The guest is live and the input sink is attached; focus the terminal so the user can
    // type immediately without first having to click into it.
    ui.focus();
  } catch (e) {
    lastBootError = e.message || String(e); // surfaced to the Docker tab's typed-error path
    term.writeln(`\x1b[31mcannot boot: ${e.message || e}\x1b[0m`);
    bootBtns.forEach((b) => b && !b.dataset.unavailable && (b.disabled = false));
    linuxCtl = null;
  }
}
if (bootLinuxBtn) {
  bootLinuxBtn.addEventListener("click", () =>
    runLinuxBoot({ manifestUrl: "./artifacts.json" }, "booting unmodified Linux 6.6.63 + busybox in wasm…"));
}
if (bootAlpineBtn) {
  bootAlpineBtn.addEventListener("click", () =>
    runLinuxBoot(
      { manifestUrl: "./artifacts-alpine.json", mode: "disk", ramMib: 256 },
      "booting unmodified Alpine (ext4 rootfs over virtio-blk) in wasm — large image, ~minutes to login:…",
    ));
}
if (bootAlpineChunkedBtn) {
  bootAlpineChunkedBtn.addEventListener("click", () =>
    runLinuxBoot(
      {
        // Same kernel as the proven Alpine disk boot; the rootfs is fetched lazily per chunk here
        // (no full-image download — only the chunks the boot actually touches).
        manifestUrl: "./artifacts-alpine.json",
        mode: "chunked",
        imageManifestUrl: "./releases/chunked-alpine/manifest.json",
        // E3-T03: `?cacheBudgetMib=N` boots with an N-MiB cache to exercise eviction (0 → 256 default).
        cacheBudgetMib: Number(new URLSearchParams(location.search).get("cacheBudgetMib")) || 0,
        // E3-T05: `?persist=1` persists the CoW overlay to IndexedDB (writes survive a reload).
        persist: new URLSearchParams(location.search).get("persist") === "1",
        // E3-T08 test hook: ?persistMax=N sets the dirty-bytes backpressure threshold.
        persistMax: Number(new URLSearchParams(location.search).get("persistMax")) || undefined,
        ramMib: 256,
      },
      "booting Alpine via LAZY CHUNK FETCH — only touched chunks download; ~minutes to login:…",
    ));
}
// ── Docker tab ⇄ real boot bridge ─────────────────────────────────────────────
// The Docker "Run" button drives the SAME real boot machinery as this Terminal tab — it never
// simulates a shell. For busybox we boot the real busybox userland on RISC-V Linux (the initramfs
// boot, which works everywhere incl. GitHub Pages) and land the user at the real `#` prompt.
// HONEST SCOPE: this runs the real busybox multi-call binary; it is NOT the wvrun/OCI-overlay
// isolation path (unshare + overlay + pivot_root), which is built and native-tested
// (crates/cli/tests/boot_wvrun.rs) but not yet baked into the served in-browser image.
const runBannerEl = document.getElementById("run-banner");
function setRunBanner(html) {
  if (!runBannerEl) return;
  runBannerEl.style.display = html == null ? "none" : "block";
  if (html != null) runBannerEl.innerHTML = html;
}

// The REAL guest console byte stream, tapped for anyone who wants it (the Docker tab attaches its
// output pane here). These are the EXACT bytes written to xterm via onOutput above — not a separate
// buffer that JS fills. `lastBootError` is the message from the most recent failed boot so the
// Docker tab can render a typed error instead of falling back to anything canned.
const consoleSubscribers = new Set();
function emitConsole(u8) {
  for (const fn of consoleSubscribers) {
    try { fn(u8); } catch { /* a broken subscriber must not break the console */ }
  }
}
let lastBootError = null;

window.wvmDemo = {
  isGuestUp: () => !!linuxCtl,
  // Subscribe to the real guest console stream (Uint8Array chunks). Returns an unsubscribe fn.
  onConsole(fn) { consoleSubscribers.add(fn); return () => consoleSubscribers.delete(fn); },
  // Inject bytes through the REAL terminal input bridge — the same backpressure queue → ttyS0 RX
  // path that keystrokes and paste take. This is NOT a side channel: it is exactly how a human types.
  sendInput(bytes) { ui.typeBytes(bytes); },
  // Focus the real terminal so the user can keep typing after a programmatic run.
  focusTerminal() { ui.focus(); },
  // Boot the real busybox userland. Resolves { ok:true } once the guest is running, { ok:true,
  // already:true } if it was already up, or { ok:false, error } if the real boot path refused to
  // start (e.g. a manifest/integrity failure) — the caller must show that error, never fall back.
  async runBusybox() {
    if (linuxCtl) {
      setRunBanner('busybox userland is already live below — you are at the shell. Try <code>ls /</code> or <code>uname -a</code>.');
      return { ok: true, already: true };
    }
    lastBootError = null;
    setRunBanner(
      'Booting a real RISC-V Linux guest → <b>busybox</b> userland… watch the console below; ' +
      'you will land at the <code>#</code> shell prompt in a few seconds.',
    );
    await runLinuxBoot({ manifestUrl: "./artifacts.json" }, "booting the real busybox userland on RISC-V Linux (in wasm)…");
    return linuxCtl ? { ok: true } : { ok: false, error: lastBootError || "boot failed" };
  },
};

// E2-T22: "Fit" re-fits the rendered grid to the panel and surfaces the matching `stty` line.
// A serial console carries no out-of-band winsize, so resize is cooperative: if a guest is live
// the button types the `stty rows R cols C` straight into it, so vi/top use the full area.
const termFitBtn = document.getElementById("term-fit");
const sttyHintEl = document.getElementById("stty-hint");
if (termFitBtn) {
  termFitBtn.addEventListener("click", () => {
    ui.fitNow();
    const hint = ui.sttyHint();
    if (sttyHintEl) sttyHintEl.textContent = hint;
    if (linuxCtl) ui.typeBytes(new TextEncoder().encode(hint + "\n"));
  });
}
// Test hook: Playwright drives keyboard input + reads the backpressure high-water via this.
window.__term = ui;

// E2-T23: idle the executor while the tab is hidden. Guest `mtime` is a deterministic retire-count
// clock, so pausing freezes guest monotonic time cleanly and it resumes with no jump/storm (see
// docs/timekeeping.md); the Date.now goldfish RTC keeps true wall time across the gap, so on return
// `date` is correct while `uptime` counts only executed time.
document.addEventListener("visibilitychange", () => {
  if (!linuxCtl) return;
  if (document.hidden) linuxCtl.pause();
  else linuxCtl.resume();
});
// Test hook for the timekeeping spec — drive pause/resume without a real tab switch.
window.__linux = {
  pause: () => linuxCtl?.pause(),
  resume: () => linuxCtl?.resume(),
  isPaused: () => !!linuxCtl?.isPaused(),
};
// E3-T02 test hook: the chunked-boot lazy-fetch instrumentation ({ fetches, bytes, error } | null).
window.__chunkedStats = () => linuxCtl?.fetchStats?.() ?? null;
// E3-T05 test hook: force a durable flush of the overlay to IndexedDB (Promise → blocks persisted).
window.__persist = () => linuxCtl?.persist?.() ?? Promise.resolve(0);

const statusEl = document.getElementById("status");
const versionEl = document.getElementById("version");
const suiteRunBtn = document.getElementById("suite-run");
const suiteStopBtn = document.getElementById("suite-stop");
const suiteHeatmap = document.getElementById("suite-heatmap");
const suiteStatus = document.getElementById("suite-status");
const suiteCount = document.getElementById("suite-count");
const metricTotal = document.getElementById("metric-total");
const metricPass = document.getElementById("metric-pass");
const metricFail = document.getElementById("metric-fail");
const metricDone = document.getElementById("metric-done");
const suiteProgressBar = document.getElementById("suite-progress-bar");
const hoverCard = document.getElementById("hover-card");
const hoverName = document.getElementById("hover-name");
const hoverStatus = document.getElementById("hover-status");
const hoverDetail = document.getElementById("hover-detail");

const GROUP_ORDER = ["rv64ui-p", "rv64um-p", "rv64ua-p", "rv64uf-p", "rv64ud-p", "rv64uc-p", "rv64mi-p"];

// A test tap: every byte delivered to the terminal is also recorded here so an automated
// check can assert byte-exact delivery independent of how xterm.js renders it (angle 5).
window.__consoleBytes = [];

let currentElf = null; // Uint8Array of the ELF to run
let currentName = "hello.elf";
let running = false; // serialize runs — overlapping clicks must not interleave output
let suiteRunning = false;
let suiteStopRequested = false;
let wasmReady = false;

const suiteDots = new Map();
const suiteResults = new Map();
const suiteGroups = new Map();
const suiteGroupMeta = new Map();
window.__suiteResults = suiteResults;

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

function statusLabel(status) {
  if (status === "pass") return "Passed";
  if (status === "fail") return "Failed";
  if (status === "error") return "Error";
  if (status === "running") return "Running";
  return "Queued";
}

function testGroup(name) {
  const match = name.match(/^(rv\d+[a-z]+-p)-/);
  return match ? match[1] : "other";
}

function groupIndex(group) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

function groupTests() {
  const grouped = new Map();
  for (const name of RISCV_TESTS) {
    const group = testGroup(name);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(name);
  }
  return [...grouped.entries()].sort((a, b) => {
    const order = groupIndex(a[0]) - groupIndex(b[0]);
    return order || a[0].localeCompare(b[0]);
  });
}

function renderSuiteHeatmap() {
  suiteCount.textContent = `${RISCV_TESTS.length} riscv-tests binaries`;
  metricTotal.textContent = String(RISCV_TESTS.length);
  suiteHeatmap.replaceChildren();
  suiteDots.clear();
  suiteResults.clear();
  suiteGroups.clear();
  suiteGroupMeta.clear();

  for (const [group, names] of groupTests()) {
    suiteGroups.set(group, names);
    const groupRow = document.createElement("div");
    groupRow.className = "test-group";
    groupRow.dataset.group = group;

    const label = document.createElement("div");
    label.className = "group-label";
    label.textContent = group;
    const meta = document.createElement("span");
    meta.className = "group-meta";
    meta.textContent = `${names.length} tests`;
    label.append(meta);
    suiteGroupMeta.set(group, meta);

    const grid = document.createElement("div");
    grid.className = "dot-grid";
    for (const name of names) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "test-dot";
      dot.dataset.status = "pending";
      dot.dataset.name = name;
      dot.setAttribute("aria-label", `${name}: queued`);
      dot.addEventListener("mouseenter", () => showHoverCard(name, dot));
      dot.addEventListener("focus", () => showHoverCard(name, dot));
      dot.addEventListener("mouseleave", hideHoverCard);
      dot.addEventListener("blur", hideHoverCard);
      grid.append(dot);
      suiteDots.set(name, dot);
      suiteResults.set(name, { status: "pending", retired: null, detail: "" });
    }

    groupRow.append(label, grid);
    suiteHeatmap.append(groupRow);
  }
  updateSuiteSummary();
}

function updateSuiteDot(name, result) {
  suiteResults.set(name, result);
  const dot = suiteDots.get(name);
  if (!dot) return;
  dot.dataset.status = result.status;
  dot.setAttribute("aria-label", `${name}: ${statusLabel(result.status)}`);
  updateSuiteSummary();
  if (!hoverCard.hidden && hoverCard.dataset.name === name) {
    renderHoverCard(name);
  }
}

function resetSuiteDots() {
  hideHoverCard();
  for (const name of RISCV_TESTS) {
    updateSuiteDot(name, { status: "pending", retired: null, detail: "" });
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

  for (const [group, names] of suiteGroups) {
    let groupPass = 0;
    let groupFail = 0;
    let groupDone = 0;
    for (const name of names) {
      const status = suiteResults.get(name).status;
      if (status === "pass") groupPass += 1;
      if (status === "fail" || status === "error") groupFail += 1;
      if (status === "pass" || status === "fail" || status === "error") groupDone += 1;
    }
    const meta = suiteGroupMeta.get(group);
    if (meta) {
      meta.textContent =
        groupDone === names.length
          ? `${groupPass} pass, ${groupFail} fail`
          : `${groupDone}/${names.length} done`;
    }
  }

  refreshRoadmapLive();
}

// ── Roadmap progress panel ──────────────────────────────────────────────────
// Renders the 9-epic capability manifest (roadmap.js). Capabilities bound to a live
// riscv-tests group re-derive their status from the browser suite results after a run:
// a static "verified" row is promoted to "live" (all bound tests passed here) or flagged
// "regressed" (any failed). Rows with no bound group keep their offline evidence (RISCOF/CI).
const roadmapGrid = document.getElementById("roadmap-grid");
const roadmapSub = document.getElementById("roadmap-sub");
const roadmapCaps = [];

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The live riscv-tests binaries a capability is proven by: names under its group prefix,
// optionally narrowed to those whose name includes one of `filter`.
function capLiveNames(cap) {
  if (!cap.group) return [];
  return RISCV_TESTS.filter((name) => {
    if (!name.startsWith(cap.group)) return false;
    if (!cap.filter) return true;
    return cap.filter.some((f) => name.includes(f));
  });
}

function renderRoadmap() {
  const doneEpics = ROADMAP.filter((e) => e.status === "done").length;
  roadmapSub.textContent =
    `${doneEpics} / ${ROADMAP.length} epics complete · bound capabilities light up live as the suite runs`;
  roadmapGrid.replaceChildren();
  roadmapCaps.length = 0;

  for (const epic of ROADMAP) {
    const card = makeEl("div", `epic-card ${epic.status}`);
    const head = makeEl("div", "epic-head");
    head.append(
      makeEl("span", "epic-tag", epic.epic),
      makeEl("span", "epic-name", epic.title),
      makeEl("span", "epic-state",
        epic.status === "done" ? "complete"
          : epic.status === "next" ? "in progress"
          : epic.status === "cancelled" ? "cancelled"
          : "planned"),
    );
    const list = makeEl("ul", "cap-list");
    for (const cap of epic.caps) {
      const row = makeEl("li", "cap");
      const pip = makeEl("span", `cap-pip ${cap.status}`);
      const body = makeEl("div");
      body.append(makeEl("span", "cap-name", cap.name));
      const evEl = cap.evidence ? makeEl("span", "cap-ev", cap.evidence) : null;
      if (evEl) body.append(evEl);
      row.append(pip, body);
      list.append(row);
      roadmapCaps.push({
        pip,
        evEl,
        base: { status: cap.status, evidence: cap.evidence },
        names: capLiveNames(cap),
      });
    }
    card.append(head, makeEl("div", "epic-blurb", epic.blurb), list);
    roadmapGrid.append(card);
  }
}

function refreshRoadmapLive() {
  for (const rc of roadmapCaps) {
    if (rc.names.length === 0) continue; // no live binding — keep static evidence
    let pass = 0;
    let done = 0;
    for (const name of rc.names) {
      const status = suiteResults.get(name)?.status;
      if (status === "pass") { pass += 1; done += 1; }
      else if (status === "fail" || status === "error") { done += 1; }
    }
    let cls = rc.base.status;
    let ev = rc.base.evidence;
    let evCls = "cap-ev";
    if (done > 0 && pass < done) {
      cls = "regressed";
      ev = `${done - pass} of ${rc.names.length} FAILED in-browser`;
      evCls = "cap-ev regressed";
    } else if (done === rc.names.length && done > 0) {
      cls = "live";
      ev = `${pass}/${rc.names.length} passing · live in browser`;
      evCls = "cap-ev live";
    }
    rc.pip.className = `cap-pip ${cls}`;
    if (rc.evEl) {
      rc.evEl.textContent = ev;
      rc.evEl.className = evCls;
    }
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

function renderHoverCard(name) {
  const result = suiteResults.get(name) || { status: "pending", retired: null, detail: "" };
  hoverCard.dataset.name = name;
  hoverName.textContent = name;
  hoverStatus.className = `hover-status ${result.status}`;
  hoverStatus.textContent = statusLabel(result.status);
  const retired = result.retired == null ? "retired: -" : `retired: ${result.retired.toLocaleString()}`;
  hoverDetail.textContent = result.detail ? `${retired}; ${result.detail}` : retired;
}

function placeHoverCard(target) {
  const rect = target.getBoundingClientRect();
  const gap = 8;
  const width = hoverCard.offsetWidth || 320;
  const height = hoverCard.offsetHeight || 92;
  const maxX = window.innerWidth - width - 12;
  let left = Math.min(Math.max(12, rect.left), Math.max(12, maxX));
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 12) {
    top = rect.top - height - gap;
  }
  if (top < 12) top = 12;
  hoverCard.style.left = `${left}px`;
  hoverCard.style.top = `${top}px`;
}

function showHoverCard(name, target) {
  renderHoverCard(name);
  hoverCard.hidden = false;
  placeHoverCard(target);
}

function hideHoverCard() {
  hoverCard.hidden = true;
  hoverCard.removeAttribute("data-name");
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
  updateSuiteDot(name, { status: "running", retired: null, detail: "loading" });
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
    updateSuiteDot(name, { status: "running", retired: null, detail: "running" });
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
  resetSuiteDots();
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
      updateSuiteDot(name, result);
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
renderSuiteHeatmap();
renderRoadmap();
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
  // Alpine availability probe (Brett 2026-07-06): the 512 MB Alpine artifacts are LOCAL-ONLY
  // by design (served by tools/serve-dev.sh — never deployed to GitHub Pages). Instead of a
  // mid-boot "boot error", detect absence up front and disable the Alpine buttons with an
  // explanation; the busybox boot works everywhere.
  try {
    const probe = await fetch("./artifacts-alpine.json", { method: "GET", cache: "no-store" });
    const text = probe.ok ? await probe.text() : "";
    const present = probe.ok && !text.trimStart().startsWith("<");
    if (!present) {
      const why =
        "Alpine's 512 MB image is local-only (not deployed to GitHub Pages) — clone the repo and run: bash tools/serve-dev.sh";
      for (const b of [bootAlpineBtn, bootAlpineChunkedBtn]) {
        if (b) {
          b.disabled = true;
          b.dataset.unavailable = "1"; // survives the generic boot-button re-enable
          b.title = why;
        }
      }
      const note = document.createElement("div");
      note.className = "version";
      note.style.cssText = "margin-top:4px; opacity:.7;";
      note.textContent = "Alpine boots need local artifacts — " + why;
      bootAlpineChunkedBtn?.parentElement?.appendChild(note);
    }
  } catch {
    /* probe failure = treat as absent; buttons already work locally */
  }
  // The riscv-tests suite no longer auto-runs on load (Brett 2026-07-06): 126 in-browser
  // binaries take real time and CPU — run it via the "Run tests" button instead. The
  // roadmap capabilities stay in their static state until a run promotes them.
})();
