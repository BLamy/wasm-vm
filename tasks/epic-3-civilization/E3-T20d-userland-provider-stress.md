---
id: E3-T20d
epic: 3
title: Userland install and provider interruption stress
priority: 320.4
status: pending
depends_on: [E3-T20b, E3-T20c]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the frozen network/image path supports the named Level-3 runtimes and bounded recovery under
real package-manager load.

## Deliverables
- Browser automation installing and running Node.js and QuickJS on the primary path.
- A roughly 50 MiB Python dependency stress run with timing, bytes, and queue-memory evidence.
- Provider-specific interruption/retry tests plus the final roadmap/browser-suite update.

## Acceptance criteria
- [ ] `make verify-E3-T20d` installs `nodejs quickjs`, runs non-trivial scripts in both, and
  completes the Python stress case within the declared five-minute budget.
- [ ] Tailscale and relay interruption variants fail normally, recover only within their selected
  provider, and retry without duplicate guest bytes or apk corruption.
- [ ] The full browser suite has zero application console errors and the roadmap reports live,
  verified apk/userland capability.

## Adversarial verification
Throttle to 1 Mbps, stall the guest reader, flap each provider, run concurrent apk commands, revoke
the node with relay healthy, and repeat from cold caches. Any memory growth beyond the protocol
bound, silent fallback, lock corruption, wrong provider attribution, or flaky runtime output refutes.

## Verification log
(empty)
