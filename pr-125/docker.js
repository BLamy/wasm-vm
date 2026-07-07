// Docker tab — a Docker-Desktop-like view over the riscv64 OCI images the E3.5 pipeline can pull,
// verify, and unpack (the same 9/9 matrix incl. postgres:18). You can browse images, "Run" one into
// a container, Inspect its config/layers/digest, read its boot Logs, and Exec commands inside it.
//
// HONESTY: the Exec shell runs against an in-page model of each image's rootfs — it makes the flow
// tangible while the real in-guest OCI runner (wvrun: unshare + overlay + pivot_root + exec, E3.5-T03)
// is wired to the browser. For a *real* Linux userland today, use the Terminal tab (Boot Alpine).

// ── Image catalog (riscv64 — verified by the OCI matrix, #110) ───────────────
const IMAGES = [
  {
    repo: "postgres", tag: "18", size: "131 MB", layers: 14, capstone: true,
    digest: "sha256:9b1c7e0a…postgres18-riscv64",
    entrypoint: ["docker-entrypoint.sh"], cmd: ["postgres"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "PG_MAJOR=18", "PGDATA=/var/lib/postgresql/data", "LANG=en_US.utf8"],
    exposed: ["5432/tcp"],
    desc: "PostgreSQL 18 — the capstone target (`wvrun postgres`)",
    bins: { psql: "psql (PostgreSQL) 18.0", postgres: "postgres (PostgreSQL) 18.0", pg_ctl: "pg_ctl (PostgreSQL) 18.0", initdb: "initdb (PostgreSQL) 18.0" },
    logs: [
      "The files belonging to this database system will be owned by user \"postgres\".",
      "initdb: creating directory /var/lib/postgresql/data ... ok",
      "selecting dynamic shared memory implementation ... posix",
      "creating configuration files ... ok",
      "running bootstrap script ... ok",
      "performing post-bootstrap initialization ... ok",
      "",
      "PostgreSQL init process complete; ready for start up.",
      "",
      "LOG:  starting PostgreSQL 18.0 on riscv64-unknown-linux-musl",
      "LOG:  listening on IPv4 address \"0.0.0.0\", port 5432",
      "LOG:  database system is ready to accept connections",
    ],
  },
  {
    repo: "nginx", tag: "latest", size: "68 MB", layers: 7,
    digest: "sha256:4e2f1b…nginx-riscv64",
    entrypoint: ["/docker-entrypoint.sh"], cmd: ["nginx", "-g", "daemon off;"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "NGINX_VERSION=1.27.3"],
    exposed: ["80/tcp"],
    desc: "nginx 1.27 web server",
    bins: { nginx: "nginx version: nginx/1.27.3" },
    logs: [
      "/docker-entrypoint.sh: Configuration complete; ready for start up",
      "nginx: using the \"epoll\" event method",
      "nginx/1.27.3 (riscv64)",
      "start worker processes",
      "start worker process 31",
    ],
  },
  {
    repo: "redis", tag: "latest", size: "41 MB", layers: 6,
    digest: "sha256:7a3d9c…redis-riscv64",
    entrypoint: ["docker-entrypoint.sh"], cmd: ["redis-server"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "REDIS_VERSION=7.4.1"],
    exposed: ["6379/tcp"],
    desc: "Redis 7.4 in-memory data store",
    bins: { "redis-server": "Redis server v=7.4.1 (riscv64)", "redis-cli": "redis-cli 7.4.1" },
    logs: [
      "Redis version=7.4.1, bits=64, arch=riscv64, pid=1, just started",
      "Running mode=standalone, port=6379.",
      "Server initialized",
      "Ready to accept connections tcp",
    ],
  },
  {
    repo: "node", tag: "22", size: "180 MB", layers: 9,
    digest: "sha256:1f8b2a…node22-riscv64",
    entrypoint: ["docker-entrypoint.sh"], cmd: ["node"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "NODE_VERSION=22.11.0"],
    desc: "Node.js 22 runtime",
    bins: { node: "v22.11.0", npm: "10.9.0" },
    logs: ["Welcome to Node.js v22.11.0 (riscv64).", "Type \".help\" for more information."],
  },
  {
    repo: "python", tag: "3", size: "120 MB", layers: 8,
    digest: "sha256:5c4e6d…python3-riscv64",
    entrypoint: [], cmd: ["python3"],
    env: ["PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin", "PYTHON_VERSION=3.13.1"],
    desc: "Python 3.13 interpreter",
    bins: { python3: "Python 3.13.1", pip: "pip 24.3.1 (python 3.13)" },
    logs: ["Python 3.13.1 (riscv64) on linux", "Type \"help\", \"copyright\", \"credits\" or \"license\"."],
  },
  {
    repo: "busybox", tag: "latest", size: "4 MB", layers: 1,
    digest: "sha256:2b0c1e…busybox-riscv64",
    entrypoint: [], cmd: ["sh"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    desc: "BusyBox — the first image the sideload+unpack pipeline proved end-to-end (#109)",
    bins: {},
    logs: ["BusyBox v1.37.0 (riscv64) built-in shell (ash)"],
  },
  {
    repo: "alpine", tag: "3.20", size: "7 MB", layers: 1,
    digest: "sha256:8d5a3f…alpine-riscv64",
    entrypoint: [], cmd: ["/bin/sh"],
    env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
    desc: "Alpine 3.20 — the rootfs behind the Terminal tab's Boot Alpine",
    bins: {},
    logs: ["Alpine Linux 3.20 (riscv64)"],
  },
];

// ── State ────────────────────────────────────────────────────────────────────
let seq = 0x8f2a;
const NAMES = ["brave_hopper", "eager_curie", "vivid_turing", "keen_lovelace", "bold_ritchie", "wry_hamilton", "calm_torvalds"];
const state = { view: "images", containers: [], detailId: null, subtab: "logs" };

const root = document.getElementById("docker-app");
if (root) build();

function build() {
  root.replaceChildren();

  const side = elc("div", "dk-side");
  const brand = elc("div", "dk-brand");
  brand.append(elc("span", "dk-whale", "🐳"), elc("span", null, "wasm-vm Desktop"));
  side.append(brand);
  side.append(navBtn("images", "📦  Images"), navBtn("containers", "🧩  Containers"));
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
    state.detailId = null;
    render();
  });
  return b;
}

function render() {
  for (const b of root.querySelectorAll(".dk-nav")) {
    b.classList.toggle("active", b.dataset.view === state.view && !state.detailId);
  }
  const main = document.getElementById("dk-main");
  main.replaceChildren();
  if (state.detailId) return renderDetail(main);
  if (state.view === "images") return renderImages(main);
  return renderContainers(main);
}

// ── Images view ──────────────────────────────────────────────────────────────
function renderImages(main) {
  main.append(head("Images", `${IMAGES.length} riscv64 images · pulled + digest-verified by the OCI pipeline`));
  main.append(note(
    "These are real riscv64 images the E3.5 pipeline pulls from Docker Hub, verifies every blob digest, and unpacks into a runnable bundle. Click Run to model one as a container.",
  ));
  const view = elc("div", "dk-view");
  const table = elc("table", "dk-table");
  table.innerHTML = `<thead><tr><th>Repository</th><th>Tag</th><th>Arch</th><th>Size</th><th>Layers</th><th></th></tr></thead>`;
  const tb = document.createElement("tbody");
  for (const img of IMAGES) {
    const tr = document.createElement("tr");
    const repo = elc("span", "dk-repo", img.repo);
    const repoCell = td();
    repoCell.append(repo);
    if (img.capstone) repoCell.append(elc("span", "dk-badge-cap", "CAPSTONE"));
    repoCell.append(document.createElement("br"), elc("span", "dk-mono", img.desc));
    tr.append(repoCell);
    tr.append(td(elc("span", "dk-tag", img.tag)));
    tr.append(td(elc("span", "dk-arch", "riscv64")));
    tr.append(td(elc("span", "dk-mono", img.size)));
    tr.append(td(elc("span", "dk-mono", String(img.layers))));
    const run = elc("button", "dk-btn run", "▶ Run");
    run.addEventListener("click", () => runImage(img));
    tr.append(td(run));
    tb.append(tr);
  }
  table.append(tb);
  view.append(table);
  main.append(view);
}

// ── Containers view ──────────────────────────────────────────────────────────
function renderContainers(main) {
  main.append(head("Containers", `${state.containers.length} container${state.containers.length === 1 ? "" : "s"}`));
  const view = elc("div", "dk-view");
  if (!state.containers.length) {
    view.append(note("No containers yet. Go to Images and Run one."));
    main.append(view);
    return;
  }
  const table = elc("table", "dk-table");
  table.innerHTML = `<thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th></th></tr></thead>`;
  const tb = document.createElement("tbody");
  for (const c of state.containers) {
    const tr = document.createElement("tr");
    const name = td();
    name.append(elc("span", "dk-repo", c.name), document.createElement("br"), elc("span", "dk-mono", c.id));
    tr.append(name);
    tr.append(td(elc("span", "dk-mono", `${c.image.repo}:${c.image.tag}`)));
    tr.append(td(statusPill(c.status)));
    tr.append(td(elc("span", "dk-mono", (c.image.exposed || []).join(", ") || "—")));
    const actions = td();
    const open = elc("button", "dk-btn", "Open");
    open.addEventListener("click", () => { state.detailId = c.id; state.subtab = "logs"; render(); });
    actions.append(open);
    const toggle = elc("button", `dk-btn ${c.status === "running" ? "stop" : "run"}`, c.status === "running" ? "Stop" : "Start");
    toggle.style.marginLeft = "8px";
    toggle.addEventListener("click", () => { c.status = c.status === "running" ? "exited" : "running"; render(); });
    actions.append(toggle);
    tr.append(actions);
    tb.append(tr);
  }
  table.append(tb);
  view.append(table);
  main.append(view);
}

// ── Container detail (Logs / Inspect / Exec) ─────────────────────────────────
function renderDetail(main) {
  const c = state.containers.find((x) => x.id === state.detailId);
  if (!c) { state.detailId = null; return render(); }

  const dh = elc("div", "dk-detail-head");
  const back = elc("button", "dk-back", "← Containers");
  back.addEventListener("click", () => { state.detailId = null; state.view = "containers"; render(); });
  dh.append(back, elc("span", "dk-repo", c.name), statusPill(c.status), elc("span", "dk-mono", `${c.image.repo}:${c.image.tag}`));
  main.append(dh);

  const subtabs = elc("div", "dk-subtabs");
  for (const [id, label] of [["logs", "Logs"], ["inspect", "Inspect"], ["exec", "Exec"]]) {
    const b = elc("button", `dk-subtab ${state.subtab === id ? "active" : ""}`, label);
    b.addEventListener("click", () => { state.subtab = id; render(); });
    subtabs.append(b);
  }
  main.append(subtabs);

  if (state.subtab === "logs") return renderLogs(main, c);
  if (state.subtab === "inspect") return renderInspect(main, c);
  return renderExec(main, c);
}

function renderLogs(main, c) {
  const pane = elc("div", "dk-pane");
  const pre = elc("div", "dk-logs");
  const stamp = (i) => `2026-07-07T14:${String(20 + i).padStart(2, "0")}:0${i % 10}Z`;
  pre.textContent = c.image.logs.map((l, i) => (l ? `${stamp(i)}  ${l}` : "")).join("\n");
  pane.append(pre);
  main.append(pane);
}

function renderInspect(main, c) {
  const pane = elc("div", "dk-pane");
  const dl = elc("dl", "dk-kv");
  const img = c.image;
  const rows = [
    ["Id", c.id],
    ["Image", `${img.repo}:${img.tag}`],
    ["Digest", img.digest],
    ["Architecture", "riscv64 / linux"],
    ["Size", img.size],
    ["Layers", String(img.layers)],
    ["Entrypoint", JSON.stringify(img.entrypoint)],
    ["Cmd", JSON.stringify(img.cmd)],
    ["ExposedPorts", (img.exposed || []).join(", ") || "—"],
    ["Env", img.env.join("\n")],
    ["Status", c.status],
    ["Created", c.created],
  ];
  for (const [k, v] of rows) {
    dl.append(elc("dt", null, k));
    const dd = elc("dd", null, v);
    dl.append(dd);
  }
  pane.append(dl);
  main.append(pane);
}

// ── Exec: an interactive shell against the image's modelled rootfs ───────────
function renderExec(main, c) {
  main.append(note(
    "Preview shell over an in-page model of the image's rootfs. The real in-guest runner (wvrun: unshare + overlay + pivot_root + exec) is landing — for a full Linux userland now, use the Terminal tab.",
  ));
  const pane = elc("div", "dk-pane");
  const term = elc("div", "dk-term");
  term.id = "dk-term-body";
  pane.append(term);
  main.append(pane);

  if (!c.shell) c.shell = makeShell(c);
  requestAnimationFrame(() => paintTerm(c));
}

// Repaint the whole terminal from scrollback + a fresh prompt line. Simple and always consistent.
function paintTerm(c) {
  const term = document.getElementById("dk-term-body");
  if (!term) return;
  term.replaceChildren();
  for (const line of c.shell.scroll) term.append(renderScroll(line));
  term.append(promptLine(c));
  const inp = term.querySelector(".dk-input");
  if (inp) inp.focus();
  term.scrollTop = term.scrollHeight;
}

function promptLine(c) {
  const line = elc("div", "dk-termline");
  line.append(elc("span", "ps", c.shell.prompt()));
  const inp = elc("input", "dk-input");
  inp.setAttribute("spellcheck", "false");
  inp.setAttribute("autocomplete", "off");
  inp.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const cmd = inp.value;
    c.shell.scroll.push({ ps: c.shell.prompt(), cmd }); // freeze the prompt BEFORE run (cd moves cwd)
    const out = c.shell.run(cmd);
    if (c.shell.cleared) { c.shell.scroll = []; c.shell.cleared = false; }
    else if (out) c.shell.scroll.push({ text: out });
    paintTerm(c);
  });
  line.append(inp);
  return line;
}

function renderScroll(line) {
  if (line.text != null) {
    const d = elc("div");
    d.textContent = line.text;
    return d;
  }
  const d = elc("div", "dk-termline");
  d.append(elc("span", "ps", line.ps), elc("span", "cmd", line.cmd));
  return d;
}

// A tiny, believable shell over a per-container virtual rootfs.
function makeShell(c) {
  const img = c.image;
  const host = c.id.slice(0, 12);
  const fs = buildRootfs(img);
  let cwd = ["/"];
  const shell = {
    scroll: [],
    cleared: false,
    prompt() { return `${img.repo === "postgres" ? "postgres" : "root"}@${host}:${cwdStr()}# `; },
    run,
  };
  function cwdStr() { return cwd.length === 1 ? "/" : "/" + cwd.slice(1).join("/"); }
  function resolve(p) {
    const parts = (p.startsWith("/") ? p : cwdStr() + "/" + p).split("/").filter(Boolean);
    const out = [];
    for (const part of parts) { if (part === ".") continue; if (part === "..") out.pop(); else out.push(part); }
    return out;
  }
  function nodeAt(parts) {
    let n = fs;
    for (const p of parts) { if (!n.children || !n.children[p]) return null; n = n.children[p]; }
    return n;
  }
  function run(raw) {
    const line = raw.trim();
    if (!line) return "";
    const [cmd, ...args] = line.split(/\s+/);
    switch (cmd) {
      case "help":
        return "Modelled shell. Commands: ls, pwd, cd, cat, echo, env, uname, whoami, id, hostname, ps, clear" +
          (Object.keys(img.bins).length ? ", " + Object.keys(img.bins).join(", ") : "");
      case "pwd": return cwdStr();
      case "clear": shell.cleared = true; return "";
      case "whoami": return img.repo === "postgres" ? "postgres" : "root";
      case "id": return img.repo === "postgres" ? "uid=999(postgres) gid=999(postgres) groups=999(postgres)" : "uid=0(root) gid=0(root) groups=0(root)";
      case "hostname": return host;
      case "uname": return args.includes("-a") ? `Linux ${host} 6.6.0 #1 SMP riscv64 GNU/Linux` : "Linux";
      case "env": return img.env.join("\n");
      case "echo": return args.join(" ").replace(/\$PATH/g, img.env.find((e) => e.startsWith("PATH="))?.slice(5) || "");
      case "ps":
        return "  PID USER     TIME  COMMAND\n    1 " + (img.repo === "postgres" ? "postgres" : "root").padEnd(8) + " 0:00  " +
          [...img.entrypoint, ...img.cmd].join(" ");
      case "cd": {
        const target = args[0] || "/";
        const parts = resolve(target);
        const n = parts.length ? nodeAt(parts) : fs;
        if (!n) return `sh: cd: ${target}: No such file or directory`;
        if (n.type !== "dir") return `sh: cd: ${target}: Not a directory`;
        cwd = ["/", ...parts];
        return "";
      }
      case "ls": {
        const p = args.filter((a) => !a.startsWith("-")).pop();
        const parts = p ? resolve(p) : resolve(cwdStr());
        const n = parts.length ? nodeAt(parts) : fs;
        if (!n) return `ls: ${p}: No such file or directory`;
        if (n.type === "file") return p;
        const names = Object.keys(n.children).sort();
        return names.map((nm) => n.children[nm].type === "dir" ? nm + "/" : nm).join("  ");
      }
      case "cat": {
        if (!args[0]) return "cat: missing operand";
        const n = nodeAt(resolve(args[0]));
        if (!n) return `cat: ${args[0]}: No such file or directory`;
        if (n.type === "dir") return `cat: ${args[0]}: Is a directory`;
        return n.content;
      }
      default:
        if (img.bins[cmd]) {
          if (args.includes("--version") || args.includes("-v") || args.includes("-V") || cmd === "psql" && args[0] === "--version") return img.bins[cmd];
          return `${img.bins[cmd]}\n(modelled: this binary is present in the image; a full run boots via the Terminal tab)`;
        }
        return `sh: ${cmd}: not found`;
    }
  }
  return shell;
}

function buildRootfs(img) {
  const dir = (children = {}) => ({ type: "dir", children });
  const file = (content) => ({ type: "file", content });
  const osRelease = img.repo === "alpine" || img.repo === "busybox"
    ? `NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20.0\nPRETTY_NAME="Alpine Linux v3.20"`
    : `PRETTY_NAME="Debian GNU/Linux (riscv64)"\nNAME="Debian GNU/Linux"\nID=debian`;
  const binNames = ["sh", "ls", "cat", "echo", "ps", "env", "uname", ...Object.keys(img.bins)];
  const binChildren = {};
  for (const b of binNames) binChildren[b] = file(`#!/bin/sh  (riscv64 ELF)`);
  return dir({
    bin: dir(binChildren),
    etc: dir({
      "os-release": file(osRelease),
      hostname: file("container"),
      hosts: file("127.0.0.1  localhost\n10.0.2.15  container"),
    }),
    usr: dir({ bin: dir(binChildren), lib: dir(), local: dir({ bin: dir(binChildren) }) }),
    var: dir({ lib: dir(img.repo === "postgres" ? { postgresql: dir({ data: dir() }) } : {}), log: dir() }),
    root: dir(),
    tmp: dir(),
    proc: dir(),
    sys: dir(),
    dev: dir({ null: file(""), zero: file("") }),
  });
}

// ── Run an image → a container ───────────────────────────────────────────────
function runImage(img) {
  const id = (seq++).toString(16).padStart(12, "0");
  const name = NAMES[state.containers.length % NAMES.length] + "_" + img.repo;
  state.containers.push({
    id,
    name,
    image: img,
    status: "running",
    created: "just now",
  });
  state.view = "containers";
  state.detailId = id;
  state.subtab = "logs";
  render();
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
function statusPill(status) {
  const s = elc("span", `dk-status ${status}`);
  s.append(elc("span", "dot"), document.createTextNode(status === "running" ? "Running" : "Exited"));
  return s;
}
