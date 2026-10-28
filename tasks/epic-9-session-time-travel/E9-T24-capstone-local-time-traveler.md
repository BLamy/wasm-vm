---
id: E9-T24
epic: 9
title: CAPSTONE locally saved replayable VM sessions with a time-travel UI
priority: 524.924
status: in-progress
depends_on: [E9-T08, E9-T13, E9-T18c, E9-T19, E9-T20, E9-T21, E9-T23]
estimate: S
risk: high
capstone: true
---

## User scope amendment — 2026-10-28

The user waived the long original-cold boot/replay campaign. Full Omarchy
qualification, a new cold first-frame/browser-profile allowance and the complete
two-profile performance campaign are outside this capstone's accepted scope.
They remain unproven, with original criteria/failures preserved in cancelled
E9-T22u/T22p/T22c/T22d. Remove T22d as an integration prerequisite; do not
advertise its numeric budgets or full-desktop qualification as verified.

Keep the software Linux user flow and bounded accelerated-guest integration,
including actual recorded input, files, network witnesses, exact functional
seeking, branching, export/import, recovery, independent Daybreak review and
production verification. A bounded GPU guest must be labelled as such; it is
not the full frozen Omarchy workload. Neither the long original cold boot nor
its whole-history replay may be relaunched by this task without a new user
request.

## Goal

Ship a user-visible local time traveler that records, reopens, rewinds and branches real VM sessions.

## Boundary

Final integration, unified Docstream documentation and production publication of the accepted boundaries. No new replay semantics or hidden fixture substitutions belong in this capstone.

## Acceptance criteria

- [ ] From a fresh browser profile, record a software Linux session with real input, file edits and a local witnessed network exchange; separately demonstrate a bounded accelerated-guest session with actual physical GPU result witnesses, explicitly labelled as bounded rather than full Omarchy qualification.
- [ ] Reload, choose each saved session, seek backward/forward and step at exact positions; match CPU/RAM/device/disk state and applicable GPU result witnesses against the recording, with zero replay egress.
- [ ] Branch from the past, edit a file and prove parent/sibling history unchanged; export/import one session into another fresh profile and replay it.
- [ ] Exercise visible timeline, compatibility, storage and recovery states, verify the existing guest/fast-boot regressions, record bounded final clean-head evidence and obtain fresh actual Daybreak independent verification. The existing exact-head independent-clone build checks may be carried forward when their source boundary is unchanged; no new long cold boot is required.
- [ ] Update the unified docs and roadmap capability, build locally, deploy through the existing Cloudflare process and directly verify the public path with original sources and zero unexpected errors.

## Deterministic acceptance

`make verify-E9-T24`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Select independent seek positions, remove caches/network, and replay on the declared supported host profile. Reject canned footage, a software frame labelled GPU, hidden live requests, changed fixtures or an unverified implementation claim.

## Verification log

(pending; no implementation or verification claim)
