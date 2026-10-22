---
id: E9-T22b
epic: 9
title: Connect the shared owned network path to witnessed local HTTP
priority: 524.92202
status: evidence-needed
depends_on: [E9-T22a]
estimate: S
risk: high
capstone: false
---

## Goal

Supply the real exact-mode guest network workload required by unchanged T01.

## Boundary

One live provider boundary shared by recording and unrecorded controls: a real
Slirp Ethernet/TCP pump and an explicitly bounded local HTTP service at the
frozen gateway `10.0.2.2:9191`. Actual guest TX/RX/link/pending/completion results
cross existing owned leases. Only recording mode appends their receipts;
replay cannot construct/open/poll the live provider. Do not add general egress,
remote credentials, fixture-only replies or a different OFF transport.

## Acceptance criteria

- [x] Full pinned Alpine BusyBox wget reaches the real local service via guest Ethernet/TCP at the unchanged URL, receiving ten exact indexed 1024-byte bodies `(17+INDEX)%256` with independently retained server request/body counts.
- [x] Both OFF and ON use the same live network pump/service. ON records every real owned network observation and replays exact state and HTTP bytes with zero server/provider/host egress; OFF retains no event/observation history.
- [x] Bound all queues, payloads and callback lifetimes; reject malformed/stale/replay callbacks before mutation and settle cancellation/provider failure.
- [ ] Record the high-risk prescribed gates, native/guest/browser witnesses, final exact-head cold proof and fresh actual Daybreak adversarial verdict; update demo/roadmap and deploy the verified browser boundary to the main Cloudflare URL.

## Deterministic acceptance

`make verify-E9-T22b`. Planned target with a counted real full-guest HTTP proof,
source/event/raw-state digests, direct failures and the high-risk local gates.

## Adversarial verification

Use different HTTP indices/bodies, fragmented TCP, duplicate/stale completions,
server close/refusal and cancellation races. Refuse arbitrary gateway ports or
unbounded local-service registration. Open a fresh replay with the live server
unavailable and inspect original/independent server counters. Sabotage the replay
provider-construction guard and show that the bounded proof detects egress.

## Verification log

### 2026-10-22 — worker — begin shared owned live HTTP provider

Activated after fresh actual Daybreak verified all E9-T22a criteria at
`615629bfa111e4b586d0a03337013ec53415f318`, including actual main deployment
`1fe76e3b`. All dependencies are verified; this task alone occupies the active
lane. The native branch `codex/e9-owned-live-network` is stacked on the verified
control, with every existing PR still open and unmerged. Risk is high because
live provider ownership, callback lifetime and replay egress boundaries change.

Implement one shared real Slirp Ethernet/TCP pump and the bounded local service
at unchanged `10.0.2.2:9191`. Use existing owned TX/RX/link/pending leases in
both OFF and ON; only ON appends receipts. Replay must refuse the provider
factory before construction and any stale/cross-owner handle before live work.
Server parsing, queues, response staging, registration and cancellation must be
bounded. Retain independent request/body counters and all ten real full-Alpine
BusyBox-wget body witnesses; fixture Ethernet responses are not acceptance.

No runtime code or passing T22b target exists at activation. Add the meaningful
direct native/browser/replay attacks first, then freeze the final exact head
for the full high-risk submission and one final cold proof. A fresh actual
Daybreak verifier must run its full charter, novel attack and replay-construction
guard sabotage; a later independent public-path verdict closes publication.
Surface the accepted boundary on the demo/roadmap and ship main Cloudflare.
T22c/d full real workloads and unchanged performance budgets, T23 recovery and
T24 capstone remain required. No merge is authorized.

### 2026-10-22 — worker — implementation and Daybreak preflight corrections

Development work adds the fixed real Slirp HTTP service, shared owned Rust
pump, read-only core lease/capacity preflights and VM-owned browser API. The
service accepts only the ten fixed paths; ordinary Slirp keeps the service
disabled. The pump retains accepted TX and popped RX across staging pressure,
uses the guest clock, captures actual pending/link edges, and closes/cancels
without adopting historical connections. The demo now exercises the complete
Alpine HTTP OFF/ON/replay path and has a matching live roadmap pip.

A fresh actual `gpt-daybreak-blue-latest` preflight, with fallback disabled and
`daybreakBlue`, reviewed a frozen source snapshot. It found two blockers:
legacy network callbacks could bypass the new provider, and `rx()` could hide
an un-preflighted service pass. The worker fenced all legacy request/lease/
completion methods while the provider is installed, split a pure egress dequeue,
and added an immediate RX preflight. Retained pre-open leases are attacked by
the product probe in both modes. Daybreak also requested OFF/WFI and quota
proof: native tests now exercise real pending TCP in both modes, four active
clients/fifth refusal, and the 128/129 boundary with owned-link failure and
queued-TX settlement. The original preflight report is retained unchanged at
`target/evidence/e9-t22b-daybreak-runtime-preflight/final-message.md`, SHA-256
`c780ebbc766ddb5c59d44d57c6707d083bd4c848049235aed4ad1b028715c2ce`; this is a development preflight, not acceptance.

Development self-checks passed strict affected native/Wasm Clippy, the ten
owned-pump tests, and real HTTP fragmentation/tiny-window/half-close/refusal/
header/cancel/timeout/queue-limit checks. A bounded native recorded run retains
8192 instructions and equal replay traces for quanta 1, 7 and 101. The latest
self-checks `target/evidence/e9-t22b-alpine-development-5/report.json` and
`target/evidence/e9-t22b-demo-development-1/report.json` pass the full guest
provider path and the visible 127/0 suite. Earlier failed development runs
remain intact (boot-reset revocation, harness progress-before-open, and a
renamed immutable-chunk route); they are not relabelled as passing evidence.

No frozen final submission, final cold checkout, fresh full adversarial
acceptance verdict, or B production deployment is claimed here. Freeze and
record `make verify-E9-T22b`, then the one final cold proof. A fresh actual
Daybreak session must independently falsify the evidence, audit changed hunks,
run the charter's novel attack and replay-factory sabotage, and later close the
main-publication criteria. Every PR remains open; T22c/d, T23 and T24 remain
required.

### 2026-10-22 — worker — frozen high-risk submission

Product/runtime freeze: `89c0c61c1c5e6f7b06790791273a1443f3ac09c4`.
Final acceptance head: `d260f684a8edba718a315b366928bb8db6d28bf5`.
The latter changes only the acceptance runner's prescribed source/deploy HTML
mapping and digest-checked incremental carry; no runtime/dependency changed.
The original failed harness report `target/evidence/e9-t22b-final-89c0c61c1/report.json`
(SHA-256 `05ea4ab97485a7dc3d1426a57f90daff1b0bf73e9f4057047e1cb9f26c212734`) remains failed and preserved. Its eleven
passing native/build gates carry only after source and evidence rehashing;
the remaining primary gates and every cold gate use the final acceptance head.

Commands: `python3 -B tools/verify/e9-owned-http.py --output
 target/evidence/e9-t22b-final-d260f684a --resume-from
 target/evidence/e9-t22b-final-89c0c61c1`; and the same runner with
`--output target/evidence/e9-t22b-cold-d260f684a --cold-clone
 /Users/blamy/Documents/Codex/.e9-t22b-cold-d260f684a`.
The full prescribed local wall executes once in the primary submission; the
pristine clone repeats direct native/Wasm/build/full-guest/browser gates, with
no target, node_modules or rootfs inherited and scrubbed Rust/Cargo settings.
The cold checkout remains intact for the independent verifier.

- primary: `target/evidence/e9-t22b-final-d260f684a/report.json`, SHA-256 `35d61834a271caef0d44838d7e4f1f6796e42a10e9ac5826f703e4fe356e9027`; 22 commands / 181 retained files.
- wall: `target/evidence/e9-t22b-final-d260f684a/gauntlet/report.json`, SHA-256 `1f01ca36343d46624b991de0eb0bdd20b0e9651f2ebeb620bacc3681485462b5`; 3 commands / 3 retained files.
- cold: `target/evidence/e9-t22b-cold-d260f684a/report.json`, SHA-256 `4788d54d4a45a6bc421e3c72e237cbee0fd97cd09c6cbb3cffcf0538bf4cc56f`; 23 commands / 404 retained files.

Both submissions rehash all changed source bindings and rebuilt runtime entries.
The full wall records 2496 passing test invocations. Its only waiver
is the same five historical quarantined zicsr-stub dead-code diagnostics,
individually retained in the wall report; production Clippy remains strict.
No new failure is waived.

The native proof retains 8192 canonical guest instructions, exact replay traces
at quanta 1/7/101, native frames and owned network envelopes. The actual full
512 MiB Alpine image authenticates as
`ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`;
the cold run freshly reconstructs and verifies all 227 unique immutable chunks.
Both OFF and ON guests boot that image, configure eth0 and use real BusyBox
wget for all ten 1024-byte indexed responses. Literal guest bytes/hashes,
independent per-index server counts and separately reconstructed TCP streams
agree. The primary ON tape has 485 events / 115 network events and twelve whole-machine
witnesses. All 15 duplicate/retained-legacy/replay-construction refusals preserve
state. Native tests additionally cover retained accepted-TX and RX backpressure,
foreign/restored/offline ownership, true TCP pending/WFI behavior in OFF and ON,
four concurrent clients/fifth refusal, and the 128/129 lifetime boundary with
owned-link failure and queued TX settlement.

The live server is closed and its backend dropped before a fresh replay. The
retained `alpine-http/final.resume` and `alpine-http/replay.resume` match byte
for byte (27687441 bytes), SHA-256
`f24d3c498f73bfcc9e6b2d0adf474f8b47c110e7acc039384e20f2b11c8568f6`. Original server counters and the independent
factory counter remain unchanged; replay fetch/socket tripwires count zero.
The visible built demo passes 127/0, exercises the same product probe, and lights
both the panel and roadmap pip live. The independent artifact reader verifies
the raw files, literal bodies, native identity, source pins and tape witnesses.

Claim: the bounded shared owned live HTTP provider works in genuine recording
OFF and ON, records actual Ethernet observations only in ON, and replays this
full-guest HTTP capture without a live service/provider or host egress. This
is the T22b provider boundary; full scheduled software/GPU desktop workloads,
unchanged performance budgets, recovery and the capstone remain T22c/d, T23/T24.

Main production publication remains outstanding. A fresh actual Daybreak must
now run the full high-risk charter, changed-hunk coverage, a novel bounded
attack and replay-factory guard sabotage. Do not mark verified from the worker
claim. After local evidence holds, publish the accepted boundary to main
Cloudflare and obtain a new independent Daybreak public-path verdict. All PRs
stay open and unmerged.

### VERDICT: needs-evidence — 2026-10-22 — fresh actual Daybreak verifier

No runtime contradiction was found. P1–P16 HELD: launch reports and every
declared evidence/source binding rehashed; the eleven unchanged gates carried
byte-for-byte while all remaining primary and all 23 cold gates ran at
`d260f684a8edba718a315b366928bb8db6d28bf5`. The preserved old report remains
failed only on its original source/built-HTML equality assertion. The cold
checkout freshly reconstructed all 227 unique chunks of the authenticated
536870912-byte Alpine image (SHA-256
`ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`).

Raw OFF and ON captures each contain the ten actual BusyBox-wget bodies and
independent server counts. OFF has no observation tape. ON has 485 ordered
events / 115 network events; all 31 Receive events follow a causative accepted
Send, and independent TCP reassembly recovers the ten exact streams. Twelve
whole-machine witnesses bind initial through final state. `final.resume` and
`replay.resume` are byte-identical (27687441 bytes, SHA-256
`f24d3c498f73bfcc9e6b2d0adf474f8b47c110e7acc039384e20f2b11c8568f6`),
with zero replay egress and unchanged closed-server/factory counters. The
8192-instruction native trace and whole architectural digest hold, as do
quanta 1/7/101 replay traces.

All stated bounds and preflight corrections HELD: malformed inputs,
fragmentation/tiny windows/half-close, four-active/fifth-refusal, 128/129
lifetime settlement, accepted-TX/dequeued-RX pressure, real SYN pending/WFI,
guest ICount clock, retained legacy lease and all callback fences, pure dequeue,
immediate RX preflight, and factory-before-construction refusal. An independent
scratch-only mixed-case duplicate-Host real-TCP attack returned 400 with no
valid counter increment. A scratch replay-guard mutant caused the permanent
factory tripwire to fail (`4` vs `2`), and exact restoration passed. A separate
coverage probe hit both finite 256-frame overflow bodies. Every changed hunk is
executed, carried under an unchanged dependency/evidence digest, or narrowly
waived as generated/declarative/debug/defensive metadata. The visible local
demo passes 127/0 with both pips live. Production Clippy is strict-clean; the
full wall's only waiver is exactly the five historical quarantined zicsr-stub
dead-code diagnostics.

Evidence: `target/evidence/e9-t22b-daybreak-full-charter/report.json`,
`report.md`, `predictions.md`, `coverage.md`, `bindings.md`, `attacks.md`,
`rehash-results.json`, and `raw-interrogation.json`. Suite decision: retain the
existing permanent direct tests and `make verify-E9-T22b`; discard the novel
duplicate-Host mirror and sabotage mutant because the stable parser/guard
tripwires already exist.

P17 NEEDS EVIDENCE only for the deliberately outstanding actual main
publication. The smallest missing proof is to publish this accepted `web/dist`
to `https://wasm-vm.pages.dev`, then have a new fresh actual Daybreak
final-publication verifier check deployed asset bindings, visible 127/0, the
same full-Alpine OFF/ON/closed-server replay, live pips, and zero browser/host
replay egress. This local verdict is not authorization to deploy, push, merge,
or mark verified; the fourth acceptance checkbox remains open.
