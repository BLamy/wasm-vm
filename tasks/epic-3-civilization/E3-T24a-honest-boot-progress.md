---
id: E3-T24a
epic: 3
title: Typed honest boot-progress surface
priority: 324.1
status: verified
depends_on: [E3-T03]
estimate: S
risk: medium
capstone: false
---

## Goal
Render one monotonic, stage-labeled progress surface driven by typed fetch and boot events rather
than timers or inferred fake percentages.

## Deliverables
- A typed progress event contract spanning wasm, manifest, chunk, kernel, and login milestones.
- One accessible progress component with byte-weighted measurable phases and explicit indeterminate
  phases.
- A throttled browser acceptance target comparing displayed progress to observed bytes/events.

## Acceptance criteria
- [x] `make verify-E3-T24a` proves progress never regresses, never fakes a creeping 99%, and reaches
  100% no more than two seconds before the usable prompt.
- [x] Sustained displayed-versus-observed byte divergence remains below 15%.
- [x] A missing or failed stage produces a stage-named error instead of an endless spinner.

## Adversarial verification
Reorder, duplicate, omit, and delay every event; throttle fetches; and fail each stage boundary.
Any regression, fabricated progress, early completion, inaccessible status, or indefinite spinner
refutes.

## Verification log

2026-07-29 — Verified. `make verify-E3-T24a` is green: 9 headless model tests + 2 live browser tests.

### What was built

- **Typed event contract + monotonic model** — `web/progress.js`, a pure reducer (no DOM/clock/globals).
  Stages `wasm → manifest → kernel → chunk → login` with byte-**measurable** phases (kernel, chunk) and
  **explicit indeterminate** phases (wasm, manifest, login). Events: `enter | bytes | complete | ready |
  error`. Invariants enforced structurally: `overall` is clamped monotonic (never regresses under
  reordered/duplicated/delayed events); an active indeterminate phase contributes **0** to the number
  (so the bar holds — no fabricated creep); the bar is clamped `< 1` until the `ready` event, so
  completion cannot precede the usable prompt; a dropped `complete` can't strand the bar (entering a
  later stage fills earlier ones); unknown kinds/stages are ignored.
- **Accessible surface** — `web/boot-progress.js` binds the model to a `role="progressbar"` element
  (`aria-valuemin/max/now/valuetext`, `aria-labelledby`) plus a `role="status" aria-live="polite"`
  label (`web/index.html`). Indeterminate phases render an explicit sweeping animation (honoring
  `prefers-reduced-motion`), never a number; errors render a stage-named message.
- **Wiring** — `web/main.js` translates the loader's existing `onState`/`onProgress` (roles
  kernel/rootfs/initramfs) into typed events, scans the guest console stream for the usable-prompt
  banner (`login:` / `userland up`) to emit `ready`, and drives the `chunk` phase from the loader's
  running `fetchStats()` byte counter for lazy/chunked images. The pre-existing per-role `#boot-progress`
  text is preserved (its `boot.spec.js` assertions still pass); the surface is additive.

### Evidence

- `web/tests/e3-t24a-progress.spec.js` (headless, deterministic) — the full adversarial matrix:
  monotonic under reorder/duplicate/delay; never > 99% until `ready`; byte-weighted contribution tracks
  observed bytes within **15%**; a failure at **every** stage yields a stage-named (non-spinner) error;
  the boot-to-login phase is explicitly indeterminate; omit-`complete` doesn't strand; junk events are
  no-ops.
- `web/tests/e3-t24a-boot-progress.spec.js` (real busybox boot) — accessible progressbar; aria-valuenow
  monotonic; sits in the byte-weighted "fetched, now booting" band (≥70, < 100) while login is
  indeterminate; 100% reached within 2 s of the `busybox userland up` prompt and never > 2 s before it;
  a blocked kernel fetch surfaces `data-error` + a stage-named "failed" label, not an endless spinner.

### Notes

- The busybox cold boot is used for the live test (offline, fast, known kernel/initramfs byte totals) —
  the same `login:`/`userland up` prompt signals the existing boot/chunked-boot tests use. The chunked
  Alpine path is wired through the identical `fetchStats()`-driven `chunk` phase; its end-to-end proof
  belongs to E3-T24d (frozen offline boot+resume), which composes this surface.
- The "reached 100% only at the prompt" guarantee depends on specific prompt banners, not a generic
  shell-prompt regex (a loose regex matched kernel-log noise mid-boot and fired 100% early — removed).
