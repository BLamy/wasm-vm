// IDE tab — a VSCode-like workbench powered entirely by the in-browser RISC-V Alpine guest.
//
// Layout (all over the guest's REAL filesystem / REAL wvrun containers — no synthetic data):
//   • activity bar (far left) — 📁 Files / 🐳 Docker view switch + a sidebar collapse toggle
//   • sidebar        — Files: guest file tree + the re-parented Host↔Alpine transfer panel
//                    — Docker: image catalog (Run) + live `wvrun ps -a` container list
//   • editor area    — a real tab strip: FILE tabs (open/edit/save) + CONTAINER tabs (logs + exec)
//   • terminal pane  — JUST the #term xterm (the legacy boot/bench toolbar is hidden, not deleted,
//                      because main.js binds #run/#bench/#file/#reset un-guarded)
//   • status bar     — thin blue bar: guest status + a Network item whose popover holds the
//                      re-parented provider config (.network-config)
//
// HONESTY: every byte shown comes from the real guest via window.wvmDemo.exec(). Saving is
// byte-exact (base64 in JS → `base64 -d` in-guest). Container logs/exec use the real wvrun CLI.

const ROOT = "/root";

// ── styles (injected; no dependency on index.html CSS) ───────────────────────
const css = `
/* The IDE fills the whole panel below the header (VSCode-style full-bleed, no card). */
#panel-ide.active { display: flex; flex-direction: column; height: calc(100vh - 51px); min-height: 0; }
#ide-root { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden;
  background: var(--panel, #0d1117); color: var(--text, #d6deeb);
  font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }

.ide-body { display: flex; flex: 1 1 auto; min-height: 0; }

/* Resize handles — sidebar width (col-resize) and terminal height (row-resize). */
.ide-vsplit { flex: 0 0 6px; cursor: col-resize; background: transparent; z-index: 5; border-left: 1px solid var(--line, #232a35); }
.ide-hsplit { flex: 0 0 6px; cursor: row-resize; background: transparent; z-index: 5; border-top: 1px solid var(--line, #232a35); }
.ide-vsplit:hover, .ide-vsplit.drag, .ide-hsplit:hover, .ide-hsplit.drag { background: rgba(83,212,255,.35); }

/* Activity bar */
.ide-activity { flex: 0 0 48px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 0; background: #0a0d13; border-right: 1px solid var(--line, #232a35); }
.ide-act-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  font-size: 20px; cursor: pointer; background: none; border: 0; border-left: 2px solid transparent;
  color: #8fa3bf; border-radius: 0; opacity: .7; }
.ide-act-btn:hover { opacity: 1; }
.ide-act-btn.active { opacity: 1; color: #d6deeb; border-left-color: var(--cyan, #53d4ff); }
.ide-act-spacer { flex: 1 1 auto; }

/* Sidebar */
.ide-side { flex: 0 0 264px; display: flex; flex-direction: column; min-width: 0;
  border-right: 1px solid var(--line, #232a35); background: var(--panel, #0d1117); overflow: hidden; }
.ide-side.collapsed { display: none; }
.ide-side-title { flex: 0 0 auto; padding: 8px 12px; font-size: 11px; letter-spacing: .6px;
  text-transform: uppercase; color: #8fa3bf; border-bottom: 1px solid var(--line, #232a35); }
.ide-side-view { display: none; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.ide-side-view.active { display: flex; }
#ide-explorer { flex: 1 1 auto; overflow: auto; padding: 4px 0; min-height: 80px; }
.ide-side-ft { flex: 0 0 auto; border-top: 1px solid var(--line, #232a35); overflow: auto; max-height: 46%; }
.ide-side-ft .file-transfer { margin: 0; border: 0; border-radius: 0; background: transparent; }

/* Docker sidebar */
.ide-dk { flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; }
.ide-dk-sec { padding: 6px 0; }
.ide-dk-h { padding: 8px 12px 4px; font-size: 10.5px; letter-spacing: .5px; text-transform: uppercase; color: #6f8097; }
.ide-dk-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: default; }
.ide-dk-row:hover { background: var(--panel-2, #151a22); }
.ide-dk-row .nm { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ide-dk-row .sub { color: #6f8097; font-size: 11px; }
.ide-dk-ctr { cursor: pointer; }
.ide-dk-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: #5a6b82; }
.ide-dk-dot.running { background: var(--green, #2ea043); box-shadow: 0 0 0 3px rgba(46,160,67,.2); }
.ide-mini { background: #234; color: #cfe3ff; border: 1px solid #2b5278; border-radius: 6px;
  padding: 3px 9px; cursor: pointer; font: inherit; font-size: 11px; }
.ide-mini:hover:not(:disabled) { background: #2b5278; }
.ide-mini.run { border-color: #287555; background: #143c31; color: #d6ffe6; }
.ide-mini:disabled { opacity: .4; cursor: not-allowed; }
.ide-dk-note { padding: 12px; color: #7d8ba0; line-height: 1.55; font-size: 12px; }
.ide-dk-runtime { padding: 8px 0 10px; border-bottom: 1px solid var(--line, #232a35); }
.ide-dk-runtime-status { padding: 4px 12px 8px; color: #cdd6f4; line-height: 1.45; font-size: 12px; }
.ide-dk-runtime-status[data-state="available"] { color: #9ad29a; }
.ide-dk-runtime-status[data-state="unavailable"], .ide-dk-runtime-status[data-state="error"] { color: #f0c6a0; }
.ide-dk-runtime > .ide-mini { margin: 0 12px 4px; }
.ide-dk-image-detail { margin: -2px 12px 8px; padding: 8px; border: 1px solid var(--line, #232a35);
  border-radius: 6px; background: #0b0f15; font-size: 11px; line-height: 1.45; }
.ide-dk-image-detail .title { color: #d6deeb; font-weight: 600; margin-bottom: 5px; }
.ide-dk-image-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 8px; margin: 0; }
.ide-dk-image-detail dt { color: #6f8097; }
.ide-dk-image-detail dd { min-width: 0; margin: 0; color: #cdd6f4; overflow-wrap: anywhere; }
.ide-dk-inspect-raw { max-height: 180px; overflow: auto; margin: 7px 0 0; color: #8fa3bf; white-space: pre-wrap; }
.ide-dk-run-state { padding: 5px 12px 7px; color: #9ad29a; font-size: 11px; line-height: 1.4; }
.ide-dk-run-state[data-state="starting"] { color: #f2c94c; }
.ide-dk-run-state[data-state="failed"] { color: #f0a0a0; }

/* Editor area */
.ide-editor-area { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #0b0f15; }
.ide-tabstrip { flex: 0 0 auto; display: flex; align-items: stretch; overflow-x: auto; min-height: 35px;
  background: #0a0d13; border-bottom: 1px solid var(--line, #232a35); }
.ide-tab { display: flex; align-items: center; gap: 7px; padding: 0 10px; max-width: 220px; cursor: pointer;
  color: #8fa3bf; background: #0d1117; border-right: 1px solid var(--line, #232a35); white-space: nowrap; font-size: 12.5px; }
.ide-tab:hover { color: #d6deeb; }
.ide-tab.active { color: #d6deeb; background: #0b0f15; border-top: 1px solid var(--cyan, #53d4ff); }
.ide-tab .t-nm { overflow: hidden; text-overflow: ellipsis; }
.ide-tab .t-dirty { color: #f0c674; }
.ide-tab .t-close { width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 4px; opacity: .6; }
.ide-tab .t-close:hover { background: #2b3646; opacity: 1; }

.ide-editor-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 6px 12px;
  border-bottom: 1px solid var(--line, #232a35); background: #0d1117; }
.ide-crumb { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #8fa3bf; }
.ide-crumb b { color: #d6deeb; }
.ide-status { color: #8fa3bf; font-size: 12px; }
.ide-status.err { color: #f0a0a0; } .ide-status.ok { color: #9ad29a; }
.ide-save { background: #234; color: #cfe3ff; border: 1px solid #2b5278; border-radius: 7px; padding: 4px 13px; cursor: pointer; font: inherit; }
.ide-save:hover:not(:disabled) { background: #2b5278; }
.ide-save:disabled { opacity: .4; cursor: not-allowed; }

.ide-editor-body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
#ide-editor-wrap { flex: 1 1 auto; display: flex; min-width: 0; }
.ide-gutter { flex: 0 0 auto; padding: 8px 8px 8px 12px; text-align: right; color: #4a5a72;
  background: #0b0f15; border-right: 1px solid var(--line, #232a35); user-select: none;
  overflow: hidden; white-space: pre; line-height: 1.5; font: inherit; }
.ide-textarea { flex: 1 1 auto; resize: none; border: 0; outline: 0; padding: 8px 12px;
  background: #0b0f15; color: #d6deeb; font: inherit; line-height: 1.5; tab-size: 4; white-space: pre; overflow: auto; }
.ide-textarea:disabled { color: #5a6b82; }

.ide-ctr-panel { flex: 1 1 auto; display: none; flex-direction: column; min-width: 0; min-height: 0; }
.ide-ctr-panel.active { display: flex; }
.ide-ctr-head { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border-bottom: 1px solid var(--line, #232a35); flex-wrap: wrap; }
.ide-ctr-head .id { color: #8fa3bf; }
.ide-ctr-head label { display: flex; align-items: center; gap: 5px; color: #8fa3bf; font-size: 12px; }
.ide-ctr-logs { flex: 1 1 auto; overflow: auto; margin: 0; padding: 10px 12px; white-space: pre-wrap;
  word-break: break-word; color: #cdd6f4; background: #0b0e14; font-size: 12px; line-height: 1.5; }
.ide-ctr-exec { flex: 0 0 auto; display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line, #232a35); }
.ide-ctr-exec .p { color: var(--green, #2ea043); align-self: center; }
.ide-ctr-exec input { flex: 1 1 auto; background: #0b0f15; color: #d6deeb; border: 1px solid var(--line, #232a35);
  border-radius: 6px; padding: 5px 9px; font: inherit; outline: none; }
.ide-ctr-exec input:focus { border-color: var(--cyan, #53d4ff); }

.ide-editor-ph { margin: auto; padding: 22px 18px; color: #7d8ba0; line-height: 1.6; font-size: 12.5px; text-align: center; max-width: 380px; }
.ide-explorer-ph { padding: 22px 18px; color: #7d8ba0; line-height: 1.6; font-size: 12.5px; }
.ide-spin { display: inline-block; animation: ide-spin 1s linear infinite; }
@keyframes ide-spin { to { transform: rotate(360deg); } }

/* File tree */
.ide-tree { list-style: none; margin: 0; padding: 0; }
.ide-tree .ide-tree { padding-left: 14px; }
.ide-node { display: flex; align-items: center; gap: 5px; padding: 3px 10px; cursor: pointer;
  white-space: nowrap; user-select: none; border-radius: 5px; }
.ide-node:hover { background: var(--panel-2, #151a22); }
.ide-node.sel { background: #1c2c44; color: #cfe3ff; }
.ide-node .tw { width: 12px; text-align: center; color: #5a6b82; font-size: 10px; flex: 0 0 auto; }
.ide-node .ic { flex: 0 0 auto; }
.ide-node .nm { overflow: hidden; text-overflow: ellipsis; }

/* Terminal pane */
.ide-term-pane { flex: 0 0 auto; height: 280px; min-height: 80px; display: flex; flex-direction: column;
  background: var(--panel, #0d1117); overflow: hidden; }
.ide-term-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 4px 12px;
  background: #0a0d13; border-bottom: 1px solid var(--line, #232a35); font-size: 11px; color: #8fa3bf; }
.ide-term-bar .sp { flex: 1 1 auto; }
/* root@<guest> chip — shows which guest userland the CLI is running in (busybox / alpine). */
.ide-term-who { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: #7ee787; background: rgba(63, 185, 80, 0.12); border: 1px solid rgba(63, 185, 80, 0.3);
  border-radius: 4px; padding: 1px 7px; letter-spacing: .2px; }
.ide-term-who[hidden] { display: none; }
/* The terminal pane is a single scroll: this wrapper does NOT scroll (overflow:hidden); the xterm
   viewport inside #term is the only scrollbar. #term flexes to fill so the fit addon sizes it. */
.ide-term-scroll { flex: 1 1 auto; overflow: hidden; min-height: 0; }
/* Hide the legacy boot/bench toolbar + boot-hint (kept in DOM for main.js bindings) and any info
   banners so the terminal shows only the guest console. */
.ide-term-scroll .console-head, .ide-term-scroll #boot-hint, .ide-term-scroll #run-banner { display: none !important; }
.ide-term-scroll .console { border: 0; border-radius: 0; margin: 0; height: 100%; min-height: 0;
  display: flex; flex-direction: column; }
.ide-term-scroll .console > *:not(#term) { flex: 0 0 auto; }
.ide-term-scroll #term { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.ide-term-scroll #term .xterm { height: 100%; }

/* Status bar */
.ide-statusbar { flex: 0 0 auto; display: flex; align-items: center; gap: 0; height: 24px;
  background: #0a5cc2; color: #eaf2ff; font-size: 11.5px; position: relative; }
.ide-sb-item { display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 100%; cursor: default; }
.ide-sb-item.btn { cursor: pointer; }
.ide-sb-item.btn:hover { background: rgba(255,255,255,.15); }
.ide-sb-sp { flex: 1 1 auto; }
.ide-sb-dot { width: 8px; height: 8px; border-radius: 50%; background: #f2c94c; }
.ide-sb-dot.ready { background: #7ee787; }
.ide-sb-dot.off { background: #cdd6f4; }
.ide-net-pop { position: absolute; right: 8px; bottom: 28px; width: min(560px, 92vw); z-index: 30;
  background: var(--panel-2, #151a22); border: 1px solid var(--line, #232a35); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 12px; display: none; }
.ide-net-pop.open { display: block; }
.ide-net-pop .file, .ide-net-pop h4 { color: #d6deeb; }
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

// ── Docker image catalog + command builders (folded in from docker.js) ───────
// These labels are used only while the current guest is unavailable. Once the real Alpine guest
// reports its catalog, renderDocker() uses only the objects returned by /opt/containers/index.json.
// Keeping the degraded view useful preserves T05f1's fail-closed busybox proof without making a
// public busybox boot look like it has a container catalog that it does not actually contain.
const DEGRADED_IMAGES = [
  { repo: "busybox", tag: "latest", runnable: true, bundlePath: "/opt/containers/busybox", desc: "BusyBox — guest catalog unavailable" },
  { repo: "alpine", tag: "latest", runnable: true, bundlePath: "/opt/containers/alpine", desc: "Alpine — available in the local runtime guest" },
  { repo: "memcached", tag: "latest", runnable: true, bundlePath: "/opt/containers/memcached", desc: "memcached — available in the local runtime guest" },
  { repo: "postgres", tag: "latest", runnable: false, desc: "PostgreSQL — pull natively" },
  { repo: "nginx", tag: "latest", runnable: false, desc: "nginx — pull natively" },
  { repo: "redis", tag: "latest", runnable: false, desc: "Redis — pull natively" },
];

// Detached runs deliberately use the guest bundle's own config/argv. The browser does not rewrite
// image metadata or inject a canned transcript; the only success signal is the identity printed by
// the guest's real wvrun process.
function wvrunRunCmd(img) {
  const name = dockerCatalog.runNameOverride ||
    `${img.repo || img.name || "image"}-${Date.now().toString(36)}-${++dockerCatalog.runSeq}`;
  return { name, cmd: `wvrun run -d --name ${dockerShq(name)} ${dockerShq(img.bundlePath)}` };
}

function dockerShq(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function parsePs(stdout) {
  const out = [];
  for (const line of (stdout || "").split("\n")) {
    const s = line.trim();
    if (s[0] !== "{") continue;
    try { out.push(JSON.parse(s)); } catch { /* echoed/partial line */ }
  }
  return out;
}

// Docker owns an explicit capability state instead of treating a ready shell as a container runtime.
// A public busybox boot is guest-ready but has neither wvrun nor the baked catalog, so conflating the
// two would enable controls that can only fail. Generation invalidates a probe from an older guest.
const dockerRuntime = {
  status: "unknown", // unknown | booting | checking | available | unavailable | error
  error: "",
  code: "",
  probe: null,
  booting: false,
  pullNotice: "",
  alpineStatus: "unknown", // unknown | checking | present | absent
  alpineProbe: null,
  generation: 0,
};

// The catalog is intentionally independent from the runtime probe. A guest can be ready while its
// userland is still the busybox initramfs, so a successful shell probe is not permission to render
// image rows or claim that a detached run exists.
const dockerCatalog = {
  status: "unknown", // unknown | loading | available | error
  error: "",
  code: "",
  raw: null,
  entries: [],
  promise: null,
  generation: 0,
  selected: null,
  lastRun: null,
  runSeq: 0,
  runNameOverride: "",
};

// ── DOM assembly ─────────────────────────────────────────────────────────────
const root = document.getElementById("ide-root");
if (root) {
  root.innerHTML = `
    <div class="ide-body">
      <div class="ide-activity">
        <button class="ide-act-btn active" id="ide-act-files" title="Files">📁</button>
        <button class="ide-act-btn" id="ide-act-docker" title="Docker">🐳</button>
        <div class="ide-act-spacer"></div>
        <button class="ide-act-btn" id="ide-act-collapse" title="Toggle sidebar">⟨⟩</button>
      </div>
      <div class="ide-side" id="ide-side">
        <div class="ide-side-title" id="ide-side-title">Explorer</div>
        <div class="ide-side-view active" id="ide-view-files">
          <div id="ide-explorer"></div>
          <div class="ide-side-ft" id="ide-side-ft"></div>
        </div>
        <div class="ide-side-view" id="ide-view-docker">
          <div class="ide-dk" id="ide-dk"></div>
        </div>
      </div>
      <div class="ide-vsplit" id="ide-vsplit" title="Drag to resize the sidebar"></div>
      <div class="ide-editor-area">
        <div class="ide-tabstrip" id="ide-tabstrip"></div>
        <div class="ide-editor-toolbar">
          <span class="ide-crumb" id="ide-crumb">No file open</span>
          <span class="ide-status" id="ide-status"></span>
          <button class="ide-save" id="ide-save" disabled>Save</button>
        </div>
        <div class="ide-editor-body" id="ide-editor-body">
          <div id="ide-editor-wrap">
            <div class="ide-gutter" id="ide-gutter">1</div>
            <textarea class="ide-textarea" id="ide-textarea" spellcheck="false" disabled></textarea>
          </div>
          <div class="ide-editor-ph" id="ide-editor-ph"></div>
        </div>
      </div>
    </div>
    <div class="ide-hsplit" id="ide-hsplit" title="Drag to resize the terminal"></div>
    <div class="ide-term-pane" id="ide-term-pane">
      <div class="ide-term-bar">
        <span>TERMINAL — guest shell (ttyS0)</span>
        <span class="ide-term-who" id="ide-term-who" hidden></span>
        <span class="sp"></span>
        <button class="ide-mini" id="ide-term-clear">Clear</button>
      </div>
      <div class="ide-term-scroll" id="ide-term-scroll"></div>
    </div>
    <div class="ide-statusbar" id="ide-statusbar">
      <span class="ide-sb-item" id="ide-sb-guest"><span class="ide-sb-dot" id="ide-sb-dot"></span><span id="ide-sb-guest-txt">booting…</span></span>
      <span class="ide-sb-sp"></span>
      <span class="ide-sb-item btn" id="ide-sb-net"><span class="ide-sb-dot off"></span><span id="ide-sb-net-txt">Network: offline</span></span>
      <div class="ide-net-pop" id="ide-net-pop"></div>
    </div>`;

  const q = (s) => root.querySelector(s);
  const explorerEl = q("#ide-explorer");
  const gutterEl = q("#ide-gutter");
  const taEl = q("#ide-textarea");
  const wrapEl = q("#ide-editor-wrap");
  const editorPh = q("#ide-editor-ph");
  const editorBody = q("#ide-editor-body");
  const crumbEl = q("#ide-crumb");
  const statusEl = q("#ide-status");
  const saveBtn = q("#ide-save");
  const tabstripEl = q("#ide-tabstrip");
  const dkEl = q("#ide-dk");

  // ── Re-parent live DOM nodes (keeps main.js / file-transfer / tailscale wiring intact) ──
  const consoleSection = document.querySelector("#panel-ide > .console");
  if (consoleSection) q("#ide-term-scroll").appendChild(consoleSection);
  const ftNode = document.getElementById("file-transfer");
  if (ftNode) q("#ide-side-ft").appendChild(ftNode);
  const netNode = document.querySelector(".network-config");
  if (netNode) q("#ide-net-pop").appendChild(netNode);

  const api = () => window.wvmDemo;
  const ready = () => !!(api() && api().isGuestReady && api().isGuestReady());
  // Explorer/Docker RPCs are control-plane work. Keep their fenced shell echo and marker out of
  // the user's foreground terminal; the returned stdout is rendered in the owning pane instead.
  const bgExec = (cmd, timeoutMs) => api().exec(cmd, timeoutMs, { quiet: true });

  function selectedProvider() {
    const value = document.getElementById("network-provider")?.value;
    return value || "offline";
  }

  function guestUp() {
    return !!(api()?.isGuestUp && api().isGuestUp());
  }

  function alpineAssetsPresent() {
    return dockerRuntime.alpineStatus === "present" ||
      !!(api()?.alpineArtifactsPresent && api().alpineArtifactsPresent());
  }

  function setDockerError(code, message) {
    dockerRuntime.status = "error";
    dockerRuntime.code = code;
    dockerRuntime.error = message;
  }

  // main.js has its own load-time probe, but the Docker view needs a tri-state result. A false
  // value before that probe settles would otherwise disable the only in-tab Alpine button during
  // the short window in which a real local manifest is still being fetched. This independent
  // manifest check is still fail-closed: only a valid artifacts object counts as present.
  function probeAlpineAssets() {
    if (dockerRuntime.alpineStatus === "present") return Promise.resolve(true);
    if (dockerRuntime.alpineStatus === "absent") return Promise.resolve(false);
    if (dockerRuntime.alpineProbe) return dockerRuntime.alpineProbe;
    dockerRuntime.alpineStatus = "checking";
    const probe = fetch("./artifacts-alpine.json", { cache: "no-store" })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok || text.trimStart().startsWith("<")) return false;
        try {
          const manifest = JSON.parse(text);
          return Boolean(manifest?.artifacts?.kernel && manifest?.artifacts?.rootfs);
        } catch {
          return false;
        }
      })
      .catch(() => false);
    dockerRuntime.alpineProbe = probe;
    void probe.then((present) => {
      dockerRuntime.alpineProbe = null;
      dockerRuntime.alpineStatus = present ? "present" : "absent";
      if (sideView === "docker") renderDocker();
    });
    return probe;
  }

  function runtimeReady() {
    return ready() && dockerRuntime.status === "available";
  }

  function resetDockerCatalog() {
    dockerCatalog.status = "unknown";
    dockerCatalog.error = "";
    dockerCatalog.code = "";
    dockerCatalog.raw = null;
    dockerCatalog.entries = [];
    dockerCatalog.promise = null;
    dockerCatalog.generation = dockerRuntime.generation;
    dockerCatalog.selected = null;
    dockerCatalog.lastRun = null;
    dockerCatalog.runNameOverride = "";
  }

  function catalogItems(raw) {
    if (Array.isArray(raw)) return raw.map((item) => ({ item, key: "" }));
    if (!raw || typeof raw !== "object") return [];
    for (const key of ["images", "entries", "catalog", "items"]) {
      if (Array.isArray(raw[key])) return raw[key].map((item) => ({ item, key: "" }));
    }
    if (raw.repo || raw.repository || raw.ref || raw.name || raw.bundlePath || raw.bundle) {
      return [{ item: raw, key: "" }];
    }
    return Object.entries(raw)
      .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
      .map(([key, item]) => ({ item, key }));
  }

  function splitImageRef(value, fallbackName) {
    const ref = String(value || fallbackName || "").trim();
    if (!ref) return { repo: "image", tag: "latest" };
    const at = ref.indexOf("@");
    const withoutDigest = at === -1 ? ref : ref.slice(0, at);
    const colon = withoutDigest.lastIndexOf(":");
    if (colon > withoutDigest.lastIndexOf("/")) {
      return { repo: withoutDigest.slice(0, colon), tag: withoutDigest.slice(colon + 1) || "latest" };
    }
    return { repo: withoutDigest, tag: "latest" };
  }

  function validCatalogName(value) {
    return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
  }

  function normalizeCatalog(raw) {
    return catalogItems(raw).map(({ item, key }, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`invalid guest catalog entry at index ${index}`);
      }
      const source = { ...item };
      const refValue = source.ref || source.image || source.reference || "";
      const parsed = splitImageRef(refValue, source.repo || source.repository || source.name || key);
      const name = String(source.name || source.id || "").trim();
      if (!validCatalogName(name)) throw new Error(`invalid guest image name at index ${index}`);
      const repo = String(source.repo || source.repository || name || parsed.repo || key);
      const tag = String(source.tag || parsed.tag || "latest");
      const bundleValue = source.bundlePath || source.bundle || source.bundle_dir || source.path || "";
      const bundlePath = bundleValue
        ? String(bundleValue).startsWith("/")
          ? String(bundleValue)
          : `/opt/containers/${String(bundleValue).replace(/^\.\//, "")}`
        : `/opt/containers/${name}`;
      if (!/^\/opt\/containers\/[A-Za-z0-9._-]{1,128}$/.test(bundlePath)) {
        throw new Error(`invalid guest bundle path for ${name}`);
      }
      const rootfsBytes = source.rootfsBytes ?? source.rootfs_bytes ?? source.sizeBytes ?? null;
      const rootfsEntries = source.rootfsEntries ?? source.rootfs_entries ?? source.entries ?? null;
      const manifestDigest = source.manifestDigest ?? source.manifest_digest ?? source.digest ?? "";
      const smokeCommand = source.smokeCommand ?? source["smoke-command"] ?? source.smoke ?? "";
      const runStatus = source.runStatus ?? source["run-status"] ?? source.status ?? "";
      return {
        key: `${name}:${String(source.ref || `${repo}:${tag}`)}:${index}`,
        name,
        repo,
        tag,
        ref: String(source.ref || `${repo}:${tag}`),
        arch: source.arch == null && source.architecture == null
          ? ""
          : String(source.arch ?? source.architecture),
        libc: source.libc == null ? "" : String(source.libc),
        manifestDigest: manifestDigest ? String(manifestDigest) : "",
        rootfsBytes,
        rootfsEntries,
        entry: "",
        configArgv: "",
        bundlePresent: null,
        bundleError: "",
        entryElf: String(source.entryElf || source.entry_elf || ""),
        bundlePath,
        smokeCommand: String(smokeCommand),
        runStatus: String(runStatus),
        runnable: source.runnable !== false && !/^(skip|failed)$/i.test(String(runStatus)),
        desc: String(source.desc || source.description || "Guest catalog entry"),
        raw: source,
      };
    });
  }

  function bundleMetadataCommand(bundlePath) {
    const bundle = dockerShq(bundlePath);
    return `bundle=${bundle}; if test -d "$bundle/rootfs" && test -f "$bundle/config/argv"; then ` +
      `printf '%s\\n' __WVIMG_BUNDLE_OK__; printf '%s\\n' __WVIMG_ARGV_BEGIN__; ` +
      `cat "$bundle/config/argv"; printf '%s\\n' __WVIMG_ARGV_END__; ` +
      `else printf '%s\\n' __WVIMG_BUNDLE_MISSING__; false; fi`;
  }

  function parseBundleMetadata(stdout) {
    const lines = String(stdout || "").split("\n").map((line) => line.replace(/\r$/, ""));
    const begin = lines.indexOf("__WVIMG_ARGV_BEGIN__");
    const end = lines.indexOf("__WVIMG_ARGV_END__", begin + 1);
    if (!lines.includes("__WVIMG_BUNDLE_OK__") || begin === -1 || end === -1 || end < begin) {
      return null;
    }
    const configArgv = lines.slice(begin + 1, end).join("\n").trim();
    return { configArgv, entry: configArgv };
  }

  async function loadGuestBundleMetadata(entries, generation) {
    for (const image of entries) {
      if (generation !== dockerRuntime.generation) return false;
      try {
        const res = await bgExec(bundleMetadataCommand(image.bundlePath), 30000);
        const metadata = res.exit === 0 ? parseBundleMetadata(res.stdout) : null;
        if (metadata) {
          image.bundlePresent = true;
          image.bundleError = "";
          image.configArgv = metadata.configArgv;
          image.entry = metadata.entry;
        } else {
          image.bundlePresent = false;
          image.runnable = false;
          image.bundleError = String(res.stdout || "bundle metadata is unavailable").trim() ||
            `guest exited ${res.exit}`;
        }
      } catch (error) {
        image.bundlePresent = false;
        image.runnable = false;
        image.bundleError = error?.message || String(error);
      }
    }
    return true;
  }

  function loadDockerCatalog() {
    if (!runtimeReady()) return Promise.resolve(false);
    if (dockerCatalog.status === "available") return Promise.resolve(true);
    if (dockerCatalog.promise) return dockerCatalog.promise;
    const generation = dockerRuntime.generation;
    dockerCatalog.status = "loading";
    dockerCatalog.error = "";
    dockerCatalog.code = "";
    const request = Promise.resolve()
      .then(() => bgExec("cat /opt/containers/index.json", 30000))
      .then(async (res) => {
        if (generation !== dockerRuntime.generation) return false;
        if (res.exit !== 0) throw new Error(res.stdout?.trim() || `cat exited ${res.exit}`);
        let raw;
        try {
          raw = JSON.parse(res.stdout);
        } catch (error) {
          throw new Error(`invalid guest catalog JSON: ${error.message || error}`);
        }
        const entries = normalizeCatalog(raw);
        if (!entries.length) throw new Error("guest catalog contains no image entries");
        if (!(await loadGuestBundleMetadata(entries, generation))) return false;
        dockerCatalog.raw = raw;
        dockerCatalog.entries = entries;
        dockerCatalog.generation = generation;
        dockerCatalog.status = "available";
        return true;
      })
      .catch((error) => {
        if (generation === dockerRuntime.generation) {
          dockerCatalog.status = "error";
          dockerCatalog.code = "CATALOG_LOAD_FAILED";
          dockerCatalog.error = error?.message || String(error);
        }
        return false;
      });
    dockerCatalog.promise = request;
    void request.then(() => {
      if (generation !== dockerRuntime.generation) return;
      dockerCatalog.promise = null;
      if (sideView === "docker") renderDocker();
    });
    return request;
  }

  function resetDockerRuntime(status = "unknown") {
    // The main boot path emits wvm:guest-booting synchronously after the Docker button has
    // claimed an Alpine boot. Preserve that claim so the event cannot re-enable the button or
    // invalidate the promise that will report the typed boot result.
    const bootInProgress = dockerRuntime.booting;
    if (!bootInProgress) dockerRuntime.generation += 1;
    dockerRuntime.status = bootInProgress ? "booting" : status;
    dockerRuntime.error = "";
    dockerRuntime.code = "";
    dockerRuntime.probe = null;
    dockerRuntime.booting = bootInProgress;
    dockerRuntime.pullNotice = "";
    resetDockerCatalog();
  }

  function probeDockerRuntime() {
    const current = api();
    if (!current || typeof current.hasContainerRuntime !== "function") {
      setDockerError("DOCKER_BRIDGE_UNAVAILABLE", "The guest bridge is still loading; container capability is unknown.");
      return Promise.resolve(false);
    }
    if (!ready()) {
      dockerRuntime.status = guestUp() ? "booting" : "unknown";
      return Promise.resolve(false);
    }
    if (dockerRuntime.probe) return dockerRuntime.probe;
    if (dockerRuntime.status === "available") return Promise.resolve(true);

    const generation = dockerRuntime.generation;
    dockerRuntime.status = "checking";
    dockerRuntime.error = "";
    dockerRuntime.code = "";
    const probe = Promise.resolve()
      .then(() => current.hasContainerRuntime())
      .then((present) => {
        if (generation !== dockerRuntime.generation) return false;
        dockerRuntime.status = present ? "available" : "unavailable";
        dockerRuntime.code = present ? "" : "RUNTIME_ABSENT";
        dockerRuntime.error = present
          ? ""
          : "The booted guest has no executable /usr/local/bin/wvrun and no /opt/containers/index.json.";
        return present;
      })
      .catch((error) => {
        if (generation === dockerRuntime.generation) {
          setDockerError("RUNTIME_PROBE_FAILED", error?.message || String(error));
        }
        return false;
      });
    dockerRuntime.probe = probe;
    void probe.then(() => {
      if (generation !== dockerRuntime.generation) return;
      dockerRuntime.probe = null;
      if (sideView === "docker") {
        renderDocker();
        if (runtimeReady()) startPsPoll();
        else stopPsPoll();
      }
    });
    return probe;
  }

  function bootAlpineFromDocker() {
    const current = api();
    if (dockerRuntime.booting) return;
    if (!current || typeof current.bootAlpine !== "function") {
      setDockerError("ALPINE_BRIDGE_UNAVAILABLE", "The Alpine boot bridge is still loading.");
      renderDocker();
      return;
    }

    const generation = ++dockerRuntime.generation;
    dockerRuntime.status = "booting";
    dockerRuntime.error = "";
    dockerRuntime.code = "";
    dockerRuntime.booting = true;
    dockerRuntime.probe = null;
    renderDocker();
    void Promise.resolve()
      .then(() => probeAlpineAssets())
      .then((present) => {
        if (generation !== dockerRuntime.generation) return null;
        if (!present) {
          setDockerError(
            "ALPINE_ARTIFACTS_UNAVAILABLE",
            "Alpine artifacts are not deployed here; the public build exposes the catalog only. Clone the repo and run: bash tools/serve-dev.sh",
          );
          dockerRuntime.booting = false;
          renderDocker();
          return null;
        }
        return current.bootAlpine();
      })
      .then((outcome) => {
        if (outcome === null) return;
        if (generation !== dockerRuntime.generation) return;
        dockerRuntime.booting = false;
        if (!outcome?.ok) {
          setDockerError(
            outcome?.conflict ? "GUEST_CONFLICT" : "ALPINE_BOOT_FAILED",
            outcome?.error || "Alpine boot was refused.",
          );
        } else if (ready()) {
          dockerRuntime.status = "unknown";
          dockerRuntime.code = "";
          void probeDockerRuntime();
        } else {
          // bootAlpine() owns setup before the shell prompt; the ready event will trigger the probe.
          dockerRuntime.status = "booting";
        }
        renderDocker();
      })
      .catch((error) => {
        if (generation !== dockerRuntime.generation) return;
        dockerRuntime.booting = false;
        setDockerError("ALPINE_BOOT_FAILED", error?.message || String(error));
        renderDocker();
      });
  }

  function renderDockerRuntimeState() {
    const box = mk("div", "ide-dk-runtime");
    box.id = "ide-dk-runtime";
    const title = mk("div", "ide-dk-h", "Guest runtime");
    box.appendChild(title);
    const status = mk("div", "ide-dk-runtime-status");
    status.id = "ide-dk-runtime-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.dataset.state = dockerRuntime.status;
    if (dockerRuntime.code) status.dataset.code = dockerRuntime.code;
    const current = api();
    const hasGuest = guestUp();
    const hasAlpine = dockerRuntime.alpineStatus === "present";
    if (!current) {
      status.textContent = "Loading the guest bridge…";
    } else if (dockerRuntime.status === "error") {
      status.textContent = `Container bootstrap failed${dockerRuntime.code ? ` (${dockerRuntime.code})` : ""}: ${dockerRuntime.error}`;
    } else if (!hasGuest && dockerRuntime.alpineStatus === "absent") {
      status.textContent = "Alpine runtime unavailable on this host; public busybox build is catalog-only.";
    } else if (!hasGuest && dockerRuntime.alpineStatus === "checking") {
      status.textContent = "Checking for the local Alpine runtime artifacts…";
    } else if (!hasGuest) {
      status.textContent = "Guest offline — boot Alpine here to enable real container controls.";
    } else if (!ready() || dockerRuntime.status === "booting") {
      status.textContent = "Booting the real Alpine guest… container controls stay locked until the shell is ready.";
    } else if (dockerRuntime.status === "checking") {
      status.textContent = "Checking /usr/local/bin/wvrun and /opt/containers/index.json in the guest…";
    } else if (dockerRuntime.status === "available") {
      status.textContent = "Container runtime ready — controls are backed by the booted guest.";
    } else {
      status.textContent = "Runtime absent in this guest — the catalog remains available, but lifecycle controls are disabled.";
    }
    box.appendChild(status);

    if (dockerRuntime.error) box.appendChild(mk("div", "ide-dk-note", dockerRuntime.error));

    if (!runtimeReady()) {
      const boot = mk("button", "ide-mini run", dockerRuntime.booting ? "Booting Alpine…" : "Boot Alpine guest");
      boot.id = "ide-dk-boot-alpine";
      boot.dataset.action = "boot-alpine";
      boot.disabled = dockerRuntime.booting || dockerRuntime.status === "booting" ||
        dockerRuntime.alpineStatus === "checking" || dockerRuntime.alpineStatus === "absent" || !current?.bootAlpine;
      boot.title = dockerRuntime.alpineStatus === "absent"
        ? "Alpine artifacts are not deployed on this host"
        : hasGuest && ready() && dockerRuntime.status === "unavailable"
          ? "The current guest is ready but has no container runtime; reload with ?guest=alpine to switch guests"
          : "Start the real chunked Alpine guest; no fallback shell is used";
      boot.addEventListener("click", bootAlpineFromDocker);
      box.appendChild(boot);
    }

    const provider = selectedProvider();
    const pull = mk("button", "ide-mini", "Pull");
    pull.id = "ide-dk-pull";
    pull.dataset.action = "pull";
    pull.dataset.progress = "none";
    pull.addEventListener("click", () => {
      dockerRuntime.pullNotice = provider === "offline"
        ? "Live pull is unavailable while Network is offline. The rows below are the baked guest set; configure a relay/tailscale provider before requesting a registry pull."
        : `Network provider ${provider} is selected, but live registry pull is not part of this bootstrap slice; no pull was attempted.`;
      renderDocker();
    });
    box.appendChild(pull);
    const pullState = dockerRuntime.pullNotice || (provider === "offline"
      ? "Live pull is unavailable while Network is offline. The baked guest set is available; configure a relay/tailscale provider before requesting a registry pull. No download progress or layers are shown because no pull is running."
      : `Network provider ${provider} is selected, but live registry pull is not part of this bootstrap slice; no pull was attempted and no progress is shown.`);
    box.appendChild(mk("div", "ide-dk-note", pullState));
    return box;
  }

  // ── Activity bar / sidebar ──────────────────────────────────────────────────
  const sideEl = q("#ide-side");
  const sideTitle = q("#ide-side-title");
  let sideView = "files"; // files | docker
  function selectSideView(view) {
    sideView = view;
    if (sideEl.classList.contains("collapsed")) sideEl.classList.remove("collapsed");
    q("#ide-act-files").classList.toggle("active", view === "files");
    q("#ide-act-docker").classList.toggle("active", view === "docker");
    q("#ide-view-files").classList.toggle("active", view === "files");
    q("#ide-view-docker").classList.toggle("active", view === "docker");
    sideTitle.textContent = view === "files" ? "Explorer" : "Docker";
    if (view === "docker") { renderDocker(); startPsPoll(); } else { stopPsPoll(); }
  }
  q("#ide-act-files").addEventListener("click", () => selectSideView("files"));
  q("#ide-act-docker").addEventListener("click", () => selectSideView("docker"));
  q("#ide-act-collapse").addEventListener("click", () => sideEl.classList.toggle("collapsed"));

  // ── Terminal toolbar + AUTO-FIT ─────────────────────────────────────────────
  q("#ide-term-clear").addEventListener("click", () => window.__term?.clear?.());
  // Fit the terminal to its pane automatically — on window resize AND when the pane is resized
  // (dragged) or the Demo tab becomes visible. No manual "Fit" button. Debounced.
  let fitTimer = null;
  const autoFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { try { window.__term?.fitNow?.(); } catch {} }, 80); };
  window.addEventListener("resize", autoFit);
  try { new ResizeObserver(autoFit).observe(document.getElementById("ide-term-pane")); } catch {}
  // Re-fit when the Demo tab is shown (it may have been display:none, so xterm couldn't size).
  document.querySelector('.tab[data-tab="ide"]')?.addEventListener("click", autoFit);
  window.addEventListener("hashchange", () => { if (location.hash.slice(1) === "ide") autoFit(); });
  autoFit();

  // ── Resizable panels: drag the sidebar width (vsplit) and the terminal height (hsplit) ─────────
  function makeDrag(handle, target, axis) {
    if (!handle || !target) return;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startPos = axis === "x" ? e.clientX : e.clientY;
      const r = target.getBoundingClientRect();
      const startSize = axis === "x" ? r.width : r.height;
      handle.classList.add("drag");
      document.body.style.userSelect = "none";
      const move = (ev) => {
        if (axis === "x") {
          const w = Math.max(140, Math.min(640, startSize + (ev.clientX - startPos)));
          target.style.flex = "0 0 " + w + "px";
        } else {
          // hsplit sits above the terminal; dragging UP grows the terminal.
          const h = Math.max(80, Math.min(window.innerHeight - 180, startSize - (ev.clientY - startPos)));
          target.style.height = h + "px";
        }
        autoFit();
      };
      const up = () => {
        handle.classList.remove("drag");
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        autoFit();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }
  makeDrag(q("#ide-vsplit"), q("#ide-side"), "x");
  makeDrag(q("#ide-hsplit"), q("#ide-term-pane"), "y");

  // ── Status bar: guest + network ─────────────────────────────────────────────
  const sbDot = q("#ide-sb-dot");
  const sbGuestTxt = q("#ide-sb-guest-txt");
  function refreshGuestStatus() {
    const up = api() && api().isGuestUp && api().isGuestUp();
    const rdy = ready();
    sbDot.className = "ide-sb-dot" + (rdy ? " ready" : "");
    sbGuestTxt.textContent = rdy ? "guest ready" : up ? "booting…" : "guest offline";
  }
  const netPop = q("#ide-net-pop");
  const netTxt = q("#ide-sb-net-txt");
  const netDot = q("#ide-sb-net .ide-sb-dot");
  q("#ide-sb-net").addEventListener("click", (e) => { e.stopPropagation(); netPop.classList.toggle("open"); });
  document.addEventListener("click", (e) => { if (!netPop.contains(e.target) && !q("#ide-sb-net").contains(e.target)) netPop.classList.remove("open"); });
  function refreshNet() {
    const sel = document.getElementById("network-provider");
    const v = sel ? sel.value : "offline";
    const label = v === "offline"
      ? "offline"
      : v === "websocket"
        ? "websocket"
        : v === "relay"
          ? "private wvrelay"
          : v === "headscale"
            ? "private Headscale"
            : "public Tailscale / DERP";
    netTxt.textContent = "Network: " + label;
    netDot.className = "ide-sb-dot" + (v === "offline" ? " off" : " ready");
  }
  document.getElementById("network-provider")?.addEventListener("change", refreshNet);
  refreshNet();

  // ── Editor: multi-tab model ─────────────────────────────────────────────────
  // tab: { key, type:'file'|'container', title, ... }
  //   file:      { path, savedText, value, scrollTop, loaded }
  //   container: { id, name, image, panelEl, logsEl, follow, poll }
  const tabs = [];
  let activeKey = null;
  const tabByKey = (k) => tabs.find((t) => t.key === k);
  const activeTab = () => tabByKey(activeKey);

  function setStatus(msg, cls) {
    statusEl.textContent = msg || "";
    statusEl.className = "ide-status" + (cls ? " " + cls : "");
  }
  function isDirty(t) { return t && t.type === "file" && t.loaded && t.value !== t.savedText; }
  function refreshSave() {
    const t = activeTab();
    saveBtn.disabled = !isDirty(t);
    renderTabs();
  }
  function syncGutter() {
    const lines = taEl.value.split("\n").length || 1;
    let s = "";
    for (let i = 1; i <= lines; i++) s += i + "\n";
    gutterEl.textContent = s;
    gutterEl.scrollTop = taEl.scrollTop;
  }
  taEl.addEventListener("input", () => {
    const t = activeTab();
    if (t && t.type === "file") t.value = taEl.value;
    syncGutter(); refreshSave();
  });
  taEl.addEventListener("scroll", () => { gutterEl.scrollTop = taEl.scrollTop; });

  function renderTabs() {
    tabstripEl.replaceChildren();
    for (const t of tabs) {
      const el = document.createElement("div");
      el.className = "ide-tab" + (t.key === activeKey ? " active" : "");
      const icon = t.type === "container" ? "🐳" : "📄";
      const nm = document.createElement("span");
      nm.className = "t-nm";
      nm.textContent = `${icon} ${t.title}`;
      el.appendChild(nm);
      if (isDirty(t)) { const d = document.createElement("span"); d.className = "t-dirty"; d.textContent = "●"; el.appendChild(d); }
      const close = document.createElement("span");
      close.className = "t-close"; close.textContent = "✕";
      close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.key); });
      el.appendChild(close);
      el.addEventListener("click", () => activateTab(t.key));
      tabstripEl.appendChild(el);
    }
  }

  function closeTab(key) {
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx === -1) return;
    const t = tabs[idx];
    if (isDirty(t) && !confirm("Discard unsaved changes to " + t.path + "?")) return;
    if (t.type === "container") { clearInterval(t.poll); t.panelEl?.remove(); }
    tabs.splice(idx, 1);
    if (activeKey === key) {
      const next = tabs[idx] || tabs[idx - 1] || null;
      activeKey = null;
      if (next) activateTab(next.key); else showNoTab();
    }
    renderTabs();
  }

  function showNoTab() {
    activeKey = null;
    wrapEl.style.display = "none";
    for (const p of editorBody.querySelectorAll(".ide-ctr-panel")) p.classList.remove("active");
    editorPh.style.display = "";
    editorPh.innerHTML = ready()
      ? "Open a file from the Explorer, or a container from the Docker view."
      : `<span class="ide-spin">◠</span> Booting the Linux guest… open a file once the shell is ready.`;
    crumbEl.textContent = "No file open";
    setStatus("");
    saveBtn.disabled = true;
    renderTabs();
  }

  function activateTab(key) {
    const t = tabByKey(key);
    if (!t) return;
    // stash outgoing file editor state
    const prev = activeTab();
    if (prev && prev.type === "file") { prev.value = taEl.value; prev.scrollTop = taEl.scrollTop; }
    activeKey = key;
    editorPh.style.display = "none";
    for (const p of editorBody.querySelectorAll(".ide-ctr-panel")) p.classList.remove("active");
    if (t.type === "file") {
      wrapEl.style.display = "";
      crumbEl.innerHTML = "<b>" + t.path + "</b>";
      if (t.loaded) {
        taEl.value = t.value; taEl.disabled = false;
        syncGutter(); taEl.scrollTop = t.scrollTop || 0;
        setStatus(isDirty(t) ? "modified" : "", isDirty(t) ? "" : "ok");
      } else {
        taEl.value = ""; taEl.disabled = true; setStatus("opening…");
      }
      // sync tree selection
      for (const n of explorerEl.querySelectorAll(".ide-node.sel")) n.classList.remove("sel");
    } else {
      wrapEl.style.display = "none";
      crumbEl.innerHTML = `<b>🐳 ${t.name}</b> <span class="id">${t.id}</span>`;
      t.panelEl.classList.add("active");
      setStatus("");
    }
    refreshSave();
  }

  // ── guest command helpers ────────────────────────────────────────────────
  const shq = (p) => "'" + String(p).replace(/'/g, "'\\''") + "'";
  function joinPath(dir, name) { return dir === "/" ? "/" + name : dir + "/" + name; }

  function parseLs(out) {
    const rows = [];
    for (const raw of out.split("\n")) {
      const line = raw.trimEnd();
      if (!line || /^total\b/.test(line)) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      const perms = parts[0];
      let name = parts.slice(8).join(" ");
      const arrow = name.indexOf(" -> ");
      if (arrow !== -1) name = name.slice(0, arrow);
      if (name === "." || name === "..") continue;
      const tt = perms[0];
      rows.push({ name, type: tt === "d" ? "dir" : tt === "l" ? "link" : "file", perms });
    }
    rows.sort((a, b) => (a.type === "dir") === (b.type === "dir")
      ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
    return rows;
  }
  async function listDir(dir) {
    const res = await bgExec("ls -la " + shq(dir), 30000);
    if (res.exit !== 0) throw new Error(res.stdout.trim() || ("cannot read " + dir));
    return parseLs(res.stdout);
  }

  // ── explorer rendering ───────────────────────────────────────────────────
  function makeNode(entry, dir, depth) {
    const path = joinPath(dir, entry.name);
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "ide-node"; row.dataset.path = path;
    const isDir = entry.type === "dir";
    const tw = document.createElement("span"); tw.className = "tw"; tw.textContent = isDir ? "▸" : "";
    const ic = document.createElement("span"); ic.className = "ic";
    ic.textContent = isDir ? "📁" : entry.type === "link" ? "🔗" : "📄";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = entry.name;
    row.append(tw, ic, nm); li.appendChild(row);
    let childUl = null;
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isDir) {
        if (childUl) {
          const open = childUl.style.display !== "none";
          childUl.style.display = open ? "none" : "";
          tw.textContent = open ? "▸" : "▾";
          return;
        }
        tw.innerHTML = '<span class="ide-spin">◠</span>';
        try {
          const kids = await listDir(path);
          childUl = document.createElement("ul"); childUl.className = "ide-tree";
          for (const k of kids) childUl.appendChild(makeNode(k, path, depth + 1));
          li.appendChild(childUl); tw.textContent = "▾";
        } catch (err) { tw.textContent = "▸"; setStatus(String(err.message || err), "err"); }
      } else {
        openFile(path, row);
      }
    });
    return li;
  }

  async function loadTree() {
    explorerEl.innerHTML = `<div class="ide-explorer-ph"><span class="ide-spin">◠</span> Loading ${ROOT}…</div>`;
    try {
      const entries = await listDir(ROOT);
      const ul = document.createElement("ul"); ul.className = "ide-tree";
      for (const e of entries) ul.appendChild(makeNode(e, ROOT, 0));
      explorerEl.innerHTML = "";
      const head = document.createElement("div");
      head.className = "ide-node"; head.style.color = "#8fa3bf";
      head.innerHTML = `<span class="tw"></span><span class="ic">🗂️</span><span class="nm">${ROOT}</span>`;
      explorerEl.append(head, ul);
    } catch (err) {
      explorerEl.innerHTML = `<div class="ide-explorer-ph">Could not list <b>${ROOT}</b>:<br>${String(err.message || err)}</div>`;
    }
  }

  async function openFile(path, rowEl) {
    const key = "file:" + path;
    for (const n of explorerEl.querySelectorAll(".ide-node.sel")) n.classList.remove("sel");
    if (rowEl) rowEl.classList.add("sel");
    if (tabByKey(key)) { activateTab(key); return; }
    const t = { key, type: "file", title: path.split("/").pop() || path, path,
      savedText: "", value: "", scrollTop: 0, loaded: false };
    tabs.push(t);
    activateTab(key);
    try {
      const res = await bgExec("cat " + shq(path), 45000);
      if (res.exit !== 0) throw new Error(res.stdout.trim() || "cat failed");
      t.savedText = res.stdout; t.value = res.stdout; t.loaded = true;
      if (activeKey === key) {
        taEl.value = res.stdout; taEl.disabled = false;
        syncGutter(); setStatus("opened", "ok"); taEl.focus();
      }
      refreshSave();
    } catch (err) {
      if (activeKey === key) { setStatus(String(err.message || err), "err"); taEl.disabled = false; }
    }
  }

  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  async function save() {
    const t = activeTab();
    if (!t || t.type !== "file" || !ready()) return;
    saveBtn.disabled = true; setStatus("saving…");
    try {
      const b64 = toB64(taEl.value);
      const cmd = "printf %s " + shq(b64) + " | base64 -d > " + shq(t.path);
      const res = await bgExec(cmd, 60000);
      if (res.exit !== 0) throw new Error(res.stdout.trim() || ("write failed (exit " + res.exit + ")"));
      t.savedText = taEl.value; t.value = taEl.value;
      refreshSave(); setStatus("saved ✓", "ok");
    } catch (err) { setStatus(String(err.message || err), "err"); saveBtn.disabled = false; }
  }
  saveBtn.addEventListener("click", save);
  taEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });

  // ── Docker sidebar view ─────────────────────────────────────────────────────
  let psPoll = null;
  let psInFlight = false;
  function stopPsPoll() { clearInterval(psPoll); psPoll = null; }
  function startPsPoll() {
    stopPsPoll();
    if (!runtimeReady()) return;
    refreshContainers();
    psPoll = setInterval(refreshContainers, 6000);
  }

  function formatBytes(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "unknown");
    if (value < 1024 * 1024) return `${value} bytes`;
    return `${value} bytes (${(value / (1024 * 1024)).toFixed(1)} MiB)`;
  }

  function imageRunState(img) {
    const run = dockerCatalog.lastRun;
    if (!run || run.imageKey !== img.key) return null;
    const state = mk("div", "ide-dk-run-state");
    state.dataset.state = run.status;
    if (run.status === "starting") {
      state.textContent = `guest: wvrun run -d is accepting ${run.name}…`;
    } else if (run.status === "accepted") {
      state.textContent = `guest accepted detached run · id ${run.id}`;
    } else {
      state.textContent = `guest rejected detached run${run.code ? ` (${run.code})` : ""}` +
        `${run.exit != null ? ` · exit ${run.exit}` : ""}: ${run.error}`;
    }
    return state;
  }

  function renderImageInspect(img) {
    const detail = document.createElement("div");
    detail.className = "ide-dk-image-detail";
    detail.id = "ide-dk-inspect";
    detail.dataset.image = img.name || img.repo;
    detail.appendChild(mk("div", "title", `Inspect ${img.ref}`));
    const dl = document.createElement("dl");
    const fields = [
      ["Source", "/opt/containers/index.json (guest)"],
      ["Reference", img.ref],
      ["Architecture", img.arch || "not published by guest catalog"],
      ["libc", img.libc || "not published by guest catalog"],
      ["Manifest digest", img.manifestDigest || "not published by guest catalog"],
      ["Bundle", img.bundlePath],
      ["Bundle state", img.bundlePresent === true ? "verified in guest" : "unavailable in guest"],
      ["Entrypoint", img.entry || "no guest config/argv"],
      ["Rootfs", formatBytes(img.rootfsBytes)],
      ["Rootfs entries", img.rootfsEntries ?? "not published by guest catalog"],
    ];
    if (img.configArgv) fields.push(["Exact config/argv", img.configArgv.replace(/\n/g, " · ")]);
    if (img.entryElf) fields.push(["Entry ELF", img.entryElf]);
    if (img.smokeCommand) fields.push(["Smoke command", img.smokeCommand]);
    if (img.runStatus) fields.push(["Bake run status", img.runStatus]);
    fields.push(["Run command", `wvrun run -d --name <generated-name> ${img.bundlePath}`]);
    fields.push(["Provenance", "guest catalog + guest bundle config/argv"]);
    if (img.bundleError) fields.push(["Bundle error", img.bundleError]);
    const lastRun = dockerCatalog.lastRun?.imageKey === img.key ? dockerCatalog.lastRun : null;
    if (lastRun?.command) fields.push(["Last guest command", lastRun.command]);
    if (lastRun?.id) fields.push(["Guest identity", lastRun.id]);
    for (const [label, value] of fields) {
      const dt = mk("dt", null, label);
      const dd = mk("dd", null, value);
      dd.dataset.field = label.toLowerCase().replaceAll(" ", "-");
      dl.append(dt, dd);
    }
    detail.appendChild(dl);
    detail.appendChild(mk("pre", "ide-dk-inspect-raw", JSON.stringify(img.raw, null, 2)));
    return detail;
  }

  function catalogRows() {
    if (dockerCatalog.status === "available") return dockerCatalog.entries;
    if (!runtimeReady()) return DEGRADED_IMAGES;
    return [];
  }

  function renderDocker() {
    dkEl.replaceChildren();
    void probeAlpineAssets();
    if (ready() && dockerRuntime.status === "unknown") probeDockerRuntime();
    if (runtimeReady()) void loadDockerCatalog();
    dkEl.appendChild(renderDockerRuntimeState());
    // Images section
    const imgSec = document.createElement("div"); imgSec.className = "ide-dk-sec";
    imgSec.appendChild(mk("div", "ide-dk-h", "Images"));
    if (runtimeReady() && dockerCatalog.status !== "available") {
      if (dockerCatalog.status === "error") {
        const note = mk("div", "ide-dk-note", `Guest image catalog unavailable (${dockerCatalog.code}): ${dockerCatalog.error}`);
        const retry = mk("button", "ide-mini", "Retry catalog");
        retry.dataset.action = "retry-catalog";
        retry.addEventListener("click", () => {
          dockerCatalog.status = "unknown";
          renderDocker();
        });
        note.appendChild(document.createTextNode(" "));
        note.appendChild(retry);
        imgSec.appendChild(note);
      } else {
        imgSec.appendChild(mk("div", "ide-dk-note", "Loading the guest image catalog from /opt/containers/index.json…"));
      }
    } else if (!runtimeReady()) {
      imgSec.appendChild(mk("div", "ide-dk-note", "Guest catalog is unavailable; these are labels only until Alpine reports the real catalog."));
    }
    const rows = catalogRows();
    for (const img of rows) {
      const row = document.createElement("div"); row.className = "ide-dk-row";
      row.dataset.image = img.name || img.repo;
      row.dataset.ref = img.ref || "";
      const nm = document.createElement("div"); nm.className = "nm";
      nm.append(mk("span", null, img.name || img.repo), mk("span", "sub", ` ${img.ref || `${img.repo}:${img.tag}`}`));
      nm.title = img.desc;
      row.appendChild(nm);
      if (dockerCatalog.status === "available") {
        const inspect = mk("button", "ide-mini", dockerCatalog.selected === img.key ? "Close" : "Inspect");
        inspect.dataset.action = "inspect-image";
        inspect.dataset.image = img.name || img.repo;
        inspect.title = "Show the exact metadata returned by the guest catalog";
        inspect.addEventListener("click", () => {
          dockerCatalog.selected = dockerCatalog.selected === img.key ? null : img.key;
          renderDocker();
        });
        row.appendChild(inspect);
      }
      if (img.runnable && img.bundlePath && img.bundlePresent !== false) {
        const b = mk("button", "ide-mini run", "▶ Run");
        b.dataset.action = "run-image";
        b.dataset.image = img.name || img.repo;
        b.dataset.bundle = img.bundlePath;
        const runInFlight = dockerCatalog.lastRun?.imageKey === img.key &&
          dockerCatalog.lastRun?.status === "starting";
        b.disabled = !runtimeReady() || runInFlight;
        b.title = runInFlight
          ? "Waiting for the guest to accept the detached run"
          : runtimeReady()
            ? "Start as a detached wvrun container"
            : "Container runtime is not confirmed in the guest";
        if (runtimeReady()) b.addEventListener("click", () => runImage(img));
        row.appendChild(b);
      } else {
        row.appendChild(mk("span", "sub", img.bundleError ? "bundle unavailable" : "pull natively"));
      }
      imgSec.appendChild(row);
      const runState = imageRunState(img);
      if (runState) imgSec.appendChild(runState);
      if (dockerCatalog.selected === img.key) imgSec.appendChild(renderImageInspect(img));
    }
    dkEl.appendChild(imgSec);
    // Containers section
    const cSec = document.createElement("div"); cSec.className = "ide-dk-sec";
    cSec.appendChild(mk("div", "ide-dk-h", "Containers"));
    const list = document.createElement("div"); list.id = "ide-dk-clist";
    if (!runtimeReady()) {
      list.appendChild(mk("div", "ide-dk-note", "Container rows stay locked until the guest probe confirms wvrun and the baked catalog."));
    } else {
      list.appendChild(mk("div", "ide-dk-note", "loading (wvrun ps -a)…"));
    }
    cSec.appendChild(list);
    dkEl.appendChild(cSec);
    if (runtimeReady()) refreshContainers();
  }

  async function runImage(img) {
    if (!runtimeReady() || dockerCatalog.status !== "available" || !img.bundlePath ||
      img.bundlePresent === false || dockerCatalog.lastRun?.status === "starting") return;
    const { name, cmd } = wvrunRunCmd(img);
    dockerCatalog.lastRun = {
      imageKey: img.key, image: img.repo, name, command: cmd, status: "starting",
      id: "", exit: null, code: "", error: "", stdout: "",
    };
    renderDocker();
    try {
      const res = await bgExec(cmd, 60000);
      const exit = Number(res?.exit);
      if (!Number.isFinite(exit) || exit !== 0) {
        const raw = String(res?.stdout || "").trim();
        const detail = raw.replace(/\s+/g, " ");
        const error = new Error(detail || `wvrun exited ${res?.exit ?? "unknown"}`);
        error.code = /already in use/i.test(raw)
          ? "DUPLICATE_NAME"
          : /no rootfs|no such file|not found/i.test(raw)
            ? "BUNDLE_NOT_RUNNABLE"
            : /no entrypoint|no.*argv/i.test(raw)
              ? "ENTRYPOINT_MISSING"
              : "WVRUN_REJECTED";
        error.exit = res?.exit;
        error.stdout = raw;
        throw error;
      }
      const output = String(res?.stdout || "").trim();
      const identity = output.split(/\s+/).filter(Boolean).pop() || "";
      if (!/^[0-9a-f]{12}$/i.test(identity)) {
        const error = new Error(identity
          ? `wvrun returned an invalid container identity: ${identity}`
          : "wvrun returned success without a container identity");
        error.code = "RUN_PROTOCOL_FAILED";
        error.exit = exit;
        error.stdout = output;
        throw error;
      }
      dockerCatalog.lastRun = {
        ...dockerCatalog.lastRun, status: "accepted", id: identity, exit,
        stdout: output, error: "",
      };
      renderDocker();
      await refreshContainers();
    } catch (error) {
      dockerCatalog.lastRun = {
        ...dockerCatalog.lastRun, status: "failed", code: error?.code || "RUN_FAILED",
        exit: error?.exit ?? null, error: error?.message || String(error), stdout: error?.stdout || "",
      };
      renderDocker();
    }
  }

  async function refreshContainers() {
    if (sideView !== "docker" || !runtimeReady() || psInFlight) return;
    const list = document.getElementById("ide-dk-clist");
    if (!list) return;
    psInFlight = true;
    try {
      const res = await bgExec("wvrun ps -a", 30000);
      renderContainerList(list, parsePs(res.stdout));
    } catch (e) {
      list.replaceChildren(mk("div", "ide-dk-note", "wvrun ps failed: " + (e.message || e)));
    } finally { psInFlight = false; }
  }

  function renderContainerList(list, rows) {
    list.replaceChildren();
    if (!rows.length) { list.appendChild(mk("div", "ide-dk-note", "No containers. Run an image above.")); return; }
    for (const c of rows) {
      const row = document.createElement("div"); row.className = "ide-dk-row ide-dk-ctr";
      const dot = document.createElement("span");
      dot.className = "ide-dk-dot" + (c.status === "running" ? " running" : "");
      const nm = document.createElement("div"); nm.className = "nm";
      nm.innerHTML = `${c.name || c.id}<span class="sub"> ${c.status || ""}${c.exit ? " (" + c.exit + ")" : ""}</span>`;
      nm.title = (c.image || "") + " · " + c.id;
      row.append(dot, nm);
      row.addEventListener("click", () => openContainer(c));
      list.appendChild(row);
    }
  }

  // ── Container tabs (logs + exec) ─────────────────────────────────────────────
  function openContainer(c) {
    const key = "ctr:" + c.id;
    if (tabByKey(key)) { activateTab(key); return; }
    const panel = document.createElement("div"); panel.className = "ide-ctr-panel";
    panel.innerHTML = `
      <div class="ide-ctr-head">
        <span class="id">${c.image || ""} · ${c.id}</span>
        <span style="flex:1 1 auto"></span>
        <button class="ide-mini" data-a="refresh">↻ Logs</button>
        <label><input type="checkbox" data-a="follow"> Follow</label>
      </div>
      <pre class="ide-ctr-logs">loading logs…</pre>
      <form class="ide-ctr-exec">
        <span class="p">$</span>
        <input type="text" placeholder="exec a command in the container (e.g. ls -la /) — runs via wvrun exec" autocomplete="off" spellcheck="false" />
      </form>`;
    editorBody.appendChild(panel);
    const t = { key, type: "container", title: c.name || c.id, id: c.id, name: c.name || c.id,
      image: c.image || "", panelEl: panel, logsEl: panel.querySelector(".ide-ctr-logs"), poll: null };
    tabs.push(t);

    const refreshLogs = async () => {
      try {
        const res = await bgExec("wvrun logs " + shq(t.id), 30000);
        t.logsEl.textContent = res.stdout.trim() || "(no output yet)";
      } catch (e) { t.logsEl.textContent = "wvrun logs failed: " + (e.message || e); }
    };
    panel.querySelector('[data-a="refresh"]').addEventListener("click", refreshLogs);
    panel.querySelector('[data-a="follow"]').addEventListener("change", (e) => {
      clearInterval(t.poll); t.poll = null;
      if (e.target.checked) { refreshLogs(); t.poll = setInterval(refreshLogs, 2000); }
    });
    const execForm = panel.querySelector(".ide-ctr-exec");
    const execInput = execForm.querySelector("input");
    execForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cmd = execInput.value.trim();
      if (!cmd) return;
      t.logsEl.textContent += `\n$ ${cmd}\n`;
      execInput.value = "";
      try {
        const res = await bgExec("wvrun exec " + shq(t.id) + " sh -c " + shq(cmd), 45000);
        t.logsEl.textContent += (res.stdout || "") + (res.exit ? `[exit ${res.exit}]\n` : "");
      } catch (err) { t.logsEl.textContent += "exec failed: " + (err.message || err) + "\n"; }
      t.logsEl.scrollTop = t.logsEl.scrollHeight;
    });

    activateTab(key);
    renderTabs();
    refreshLogs();
  }

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── ready / not-ready state ────────────────────────────────────────────────
  function showBooting(event = null) {
    // The initial noAutoBoot render is offline, not an in-flight boot. Only the real lifecycle
    // event (or a Docker-tab boot already claimed by this UI) should lock the Alpine affordance.
    resetDockerRuntime(event?.type === "wvm:guest-booting" || dockerRuntime.booting ? "booting" : "unknown");
    explorerEl.innerHTML =
      `<div class="ide-explorer-ph"><span class="ide-spin">◠</span> Booting the Linux guest…<br>` +
      `the file explorer loads the guest filesystem when the shell is ready.</div>`;
    if (!tabs.length) showNoTab();
    refreshGuestStatus();
    if (sideView === "docker") renderDocker();
  }
  function showReady() {
    resetDockerRuntime("unknown");
    loadTree();
    if (!tabs.length) showNoTab();
    refreshGuestStatus();
    if (sideView === "docker") { renderDocker(); startPsPoll(); }
  }

  window.addEventListener("wvm:guest-ready", showReady);
  window.addEventListener("wvm:guest-booting", showBooting);

  document.getElementById("network-provider")?.addEventListener("change", () => {
    dockerRuntime.pullNotice = "";
    if (sideView === "docker") renderDocker();
  });

  if (new URLSearchParams(location.search).has("testHooks")) {
    window.__dockerStateForTest = () => ({
      runtime: dockerRuntime.status,
      error: dockerRuntime.error,
      code: dockerRuntime.code,
      booting: dockerRuntime.booting,
      provider: selectedProvider(),
      ready: ready(),
      guestUp: guestUp(),
      alpineAssets: alpineAssetsPresent(),
      alpineStatus: dockerRuntime.alpineStatus,
      catalogStatus: dockerCatalog.status,
      catalogError: dockerCatalog.error,
      catalog: dockerCatalog.entries.map((entry) => ({ ...entry, raw: entry.raw })),
      lastRun: dockerCatalog.lastRun,
    });
    window.__dockerCatalogForTest = () => ({
      status: dockerCatalog.status,
      error: dockerCatalog.error,
      code: dockerCatalog.code,
      raw: dockerCatalog.raw,
      entries: dockerCatalog.entries.map((entry) => ({ ...entry, raw: entry.raw })),
      lastRun: dockerCatalog.lastRun,
    });
    window.__dockerSetImageForTest = (repo, patch = {}) => {
      const image = dockerCatalog.entries.find((entry) => entry.repo === repo || entry.name === repo);
      if (!image || !patch || typeof patch !== "object") return false;
      Object.assign(image, patch);
      if (image.raw && typeof image.raw === "object") Object.assign(image.raw, patch);
      renderDocker();
      return true;
    };
    window.__dockerSetRunNameForTest = (name) => {
      dockerCatalog.runNameOverride = name == null ? "" : String(name);
      return dockerCatalog.runNameOverride;
    };
  }

  if (ready()) showReady(); else showBooting();
}
