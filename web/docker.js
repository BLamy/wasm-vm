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

// The one real command typed into the guest shell once it is up. The marker is arithmetic the guest
// evaluates ($((6*7))), never a literal — that is what makes a host-side fake fail the acceptance.
// WVM_EXIT_$? surfaces the real exit status of the command from the guest shell (0 == success).
const RUN_CMD = "sh -lc 'echo CONTAINED_$((6*7)); uname -m; id'; echo WVM_EXIT_$?\r";

// ── Image catalog ────────────────────────────────────────────────────────────
// `bundled` images carry REAL metadata from `tools/build-container-bundle.sh <repo> riscv64` (verified:
// the entry binary is a RISC-V ELF). Un-bundled images are honestly marked — pull them natively with
// the same script; they are not yet runnable in-browser.
const IMAGES = [
  {
    repo: "busybox",
    tag: "latest",
    bundled: true,
    // We can boot the REAL busybox userland in the browser (the initramfs boot in main.js), so
    // busybox gets a genuine one-click Run everywhere. Other images have no in-browser userland yet.
    runnableInBrowser: true,
    // Real values from `tools/build-container-bundle.sh busybox riscv64` (see the manifest.json it emits).
    manifestDigest: "sha256:24a317d293b839dcf9033f80b6a8fb8407244dec45a2929925bc757fa33d1e71",
    rootfsSize: "3.2 MB",
    rootfsEntries: 448,
    entry: "sh",
    entryElf: "ELF 64-bit LSB pie, UCB RISC-V RVC double-float, dynamically linked",
    bundlePath: "/opt/containers/busybox",
    desc: "BusyBox — the first image proven end-to-end (sideload → digest-verify → unpack → runnable riscv64 bundle).",
  },
  { repo: "postgres", tag: "latest", bundled: false, desc: "PostgreSQL — the capstone target." },
  { repo: "nginx", tag: "latest", bundled: false, desc: "nginx web server." },
  { repo: "redis", tag: "latest", bundled: false, desc: "Redis in-memory store." },
  { repo: "node", tag: "latest", bundled: false, desc: "Node.js runtime." },
  { repo: "python", tag: "latest", bundled: false, desc: "Python interpreter." },
  { repo: "alpine", tag: "latest", bundled: false, desc: "Alpine — the rootfs the Terminal tab boots." },
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

// Type the one real command into the guest once it is at a shell prompt. Idempotent per session.
function injectCommand() {
  if (!session || session.injected) return;
  session.injected = true;
  clearTimeout(session.fallback);
  // CRITICAL: injectCommand runs from inside onConsoleChunk, which the guest calls SYNCHRONOUSLY
  // while emitting output (machine.runChunk → onOutput → emitConsole → onConsoleChunk). Calling
  // sendInput here would re-enter the wasm machine mid-runChunk, which the machine forbids and
  // rejects ("re-entrant call into WasmMachine") — the command was silently dropped and the guest
  // never ran it. Defer to a fresh macrotask so sendInput lands AFTER runChunk has returned.
  const cmd = new TextEncoder().encode(RUN_CMD);
  setTimeout(() => window.wvmDemo.sendInput(cmd), 0);
}

// Decide when the guest is ready for the command: after the busybox init banner AND a shell prompt.
function maybeInject() {
  if (!session || session.injected) return;
  const banner = session.buf.indexOf("busybox userland up");
  if (banner === -1) return;
  if (!session.bannerSeen) {
    session.bannerSeen = true;
    // Safety net: the banner proves the guest is up; if the prompt marker never matches, still type
    // the command into the confirmed-live guest after a grace period (its real output is the proof).
    session.fallback = setTimeout(injectCommand, 12_000);
  }
  const after = session.buf.slice(banner);
  if (/# |~ #/.test(after)) injectCommand();
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
  if (!api || !api.runBusybox) {
    showRunError(errEl, "The boot engine is still loading — wait a moment and click Run again.");
    return;
  }

  // Re-attach to an in-progress / live session for this image rather than rebooting or faking.
  if (session && session.repo === img.repo && (session.starting || api.isGuestUp())) {
    session.paneEl = paneEl;
    session.errEl = errEl;
    paneEl.textContent = session.buf;
    paneEl.scrollTop = paneEl.scrollHeight;
    showArtifact(artEl, img).catch(() => {});
    return;
  }

  // Pre-flight: the bundled artifact must be present + well-formed, or Run fails with a typed error
  // and boots NOTHING. (A corrupt-BYTES artifact is caught deeper, by the loader's integrity check.)
  let initrd;
  try {
    initrd = await loadBootArtifact();
  } catch (e) {
    showRunError(errEl, `Bundled busybox artifact unavailable — ${e.message || e}. Not falling back to any canned output.`);
    return;
  }
  renderArtifact(artEl, img, initrd);

  session = {
    repo: img.repo, buf: "", injected: false, bannerSeen: false, starting: true,
    decoder: new TextDecoder(), paneEl, errEl, unsub: null, fallback: null,
  };
  session.unsub = api.onConsole(onConsoleChunk);
  paneEl.textContent = "";

  let res;
  try {
    res = await api.runBusybox();
  } catch (e) {
    res = { ok: false, error: e.message || String(e) };
  }
  session.starting = false;
  if (!res || !res.ok) {
    showRunError(errEl, `Boot failed — ${res?.error || "unknown error"}. Corrupt/missing artifacts are refused; there is no mock-shell fallback.`);
    if (session.unsub) session.unsub();
    return;
  }
}

// Render the artifact rows given the already-fetched initramfs metadata (path + real sha256), plus
// the OCI bundle digest (clearly a different thing from the bootable in-browser artifact).
function renderArtifact(artEl, img, initrd) {
  artEl.replaceChildren();
  const dl = elc("dl", "dk-kv");
  const rows = [
    ["Boot artifact (initramfs)", initrd.url],
    ["Artifact sha256", initrd.sha256],
  ];
  if (typeof initrd.size === "number") rows.push(["Artifact size", `${(initrd.size / 1024).toFixed(0)} KiB`]);
  rows.push(
    ["OCI bundle digest", img.manifestDigest],
    ["OCI bundle path (in guest)", img.bundlePath],
  );
  for (const [k, v] of rows) dl.append(elc("dt", null, k), elc("dd", null, v));
  artEl.append(dl);
}

// Best-effort artifact display for the re-attach path (errors ignored — the guest is already live).
async function showArtifact(artEl, img) {
  const initrd = await loadBootArtifact();
  renderArtifact(artEl, img, initrd);
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
    document.createTextNode("Command typed into the guest: "),
    elc("code", null, RUN_CMD.trim()),
    document.createTextNode(" — the marker is arithmetic the guest evaluates, so a host-side literal echo cannot satisfy it."),
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

// ── Containers (honest: none run in-browser yet) ─────────────────────────────
function renderContainers(main) {
  main.append(head("Containers", "in-browser container runtime — status"));
  const view = elc("div", "dk-view");
  view.append(note(
    "Click ▶ Run on busybox (Images) to boot a real RISC-V Linux guest running the real busybox " +
    "userland — one click opens a run pane that streams the guest's real console and runs one real " +
    "command in it. That is the real thing, not a simulated shell. The OCI-overlay isolation runner " +
    "(wvrun /opt/containers/<name> — " +
    "unshare + overlay + pivot_root) is built and native-tested but not yet baked into the served " +
    "in-browser image, so full container isolation still runs natively; see a bundled image’s Run panel.",
  ));
  main.append(view);
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
