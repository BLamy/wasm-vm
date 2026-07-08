// Docker tab — riscv64 OCI images the E3.5 pipeline pulls, digest-verifies, and unpacks into runnable
// bundles, plus the path to running them in the in-browser RISC-V guest via `wvrun`.
//
// HONESTY: this UI shows only REAL state and NEVER simulates a shell or canned output. Clicking
// "▶ Run" on busybox boots the REAL RISC-V Linux guest (the same machinery as the Terminal tab)
// and drops you at the REAL busybox shell — one click, works everywhere incl. GitHub Pages.
// HONEST SCOPE: that runs the real busybox userland; it is NOT the OCI-overlay isolation path
// (`wvrun /opt/containers/<name>` — unshare + overlay + pivot_root + exec). That runner is built
// and native-tested (crates/cli/tests/boot_wvrun.rs) but the bundle isn't baked into the served
// in-browser image yet, so it can't run headlessly here — the detail pane says so plainly.
// Un-bundled images are honestly marked as pullable-natively, not fabricated as runnable.

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
      render();
    }
  } catch {
    /* asset absent — keep the checked-in constants (which mirror the manifest) */
  }
}

const state = { view: "images", detailRepo: null };

// One-click Run: drive the REAL Terminal-tab boot machinery (no simulated shell). Switch to the
// Terminal tab's real xterm console and boot the guest via main.js's window.wvmDemo bridge. Only
// images with a real in-browser userland (busybox today) reach here; the caller gates on that.
function runContainer(img) {
  const api = window.wvmDemo;
  if (!api || !api.runBusybox) {
    // main.js hasn't finished wiring the bridge (module still loading). Ask for a reload rather
    // than pretending — no fake path.
    alert("The boot engine is still loading — give it a second and click Run again.");
    return;
  }
  location.hash = "terminal"; // tabs.js shows the Terminal panel + re-fits xterm
  // Let the panel become visible (tabs.js re-fits xterm on the next frame) before we boot+write.
  setTimeout(() => { api.runBusybox(); }, 60);
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

// ── Containers (honest: none run in-browser yet) ─────────────────────────────
function renderContainers(main) {
  main.append(head("Containers", "in-browser container runtime — status"));
  const view = elc("div", "dk-view");
  view.append(note(
    "Click ▶ Run on busybox (Images) to boot a real RISC-V Linux guest running the real busybox " +
    "userland — one click, and you land at the shell in the Terminal tab. That is the real thing, " +
    "not a simulated shell. The OCI-overlay isolation runner (wvrun /opt/containers/<name> — " +
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
      `One click boots a real RISC-V Linux guest running the REAL busybox userland and drops you at ` +
      `its shell in the Terminal tab — no local setup, works everywhere including GitHub Pages.`,
    ));
    const go = elc("button", "dk-btn run", "▶ Run busybox in the browser");
    go.style.margin = "0 18px 12px";
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
