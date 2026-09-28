# T03i — divider 1 is insufficient in the matched R3 trial

This is a negative diagnostic, not a fix or a 120-second nonce acceptance.
The headed browser exited 0 after the final screenshot. No production,
image, renderer, cache, emulator-code or additional clock-setting change.

Frozen head: `26085068dd2b892f4c2ab585e3461c3f91aefe6a`.
The four recorder helpers are byte-identical to T03h. The actual served core,
kernel, manifest and R3 RAM/disk pair are unchanged; `identities.json` records
actual restore, headed mode, ICount divider 1 and JIT on. Default decoded
cache 4096 and repack-off residency cap 24 are observed, not just requested.
The helper head differs only through subsequent offline evidence/task work.

```sh
node tools/verify/omarchy-input-diagnostic.mjs \
  evidence/omarchy-profile/timer-sensitivity-r1 1 1 \
  --pair-directory target/omarchy-sdr-r3-snapshot \
  --chunk-dir target/omarchy-profile-chunks-sdr-r3-256k --headed
```

Recorded command stream:

```jsonl
{"op":"stats"}
{"op":"screenshot","name":"before-input.png"}
{"op":"type","text":"x","delay":100}
{"op":"stats"}
{"op":"screenshot","name":"after-input-immediate.png"}
{"op":"stats"}
{"op":"screenshot","name":"after-input-window.png"}
{"op":"quit"}
```

Trusted, canvas-focused KeyX down/up occurred at 03:47:21.568/03:47:21.681
UTC on 2026-09-14. Keyboard/sync calls 92/93/95/96 all returned true by
03:47:21.792. Immediate stats had two pending events; the endpoint had zero.
Neither observation proves Linux/compositor input consumption. No explicit
diagnostic serial command was sent. The app's implicit readiness commands
and 190 length-only agent messages remain recorded limitations.

| Observation | Retired instructions | Guest clock ticks | Received/presented frames |
| --- | ---: | ---: | ---: |
| Immediate, 03:47:22.330 | 60,492,833 | 1,400,453,662 | 1 / 1 |
| Endpoint, 03:49:44.559 | 658,440,743 | 1,998,401,557 | 1 / 1 |

Over 142.229 host seconds, 597,947,910 further instructions retired and
59.7947895 guest seconds elapsed. Clock and instruction RPCs are sequential,
so their delta difference of 15 is not a clock-accuracy failure. T03h's
divider64 window advanced only 1.6749978 guest seconds in 140.384 host
seconds. This is a timer-rate effect, not a 64-fold host speedup.

The coordinator personally inspected the immediate and endpoint screenshots:
actual Foot/bar, real boot dialog, and **no x**. The endpoint's pixels match
the baseline (SHA-256 `eb4b181d…`). There was no new frame to present during
the window. Faster guest time therefore did not restore a visible physical
response in this arm. No more divider exploration is selected. The next
bounded investigation is the exact recurring-block admission witness from
T03h, without presuming that the aggregate drop count proves the cause.

Offline reproduction: `node evidence/omarchy-profile/timer-sensitivity-r1/audit.mjs`.
The adjacent `audit.json` binds file digests, actual served bytes against the
frozen head/baseline, the unchanged pair and physical event/acknowledgement
records. It is explicitly diagnostic-only. Fresh critic verdict is pending.

Raw SHA-256:

- diagnostic.json: `710b3705e3daed7c82db5c09a1b5d17ac1f5f0d3706b7010535079091a5708f0`
- identities.json: `d75f6b6d63aeee69e4a7aaef6af2ed2a9442acded22dc190575a64012d8f2c33`
- wire.json: `f20726ca47d71c7936a9d1e31bad1a134119033fa0554282fa19b431ba0e97a8`
- before-input.png / after-input-window.png: `eb4b181dc1480935a2ef49f1480d082eeb8371d5229dbef13a473b1c05c3da3e`
- after-input-immediate.png: `e9e97d1afcbaf32fba419933c1ac580983d21901d6d195e9c710258776533ee9`
