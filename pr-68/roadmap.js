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
      { name: "ELF64 loader + HTIF tohost exit", status: "verified", evidence: "boots every -p binary + hello.elf" },
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
      { name: "Sv39 / Sv48 / Sv57 paging + software TLB", status: "verified", evidence: "RISCOF 395/0 vs Sail (vm_sv39/48/57)" },
    ],
  },
  {
    epic: "E2",
    title: "First Light",
    status: "next",
    blurb: "OpenSBI firmware, device tree, SBI console — boot a real kernel to a UART login.",
    caps: [
      { name: "Machine platform + FDT device tree", status: "pending" },
      { name: "OpenSBI firmware boot (M→S handoff)", status: "pending" },
      { name: "SBI base + debug-console + timer", status: "pending" },
      { name: "virtio-blk + kernel boot to shell", status: "pending" },
    ],
  },
  {
    epic: "E3",
    title: "Civilization",
    status: "pending",
    blurb: "Lazy HTTP-fetched disk images, block cache, copy-on-write overlay — a persistent filesystem.",
    caps: [
      { name: "Chunked disk image format", status: "pending" },
      { name: "HTTP range lazy block fetch + cache", status: "pending" },
      { name: "Copy-on-write overlay", status: "pending" },
    ],
  },
  {
    epic: "E4",
    title: "Acceleration",
    status: "pending",
    blurb: "Profiling, flamegraphs, in-guest CoreMark/Dhrystone, boot + compile benchmark ledger.",
    caps: [
      { name: "Hot-PC profiling + flamegraphs", status: "pending" },
      { name: "In-guest CoreMark / Dhrystone", status: "pending" },
      { name: "Boot + compile benchmark ledger", status: "pending" },
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
    status: "pending",
    blurb: "Boot Chromium on RISC-V to first paint; deterministic record/replay engine.",
    caps: [
      { name: "Chromium/RISC-V boot to first paint", status: "pending" },
      { name: "Deterministic record/replay engine", status: "pending" },
    ],
  },
];
