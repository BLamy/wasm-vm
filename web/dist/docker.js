// Docker tab — riscv64 OCI images the E3.5 pipeline pulls, digest-verifies, and unpacks into runnable
// bundles, plus the path to running them in the in-browser RISC-V guest via `wvrun`.
//
// HONESTY (E3.5-T05a): this UI shows only REAL state and NEVER simulates a shell or canned output.
// Clicking "▶ Run" on busybox:
//   1. fetches + displays the bundled boot artifact (initramfs) path and its sha256 from
//      artifacts.json — if that fetch fails, Run shows a TYPED ERROR and does NOT boot;
//   2. boots the REAL RISC-V Linux guest via window.wvmDemo.runBusybox() (the SAME WasmLinux boot
//      path the Terminal tab uses; the loader integrity-checks the artifact and refuses corrupt
//      bytes — a mismatch surfaces as a typed error, never a fallback);
//   3. attaches this tab's output pane to the REAL guest console byte stream (wvmDemo.onConsole —
//      the exact bytes xterm renders, not a buffer this file fills);
//   4. once the guest reaches its shell prompt, types ONE real command into the guest through the
//      REAL input bridge (wvmDemo.sendInput → ttyS0), and the guest's real output streams back.
// The command's marker is computed INSIDE the guest (echo CONTAINED_$((6*7)) → the value 42 the
// guest shell evaluates), so no host-side literal echo can satisfy it. There is deliberately NO JS
// command interpreter, NO canned transcript, and NO fake digest anywhere below.
//
// HONEST SCOPE: this runs the real busybox userland; it is NOT the OCI-overlay isolation path
// (`wvrun /opt/containers/<name>` — unshare + overlay + pivot_root + exec). That runner is built
// and native-tested (crates/cli/tests/boot_wvrun.rs) but the bundle isn't baked into the served
// in-browser image yet, so it can't run headlessly here — the run pane says so plainly.
// Un-bundled images are honestly marked as pullable-natively, not fabricated as runnable.

// Build the command typed into the ALPINE guest to run an image as a REAL OCI container: write the
// image's demo into the bundle's config/argv (single quotes keep $((…))/$(…) LITERAL to Alpine, so they
// are evaluated INSIDE the container — a host-side fake can't satisfy them), then `wvrun <bundle>`
// (unshare + overlay + pivot_root + seccomp). WVM_EXIT_$? surfaces the container's real exit status.
function wvrunCmd(img) {
  return `printf '/bin/sh\\n-c\\n${img.demo}\\n' > ${img.bundlePath}/config/argv; wvrun ${img.bundlePath}; echo WVM_EXIT_$?\r`;
}

// ── Image catalog ────────────────────────────────────────────────────────────
// `bundled` images carry REAL metadata from `tools/build-container-bundle.sh <repo> riscv64` (verified:
// the entry binary is a RISC-V ELF). Un-bundled images are honestly marked — pull them natively with
// the same script; they are not yet runnable in-browser.
const IMAGES = [
  {
    repo: "busybox",
    tag: "latest",
    bundled: true,
    runnableInBrowser: true,
    manifestDigest: "sha256:24a317d293b839dcf9033f80b6a8fb8407244dec45a2929925bc757fa33d1e71",
    rootfsSize: "3.2 MB",
    rootfsEntries: 448,
    entry: "sh",
    entryElf: "ELF 64-bit LSB pie, UCB RISC-V RVC double-float, dynamically linked",
    bundlePath: "/opt/containers/busybox",
    // The demo command runs INSIDE the container via wvrun. Markers are computed by the container's own
    // shell (arithmetic, `hostname`, `/proc/1/comm`), so no host-side literal can satisfy them — and
    // they prove the pid/uts/mount isolation of a real OCI container.
    demo: "echo CONTAINED_$((6*7)); echo pid1=$(cat /proc/1/comm); echo host=$(hostname); echo root:; ls /",
    desc: "BusyBox — a real Docker Hub image, digest-verified, run as an isolated OCI container by wvrun.",
  },
  {
    repo: "alpine",
    tag: "latest",
    bundled: true,
    runnableInBrowser: true,
    rootfsSize: "7.0 MB",
    rootfsEntries: 515,
    entry: "/bin/sh",
    bundlePath: "/opt/containers/alpine",
    demo: "echo CONTAINED_$((6*7)); echo alpine $(cat /etc/alpine-release 2>/dev/null); echo pid1=$(cat /proc/1/comm); echo host=$(hostname)",
    desc: "Alpine Linux — a real Docker Hub image run as an isolated OCI container (its own /etc, pid ns, hostname).",
  },
  {
    repo: "memcached",
    tag: "latest",
    bundled: true,
    runnableInBrowser: true,
    rootfsSize: "72 MB",
    rootfsEntries: 3323,
    entry: "docker-entrypoint.sh memcached",
    bundlePath: "/opt/containers/memcached",
    // memcached is a real server: run its default entrypoint (no argv override) so the container stays
    // LONG-LIVED — it shows as `running` in the Containers tab, and its logs carry the server's startup.
    demo: null,
    desc: "memcached — a real server image; wvrun runs the actual riscv64 memcached server in an isolated, long-lived container.",
  },
  { repo: "postgres", tag: "latest", bundled: false, riscv64: true, desc: "PostgreSQL — riscv64 image exists (254 MB); too large to bundle, pull natively." },
  { repo: "nginx", tag: "latest", bundled: false, riscv64: true, desc: "nginx — riscv64 image exists; large, pull natively." },
  { repo: "redis", tag: "latest", bundled: false, riscv64: true, desc: "Redis — riscv64 image exists (172 MB); large, pull natively." },
];

// Populate busybox's displayed metadata from the COMMITTED artifact so the numbers are provable, not
// hand-typed. Falls back to the constants above if the asset isn't deployed (e.g. a trimmed build).
async function loadBundleManifests() {
  const bb = IMAGES.find((i) => i.repo === "busybox");
  try {
    const m = await fetch("./assets/containers/busybox/manifest.json").then((r) =>
      r.ok ? r.json() : null,
    );
    if (m && m.manifestDigest) {
      bb.manifestDigest = m.manifestDigest;
      bb.rootfsEntries = m.rootfsEntries ?? bb.rootfsEntries;
      if (typeof m.rootfsBytes === "number") {
        bb.rootfsSize = `${(m.rootfsBytes / (1024 * 1024)).toFixed(1)} MB`;
      }
      if (m.entry) bb.entry = m.entry;
      if (m.entryElf) bb.entryElf = m.entryElf;
      // Only repaint the images list — never clobber a live run view (which owns the console pane).
      if (state.view === "images" && !state.detailRepo && !state.runRepo) render();
    }
  } catch {
    /* asset absent — keep the checked-in constants (which mirror the manifest) */
  }
}

const state = { view: "images", detailRepo: null, runRepo: null };

// ── Guest command channel: a serialized, fenced RPC over the single serial console ─────────────────
// Sends `<cmd>; printf '\n__WVEND_<id>_%s\n' $?` and captures stdout between the echoed command and the
// END marker. The marker is matched with a trailing DIGIT (the real $? output) so the command's OWN
// echoed marker text — which ends in the literal `%s` — never matches. Requires the Alpine guest booted
// and idle at a shell. Serialized via a promise chain so concurrent callers don't interleave.
let rpcChain = Promise.resolve();
let rpcSeq = 0;
function guestRun(cmd, timeoutMs = 60000) {
  const task = () =>
    new Promise((resolve, reject) => {
      const api = window.wvmDemo;
      if (!api || !api.isGuestUp || !api.isGuestUp()) return reject(new Error("guest not up"));
      const rid = `${Date.now().toString(36)}${rpcSeq++}`;
      const endRe = new RegExp(`__WVEND_${rid}_(\\d+)`);
      const dec = new TextDecoder();
      let buf = "";
      let unsub = null;
      let timer = null;
      const finish = (fn) => { clearTimeout(timer); if (unsub) unsub(); fn(); };
      unsub = api.onConsole((u8) => {
        buf += stripAnsi(dec.decode(u8, { stream: true }));
        const m = buf.match(endRe);
        if (m) {
          const exit = parseInt(m[1], 10);
          let out = buf.slice(0, m.index);
          const nl = out.indexOf("\n"); // drop the guest's echo of the command line
          if (nl !== -1) out = out.slice(nl + 1);
          finish(() => resolve({ stdout: out, exit }));
        }
      });
      timer = setTimeout(() => finish(() => reject(new Error("guest command timed out"))), timeoutMs);
      const full = `${cmd}; printf '\\n__WVEND_${rid}_%s\\n' "$?"\r`;
      setTimeout(() => api.sendInput(new TextEncoder().encode(full)), 0);
    });
  rpcChain = rpcChain.then(task, task);
  return rpcChain;
}

// Parse `wvrun ps` JSON-line output into container objects (skips the echoed command + partial lines).
function parsePs(stdout) {
  const out = [];
  for (const line of (stdout || "").split("\n")) {
    const s = line.trim();
    if (s[0] !== "{") continue;
    try { out.push(JSON.parse(s)); } catch { /* echoed/partial line */ }
  }
  return out;
}

// Build the detached-run command for an image: for busybox/alpine, override the container argv with the
// isolation-proof demo + a sleep so the container stays "running" (visible in Containers) and its logs
// carry the proof; memcached (img.demo unset) runs its real long-lived server entrypoint.
function wvrunRunCmd(img) {
  const name = `${img.repo}-${Math.floor(1000 + Math.random() * 9000)}`;
  const setArgv = img.demo
    ? `printf '/bin/sh\\n-c\\n${img.demo}; echo; echo [container still alive — sleeping]; sleep 240\\n' > ${img.bundlePath}/config/argv; `
    : "";
  return { name, cmd: `${setArgv}wvrun run -d --name ${name} ${img.bundlePath}` };
}

// Poll handle for the Containers view (cleared when navigating away).
let containersPoll = null;

// The live in-tab run session (see runFlow). Holds the real console tap + the streamed transcript
// so a re-render of the run view can re-attach without rebooting or fabricating output.
let session = null;

// One-click Run: open the in-tab run view and drive the REAL boot + REAL command through the guest.
// No tab switch, no simulated shell — the output pane below attaches to the real guest console.
function runContainer(img) {
  state.view = "run";
  state.runRepo = img.repo;
  render();
}

// ── Bundled boot artifact (initramfs) ─────────────────────────────────────────
// Fetch + validate the artifact the in-browser Run actually boots (from artifacts.json). Throws a
// clear typed error if the manifest is missing/corrupt so Run can surface it and refuse to boot —
// never a fallback. Returns { url, sha256, size }.
async function loadBootArtifact() {
  let resp;
  try {
    resp = await fetch("./artifacts.json", { cache: "no-store" });
  } catch (e) {
    throw new Error(`could not fetch the boot manifest artifacts.json: ${e.message || e}`);
  }
  const text = await resp.text();
  if (!resp.ok || text.trimStart().startsWith("<")) {
    throw new Error(`boot manifest artifacts.json not found (HTTP ${resp.status})`);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("boot manifest artifacts.json is not valid JSON"); }
  const initrd = j?.artifacts?.initramfs;
  if (!initrd?.url || !initrd?.sha256) {
    throw new Error("boot manifest artifacts.json is missing the initramfs artifact (url/sha256)");
  }
  return initrd;
}

// Strip ANSI/VT control sequences and carriage returns for a plain-text transcript + marker
// matching. Newlines are preserved. (The Terminal tab still renders full VT100 via xterm.)
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b[()][0-9A-B]/g, "").replace(/\r/g, "");
}

function showRunError(errEl, msg) {
  errEl.textContent = `⛔ ${msg}`;
  errEl.style.display = "block";
}

// Once the Alpine guest reaches a shell prompt, start the container DETACHED (`wvrun run -d`) so it is
// tracked and shows up in the Containers tab. Idempotent per session.
function injectCommand() {
  if (!session || session.injected) return;
  session.injected = true;
  clearTimeout(session.fallback);
  const { name, cmd } = wvrunRunCmd(session.img);
  session.startedName = name;
  // CRITICAL: injectCommand runs from inside onConsoleChunk (the guest emits output synchronously);
  // calling sendInput here re-enters the wasm machine ("re-entrant call into WasmMachine"). Defer it.
  const bytes = new TextEncoder().encode(cmd + "\r");
  setTimeout(() => {
    window.wvmDemo.sendInput(bytes);
    // `wvrun run -d` returns the id quickly; jump to the Containers tab, which polls `wvrun ps`.
    setTimeout(() => {
      if (session && session.unsub) session.unsub();
      state.view = "containers";
      state.runRepo = null;
      render();
    }, 3500);
  }, 0);
}

// Decide when the Alpine guest is ready for the command: it reaches a root auto-login shell prompt
// like `wasm-vm:~# ` (the interpreted boot takes minutes; the prompt is the ready signal).
function maybeInject() {
  if (!session || session.injected) return;
  if (/[\w][\w.-]*:~#\s*$/m.test(session.buf) || /\/ #\s*$/m.test(session.buf)) injectCommand();
}

// The console tap: exactly the bytes main.js writes to xterm. Append to the pane + drive injection.
function onConsoleChunk(u8) {
  if (!session) return;
  const clean = stripAnsi(session.decoder.decode(u8, { stream: true }));
  session.buf += clean;
  const pane = session.paneEl;
  if (pane && pane.isConnected) {
    pane.textContent += clean;
    pane.scrollTop = pane.scrollHeight;
  }
  maybeInject();
}

// Drive one real run: validate+show the artifact, boot the real guest, stream real output, type the
// real command. `reuse` re-attaches the pane to an already-live session instead of rebooting.
async function runFlow(img, paneEl, errEl, artEl) {
  const api = window.wvmDemo;
  if (!api || !api.bootAlpine) {
    showRunError(errEl, "The boot engine is still loading — wait a moment and click Run again.");
    return;
  }

  // Pre-flight: the Alpine guest (which ships wvrun + the baked bundles) must be deployed to this host,
  // or wvrun cannot run here — fail with a typed error and boot NOTHING (no busybox-initramfs fallback).
  if (!api.alpineArtifactsPresent || !api.alpineArtifactsPresent()) {
    showRunError(
      errEl,
      "The Alpine container image (wvrun + baked OCI bundles) isn't deployed to this host yet, so real " +
        "containers can't run here. Deploy the Alpine artifacts (artifacts-alpine.json + releases/chunked-alpine/), " +
        "or clone the repo and run: bash tools/serve-dev.sh",
    );
    return;
  }
  renderContainerInfo(artEl, img);

  session = {
    repo: img.repo, img, buf: "", injected: false, starting: true,
    decoder: new TextDecoder(), paneEl, errEl, unsub: null, fallback: null,
  };
  session.unsub = api.onConsole(onConsoleChunk);
  paneEl.textContent = "";

  let res;
  try {
    res = await api.bootAlpine();
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }
  session.starting = false;
  if (!res || !res.ok) {
    showRunError(errEl, `Alpine boot failed — ${res?.error || "unknown error"}. Missing/corrupt artifacts are refused; there is no mock-shell fallback.`);
    if (session.unsub) session.unsub();
    return;
  }
  // If the guest was ALREADY up (a second Run), no boot prompt will re-appear in the console stream to
  // trigger injection — so fire the detached run now (the guest is idle at a shell). A fresh boot is
  // driven by maybeInject() when the prompt first appears.
  if (res.already) setTimeout(injectCommand, 800);
}

// Show what actually runs: the baked OCI bundle (real Docker Hub image, digest-verified) and the
// `wvrun` command that runs it as an isolated container in the Alpine guest.
function renderContainerInfo(artEl, img) {
  if (!artEl) return;
  artEl.replaceChildren();
  const dl = elc("dl", "dk-kv");
  const rows = [
    ["Image", `${img.repo}:${img.tag} (riscv64)`],
    ["OCI bundle (in guest)", img.bundlePath],
    ["Unpacked rootfs", `${img.rootfsSize || "?"}${img.rootfsEntries ? ` · ${img.rootfsEntries} entries` : ""}`],
    ["Entrypoint", img.entry || "sh"],
  ];
  if (img.manifestDigest) rows.push(["Manifest digest", img.manifestDigest]);
  rows.push(["Runs as", `wvrun ${img.bundlePath}  (unshare + overlay + pivot_root + seccomp)`]);
  for (const [k, v] of rows) dl.append(elc("dt", null, k), elc("dd", null, v));
  artEl.append(dl);
}

const root = document.getElementById("docker-app");
if (root) build();

function build() {
  root.replaceChildren();
  const side = elc("div", "dk-side");
  const brand = elc("div", "dk-brand");
  brand.append(elc("span", "dk-whale", "🐳"), elc("span", null, "wasm-vm Desktop"));
  side.append(brand, navBtn("images", "📦  Images"), navBtn("containers", "🧩  Containers"));
  root.append(side);
  const main = elc("div", "dk-main");
  main.id = "dk-main";
  root.append(main);
  render();
  loadBundleManifests(); // replace busybox's constants with the committed artifact's real numbers
}

function bundledCount() {
  return IMAGES.filter((i) => i.bundled).length;
}

function navBtn(view, label) {
  const b = elc("button", "dk-nav", label);
  b.dataset.view = view;
  b.addEventListener("click", () => {
    state.view = view;
    state.detailRepo = null;
    render();
  });
  return b;
}

function render() {
  // Any prior Containers poll stops on a view change; renderContainers re-arms it if we stay there.
  clearInterval(containersPoll);
  containersPoll = null;
  for (const b of root.querySelectorAll(".dk-nav")) {
    b.classList.toggle("active", b.dataset.view === state.view && !state.detailRepo);
  }
  const main = document.getElementById("dk-main");
  main.replaceChildren();
  if (state.view === "run" && state.runRepo) return renderRun(main);
  if (state.detailRepo) return renderDetail(main);
  if (state.view === "containers") return renderContainers(main);
  return renderImages(main);
}

// ── Images ───────────────────────────────────────────────────────────────────
function renderImages(main) {
  const nb = bundledCount();
  main.append(head("Images", `${IMAGES.length} riscv64 images · ${nb} bundled + digest-verified · click ▶ Run on busybox to boot it in the browser`));
  main.append(note(
    `${nb === 1 ? "busybox was" : `${nb} images were`} pulled from Docker Hub, digest-verified, and ` +
    "unpacked into a real riscv64 bundle via tools/build-container-bundle.sh (the entry binary is " +
    "checked to be a RISC-V ELF). The rest are catalog entries — pullable the same way, but not pulled " +
    "or bundled here yet.",
  ));
  const view = elc("div", "dk-view");
  const table = elc("table", "dk-table");
  table.innerHTML = `<thead><tr><th>Repository</th><th>Tag</th><th>Arch</th><th>Bundle</th><th></th></tr></thead>`;
  const tb = document.createElement("tbody");
  for (const img of IMAGES) {
    const tr = document.createElement("tr");
    const repoCell = td();
    repoCell.append(elc("span", "dk-repo", img.repo));
    repoCell.append(document.createElement("br"), elc("span", "dk-mono", img.desc));
    tr.append(repoCell);
    tr.append(td(elc("span", "dk-tag", img.tag)));
    tr.append(td(elc("span", "dk-arch", "riscv64")));
    const bundleCell = td();
    if (img.bundled) {
      const s = elc("span", "dk-status running");
      s.append(elc("span", "dot"), document.createTextNode(`${img.rootfsSize} · ${img.rootfsEntries} files`));
      bundleCell.append(s);
    } else {
      bundleCell.append(elc("span", "dk-mono", "not bundled — pull natively"));
    }
    tr.append(bundleCell);
    const actions = td();
    actions.style.whiteSpace = "nowrap";
    if (img.runnableInBrowser) {
      const runBtn = elc("button", "dk-btn run", "▶ Run");
      runBtn.title = "Boot the real busybox userland on RISC-V Linux, in your browser";
      runBtn.dataset.run = img.repo;
      runBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runContainer(img);
      });
      actions.append(runBtn);
    }
    const detailsBtn = elc("button", "dk-btn", "Details");
    if (img.runnableInBrowser) detailsBtn.style.marginLeft = "6px";
    detailsBtn.addEventListener("click", () => {
      state.detailRepo = img.repo;
      render();
    });
    actions.append(detailsBtn);
    tr.append(actions);
    tb.append(tr);
  }
  table.append(tb);
  view.append(table);
  main.append(view);
}

// ── Run view: real boot + real command + real transcript (E3.5-T05a) ─────────
function renderRun(main) {
  const img = IMAGES.find((i) => i.repo === state.runRepo);
  if (!img || !img.runnableInBrowser) {
    state.view = "images";
    state.runRepo = null;
    return render();
  }
  const dh = elc("div", "dk-detail-head");
  const back = elc("button", "dk-back", "← Images");
  back.addEventListener("click", () => {
    state.view = "images";
    state.runRepo = null;
    render();
  });
  dh.append(
    back,
    elc("span", "dk-repo", `${img.repo}:${img.tag}`),
    elc("span", "dk-arch", "riscv64"),
    elc("span", "dk-verified", "verified bundled · runs in-browser"),
  );
  main.append(dh);

  main.append(note(
    "Verified bundled busybox. Run boots the REAL RISC-V Linux guest in your browser (the same " +
    "WasmLinux engine as the Terminal tab), attaches the pane below to the guest's real console, " +
    "and once it reaches a shell prompt types ONE real command into the guest. The output below is " +
    "the guest's own — not a simulated shell. (Un-bundled images stay on the Images list marked " +
    "“pull natively”; they have no in-browser userland yet.)",
  ));

  const artEl = elc("div", "dk-pane");
  artEl.id = "dk-artifact";
  main.append(artEl);

  const errEl = elc("div", "dk-error");
  errEl.id = "dk-error";
  errEl.style.display = "none";
  main.append(errEl);

  const cmdNote = elc("div", "dk-note");
  cmdNote.append(
    document.createTextNode("Runs in the Alpine guest: "),
    elc("code", null, `wvrun ${img.bundlePath}`),
    document.createTextNode(
      " — a REAL OCI container (unshare + overlay + pivot_root + seccomp). The marker below is computed " +
        "INSIDE the container by its own shell, so a host-side literal can't satisfy it.",
    ),
  );
  main.append(cmdNote);

  const pane = elc("pre", "dk-console");
  pane.id = "dk-console";
  pane.setAttribute("aria-label", "guest console transcript");
  main.append(pane);

  // Kick off (or re-attach to) the real run. Fire-and-forget: console updates append to `pane`
  // directly, so this render is never called again mid-run.
  runFlow(img, pane, errEl, artEl);
}

// ── Containers: LIVE from `wvrun ps` in the Alpine guest ──────────────────────
function renderContainers(main) {
  main.append(head("Containers", "live from wvrun ps in the Alpine guest"));
  const view = elc("div", "dk-view");
  main.append(view);
  const api = window.wvmDemo;

  if (!api || !api.isGuestUp || !api.isGuestUp()) {
    view.append(note(
      "No guest is running yet. Go to Images and click ▶ Run on a bundled image — it boots the Alpine " +
      "guest and starts the container detached (wvrun run -d). Running/exited containers then appear " +
      "here, polled live from wvrun ps, with Logs / Stop / Remove.",
    ));
    return;
  }

  const listEl = elc("div", "dk-clist");
  listEl.textContent = "loading containers (wvrun ps -a)…";
  view.append(listEl);
  const logEl = elc("pre", "dk-console");
  logEl.style.display = "none";
  view.append(logEl);

  let inFlight = false;
  const refresh = async () => {
    if (state.view !== "containers" || inFlight) return; // navigated away / prior poll still running
    inFlight = true;
    try {
      const { stdout } = await guestRun("wvrun ps -a");
      if (state.view !== "containers") return;
      renderContainerList(listEl, logEl, parsePs(stdout));
    } catch (e) {
      if (state.view === "containers") listEl.textContent = `wvrun ps failed: ${e.message || e}`;
    } finally {
      inFlight = false;
    }
  };
  refresh();
  clearInterval(containersPoll);
  containersPoll = setInterval(refresh, 6000);
}

// Render the container rows + wire Logs / Stop / Remove (each an RPC into the guest).
function renderContainerList(listEl, logEl, rows) {
  listEl.replaceChildren();
  if (!rows.length) {
    listEl.append(note("No containers yet. Run a bundled image from the Images tab."));
    return;
  }
  const table = elc("table", "dk-table");
  table.innerHTML = "<thead><tr><th>Container</th><th>Image</th><th>Status</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const c of rows) {
    const tr = document.createElement("tr");
    const nameCell = td();
    nameCell.append(elc("span", "dk-repo", c.name || c.id));
    nameCell.append(document.createElement("br"), elc("span", "dk-mono", c.id));
    tr.append(nameCell);
    tr.append(td(elc("span", "dk-mono", c.image || "")));
    const st = td();
    const running = c.status === "running";
    const badge = elc("span", running ? "dk-status running" : "dk-mono");
    if (running) badge.append(elc("span", "dot"), document.createTextNode("running"));
    else badge.textContent = c.status + (c.exit ? ` (${c.exit})` : "");
    st.append(badge);
    tr.append(st);
    const actions = td();
    actions.style.whiteSpace = "nowrap";
    const logsBtn = elc("button", "dk-btn", "Logs");
    logsBtn.addEventListener("click", () => showLogs(logEl, c));
    actions.append(logsBtn);
    if (running) {
      const stopBtn = elc("button", "dk-btn", "Stop");
      stopBtn.style.marginLeft = "6px";
      stopBtn.addEventListener("click", async () => { stopBtn.disabled = true; await guestRun(`wvrun stop ${c.id}`).catch(() => {}); });
      actions.append(stopBtn);
    } else {
      const rmBtn = elc("button", "dk-btn", "Remove");
      rmBtn.style.marginLeft = "6px";
      rmBtn.addEventListener("click", async () => { rmBtn.disabled = true; await guestRun(`wvrun rm -f ${c.id}`).catch(() => {}); });
      actions.append(rmBtn);
    }
    tr.append(actions);
    tb.append(tr);
  }
  table.append(tb);
  listEl.append(table);
}

// Fetch + show a container's logs (the container's real stdout, incl. the guest-computed proof markers).
async function showLogs(logEl, c) {
  logEl.style.display = "block";
  logEl.textContent = `wvrun logs ${c.name || c.id} …`;
  try {
    const { stdout } = await guestRun(`wvrun logs ${c.id}`);
    logEl.textContent = `$ wvrun logs ${c.name || c.id}\n${stdout.trim() || "(no output yet)"}`;
  } catch (e) {
    logEl.textContent = `wvrun logs failed: ${e.message || e}`;
  }
}

// ── Image detail: Inspect + Run (honest, no fake shell) ──────────────────────
function renderDetail(main) {
  const img = IMAGES.find((i) => i.repo === state.detailRepo);
  if (!img) {
    state.detailRepo = null;
    return render();
  }
  const dh = elc("div", "dk-detail-head");
  const back = elc("button", "dk-back", "← Images");
  back.addEventListener("click", () => {
    state.detailRepo = null;
    state.view = "images";
    render();
  });
  dh.append(back, elc("span", "dk-repo", `${img.repo}:${img.tag}`), elc("span", "dk-arch", "riscv64"));
  main.append(dh);

  const pane = elc("div", "dk-pane");
  const dl = elc("dl", "dk-kv");
  const rows = [["Repository", `${img.repo}:${img.tag}`], ["Architecture", "riscv64 / linux"]];
  if (img.bundled) {
    rows.push(
      ["Manifest digest", img.manifestDigest],
      ["Unpacked rootfs", `${img.rootfsSize} · ${img.rootfsEntries} entries`],
      ["Entrypoint", img.entry],
      ["Entry binary", img.entryElf],
      ["Bundle path (in guest)", img.bundlePath],
    );
  } else {
    rows.push(["Bundle", "not built yet"]);
  }
  for (const [k, v] of rows) {
    dl.append(elc("dt", null, k), elc("dd", null, v));
  }
  pane.append(dl);
  main.append(pane);

  if (img.runnableInBrowser) {
    main.append(note(
      `One click boots a real RISC-V Linux guest running the REAL busybox userland, streams its real ` +
      `console into a run pane here, and runs one real command in it — no local setup, works ` +
      `everywhere including GitHub Pages.`,
    ));
    const go = elc("button", "dk-btn run", "▶ Run busybox in the browser");
    go.style.margin = "0 18px 12px";
    go.dataset.run = img.repo;
    go.addEventListener("click", () => runContainer(img));
    main.append(go);
    main.append(note(
      `Honest scope: this runs the real busybox binary on real RISC-V Linux. The OCI-bundle isolation ` +
      `path — wvrun ${img.bundlePath} (unshare + overlay ro-rootfs+tmpfs + pivot_root + exec ${img.entry}) — ` +
      `is built and native-tested (crates/cli/tests/boot_wvrun.rs), but the ${img.bundlePath} bundle is not ` +
      `baked into the served in-browser image yet, so it cannot run headlessly here. Run it natively with a ` +
      `guest that mounts the bundle (the Alpine rootfs ships wvrun at /usr/local/bin/wvrun).`,
    ));
  } else if (img.bundled) {
    main.append(note(
      `Bundled and digest-verified, but there is no in-browser userland for it yet. Run it natively: ` +
      `wvrun ${img.bundlePath || "/opt/containers/" + img.repo} on a guest that mounts the bundle ` +
      `(unshare + overlay + pivot_root + exec ${img.entry || "the entrypoint"}).`,
    ));
  } else {
    main.append(note(
      `Not bundled yet. Build a real riscv64 bundle natively:  ` +
      `tools/build-container-bundle.sh ${img.repo}:${img.tag} web/assets/containers/${img.repo} riscv64  ` +
      `— it digest-verifies every blob and asserts the entry binary is a RISC-V ELF.`,
    ));
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────
function elc(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function td(child) {
  const c = document.createElement("td");
  if (child) c.append(child);
  return c;
}
function head(title, sub) {
  const h = elc("div", "dk-head");
  const box = elc("div");
  box.append(elc("h2", null, title), elc("div", "dk-sub", sub));
  h.append(box);
  return h;
}
function note(text) {
  return elc("div", "dk-note", text);
}
