// Roadmap capability manifest for the demo's "Roadmap progress" panel (E1-T30, demo follow-up).
//
// The panel answers one question at a glance: how far along the 9-epic roadmap are we, and
// which capabilities are *proven*? Each capability carries a status and its evidence. Where a
// capability maps to a group of live riscv-tests binaries (`group`) — optionally narrowed by a
// substring (`filter`) — main.js RE-DERIVES its status from the browser suite results after a
// run, so the panel is a live conformance dashboard, not a static claim. Capabilities with no
// `group` (MMU, differential compliance) cite the offline evidence that proves them (RISCOF vs
// the RISC-V Sail model, CI), since they aren't exercised by the machine-mode -p suite.
//
// status: "verified" (green) · "partial" (amber) · "pending" (gray). Live wiring may promote a
// static row to "verified"/"live" or flag "regressed" (red) if a bound group fails in-browser.

export const ROADMAP = [
  {
    epic: "E0",
    title: "Ignition",
    status: "done",
    blurb: "RV64 core, decoder, ELF/HTIF, differential harness, browser demo.",
    caps: [
      { name: "RV64I base decode + execute", status: "verified", evidence: "rv64ui-p suite", group: "rv64ui-p" },
      { name: "ELF64 loader + HTIF tohost exit", capstone: true, status: "verified", evidence: "boots every -p binary + hello.elf" },
      { name: "Byte-exact differential vs reference", status: "verified", evidence: "Spike/Sail trace match (CI)" },
      { name: "Browser demo (this page) + wasm", status: "verified", evidence: "native == node-wasm == browser" },
    ],
  },
  {
    epic: "E1",
    title: "The Machine",
    status: "done",
    blurb: "Privileged ISA: traps, CSRs, MMU (Sv39/48/57), PMP, atomics, FP — RISCOF 395/0 vs Sail.",
    caps: [
      { name: "M extension — mul / div / rem", status: "verified", evidence: "rv64um-p suite", group: "rv64um-p" },
      { name: "A extension — LR/SC + AMO", status: "verified", evidence: "rv64ua-p suite", group: "rv64ua-p" },
      { name: "F — single-precision float", status: "verified", evidence: "rv64uf-p suite", group: "rv64uf-p" },
      { name: "D — double-precision float", status: "verified", evidence: "rv64ud-p suite", group: "rv64ud-p" },
      { name: "C — compressed instructions", status: "verified", evidence: "rv64uc-p suite", group: "rv64uc-p" },
      { name: "Machine traps + Zicsr CSR file", status: "verified", evidence: "rv64mi-p csr/mcsr/scall/sbreak", group: "rv64mi-p", filter: ["csr", "scall", "sbreak", "illegal"] },
      { name: "Zicntr counters (cycle/time/instret)", status: "verified", evidence: "rv64mi-p-zicntr", group: "rv64mi-p", filter: ["zicntr"] },
      { name: "PMP — 64 entries, WARL, NAPOT/TOR", status: "verified", evidence: "rv64mi-p-pmpaddr + RISCOF pmpm 64-region", group: "rv64mi-p", filter: ["pmpaddr"] },
      { name: "Misaligned scalar load / store", status: "verified", evidence: "rv64mi-p *-misaligned + ma_addr/ma_fetch", group: "rv64mi-p", filter: ["misaligned", "ma_addr", "ma_fetch"] },
      { name: "Debug triggers — mcontrol (tdata)", status: "verified", evidence: "rv64mi-p-breakpoint", group: "rv64mi-p", filter: ["breakpoint"] },
      { name: "Sv39 / Sv48 / Sv57 paging + software TLB", capstone: true, status: "verified", evidence: "RISCOF 395/0 vs Sail (vm_sv39/48/57)" },
    ],
  },
  {
    epic: "E2",
    title: "First Light",
    status: "done",
    blurb: "OpenSBI firmware, device tree, SBI console, virtio-blk — a real Linux kernel boots to a UART shell in the browser.",
    caps: [
      { name: "Machine platform + FDT device tree", status: "verified", evidence: "generated DT boots OpenSBI + Linux (E2-T01…T05)" },
      { name: "OpenSBI firmware boot (M→S handoff)", status: "verified", evidence: "OpenSBI → S-mode kernel handoff in-browser" },
      { name: "SBI base + debug-console + timer + IPI", status: "verified", evidence: "SBI console login + timer interrupts live" },
      { name: "virtio-blk + kernel boot to shell", capstone: true, status: "verified", evidence: "Alpine ext4 rootfs boots to a shell (#84) — try it in the Terminal tab" },
    ],
  },
  {
    epic: "E3",
    title: "Civilization",
    status: "done",
    blurb: "Lazy HTTP-fetched disk images, bounded block cache, copy-on-write + IndexedDB-durable overlay, virtio-net, honest flush, multi-tab safety — a persistent, networked filesystem.",
    caps: [
      { name: "Chunked disk image format", status: "verified", evidence: "cold-cache byte-identical rebuild + 92-chunk real-boot profile (E3-T01/T11)" },
      { name: "Lazy HTTP range chunk boot", status: "verified", evidence: "Alpine boots pulling ~1.2% of a 512 MB image on demand (E3-T02, #88)" },
      { name: "Bounded block cache + prefetch", status: "verified", evidence: "CLOCK cache + pinning + prefetch (E3-T03, #90)" },
      { name: "Copy-on-write overlay", status: "verified", evidence: "4 KiB CoW blocks + base-binding + write-park (E3-T04, #92)" },
      { name: "IndexedDB durable overlay — survives reload", capstone: true, status: "verified", evidence: "guest writes SURVIVE a tab reload: write→sync→reload→reboot→cat proven in-browser (E3-T05, #95)" },
      { name: "virtio-net device", status: "verified", evidence: "eth0 acceptance: native 828s + browser 15.8 min (E3-T13, #96/#98)" },
      { name: "Honest FLUSH barrier + crash safety", status: "verified", evidence: "barrier seam; 2 tab-kills survived 53 min crashtest (E3-T08, #100)" },
      { name: "Multi-tab writer lock + RO takeover", status: "verified", evidence: "20/20 race + RO-guest/EROFS/takeover, staggered-boot evidence (E3-T09, #102)" },
      { name: "Storage quota + honest per-image reset", status: "verified", evidence: "50 MiB real-IDB abort → Retry / guest IOERR / clean recovery / typed reset (E3-T10)" },
      { name: "User-mode network (slirp + smoltcp NAT)", status: "verified", evidence: "browser Alpine TCP/UDP through the relay (E3-T14); one real WS multiplexes 3 flows with a stalled reader + 100 MiB SHA-256 match, and transport drop reaps 500 real sockets (E3-T16)" },
      { name: "Zero-config Alpine DHCP + DNS", status: "verified", evidence: "stock Alpine leases 10.0.2.15/24; native OS DNS + browser DoH, cache, failure, renewal, and UDP→TCP fallback (E3-T15)" },
      { name: "Tailscale TCP transport", status: "verified", evidence: "stock Alpine reaches a tailnet-only TCP peer as the browser node; 1 GiB SHA-256 exact with bounded stalled-reader backpressure (E3-T17)" },
      { name: "Tailscale UDP transport", status: "verified", evidence: "tailnet echo preserves zero-length, maximum, and back-to-back datagram boundaries (E3-T17)" },
      { name: "Tailscale MagicDNS", status: "verified", evidence: "stock Alpine resolves a tailnet peer through 10.0.2.3 via the active browser IPN (E3-T17)" },
      { name: "Tailscale exit-node routing", status: "verified", evidence: "stock Alpine HTTPS succeeds through the selected exit node and fails closed with no exit route (E3-T17)" },
      { name: "Network provider lifecycle + relay policy", status: "verified", evidence: "one-shot Headscale provisioning, restore/logout + allow/deny ACL proof; Origin-bound relay tokens, post-DNS SSRF policy, and shared abuse budgets (E3-T19)" },
      { name: "Bounded host/guest file-transfer agent", status: "verified", evidence: "static riscv64 WVFT agent installed in Alpine; real guest upload/download, timeout cleanup, and restart recovery (E3-T21b2c)" },
      { name: "Streaming browser file-transfer UI", status: "verified", evidence: "100 MiB each direction with matching SHA-256, <32 MiB heap growth, bounded two-flow scheduling, cancellation, and hostile-input browser proof (E3-T21c)" },
    ],
  },
  {
    epic: "E3.5",
    title: "OCI Workloads",
    status: "next",
    blurb: "Pull real riscv64 container images, verify digests, run them with a tiny runner — layers cached in browser storage across reloads.",
    caps: [
      { name: "OCI image importer (pull + verify + unpack)", status: "verified", evidence: "wasm-vm oci unpack — digest-verifies every blob; escape/gzip-bomb hardened (#106)" },
      { name: "Container kernel audit (namespaces/cgroups/overlayfs)", status: "verified", evidence: "config matrix =y + in-guest container-smoke.sh 9/9 (#107)" },
      { name: "Native OCI sideload (Docker Hub/ghcr/quay/gcr, gzip+zstd)", status: "verified", evidence: "pull any v2 registry into a runnable bundle (#109/#111/#112)" },
      { name: "Container matrix — pipeline is image-generic", capstone: true, status: "verified", evidence: "9/9 riscv64 images incl. postgres:18 (8483-entry bundle, RISC-V ELFs) (#110)" },
      { name: "oci validate — bundle preflight (no boot)", status: "verified", evidence: "native runnability checks, CI-gated (#113)" },
      { name: "Tiny OCI runner (wvrun)", status: "partial", evidence: "core done: unshare+overlay+pivot_root+exec (#108) — booted in-guest run pending" },
      { name: "Digest-deduped layer cache, reload-proof", status: "pending" },
    ],
  },
  {
    epic: "E4",
    title: "Acceleration",
    status: "in-progress",
    blurb: "Fast interpreter and bounded JIT paths are proven; the whole-machine worker is the remaining demo-default boundary.",
    caps: [
      { name: "Fast predecoded interpreter", status: "verified", evidence: "E4-T30: exact-entry hit path, differential corpus, and live busybox proof" },
      { name: "Exact bounded JIT work + retirement", status: "verified", evidence: "E4-T31: budgets, traps, counters, trace gating, CLI, and Wasm wrapper" },
      { name: "Bulk JIT state handoff + bounded browser handles", status: "verified", evidence: "E4-T33: one 568-byte transfer each way; exact fault state; 4,096-cycle externref/eviction stress" },
      { name: "Default whole-machine Web Worker", status: "in-progress", evidence: "E4-T32: exact-head Node/browser/rr evidence submitted; fresh verifier pending" },
    ],
  },
  {
    epic: "E5",
    title: "The Window",
    status: "pending",
    blurb: "virtio-gpu — control queue, resource lifecycle, scanout, EDID — pixels on screen.",
    caps: [
      { name: "virtio-gpu control + resource queues", status: "pending" },
      { name: "Scanout transfer + flush", status: "pending" },
      { name: "EDID / display info", status: "pending" },
    ],
  },
  {
    epic: "E6",
    title: "Transcendence",
    status: "pending",
    blurb: "Multi-hart SMP: HSM hart lifecycle, round-robin boot, RVWMO memory-model audit.",
    caps: [
      { name: "Multi-hart core state + SBI HSM", status: "pending" },
      { name: "SMP kernel boot (round-robin)", status: "pending" },
      { name: "RVWMO / wasm memory-model audit", status: "pending" },
    ],
  },
  {
    epic: "E7",
    title: "Babel",
    status: "pending",
    blurb: "Multi-arch rootfs + binfmt — run foreign-architecture binaries under emulation.",
    caps: [
      { name: "Multi-arch rootfs", status: "pending" },
      { name: "binfmt integration", status: "pending" },
    ],
  },
  {
    epic: "E8",
    title: "Chrome in Chrome",
    status: "cancelled",
    blurb: "Cancelled 2026-07-06 — superseded by E3.5 OCI Workloads. The record/replay ideas may return as their own epic.",
    caps: [],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// Linear-style roadmap — the Roadmap tab. Reads ./tasks.json (generated from the
// /tasks folder by tools/gen-tasks-json.py, the single source of truth). The
// ROADMAP array above is retained ONLY because main.js/tabs.js still import it
// for the legacy live-suite capability panel (now hidden); this module owns the
// visible Roadmap tab and never touches those elements.
// ════════════════════════════════════════════════════════════════════════════

const STATUS = {
  verified: { label: "verified", color: "var(--green)", cls: "st-verified" },
  implemented: { label: "implemented", color: "#4a9eff", cls: "st-implemented" },
  "evidence-needed": { label: "evidence-needed", color: "#4a9eff", cls: "st-implemented" },
  "in-progress": { label: "in progress", color: "var(--amber)", cls: "st-progress" },
  pending: { label: "pending", color: "#6b7684", cls: "st-pending" },
  blocked: { label: "blocked", color: "var(--red)", cls: "st-blocked" },
  "verification-debt": { label: "verification debt", color: "#b17ce0", cls: "st-debt" },
  cancelled: { label: "cancelled", color: "#5a6470", cls: "st-cancelled" },
  decomposed: { label: "decomposed", color: "#7c8aa0", cls: "st-decomposed" },
};

function statusMeta(s) {
  return STATUS[s] || STATUS.pending;
}

// A "decomposed" parent was split into sub-tickets (seam decomposition). It carries
// `status: cancelled` in the source frontmatter, but it's superseded, not abandoned —
// we render it as a parent group with its sub-tickets nested, never as "cancelled".
function isDecomposed(t) {
  return Array.isArray(t.decomposed_into) && t.decomposed_into.length > 0;
}
function effStatus(t) {
  return isDecomposed(t) ? "decomposed" : t.status;
}

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const state = {
  data: null,
  epics: [],
  filters: { search: "", epic: "", status: "" },
  view: "timeline", // "kanban" | "timeline"
};

function epicTitle(key) {
  const e = state.epics.find((x) => x.key === key);
  return e ? e.title : key;
}

function groupByEpic(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (!map.has(t.epicKey)) map.set(t.epicKey, []);
    map.get(t.epicKey).push(t);
  }
  // Preserve the /tasks epic ordering.
  const ordered = [];
  for (const e of state.epics) {
    if (map.has(e.key)) ordered.push([e.key, map.get(e.key)]);
  }
  return ordered;
}

function matchesFilter(t) {
  const f = state.filters;
  if (f.epic && t.epicKey !== f.epic) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!(`${t.id} ${t.title} ${t.goal}`.toLowerCase().includes(q))) return false;
  }
  return true;
}

// Small stacked progress bar: verified vs everything-else, coloured by status.
function stackBar(tasks) {
  // Cancelled/decomposed tickets don't fill the bar (they don't gate completion),
  // so exclude them from both the segments and the denominator.
  const counted = tasks.filter((t) => t.status !== "cancelled");
  const total = counted.length || 1;
  const order = ["verified", "implemented", "evidence-needed", "in-progress", "verification-debt", "blocked", "pending"];
  const counts = {};
  for (const t of counted) counts[t.status] = (counts[t.status] || 0) + 1;
  const bar = h("div", "rm-stack");
  for (const s of order) {
    if (!counts[s]) continue;
    const seg = h("span", "rm-stack-seg");
    seg.style.width = (counts[s] / total) * 100 + "%";
    seg.style.background = statusMeta(s).color;
    seg.title = `${counts[s]} ${statusMeta(s).label}`;
    bar.append(seg);
  }
  return bar;
}

// Overall burndown: remaining (non-verified, non-cancelled) tasks as the epic
// timeline advances — hand-rolled SVG, no libs. It is a *derived* burndown from
// the epic sequence (we have no historical dated snapshots), labelled as such.
function overallBurndown(tasks) {
  const wrap = h("div", "rm-overall-card");
  const active = tasks.filter((t) => t.status !== "cancelled");
  const total = active.length;
  const verified = active.filter((t) => t.status === "verified").length;

  const head = h("div", "rm-overall-head");
  head.append(h("span", "rm-overall-title", "Overall progress"));
  head.append(h("span", "rm-overall-num", `${verified} / ${total} verified`));
  wrap.append(head);

  const pct = total ? Math.round((verified / total) * 100) : 0;
  const pbar = h("div", "rm-progress");
  const fill = h("span", "rm-progress-fill");
  fill.style.width = pct + "%";
  pbar.append(fill);
  wrap.append(pbar);
  wrap.append(h("div", "rm-overall-foot", `${pct}% verified`));
  return wrap;
}

function taskCard(t) {
  const meta = statusMeta(effStatus(t));
  const card = h("button", `rm-card ${meta.cls}`);
  card.type = "button";
  card.dataset.id = t.id;

  const top = h("div", "rm-card-top");
  top.append(h("span", "rm-card-id", t.id));
  if (t.capstone) top.append(h("span", "rm-capstone", "★ capstone"));
  const badge = h("span", `rm-badge ${meta.cls}`, meta.label);
  top.append(badge);
  card.append(top);

  card.append(h("div", "rm-card-title", t.title));

  const foot = h("div", "rm-card-foot");
  if (t.estimate) foot.append(h("span", "rm-chip", t.estimate));
  if (t.criteriaTotal) foot.append(h("span", "rm-chip", `AC ${t.criteriaDone}/${t.criteriaTotal}`));
  if (t.depends_on && t.depends_on.length) foot.append(h("span", "rm-chip", `${t.depends_on.length} dep${t.depends_on.length > 1 ? "s" : ""}`));
  card.append(foot);

  card.addEventListener("click", () => openDetail(t.id));
  return card;
}

// childId → parent task, for every decomposed parent (incl. nested). Rebuilt each
// render so filtering never desyncs it.
let PARENTS = new Map();
function rebuildParentIndex() {
  PARENTS = new Map();
  for (const t of state.data.tasks) {
    if (isDecomposed(t)) for (const cid of t.decomposed_into) PARENTS.set(cid, t);
  }
}

// Jira-style: sub-tickets keep their own status column but sit inside a subtle grey
// box headed by a parent-context band (the parent's id + title, clickable). Siblings
// that land in the same column share one box, so the band isn't repeated. This
// replaces the old "cancelled" card for decomposed parents — the parent lives only
// as the band above its children.
function subGroup(parent, children) {
  const wrap = h("div", "rm-sub");
  const ctx = h("button", "rm-sub-ctx");
  ctx.type = "button";
  ctx.append(h("span", "rm-sub-ctx-id", parent.id));
  ctx.append(h("span", "rm-sub-ctx-title", parent.title));
  ctx.addEventListener("click", (e) => { e.stopPropagation(); openDetail(parent.id); });
  wrap.append(ctx);
  for (const c of children) wrap.append(taskCard(c));
  return wrap;
}

// Lay out a column body: standalone cards render loose; decomposed sub-tickets are
// grouped by parent (first-occurrence order preserved) into one grey box each.
function appendColumnCards(body, cards) {
  const order = [];
  const groups = new Map();
  for (const t of cards) {
    const p = PARENTS.get(t.id);
    if (!p) { order.push({ solo: t }); continue; }
    if (!groups.has(p)) { groups.set(p, []); order.push({ parent: p }); }
    groups.get(p).push(t);
  }
  for (const item of order) {
    if (item.solo) body.append(taskCard(item.solo));
    else body.append(subGroup(item.parent, groups.get(item.parent)));
  }
}

// Jira-style Kanban columns. Each status maps to one column; columns render in
// this fixed left-to-right order, and only columns with at least one card in the
// current epic (after filtering) are shown.
const COLUMNS = [
  { key: "pending", label: "Backlog", statuses: ["pending"] },
  { key: "in-progress", label: "In progress", statuses: ["in-progress"] },
  { key: "review", label: "In review", statuses: ["implemented", "evidence-needed"] },
  { key: "debt", label: "Verification debt", statuses: ["verification-debt"] },
  { key: "blocked", label: "Blocked", statuses: ["blocked"] },
  { key: "verified", label: "Done", statuses: ["verified"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

// An epic is "done" (collapsed by default) when it has active tasks and every
// non-cancelled task is verified.
function epicIsDone(tasks) {
  const active = tasks.filter((t) => t.status !== "cancelled");
  return active.length > 0 && active.every((t) => t.status === "verified");
}

// Remember which epics the user has manually toggled so re-renders (filtering,
// searching) keep their expanded/collapsed state.
const collapseOverride = new Map();
// Which epics are collapsed in the Timeline view (independent of the Kanban lanes).
const timelineCollapse = new Set();

function kanbanBoard(tasks) {
  const board = h("div", "rm-board");
  for (const col of COLUMNS) {
    const cards = tasks.filter((t) => col.statuses.includes(t.status));
    if (!cards.length) continue;
    const column = h("div", `rm-col rm-col-${col.key}`);
    const chead = h("div", "rm-col-head");
    chead.append(h("span", "rm-col-label", col.label));
    chead.append(h("span", "rm-col-count", String(cards.length)));
    column.append(chead);
    const body = h("div", "rm-col-body");
    appendColumnCards(body, cards);
    column.append(body);
    board.append(column);
  }
  return board;
}

// ── Timeline / Gantt view ───────────────────────────────────────────────────
// Plots each ticket on a REAL calendar using the evidence chain: the bar spans the
// first→last date the AI worked on it (git commits naming/touching the ticket, plus
// dated verification-log entries), with a tick per active day. Data comes from
// tasks.json `activity` / `firstActivity` / `lastActivity`, generated by
// tools/gen-tasks-json.py. No historical guesswork — only recorded dates.
function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtTick(dt) {
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}
const DAY_MS = 86400000;

function renderTimeline(root, visible) {
  const range = state.data.activityRange;
  // Show ALL tickets (except decomposed parents, which live as their children) — including ones
  // with no recorded activity. Activity-bearing rows sort by first date; no-activity rows sort
  // after, by id.
  // Exclude cancelled tickets (and decomposed parents, which are status:cancelled too). An epic
  // whose only tickets are cancelled then has zero rows, so groupByEpic drops it entirely.
  const worked = visible.filter((t) => t.status !== "cancelled" && !isDecomposed(t)).sort((a, b) => {
    if (a.firstActivity && b.firstActivity) return a.firstActivity.localeCompare(b.firstActivity) || a.id.localeCompare(b.id);
    if (a.firstActivity) return -1;
    if (b.firstActivity) return 1;
    return a.id.localeCompare(b.id);
  });
  if (!range || !worked.length) {
    root.append(h("div", "rm-empty", "No recorded activity to plot for the current filters."));
    return;
  }
  // Domain: one day of padding each side of the recorded span.
  const start = parseDay(range.start).getTime() - DAY_MS;
  const end = parseDay(range.end).getTime() + 2 * DAY_MS;
  const span = Math.max(end - start, DAY_MS);
  const frac = (ms) => Math.min(1, Math.max(0, (ms - start) / span));
  const pct = (ms) => (frac(ms) * 100).toFixed(3) + "%";

  const gantt = h("div", "rm-gantt");
  const inner = h("div", "rm-gantt-inner");

  // Axis: weekly ticks.
  const axis = h("div", "rm-gantt-axis");
  axis.append(h("div", "rm-axis-spacer"));
  const axisTrack = h("div", "rm-axis-track");
  const firstMon = parseDay(range.start);
  firstMon.setDate(firstMon.getDate() - ((firstMon.getDay() + 6) % 7)); // back to Monday
  const weekMs = [];
  for (let t = firstMon.getTime(); t <= end; t += 7 * DAY_MS) {
    if (t < start) continue;
    weekMs.push(t);
    const tick = h("div", "rm-axis-tick");
    tick.style.left = pct(t);
    const lbl = h("div", "rm-axis-lbl", fmtTick(new Date(t)));
    lbl.style.left = pct(t);
    axisTrack.append(tick, lbl);
  }
  axis.append(axisTrack);
  inner.append(axis);

  const body = h("div", "rm-gantt-body");

  // Gridlines + today marker overlay (behind the rows).
  const grid = h("div", "rm-gridlines");
  const gspan = end - start;
  for (const t of weekMs) {
    const gl = h("div", "rm-gridline");
    gl.style.left = ((t - start) / gspan * 100).toFixed(3) + "%";
    grid.append(gl);
  }
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (todayMs >= start && todayMs <= end) {
    const tl = h("div", "rm-today");
    tl.style.left = ((todayMs - start) / gspan * 100).toFixed(3) + "%";
    tl.append(h("div", "rm-today-lbl", "today"));
    grid.append(tl);
  }
  body.append(grid);

  // Rows grouped by epic (epic order preserved), each collapsible.
  const groups = groupByEpic(worked);
  for (const [key, tasks] of groups) {
    const collapsed = timelineCollapse.has(key);
    const eh = h("div", "rm-g-epic");
    const ehead = h("button", "rm-g-epic-head");
    ehead.type = "button";
    ehead.append(h("span", "rm-caret", collapsed ? "▶" : "▼"));
    ehead.append(h("span", "rm-g-epic-name", `E${key} · ${epicTitle(key)}`));
    ehead.append(h("span", "rm-g-epic-num", `${tasks.length}`));
    ehead.addEventListener("click", () => {
      if (collapsed) timelineCollapse.delete(key); else timelineCollapse.add(key);
      render();
    });
    eh.append(ehead);
    eh.append(h("div"));
    body.append(eh);
    if (collapsed) continue;

    for (const t of tasks) {
      const row = h("div", "rm-g-row");
      const label = h("button", "rm-g-label");
      label.type = "button";
      const dot = h("span", "rm-g-dot-s");
      dot.style.background = statusMeta(effStatus(t)).color;
      label.append(dot, h("span", "rm-g-id", t.id), h("span", "rm-g-title", t.title));
      label.addEventListener("click", () => openDetail(t.id));
      row.append(label);

      const track = h("div", "rm-g-track");
      if (t.firstActivity) {
        const f = parseDay(t.firstActivity).getTime();
        const l = parseDay(t.lastActivity).getTime();
        const bar = h("div", "rm-g-bar");
        bar.style.left = pct(f);
        bar.style.width = Math.max(frac(l) - frac(f), 0) * 100 + "%";
        bar.style.background = statusMeta(effStatus(t)).color;
        bar.title = `${t.id}: ${t.firstActivity} → ${t.lastActivity} · ${t.commitCount} commit${t.commitCount === 1 ? "" : "s"} over ${t.activity.length} day${t.activity.length === 1 ? "" : "s"}`;
        bar.addEventListener("click", () => openDetail(t.id));
        track.append(bar);
        // One tick per active day.
        for (const e of t.activity) {
          const tk = h("div", "rm-g-tick");
          tk.style.left = pct(parseDay(e.date).getTime());
          track.append(tk);
        }
      } else {
        // No recorded activity yet — show the row with a muted marker instead of a bar.
        const na = h("div", "rm-g-noact", "no recorded activity");
        na.title = `${t.id}: no git/verification activity recorded`;
        track.append(na);
      }
      row.append(track);
      body.append(row);
    }
  }
  inner.append(body);
  gantt.append(inner);
  root.append(gantt);

  const legend = h("div", "rm-gantt-legend");
  const withAct = worked.filter((t) => t.firstActivity).length;
  legend.append(h("span", null, `${worked.length} tickets · ${withAct} with recorded activity · ${range.start} → ${range.end}`));
  const dotSpan = h("span");
  const dotI = h("i"); dotI.style.background = "var(--green)";
  dotSpan.append(dotI, document.createTextNode("bar = first→last evidence date · tick = an active day"));
  legend.append(dotSpan);
  root.append(legend);
}

function render() {
  const lanes = document.getElementById("rm-lanes");
  if (!lanes || !state.data) return;
  rebuildParentIndex();
  lanes.replaceChildren();

  const visible = state.data.tasks.filter(matchesFilter);
  const groups = groupByEpic(visible);
  const filtering = !!(state.filters.search || state.filters.status || state.filters.epic);

  const countEl = document.getElementById("rm-count");
  if (countEl) {
    // Cancelled tickets are excluded from the overall count (they don't gate completion).
    const totalCounted = state.data.tasks.filter((t) => t.status !== "cancelled").length;
    const visibleCounted = visible.filter((t) => t.status !== "cancelled").length;
    countEl.textContent = `${visibleCounted} of ${totalCounted} issues`;
  }

  if (state.view === "timeline") {
    renderTimeline(lanes, visible);
    return;
  }

  if (!groups.length) {
    lanes.append(h("div", "rm-empty", "No issues match the current filters."));
    return;
  }

  for (const [key, tasks] of groups) {
    const done = epicIsDone(tasks);
    const allCancelled = tasks.length > 0 && tasks.every((t) => t.status === "cancelled");
    // Collapsed by default when the epic is done OR fully cancelled — unless the user
    // overrode it, or an active filter is narrowing results (then always expand so hits show).
    let collapsed = done || allCancelled;
    if (collapseOverride.has(key)) collapsed = collapseOverride.get(key);
    else if (filtering) collapsed = false;

    const lane = h("section", `rm-lane${collapsed ? " collapsed" : ""}${done ? " done" : ""}${allCancelled ? " cancelled" : ""}`);

    const head = h("button", "rm-lane-head");
    head.type = "button";
    head.setAttribute("aria-expanded", String(!collapsed));
    head.append(h("span", "rm-caret", collapsed ? "▶" : "▼"));
    head.append(h("span", "rm-epic-tag", `E${key}`));
    head.append(h("span", "rm-epic-name", epicTitle(key)));
    const verified = tasks.filter((t) => t.status === "verified").length;
    // Cancelled tickets don't count toward completion — an epic whose only
    // non-verified tickets are cancelled is done.
    const counted = tasks.filter((t) => t.status !== "cancelled").length;
    if (done) head.append(h("span", "rm-epic-done", "✓ done"));
    else if (allCancelled) head.append(h("span", "rm-epic-done", "✕ cancelled"));
    head.append(h("span", "rm-epic-count", allCancelled ? `${tasks.length} cancelled` : `${verified}/${counted} verified`));
    head.addEventListener("click", () => {
      collapseOverride.set(key, !lane.classList.contains("collapsed") ? true : false);
      render();
    });
    lane.append(head);
    lane.append(stackBar(tasks));

    // Decomposed parents never render as cards (they'd read as "cancelled") — they
    // appear only as the grey parent-context band above their sub-tickets, which
    // stay in their own real status columns.
    const boardTasks = tasks.filter((t) => !isDecomposed(t));

    if (!collapsed && boardTasks.length) lane.append(kanbanBoard(boardTasks));
    lanes.append(lane);
  }
}

// ── Ticket detail — evidence lives in the ticket ────────────────────────────
function openDetail(id) {
  const t = state.data.tasks.find((x) => x.id === id);
  const panel = document.getElementById("rm-detail");
  if (!t || !panel) return;
  const meta = statusMeta(effStatus(t));
  panel.replaceChildren();

  const bar = h("div", "rm-detail-bar");
  const close = h("button", "rm-detail-close", "✕ Close");
  close.type = "button";
  close.addEventListener("click", closeDetail);
  bar.append(h("span", "rm-detail-id", t.id), h("span", `rm-badge ${meta.cls}`, meta.label), close);
  panel.append(bar);

  const body = h("div", "rm-detail-body");
  body.append(h("h3", "rm-detail-title", t.title));

  const kv = h("div", "rm-detail-kv");
  const add = (k, v) => { kv.append(h("dt", null, k), h("dd", null, v)); };
  add("Epic", `E${t.epicKey} — ${epicTitle(t.epicKey)}`);
  add("Status", meta.label);
  if (t.estimate) add("Estimate", t.estimate);
  add("Depends on", t.depends_on && t.depends_on.length ? t.depends_on.join(", ") : "—");
  if (t.capstone) add("Capstone", "★ epic capstone");
  body.append(kv);

  if (isDecomposed(t)) {
    body.append(h("h4", "rm-detail-h", `Decomposed into ${t.decomposed_into.length} sub-tickets`));
    const ul = h("ul", "rm-ac");
    for (const cid of t.decomposed_into) {
      const child = state.data.tasks.find((x) => x.id === cid);
      const li = h("li", "rm-ac-item");
      const cm = child ? statusMeta(effStatus(child)) : null;
      li.append(h("span", "rm-ac-box", child && child.status === "verified" ? "✓" : "○"));
      const link = h("button", "rm-ac-text rm-sub-link", child ? `${cid} — ${child.title}` : `${cid} — (not found)`);
      link.type = "button";
      if (child) link.addEventListener("click", () => openDetail(cid));
      li.append(link);
      if (cm) li.append(h("span", `rm-badge ${cm.cls}`, cm.label));
      ul.append(li);
    }
    body.append(ul);
  }

  if (t.goal) {
    body.append(h("h4", "rm-detail-h", "Goal"));
    body.append(h("p", "rm-detail-text", t.goal));
  }

  if (t.criteria && t.criteria.length) {
    body.append(h("h4", "rm-detail-h", `Acceptance criteria (${t.criteriaDone}/${t.criteriaTotal})`));
    const ul = h("ul", "rm-ac");
    for (const c of t.criteria) {
      const li = h("li", c.checked ? "rm-ac-item done" : "rm-ac-item");
      li.append(h("span", "rm-ac-box", c.checked ? "✓" : "○"));
      li.append(h("span", "rm-ac-text", c.text));
      ul.append(li);
    }
    body.append(ul);
  }

  if (t.verificationLog) {
    body.append(h("h4", "rm-detail-h", "Verification log — evidence"));
    body.append(h("pre", "rm-log", t.verificationLog));
  }

  if (t.adversarial) {
    body.append(h("h4", "rm-detail-h", "Adversarial verification"));
    body.append(h("pre", "rm-log", t.adversarial));
  }

  const src = h("div", "rm-detail-src");
  src.append(h("span", null, "source: "), h("code", null, t.file));
  body.append(src);

  panel.append(body);
  panel.hidden = false;
  panel.scrollTop = 0;
  close.focus();
}

function closeDetail() {
  const panel = document.getElementById("rm-detail");
  if (panel) panel.hidden = true;
}

function populateFilters() {
  const epicSel = document.getElementById("rm-epic");
  if (epicSel) {
    for (const e of state.epics) {
      const o = h("option", null, `E${e.key} — ${e.title}`);
      o.value = e.key;
      epicSel.append(o);
    }
  }
  const statusSel = document.getElementById("rm-status");
  if (statusSel) {
    const present = [...new Set(state.data.tasks.map((t) => t.status))];
    for (const s of Object.keys(STATUS)) {
      if (!present.includes(s)) continue;
      const o = h("option", null, statusMeta(s).label);
      o.value = s;
      statusSel.append(o);
    }
  }
}

function wireControls() {
  const search = document.getElementById("rm-search");
  const epicSel = document.getElementById("rm-epic");
  const statusSel = document.getElementById("rm-status");
  search?.addEventListener("input", () => { state.filters.search = search.value.trim(); render(); });
  epicSel?.addEventListener("change", () => { state.filters.epic = epicSel.value; render(); });
  statusSel?.addEventListener("change", () => { state.filters.status = statusSel.value; render(); });

  const boardBtn = document.getElementById("rm-view-board");
  const timelineBtn = document.getElementById("rm-view-timeline");
  const setView = (v) => {
    state.view = v;
    boardBtn?.classList.toggle("active", v === "kanban");
    boardBtn?.setAttribute("aria-selected", String(v === "kanban"));
    timelineBtn?.classList.toggle("active", v === "timeline");
    timelineBtn?.setAttribute("aria-selected", String(v === "timeline"));
    render();
  };
  boardBtn?.addEventListener("click", () => setView("kanban"));
  timelineBtn?.addEventListener("click", () => setView("timeline"));
  // Reflect the initial view on the segmented control so the highlighted segment always
  // matches what's actually rendered (default is the Gantt/timeline view). initRoadmap()
  // calls render() right after this, so we only sync the button state here — no extra render.
  boardBtn?.classList.toggle("active", state.view === "kanban");
  boardBtn?.setAttribute("aria-selected", String(state.view === "kanban"));
  timelineBtn?.classList.toggle("active", state.view === "timeline");
  timelineBtn?.setAttribute("aria-selected", String(state.view === "timeline"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
    if (e.key === "/" && document.activeElement !== search && !document.getElementById("rm-detail")?.hidden === false) {
      // focus search unless typing in a field
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) {
        e.preventDefault();
        search?.focus();
      }
    }
  });
}

async function initRoadmap() {
  const lanes = document.getElementById("rm-lanes");
  if (!lanes) return; // not on this page build
  try {
    const res = await fetch("./tasks.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.epics = state.data.epics || [];
  } catch (err) {
    lanes.append(h("div", "rm-empty", `Could not load tasks.json (${err.message}). Run: make tasks-json`));
    return;
  }

  const headline = document.getElementById("rm-headline");
  if (headline && state.data.headline) {
    headline.textContent = `${state.data.headline.verified} / ${state.data.headline.total} tasks verified across ${state.epics.length} epics`;
  }
  const overall = document.getElementById("rm-overall");
  if (overall) overall.replaceChildren(overallBurndown(state.data.tasks));

  populateFilters();
  wireControls();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRoadmap);
} else {
  initRoadmap();
}
