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
    status: "cancelled",
    blurb: "Cancelled 2026-07-06 — superseded by E3.5 OCI Workloads. The record/replay ideas may return as their own epic.",
    caps: [],
  },
];
