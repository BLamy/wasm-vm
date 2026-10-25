---
id: E9-T22n
epic: 9
title: Qualify a finite desktop host-wall allowance
priority: 524.92202975
status: implemented
depends_on: [E9-T22m]
estimate: S
risk: medium
capstone: false
---

## Goal

Let the unchanged full Omarchy qualification reach its frozen guest-transition
bound without the host wall expiring first during durable checkpoint I/O.

## Boundary

Create a version-11 qualification profile chained to v10 that changes only the
desktop harness's host wall allowance from 8 to 16 hours. The exact C run at
`a161b0f8d6a4e7e4d19de7170fe7ad52a2f416f6` failed on that eight-hour
guard at transition 17,550,000,000 while still waiting for a first frame. The
recent 15.0B-to-15.45B segment ran at about 0.77B transitions/hour; reaching
the unchanged 20B cap at that rate takes about 12.8 hours from boot, so 16
hours is a finite allowance with host and storage headroom. This is an
execution allowance, not a performance budget or a promise that C will pass.
Keep the 20B transition cap, 50M checkpoint cadence, ICount/64 clock, original
Omarchy image and COW, 16 GiB retention, probe, workloads, replay rules, asset
pins and all original numeric performance budgets unchanged. E9-T22c owns the
next complete real-workload attempt; this task cannot pass C from a prefix.

## Acceptance criteria

- [ ] Authenticate the original eight-hour failure report and retained graph:
      17,550,000,000 transitions, 351 periodic checkpoints, 2,472 receipts,
      10,320 physical chunks, 2,822 reachable objects, no first frame and no
      other failure. Preserve the report and saved graph.
- [ ] Seal v11 to v10 by SHA-256 and prove that the only qualification change
      is the finite host-wall allowance, while the 20B guest-transition guard,
      clock/cadence, workload, source/asset pins, retention and original
      performance budgets remain unchanged.
- [ ] Prove the production desktop harness uses the declared wall allowance.
      A deterministic fake-clock boundary check must show that the old 8-hour
      point would refuse, 16 hours minus one millisecond admits and exactly 16
      hours refuses; reject a tampered profile or unbounded allowance.
- [ ] Record medium-risk affected harness/browser/build evidence at a clean
      exact head and obtain a fresh Daybreak verdict with one bounded novel
      clock-boundary attack. Do not claim full desktop qualification or timing.

## Deterministic acceptance

`make verify-E9-T22n` proves the retained exact-prefix oracle, v11/v10 policy
chain, fake-clock boundaries and affected built browser path. Run its selected
medium-risk gate once on the final frozen head. The next full acceptance is
still `make verify-E9-T22c` after this prerequisite is independently verified.

## Adversarial verification

Change the elapsed clock at the exact boundary; tamper with the predecessor
digest, wall field, transition ceiling or workload pins; omit a retained chunk;
try to pass by replaying only the incomplete prefix or by presenting a timing
claim. Check the active browser source actually consults the sealed profile.

## Verification log

### 2026-10-25 — worker — implemented, awaiting fresh Daybreak verification

At clean exact implementation head `7c5dd728fce680849a2dd6f5804c208a2af64059`,
`E9_OUT=target/evidence/e9-t22n-submission-7c5dd728f make verify-E9-T22n`
passed. The gate ran five deterministic boundary/source/asset tests, rebuilt
`web/dist` without a diff, loaded the actual desktop module in
Chrome `155.0.8059.86` with no console/page/HTTP/external errors, and rehashed
the original exported graph using `e9-workload-retained-closure.mjs
--allow-incomplete`. The browser proof's fake clock observed old-eight-hour
refusal, admission at the old point under v11 and at 16 hours minus 1 ms,
refusal at exactly 16 hours, and rejection of an unbounded/tampered profile.
The retained oracle authenticated 10,320 physical chunks, 2,822 reachable
objects, 352 witness pages, and the original failed report (SHA-256
`12b51f16c8502c9c4243e1c639c8d619a015c780bb5fa97630caa32fe224e593`).
The browser receipt records v10 SHA-256
`3e118664a0079556aa446066e1562649bcc7aabbccef00c78e426d2862000de6`
and v11 SHA-256
`cced6514f53c2d747a9faed7f8f7cefde82fbd1f832007e1b0c3b1ee3d230141`.
The desktop page reverses byte-for-byte to the old sealed page after only the
wall import/version/guard edits; original guest-transition, cadence, workload,
clock, retention, source/asset pins, and numeric performance budgets were
compared against the failed run. The software profile remained v10.

Evidence: `target/evidence/e9-t22n-submission-7c5dd728f/browser/report.json`
(SHA-256 `4d3055a5aa255d0c28fbf31b2c660611234fc5622408a0a0f2c306aeea0703ad`),
`browser/browser-trace.zip` (SHA-256
`94d0870fea6d1a8b9bd74d95406360984846e2a458f8e72824eef0fe391dce22`),
`prefix/retained-closure/report.json` (SHA-256
`95eedf1fd245c4bf5e7e97a997a199e45d52ef0a407fe95d88631d4bfeb99503`),
`boundary-tests.log` (SHA-256
`ccd12f72dcb673a2e0d01c4907b5e7cdc568fbd679f577f8e191a298b2a0e696`),
and `web-dist.log` (SHA-256
`2363603c7a1b1b18a5d21df32086668982187df29896cd4299e924429ce9c824`).
The graph oracle uses its explicit incomplete-prefix mode because this
retained source is the failed eight-hour run; this is not a claim that the full
desktop workload, GPU probe, replay, or original performance budgets passed.
