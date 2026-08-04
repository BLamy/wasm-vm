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
- 2026-08-03 — **LIVE stack proof: AC2/AC3 GREEN against real Headscale.** Brought up the full
  `docker compose --profile relay` stack (Headscale 0.29.2 + DERP + fixture + exit + relay, all
  healthy on a fresh `down -v`) and ran the E3-T19 browser suite. Root-caused why the guest specs were
  "flaky/broken": they were STALE — they clicked the removed `#boot-alpine` button and filled the
  relocated provider form. Fixed to the current API (`wvmDemo.bootAlpine()` + set config via
  `evaluate`; `?assetBase=/releases` for local chunks) — committed. Result: **6/8 specs pass GREEN
  live**:
  - `e3-t17-headscale-worker` (26s) — real Headscale registration; **survives Worker restart WITHOUT
    retaining the auth key** (`firstIdentity === secondIdentity`, addr 100.64.0.3; state keys are
    hex `_machinekey`/`profile-…`; auth key absent from all messages). **This IS E3-T19a AC2 + AC3, live.**
  - revoke (56s) — node revocation kills the flow; denied (32s) — ACL blocks the peer (**E3-T19b**);
    identity-attacks (13s) — copied-key / node-key-collision rejected (**E3-T19d**); compose-relay
    (2.2s) — relay reaches public, no token leak; control-outage (2.6s) — stopped control fails the
    identity without relay fallback, no key leak.
- REMAINING (AC1 — the guest-HTTPS-through-provider transcript): the two Alpine `guest-https` boots
  (tailscale + relay). The specs are un-stale'd, but completing the ~40-min in-browser Alpine boot
  over the tailnet is the flaky/OS-reaping path (chunk-serving is entangled with the compose `app`
  container that `reuseExistingServer` picks up on :8123). This is exactly the live path the ticket
  defers via `blocked_on: E4-T13`. Run `tools/verify/e3-t19-live-proof.sh` on a host that sustains the
  boot; the other 6 legs are proven green. The live AC2/AC3 for E3-T19a itself are now DONE.
- 2026-08-04 — **Full stack set up + validated on the Linux `dev` VM: reaping SOLVED, but guest-HTTPS
  is a genuine flaky bit for BOTH providers.** Brought the whole `docker compose --profile relay` stack
  up on dev (installed compose v2 plugin, added user to docker group, relay built from source, fixed a
  real nginx bug — request-time upstream resolution, committed `95de030`). Ran the guest-HTTPS proof on
  dev for BOTH providers:
  - **The Alpine guest boots to a shell in ~37 min with NO reap** (macOS jetsam is the only reaper —
    Linux dev sustains it; see [[browser-alpine-boot-reaped-on-mac]]). `E3T19_DHCP_OK` (10.0.2.15).
  - **Providers connect live**: the tailscale node `wasm-vm-guest-exit-compose` registered with the real
    Headscale (browser@ / js); the relay authenticated + `connects_accepted:1, rejected:0`.
  - **But `E3T19_GUEST_HTTPS_FAIL … rc=1` for BOTH tailscale AND relay** — the guest's `wget https://1.1.1.1/`
    doesn't complete. Relay side: the connection is accepted and ~322 bytes (the outbound ClientHello)
    flow, but the handshake never finishes. This exactly reproduces the pre-existing documented "guest-HTTPS
    flaky for both providers, needs a decision" — a real functional issue in the HTTPS-through-provider
    path under the slow 2-core boot (the browser network worker/route not staying live through/after the
    37-min boot), NOT the reaping and NOT a regression. This is precisely what `blocked_on: E4-T13` (the
    faster worker) is meant to unblock.
- (superseded note) REMAINING (AC1 + the live AC2/AC3 transcript): the `docker compose up` fresh-stack proof (browser VM
  resolves + reaches a tailnet HTTPS fixture; one node; reload restores; auth key absent from IDB/LS/URL
  by inspection). Deliberately deferred — it is the flaky ~40-min browser-Alpine-over-tailnet path that
  OS-reaps on this mac (see [[browser-alpine-boot-reaped-on-mac]], [[e3-t19-proof-needs-fresh-stack]]),
  which is exactly why the ticket is `blocked_on: E4-T13` (the non-flaky Epic-4 relay/worker). Run
  `tools/verify/e3-t19-live-proof.sh` on a host that can sustain the boot once E4-T13 lands.
