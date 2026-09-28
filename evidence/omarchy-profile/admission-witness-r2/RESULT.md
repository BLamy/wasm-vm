# T03j R2 — actual refusals, missing hot-block contribution

Diagnostic only. Omarchy responsiveness is still unresolved; no production
deployment or physical-input acceptance is claimed.

Frozen recording head: `55b4475faeae7892ef0a1a8482e66f127de2a980`.
Observer/runtime implementation: `5ee8ed607027731bd9a50a132205c7bb42574e69`.
Served WASM SHA-256:
`2c8e48ff31c510099f719e849b760e878f6c1c0ec568e4a4aac1336af7520777`.
The same R3 LP1 kernel/RAM/delta/base-manifest pair restored successfully,
with divider64, JIT on, decoded cache4096, repack-off cap24 and probe actually
enabled. No profiling/timing mode or policy override was selected.

Command: `node evidence/omarchy-profile/record-admission-boundary.mjs`.
The child recorder and exact arguments are in `../admission-witness-gates/record-r2.log`.
The browser closed normally after its final screenshot (`exit=0`).

## Observed boundary

- Ready receipt: 04:59:25.348 UTC; first positive refusal report:
  **05:01:59.682 UTC**, received 05:02:00.752, inside the 300-second warm-up cap.
- The first positive report is the retained measurement baseline. Generation5
  is unchanged through the final report at **05:04:01.392 UTC**: 121.710 seconds.
- Observed interpreted entries increase by **17,094,482**. Full-map refusals
  increase by **1,044,606**. This is an entry ratio, not retired work or CPU time.
- The first-seen sample contains 32 exact identities. All are translator-eligible
  and have 2–10 recorded full-map refusals at the baseline. Their total entries
  since retention are 10 or 24 each, well below the default threshold512.
- **All 32 have zero entry/refusal delta in the measured interval.** They do
  not identify the hot code responsible for the additional refusals. The sample
  missed that contribution; neither its absence nor the aggregate count proves
  a desktop-stall cause or warrants claiming an admission-policy fix.
- The map is not continuously full: counts65536 at baseline, 65521 at middle,
  and65536 at final. None of the retained exact requests is in either queue;
  their physical PCs are not resident at those report points. This is not an
  exact/historical installation claim.

The coordinator personally opened the actual initial and final PNGs. Both show
the real Hyprland bar and Foot behind the slow-desktop readiness overlay. They
are byte-identical (`eb4b181d…da3e`). No keys, pointer input or explicit guest
commands were requested. Existing app readiness commands and 328 opaque agent
messages remain disclosed observer activity, not an observer-free claim.
Native checks could overlap, so no host-performance comparison is made.

## Receipts

`node evidence/omarchy-profile/admission-witness-r2/audit.mjs` completed
successfully and emitted `audit.json`. It binds all 83 served responses, frozen
helpers, restore/policy identity, input absence, authorized implicit serial
commands, precision/bounds/reason accounting and the same-generation interval.
This coordinator audit is not the separate verifier's verdict.

| File | SHA-256 |
| --- | --- |
| diagnostic.json | `513489a742d1db018a30bb93eb989a27b93eb75fbc30ceeaa6337901889b415d` |
| identities.json | `ce971fff2ad9e57945e3990c1389de7663d298a609f95f09caf6b58fb49ce14b` |
| wire.json | `b88fef6ed0843abcbf335714e3269923e4f0ca277f17f625f23e315e1ebe09f5` |
| initial.png / final.png | `eb4b181dc1480935a2ef49f1480d082eeb8371d5229dbef13a473b1c05c3da3e` |

R1 remains preserved as a separate missing-boundary result; R2 does not turn
it into a positive observation. The unchanged 120-second physical nonce/readback
acceptance in the actual desktop verifier remains outstanding.
