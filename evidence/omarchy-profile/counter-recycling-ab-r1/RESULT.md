# T03k — no demonstrated desktop-input improvement

One control and one candidate ran from frozen head
`65903012f592d7625c13d632bbd70e9e859b96aa`, using the same built WASM
`9405d6c38be9a170ef5a2e5e0bacdcbec6deace7de48c8e002bc3caea76dfb2b`
and pinned R3 LP1 kernel/RAM/delta/base. The candidate only enabled cold-counter
recycling. Both fresh headed Chrome sessions closed normally, in order, with
no parent-watchdog intervention or overlapping coordinator build.

Command: `node tools/verify/omarchy-recycling-ab.mjs evidence/omarchy-profile/counter-recycling-ab-r1`.
The parent completed at 07:43:55 UTC on September 14. Its exit0 means the two
observations were recorded; **both children exit1**. It is not acceptance.

| Observation | Control | Candidate |
| --- | --- | --- |
| Actual recycling | off, 0 epochs | on, 2 epochs / 131072 counters discarded |
| Desktop-ready event | 202731 ms | 217366 ms |
| Full startup qualification | failed at 300000 ms | failed at 300000 ms |
| Final received/presented frames | 2 / 2 | 2 / 2 |
| Physical keys attempted | none | none |
| Full-map refusals | 3623672 | 0 |
| Guest retired instructions | 2233480769 | 2054980955 |

Both arms restored the real desktop and obtained a successful `hyprctl layers`
response. The subsequent `hyprctl clients` query did not finish in the remaining
startup budget. Neither reached mapped-Foot/active-window qualification or the
physical nonce sequence. Thus input efficacy is **inconclusive**, not a failed
120-second nonce test, a measured speedup, or a proof that recycling causes or
cures the stall. Counter changes alone do not justify promotion.

The coordinator personally opened both arms' actual `desktop.png` and
`failure.png`: real Hyprland bar, Foot and prompt, with no typed response. Final
PNGs are identical, SHA-256
`97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
Rendering is real; usability remains unproven.

`node evidence/omarchy-profile/counter-recycling-ab-r1/audit.mjs` passed and
produced `audit.json`. It checks frozen helper/dist identities, actual source
and policy receipts, served resources, ordered cleanup, unchanged deadlines,
physical-input absence, serial fences and final PNG digests. Binary agent
payloads remain opaque (348 control, 344 candidate) and are not claimed audited.
The frozen browser test, not this post-run audit, selected the rules.

The wire record also exposes unnecessary hidden-IDE work in desktop mode:
`ls -la '/root'` starts at guest readiness, occupies the serialized bridge until
its 30-second timeout, and ultimately returns permission denied. The layer
query then takes about162/174 seconds from actual send to completion. Removing
that hidden IDE work is a concrete UI/service-isolation follow-up; these data
do not show that it accounts for all rendering or input latency.

No additional recycling run, production default change, deployment or merge.
All other risk-scoped gates are in `../counter-recycling-gates/`, including
352 core +33 wrapper library tests,71 browser adapters,127/0 browser ISA smoke,
and a clean isolated clone's7+1 targeted tests at unchanged runtime head
`d68be8425cae6f8a921b2ecc85d757314a6b09d4`. The final659 commit only changes
recorder lifecycle handling and evidence. Known unrelated broad macOS failures
were retained, not relabeled as passing.
