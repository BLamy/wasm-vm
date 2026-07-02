---
id: E3-T24
epic: 3
title: Loading and boot UX - progress, snapshot fast path, offline assets
priority: 324
status: pending
depends_on: [E3-T03, E3-T12]
estimate: M
capstone: false
---

## Goal
Loading the page feels intentional: a progress surface shows real stages (wasm fetch →
manifest → boot-critical chunks → kernel boot → login / snapshot restore), the T12 snapshot
fast path is the default so reloads resume in seconds, and a service worker caches the app
shell so a previously-visited VM loads with no network at all (against local disk state).

## Context
Three threads braided together. (1) Progress: drive a single UI component from typed events
(chunk-fetch counters from T03's metrics, boot milestones parsed from known kernel/getty
markers or SBI hooks, snapshot restore phases from T12) — percentages must be honest
(bytes-weighted for fetch phases, indeterminate spinner for phases we can't measure; no
fake creeping bars). (2) Fast path: boot decision tree — valid resume snapshot? restore.
Else cold boot with boot-profile prefetch. Surface which path ran and why ("resuming
yesterday's session…" / "first boot, downloading…"). (3) Offline: a service worker
(Workbox or hand-rolled ~100 lines) precaches the app shell (html, js, wasm, xterm assets,
font) with a cache version keyed to the build hash; chunk files are *not* precached (they're
huge) but are served cache-first from the Cache API once fetched — coordinate with T03 so
we don't double-cache (decide: SW cache for chunks OR in-app cache, one owner; document).
Mind the T26 interplay: COOP/COEP response headers must survive SW-served responses (the SW
must copy headers or the page loses cross-origin isolation on offline loads).

## Deliverables
- Boot progress component + typed event bus from wasm to UI; honest stage weighting.
- Boot decision tree implementation with visible path indication and fall-back logging.
- Service worker: versioned precache of app shell, upgrade flow (new build → prompt or
  silent swap on next load), explicit exclusion or ownership decision for chunk caching.
- `docs/design/boot-ux.md`: stages, event contract, SW caching ownership decision,
  header-preservation note.
- E2E tests: cold load progress reaches 100% before prompt; offline reload (DevTools
  offline) boots to a usable shell from local state.

## Acceptance criteria
- [ ] Cold load on a throttled 10 Mbps connection shows stage-labeled progress that only
      moves forward and never sits at a fake 99%; login appears within 2 s of 100%.
- [ ] With a resume snapshot present: reload → usable shell < 5 s on a dev machine, UI
      says it resumed; after "reset disk" (T10) the cold path runs and says so.
- [ ] Airplane test: visit once, go fully offline (DevTools + kill dev server), reload —
      the app shell loads, the VM boots or resumes from local overlay/snapshot + cached
      chunks, and networking features degrade with clear indicators rather than errors.
- [ ] SW-served offline page still has `crossOriginIsolated === true` (or the documented
      equivalent pre-T26 state) — headers survived the SW.
- [ ] Deploying a new build: next online load activates the new SW version without a
      broken half-old/half-new asset mix (hash-keyed cache proven by test).

## Adversarial verification
Go offline at every stage boundary: during wasm fetch, mid-manifest, at 50% of chunk
prefetch, during snapshot restore — each must yield either successful local-state fallback
or a specific, stage-named error; a spinner forever refutes. Clear only the SW cache (keep
IDB/OPFS) and reload offline; then the inverse. Load two different build versions in two
tabs (simulate a deploy mid-session) and check the SW upgrade doesn't corrupt the running
tab. Verify progress honesty: instrument actual bytes vs. displayed percent — >15% sustained
divergence refutes. Kill the page during SW install (first ever visit) and reload — a
half-populated precache serving a broken shell refutes.

## Verification log
(empty)
