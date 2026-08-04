---
id: E3-T19a
epic: 3
title: Composed-stack node lifecycle and reload-restore
priority: 319.1
status: pending
depends_on: [E3-T16, E3-T17]
blocked_on: [E4-T13]
estimate: S
risk: high
capstone: false
---

## Goal
On a fresh `docker compose` Headscale/Tailscale stack from a clean checkout (after `down -v`), the
browser VM provisions exactly one tailnet node, reaches a tailnet HTTPS fixture, and a page reload
restores the same identity without replaying the ephemeral auth key or persisting it. This is the
foundational live-network proof the rest of the network path builds on. It stays `blocked_on` the
Epic-4 relay/worker (E4-T13) so the live stack is non-flaky rather than environment-dependent.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] `docker compose up` from a clean checkout (fresh `down -v` stack) yields a browser VM that resolves and reaches a tailnet HTTPS fixture — recorded transcript.
- [ ] A fresh browser profile provisions exactly one node; a page reload restores it without re-running the auth-key exchange.
- [ ] The ephemeral auth key is never written to IndexedDB / localStorage / the URL (verified by inspection after provisioning).

## Verification log
- 2026-08-03 — **Deterministic security slice landed (persist/restore validation); the live tailnet
  proof stays `blocked_on: E4-T13`.** The identity-persistence machinery already exists from E3-T17
  (`main.js` `loadTailscaleState`/`storageUpdate` → localStorage; `tailscale-runtime.js` restores from
  it, `delete`s the auth key from config + clears it from the DOM on first status). The security-
  critical enforcement point — what every reload runs before restoring identity — is
  `normalizeSnapshot`, now exported + covered by `web/tests/tailscale-state.test.mjs` (11 node cases,
  green via `make verify-E3-T19a-state`):
  - persisted state is accepted ONLY as the Go IPN's hex-encoded key material (even-length [0-9a-f],
    ≤256-char keys, ≤1 MiB values); a fresh profile normalizes `null`→`{}`.
  - a NON-HEX value is rejected — so a stray `tskey-auth-…` (not hex) could never be restored, on top
    of the runtime deleting the key from config/DOM (AC3, the "auth key never persisted" invariant).
  - tampered / oversized / array / non-object / non-string-value saved state is refused, never restored.
  - This is the reload-restore boundary of AC2: a reload with saved state + no auth key restores the
    same identity without re-provisioning (`shouldProvision` is false unless a fresh auth key is present).
- REMAINING (AC1 + the live AC2/AC3 transcript): the `docker compose up` fresh-stack proof (browser VM
  resolves + reaches a tailnet HTTPS fixture; one node; reload restores; auth key absent from IDB/LS/URL
  by inspection). Deliberately deferred — it is the flaky ~40-min browser-Alpine-over-tailnet path that
  OS-reaps on this mac (see [[browser-alpine-boot-reaped-on-mac]], [[e3-t19-proof-needs-fresh-stack]]),
  which is exactly why the ticket is `blocked_on: E4-T13` (the non-flaky Epic-4 relay/worker). Run
  `tools/verify/e3-t19-live-proof.sh` on a host that can sustain the boot once E4-T13 lands.
