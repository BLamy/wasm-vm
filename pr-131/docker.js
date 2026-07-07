// Docker tab — riscv64 OCI images the E3.5 pipeline pulls, digest-verifies, and unpacks into runnable
// bundles, plus the path to running them in the in-browser RISC-V guest via `wvrun`.
//
// HONESTY: this UI shows only REAL state. An image is "bundled" only if a real unpacked riscv64 bundle
// exists for it; the rest are shown as pullable-natively (they are NOT fabricated as runnable). There
// is NO simulated shell and NO canned logs/metadata — running a container boots the actual guest and
// execs the real binary. The one-click in-browser run (boot `WasmLinux` → `wvrun <bundle>` → attach the
// real console) is landing; until it's wired + live-verified, bundled images are run locally and this
// tab links you to the real Terminal-tab boot rather than faking a shell.

// ── Image catalog ────────────────────────────────────────────────────────────
// `bundled` images carry REAL metadata from `tools/build-container-bundle.sh <repo> riscv64` (verified:
// the entry binary is a RISC-V ELF). Un-bundled images are honestly marked — pull them natively with
// the same script; they are not yet runnable in-browser.
const IMAGES = [
  {
    repo: "busybox",
    tag: "latest",
    bundled: true,
    // Real values from `tools/build-container-bundle.sh busybox riscv64` (see the manifest.json it emits).
    manifestDigest: "sha256:24a317d293b839dcf9033f80b6a8fb8407244dec45a2929925bc757fa33d1e71",
    rootfsSize: "3.2 MB",
    rootfsEntries: 448,
    entry: "sh",
    entryElf: "ELF 64-bit LSB pie, UCB RISC-V RVC double-float, dynamically linked",
    bundlePath: "/opt/containers/busybox",
    desc: "BusyBox — the first image proven end-to-end (sideload → digest-verify → unpack → runnable riscv64 bundle).",
  },
  { repo: "postgres", tag: "18", bundled: false, desc: "PostgreSQL 18 — the capstone target (has a riscv64 image on Docker Hub)." },
  { repo: "nginx", tag: "latest", bundled: false, desc: "nginx 1.27 web server." },
  { repo: "redis", tag: "latest", bundled: false, desc: "Redis 7.4 in-memory store." },
  { repo: "node", tag: "22", bundled: false, desc: "Node.js 22 runtime." },
  { repo: "python", tag: "3", bundled: false, desc: "Python 3.13 interpreter." },
  { repo: "alpine", tag: "3.20", bundled: false, desc: "Alpine 3.20 — the rootfs the Terminal tab boots." },
];

const state = { view: "images", detailRepo: null };

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
  main.append(head("Images", `${IMAGES.length} riscv64 images · pulled + digest-verified by the OCI pipeline`));
  main.append(note(
    "These are real riscv64 images the E3.5 pipeline pulls from Docker Hub and digest-verifies. " +
    "“Bundled” means a real unpacked riscv64 rootfs exists (built + verified via tools/build-container-bundle.sh). " +
    "The others are pullable the same way — just not bundled for an in-browser run yet.",
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
    const openBtn = elc("button", `dk-btn ${img.bundled ? "run" : ""}`, img.bundled ? "▶ Run" : "Details");
    openBtn.addEventListener("click", () => {
      state.detailRepo = img.repo;
      render();
    });
    tr.append(td(openBtn));
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
    "No containers are running in the browser yet. Running a bundled image boots the real RISC-V guest " +
    "and execs the container process via wvrun — that one-click wiring is landing. Today: run bundled " +
    "images locally (see a bundled image’s Run panel), or boot Alpine in the Terminal tab.",
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

  if (img.bundled) {
    main.append(note(
      `Running boots the real RISC-V guest and execs the container: ` +
      `wvrun ${img.bundlePath} → unshare + overlay (ro rootfs + tmpfs) + pivot_root + exec ${img.entry}. ` +
      `One-click in-browser run is landing; until it’s wired and live-verified, boot the guest in the Terminal tab and run it there.`,
    ));
    const go = elc("button", "dk-btn run", "Open Terminal tab to boot the runtime");
    go.style.margin = "0 18px 16px";
    go.addEventListener("click", () => {
      location.hash = "terminal";
    });
    main.append(go);
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
