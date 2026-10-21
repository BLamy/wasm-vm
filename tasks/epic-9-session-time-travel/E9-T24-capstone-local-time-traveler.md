---
id: E9-T24
epic: 9
title: CAPSTONE locally saved replayable VM sessions with a time-travel UI
priority: 524.924
status: pending
depends_on: [E9-T08, E9-T13, E9-T18c, E9-T19, E9-T20, E9-T21, E9-T22, E9-T23]
estimate: S
risk: high
capstone: true
---

## Goal

Ship a user-visible local time traveler that records, reopens, rewinds and branches real VM sessions.

## Boundary

Final integration, unified Docstream documentation and production publication of the accepted boundaries. No new replay semantics or hidden fixture substitutions belong in this capstone.

## Acceptance criteria

- [ ] From a fresh browser profile, record a software Linux session and a qualified accelerated desktop session with real input, file edits and a local witnessed network exchange.
- [ ] Reload, choose each saved session, seek backward/forward and step at exact positions; match CPU/RAM/device/disk state and applicable GPU result witnesses against the recording, with zero replay egress.
- [ ] Branch from the past, edit a file and prove parent/sibling history unchanged; export/import one session into another fresh profile and replay it.
- [ ] Exercise visible timeline, compatibility, storage and recovery states, verify the existing guest/fast-boot regressions, record final clean-clone evidence and obtain fresh independent verification.
- [ ] Update the unified docs and roadmap capability, build locally, deploy through the existing Cloudflare process and directly verify the public path with original sources and zero unexpected errors.

## Deterministic acceptance

`make verify-E9-T24`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Select independent seek positions, remove caches/network, and replay on the declared supported host profile. Reject canned footage, a software frame labelled GPU, hidden live requests, changed fixtures or an unverified implementation claim.

## Verification log

(pending; no implementation or verification claim)
