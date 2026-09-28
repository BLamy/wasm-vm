VERDICT: verified

Task E5.5-T03ar, worker submission `e36e1ebd`. This verifies preparation of the
new-kernel desktop pair only. Physical keyboard responsiveness is untested here;
AS and Q retain their separate acceptance gates.

## Predictions and evidence

- **P1 — HELD.** Independently hashed AQ Image
  `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`
  and extracted its 84-byte notes from System.map offset 19537624. Actual native
  notes match at `input-kernel-pair-r1/native/boot.stdout.log:425`, framed status
  zero at line 427 (log SHA `25ff25f23106ec415ce3ed71b76ecf6fdb16be5153ac2ca459dbdd0e487afa4c`).
  Cold-boot source is `c2cbcfd0`; all input/output bytes independently match.
  See `kernel-notes-identity.json` and `native-artifact-audit.json`.
- **P2/P2a/P2b — HELD.** Browser at `21b77bb0` serves the exact new native
  snapshot/delta and AQ Image, restores them, and reads the same candidate notes
  on the actual serial wire (`browser/desktop/report.json:4547`). Its notes RPC
  completes at 22:02:09.871Z before properties are sent at 22:02:09.906Z.
  Report SHA is `667d7d1528dab2bfa1198faf6d64a530cdf18ed26ffba79602650105cf0d7809`.
  Eleven independent notes mutations and fourteen source/provenance mutations
  reject old kernels, old RAM, mismatched bytes and artifact-key overrides.
  Actual-route ordering rejects old notes before any property write or export.
- **P3/P3a — HELD.** Native log lines 1315–1318 show `sync &&` followed by the
  genuine capture marker. Browser's one `sync` RPC completes at 22:05:34.453Z,
  before both idle persistence samples finish at 22:05:34.543Z. Exact native-pair
  seed selects the overlay namespace; guest stays paused during export. Prepared
  RAM and delta have matching canonical R3 base and generation **48**, with
  exactly **2750** ordered, unique, in-range delta blocks. Independent compressed
  and raw hashing is in `prepared-artifact-audit.json`; no serializer changes or
  repeated architecture proof was required.
- **P4 — HELD.** Native raw observations show mapped Foot PID 473, package-owned
  quickshell PID 484 and visible background/bar (`boot.stdout.log:1279`), LP1
  environment and one llvmpipe worker (lines 1284–1304). Native GL log contains no
  renderer string; no new GL-string claim is made. Browser's actual observations
  preserve AO WASM `36b4f1cc…27a916`, ICount64, cap256, preparation-only recycling
  off, 1280×800 canvas/GPU and 1280×832 resource. Direct opaque/RGBX are true, all
  three opacity values one, and all three overrides true in the actual RPC.
- **P5 — HELD.** I personally inspected the real saved `prepared-desktop.png`,
  SHA `a3b201ce2e00db5602df2b55f51b687af5524ce3d5f02dabb47487eb1de2e27b`,
  1280×800. It shows a readable empty `[omarchy@omarchy-demo ~]$` prompt inside
  full-size dark Foot, with the package bar above. Recorded frame/present counts
  advance **2→3** after property acknowledgment. The screenshot matching earlier
  pixels is compatible with a fresh repaint; no typed command or response is
  claimed. See `browser-record-audit.json`.
- **P6 — HELD.** Input suppression precedes navigation. There are zero physical
  events and no keyboard/mouse/tablet/agent injection calls or nonce writer.
  Parsing the actual serial byte stream yields exactly four successful RPCs in
  order: layers, kernel notes, direct properties, sync. See the independent
  `browser-record-audit.json`, bound to the original report digest.
- **P7/P7a — HELD.** Native exits zero in **3660.416s**, below its fixed bound,
  with no watchdog; its owned group 64485 is independently absent. Browser reaches
  the visible image in **237.648s**, exports in **75.084s**, and closes in
  **7.616s**, within its 900/180/30-second bounds. Parent recorder exits zero,
  closed, no watchdog. The corrected native cleanup also passes actual-process
  fixtures for an exited group, cooperative descendants and a TERM-resistant
  descendant after its leader exits.

## Refutations resolved during implementation

1. Original native timeout cleanup waited only for its leader and left a
   TERM-resistant descendant alive. Two independently repeated attacks proved
   that heartbeat still advanced. The fixed group-draining helper sends KILL
   after the finite TERM allowance and confirms the descendant is gone.
2. First browser notes call was placed after RAM capture. The actual-route test
   failed; the corrected route reads notes before properties and passes.
3. Extra artifact keys could override fixed kernel/chunk pins in the source
   guard. The preserved fourteen-case attack now rejects both overrides, and
   permanent unit tests cover them.

The native happy run carries across these harness-only fixes. The executing
guest, kernel check, snapshot trigger and serializer were unchanged. Each changed
failure/identity boundary was separately re-exercised; no stale success is used.

## Changed-hunk coverage

| Changed area | Coverage / disposition |
| --- | --- |
| `omarchy-native-capture.mjs`: optional notes selection/read/log | Actual native command, raw notes and exit; unchanged optional default behavior carries. |
| `omarchy-input-kernel-native.py`: input pins, launch, capture/audit, receipts | Actual native input/output hashes and 3660s run. Cleanup replacement is exercised independently by the preserved real-process fixtures. Last-resort OS race/error receipt branches are waived as diagnostic handling: they cannot grant `passed`. |
| `omarchy-input-kernel-state.mjs`: constants, notes/provenance/source guards and bounded request | Actual native/browser reads and source files; eleven notes attacks, fourteen source attacks, actual-route wrong-kernel rejection. Error strings and receipt fields are diagnostic-only. |
| `omarchy-desktop-live.mjs`: isolated route, kernel selection, source/report binding, notes-before-properties, sync-before-export | Actual final browser route/served-byte journal and independent serial audit; original/default routes covered by the 41 affected tests. |
| `omarchy-direct-opaque-preparation.mjs`: AR geometry selection and shared export deadline | Actual partial-damage baseline, full new frame, screenshot, and 75s export; existing negative geometry/property/export tests pass. |
| `omarchy-direct-opaque-command.mjs`: explicit additional audit commands | Actual wire has only layers/notes/properties/sync; original default audit regression tests pass. |
| `omarchy-prepare-input-kernel.mjs`: isolated orchestration, recording audit and paired artifacts | Actual closed recorder, exact native/report digests, input fence, four wire RPCs, runtime/property/frame checks and verified output bytes. Non-success receipt/error text is waived as diagnostic-only; existing owned-recorder timeout logic is unchanged. |
| Unit tests, Make target, task/queue and evidence metadata | Forty-one affected tests pass at the final browser freeze; the Make recipe's component commands were recorded incrementally. Declarative command routing and documentation are waived from runtime coverage. |

No Rust/runtime/web product code changed in AR. Existing serialization, rendering
and native/wasm proofs carry. Medium-risk local artifact preparation makes no
portability/deployment claim, so no new cold clone or broad workspace gauntlet is
required. Final browser has zero unexpected errors. The 18-file worker seal
`febd50e99b677ec4b6bfd7ef52f78ee5a40935b48ea02aae0b16708c751ff99d` and all 40
recorded helper digests were independently checked.

## Permanent artifacts

Promote the kernel-notes, exact artifact-role and actual route-ordering tests
already present in `tools/verify/`; retain `verify-E5_5-T03ar` and the executable
critic identity/process fixtures. No golden instruction trace is introduced:
this task changes preparation tooling, and its evidence is the actual native and
browser recordings plus byte-bound paired artifacts.

## Verified output

`target/omarchy-input-kernel-prepared-pair-r1`:

- RAM gzip: **205400326** bytes,
  `265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8`.
- Delta gzip: **1285559** bytes,
  `1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c`.

AS must use its uninstrumented physical keyboard/visible-response gate with AO
recycling on and original deadlines. AR verification alone does not solve or
publish desktop responsiveness.
