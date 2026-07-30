// IDE tab — a VSCode-like experience powered entirely by the in-browser RISC-V Alpine guest.
//
// Three panes over the guest's REAL filesystem:
//   • left   — a file explorer (expandable tree), populated by `wvmDemo.exec('ls -la <dir>')`
//   • center — a code editor (line-numbered textarea); files load via `cat`, Save writes back
//   • bottom — the EXISTING #term xterm console, re-parented here (keystrokes + boot stay live)
//
// HONESTY: every byte shown comes from the real guest. There is NO synthetic filesystem, NO canned
// file contents. Until `wvmDemo.isGuestReady()` the explorer/editor show a clean "booting" state and
// the terminal below shows the live boot. Saving is byte-exact: the editor content is base64-encoded
// in JS and decoded in-guest (`printf %s '<b64>' | base64 -d > '<path>'`) so quotes/newlines/binary
// survive untouched.

const ROOT = "/root";

// ── styles (injected; no dependency on index.html CSS) ───────────────────────
const css = `
#ide-root { display: flex; flex-direction: column; height: min(78vh, 900px); min-height: 480px;
  border: 1px solid var(--line, #232a35); border-radius: 12px; overflow: hidden;
  background: var(--panel, #0d1117); color: var(--text, #d6deeb); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.ide-topbar { display: flex; align-items: center; gap: 10px; padding: 7px 12px;
  background: var(--panel-2, #151a22); border-bottom: 1px solid var(--line, #232a35); flex: 0 0 auto; }
.ide-crumb { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #8fa3bf; }
.ide-crumb b { color: #d6deeb; }
.ide-dirty { color: #f0c674; font-size: 15px; width: 10px; text-align: center; opacity: 0; }
.ide-dirty.on { opacity: 1; }
.ide-save { background: #234; color: #cfe3ff; border: 1px solid #2b5278; border-radius: 7px;
  padding: 5px 14px; cursor: pointer; font: inherit; }
.ide-save:hover:not(:disabled) { background: #2b5278; }
.ide-save:disabled { opacity: .4; cursor: not-allowed; }
.ide-status { color: #8fa3bf; font-size: 12px; min-width: 90px; }
.ide-status.err { color: #f0a0a0; }
.ide-status.ok { color: #9ad29a; }

.ide-main { display: flex; flex: 1 1 auto; min-height: 0; }
.ide-explorer { flex: 0 0 240px; overflow: auto; border-right: 1px solid var(--line, #232a35);
  background: var(--panel, #0d1117); padding: 4px 0; }
.ide-editor-wrap { flex: 1 1 auto; display: flex; min-width: 0; position: relative;
  background: #0b0f15; }

.ide-tree { list-style: none; margin: 0; padding: 0; }
.ide-tree .ide-tree { padding-left: 14px; }
.ide-node { display: flex; align-items: center; gap: 5px; padding: 3px 10px; cursor: pointer;
  white-space: nowrap; user-select: none; border-radius: 5px; }
.ide-node:hover { background: var(--panel-2, #151a22); }
.ide-node.sel { background: #1c2c44; color: #cfe3ff; }
.ide-node .tw { width: 12px; text-align: center; color: #5a6b82; font-size: 10px; flex: 0 0 auto; }
.ide-node .ic { flex: 0 0 auto; }
.ide-node .nm { overflow: hidden; text-overflow: ellipsis; }
.ide-explorer .placeholder, .ide-editor-wrap .placeholder {
  padding: 22px 18px; color: #7d8ba0; line-height: 1.6; font-size: 12.5px; }
.ide-editor-wrap .placeholder { margin: auto; text-align: center; max-width: 340px; }
.ide-spin { display: inline-block; animation: ide-spin 1s linear infinite; }
@keyframes ide-spin { to { transform: rotate(360deg); } }

.ide-gutter { flex: 0 0 auto; padding: 8px 8px 8px 12px; text-align: right; color: #4a5a72;
  background: #0b0f15; border-right: 1px solid var(--line, #232a35); user-select: none;
  overflow: hidden; white-space: pre; line-height: 1.5; font: inherit; }
.ide-textarea { flex: 1 1 auto; resize: none; border: 0; outline: 0; padding: 8px 12px;
  background: #0b0f15; color: #d6deeb; font: inherit; line-height: 1.5; tab-size: 4;
  white-space: pre; overflow: auto; }
.ide-textarea:disabled { color: #5a6b82; }

.ide-term-pane { flex: 0 0 auto; height: 300px; overflow: auto; border-top: 1px solid var(--line, #232a35);
  background: var(--panel, #0d1117); resize: vertical; }
.ide-term-pane .console { border: 0; border-radius: 0; margin: 0; }
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

// ── DOM assembly ─────────────────────────────────────────────────────────────
const root = document.getElementById("ide-root");
if (root) {
  root.innerHTML = `
    <div class="ide-topbar">
      <span class="ide-dirty" id="ide-dirty" title="Unsaved changes">●</span>
      <span class="ide-crumb" id="ide-crumb">No file open</span>
      <span class="ide-status" id="ide-status"></span>
      <button class="ide-save" id="ide-save" disabled>Save</button>
    </div>
    <div class="ide-main">
      <div class="ide-explorer" id="ide-explorer"></div>
      <div class="ide-editor-wrap" id="ide-editor-wrap">
        <div class="ide-gutter" id="ide-gutter">1</div>
        <textarea class="ide-textarea" id="ide-textarea" spellcheck="false" disabled
          placeholder=""></textarea>
      </div>
    </div>
    <div class="ide-term-pane" id="ide-term-pane"></div>`;

  const explorerEl = root.querySelector("#ide-explorer");
  const wrapEl = root.querySelector("#ide-editor-wrap");
  const gutterEl = root.querySelector("#ide-gutter");
  const taEl = root.querySelector("#ide-textarea");
  const crumbEl = root.querySelector("#ide-crumb");
  const dirtyEl = root.querySelector("#ide-dirty");
  const statusEl = root.querySelector("#ide-status");
  const saveBtn = root.querySelector("#ide-save");
  const termPane = root.querySelector("#ide-term-pane");

  // Re-parent the existing console section (which contains #term + boot controls) into the
  // bottom pane. Moving the live node keeps xterm and all main.js wiring intact.
  const consoleSection = document.querySelector("#panel-ide > .console");
  if (consoleSection) termPane.appendChild(consoleSection);

  const api = () => window.wvmDemo;
  const ready = () => !!(api() && api().isGuestReady && api().isGuestReady());

  // ── editor state ───────────────────────────────────────────────────────────
  let currentPath = null;   // path of the open file
  let savedText = "";       // last-saved contents (for dirty tracking)
  const seen = new Set();   // dir paths already expanded (for toggle)

  function setStatus(msg, cls) {
    statusEl.textContent = msg || "";
    statusEl.className = "ide-status" + (cls ? " " + cls : "");
  }
  function isDirty() { return currentPath != null && taEl.value !== savedText; }
  function refreshDirty() {
    const d = isDirty();
    dirtyEl.classList.toggle("on", d);
    saveBtn.disabled = !d;
  }
  function syncGutter() {
    const lines = taEl.value.split("\n").length || 1;
    let s = "";
    for (let i = 1; i <= lines; i++) s += i + "\n";
    gutterEl.textContent = s;
    gutterEl.scrollTop = taEl.scrollTop;
  }

  taEl.addEventListener("input", () => { syncGutter(); refreshDirty(); });
  taEl.addEventListener("scroll", () => { gutterEl.scrollTop = taEl.scrollTop; });

  // ── guest command helpers ────────────────────────────────────────────────
  const shq = (p) => "'" + String(p).replace(/'/g, "'\\''") + "'";  // single-quote for the shell

  function joinPath(dir, name) {
    return dir === "/" ? "/" + name : dir + "/" + name;
  }

  // Parse busybox `ls -la` output into {type,name} entries. Columns:
  //   perms links owner group size month day time/year name...
  // (name is everything from field 8; symlinks show "name -> target").
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
      const t = perms[0];
      rows.push({ name, type: t === "d" ? "dir" : t === "l" ? "link" : "file", perms });
    }
    rows.sort((a, b) => (a.type === "dir") === (b.type === "dir")
      ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
    return rows;
  }

  async function listDir(dir) {
    const res = await api().exec("ls -la " + shq(dir), 30000);
    if (res.exit !== 0) throw new Error(res.stdout.trim() || ("cannot read " + dir));
    return parseLs(res.stdout);
  }

  // ── explorer rendering ───────────────────────────────────────────────────
  function makeNode(entry, dir, depth) {
    const path = joinPath(dir, entry.name);
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "ide-node";
    row.dataset.path = path;
    const isDir = entry.type === "dir";
    const tw = document.createElement("span");
    tw.className = "tw";
    tw.textContent = isDir ? "▸" : "";
    const ic = document.createElement("span");
    ic.className = "ic";
    ic.textContent = isDir ? "📁" : entry.type === "link" ? "🔗" : "📄";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = entry.name;
    row.append(tw, ic, nm);
    li.appendChild(row);
    let childUl = null;

    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isDir) {
        if (childUl) {                    // toggle collapse
          const open = childUl.style.display !== "none";
          childUl.style.display = open ? "none" : "";
          tw.textContent = open ? "▸" : "▾";
          return;
        }
        tw.innerHTML = '<span class="ide-spin">◠</span>';
        try {
          const kids = await listDir(path);
          childUl = document.createElement("ul");
          childUl.className = "ide-tree";
          for (const k of kids) childUl.appendChild(makeNode(k, path, depth + 1));
          li.appendChild(childUl);
          tw.textContent = "▾";
        } catch (err) {
          tw.textContent = "▸";
          setStatus(String(err.message || err), "err");
        }
      } else {
        openFile(path, row);
      }
    });
    return li;
  }

  async function loadTree() {
    explorerEl.innerHTML = `<div class="placeholder"><span class="ide-spin">◠</span> Loading ${ROOT}…</div>`;
    try {
      const entries = await listDir(ROOT);
      const ul = document.createElement("ul");
      ul.className = "ide-tree";
      for (const e of entries) ul.appendChild(makeNode(e, ROOT, 0));
      explorerEl.innerHTML = "";
      const head = document.createElement("div");
      head.className = "ide-node";
      head.style.color = "#8fa3bf";
      head.innerHTML = `<span class="tw"></span><span class="ic">🗂️</span><span class="nm">${ROOT}</span>`;
      explorerEl.append(head, ul);
    } catch (err) {
      explorerEl.innerHTML = `<div class="placeholder">Could not list <b>${ROOT}</b>:<br>${String(err.message || err)}</div>`;
    }
  }

  async function openFile(path, rowEl) {
    if (isDirty() && !confirm("Discard unsaved changes to " + currentPath + "?")) return;
    for (const n of explorerEl.querySelectorAll(".ide-node.sel")) n.classList.remove("sel");
    if (rowEl) rowEl.classList.add("sel");
    setStatus("opening…");
    taEl.disabled = true;
    try {
      const res = await api().exec("cat " + shq(path), 45000);
      if (res.exit !== 0) throw new Error(res.stdout.trim() || "cat failed");
      currentPath = path;
      savedText = res.stdout;
      taEl.value = res.stdout;
      taEl.disabled = false;
      crumbEl.innerHTML = "<b>" + path + "</b>";
      syncGutter();
      refreshDirty();
      setStatus("opened", "ok");
      taEl.focus();
    } catch (err) {
      setStatus(String(err.message || err), "err");
      taEl.disabled = false;
    }
  }

  // base64 (UTF-8 safe) of the editor content, decoded in-guest so bytes survive exactly.
  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  async function save() {
    if (!currentPath || !ready()) return;
    saveBtn.disabled = true;
    setStatus("saving…");
    try {
      const b64 = toB64(taEl.value);
      const cmd = "printf %s " + shq(b64) + " | base64 -d > " + shq(currentPath);
      const res = await api().exec(cmd, 60000);
      if (res.exit !== 0) throw new Error(res.stdout.trim() || ("write failed (exit " + res.exit + ")"));
      savedText = taEl.value;
      refreshDirty();
      setStatus("saved ✓", "ok");
    } catch (err) {
      setStatus(String(err.message || err), "err");
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener("click", save);
  taEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  });

  // ── ready / not-ready state ────────────────────────────────────────────────
  const BOOTING_EXPLORER =
    `<div class="placeholder"><span class="ide-spin">◠</span> Booting the Linux guest…<br>` +
    `the file explorer loads the guest filesystem when the shell is ready.</div>`;
  const BOOTING_EDITOR =
    `<div class="placeholder">🐧 <b>IDE powered by the VM</b><br><br>` +
    `Alpine (RISC-V, in your browser) is booting below. When it reaches a shell, the explorer ` +
    `fills with the guest's real filesystem — open a file to edit it, then <b>Save</b> writes it ` +
    `straight back into the guest.</div>`;

  function showBooting() {
    currentPath = null;
    savedText = "";
    taEl.value = "";
    taEl.disabled = true;
    saveBtn.disabled = true;
    dirtyEl.classList.remove("on");
    crumbEl.textContent = "No file open";
    setStatus("");
    explorerEl.innerHTML = BOOTING_EXPLORER;
    // Overlay editor placeholder (kept separate from the textarea so wiring stays intact).
    let ph = wrapEl.querySelector(".placeholder");
    if (!ph) {
      ph = document.createElement("div");
      ph.className = "placeholder";
      wrapEl.appendChild(ph);
    }
    ph.innerHTML = BOOTING_EDITOR;
    gutterEl.style.visibility = "hidden";
    taEl.style.visibility = "hidden";
  }

  function showReady() {
    const ph = wrapEl.querySelector(".placeholder");
    if (ph) ph.remove();
    gutterEl.style.visibility = "";
    taEl.style.visibility = "";
    syncGutter();
    loadTree();
  }

  window.addEventListener("wvm:guest-ready", showReady);
  window.addEventListener("wvm:guest-booting", showBooting);

  if (ready()) showReady(); else showBooting();
}
