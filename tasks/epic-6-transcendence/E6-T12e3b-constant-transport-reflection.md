---
id: E6-T12e3b
epic: 6
title: Bound high constant uploads and active renderer reflection
priority: 525.02699035
status: implemented
depends_on: [E6-T12e3]
estimate: S
risk: high
capstone: false
---

## Boundary

Carry the separately verified CONST0..45 shader bank through slot0 VS/FS
SET_CONSTANT_BUFFER transport, reflection, restoration and draw completeness.
Accept at most184 words /46 vec4s per stage; preserve whole-vec4, finite-float,
stage/slot and whole-submission validation. Integer constant semantics remain a
separate boundary. Preserve immutable context/subcontext snapshots and exact
generation ownership. Do not raise the unrelated system-UBO byte budget.

Distinguish the addressable46-entry bank, upstream declared uniform extent
(possibly47 for disjoint CONST45 then CONST0 declarations), actual driver
reflection (which may retain that unused suffix), and the guest addresses the
shader can actually read. Reject guest addresses beyond45; a retained reflected
extent47 alone does not imply that CONST46 is addressable.
Use actual host per-stage limits and successful linking; metadata must describe
the actual declaration. Upload only the admitted addressable prefix. Missing data
that an active shader can read must fail before drawing, never reuse stale
uniforms or silently invent guest inputs. Any padding or inactive suffix policy
must be explicit and proven separately from required data.

Use the conservative reflected-prefix policy: keep compiler metadata unchanged,
record the actual reflected extent, and require/upload min(reflected extent,46)
vec4s. A wholly inactive array requires/uploads none. A driver retaining46
entries for a shader reading only CONST7 still requires46 guest vec4s under
this policy; do not claim exact source liveness. Do not upload or clear retained
host-only element46. Query real per-stage uniform component limits and preserve
successful linking as the authoritative packing check. Existing restoration of
incomplete state may initialize legal missing words for safe state changes, but
that must not satisfy draw completeness or retain an earlier guest suffix.

## Deterministic acceptance

`make verify-E6-T12e3b` validates literal raw184-word packets, rejects188 words,
non-vec4 lengths and stage/slot neighbors before effects, then executes actual
renderer draws reading CONST45 in both VS and FS. Prove both declaration orders,
optimized-out tails and fully unused constant declarations through native/Wasm
translation, actual link reflection and independent vertex/pixel oracles.
Record bounded memory ownership, source identities, deterministic raw command
evidence, exact-head and pristine-clone proof. Preserve original shader/state/
draw regressions and the12/19 unchanged shader result. Production stays off.

## Adversarial verification

Poison low/high uniforms and switch A/B/A contexts and subcontexts. Destroy and
reuse numeric IDs, supply one fewer required vec4, and verify rejection leaves
state and budgets unchanged. Distinguish unused declarations from active reads;
attack declared47/retained47/addressable46 and required46/provided45 without
off-by-one aliases. Poison any retained unaddressable host padding and prove
that it cannot become a guest input.
Sabotage high-index upload or context restoration and require an independently
computed hardware output to fail. Do not use the lowering itself as the oracle.

## Verification log

### 2026-10-03 — worker — activation

E6-T12e3 is independently verified at
`5af5600c33c69e926c96a3dc82369c31da391565`. Its shader frontend remains unchanged
for this slice. The selected implementation changes only bounded constant
transport and shared renderer reflection/restoration/completeness. Empty and
short uploads replace the stored prefix; a later rejected draw reports earlier
valid applied commands truthfully. Malformed packet tails remain whole-submission
rejections before effects. Tests isolate rejected draws after prelinking so
program creation does not masquerade as a draw rollback failure.

An independent scan of the original hashed command blobs found a maximum32
uploaded VS words and4 FS words. The large-bank shaders were compiled but not
executed in those captures. Therefore the184-word boundary requires authored
literal raw packets and actual renderer output, while original captures remain
unchanged regression inputs. No high-constant original execution is claimed.

### 2026-10-03 — worker — implemented

Frozen runtime and acceptance harness:
`81cd3a4c403176be4b0191fa00ed37f4fd1e1e35`. The final gate and pristine clone
both passed on their first recorded run, without a runtime or harness repair.
Commands:

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
VIRGL_CONSTANT_EVIDENCE_DIR=evidence/virgl-constants/worker make verify-E6-T12e3b
python3 tools/virgl-constants/cold.py --output evidence/virgl-constants/cold-clone
```

Claim: the shared sync/async renderer accepts at most184 finite float-bit words
per VS/FS slot0, keeps immutable per-context/subcontext values, and requires the
complete conservative reflected legal prefix before index reading or drawing.
Actual Metal reflection is declared/active/upload46/46/46 for both high and
low-read shaders,47/47/46 for both ordered declarations, and46/0/0 for wholly
inactive declarations. Measured stage limits are4096/4096 components. No upload
or restoration writes host-only element46. Two distinct actual poisons there
survive restoration with unchanged correct output. Incomplete restoration zeros
missing legal words but short/empty guest prefixes never satisfy draw admission.

The record contains23 literal raw packet cases with exact Node/browser parity;
27 native translations (all19 unchanged original bodies, still12 accepted and7
PRECISE rejections, plus8 exact authored hardware strings);44 actual renderer
framebuffers /45,056 independently checked pixels;10 actual hardware rigs;
25 separately labelled real-GL pass-through validation rigs; A/B/A context and
subcontext switching with identical numeric shader handles; destroyed/recreated
IDs with empty banks; malformed-tail zero-effects rejection; truthful applied
prefixes on later semantic failures; low/high uniform poisoning; and caller
mutation after synchronous predecode and asynchronous begin. Four deterministic
async schedules use seeds7c1209ad/491be583/ea016f35/265d8cb7 and command-step
budgets1/2/3/8, with short/empty rejection before index/PBO work and recovery.
All owned state/resource budgets and native GL objects return to zero.

The served-source high-upload control truncates only actual uniform uploads to
180 words. Both shaders compile and link successfully, but high VS input is
missing and the first independently expected pixel fails: expected
[64,191,128,191], observed the untouched blue clear [0,0,255,255]. This directly
exercises the new transport/restoration path without changing shader source,
compiler output or authored command inputs. All browser runs have zero console,
page and request errors. Original resource/state/draw/async replay (210 packets,
three original draws /768 pixels) and both async ordering controls pass; flat
interface/variant regressions retain114 pair cases and8+44 actual draws.
The unchanged frontend's sanitizer and bank semantics are carried from verified
`5af5600c33c69e926c96a3dc82369c31da391565`; source hashes and every original full
translation result are checked, not just the accepted count.

Evidence (`evidence/virgl-constants/worker/`):

- `receipt.json`: `b8c266ccb74028314366b0ed556377b6e2ca49bff9234734fa1b9f6aeab014d5`.
- `native/native-report.json`: `1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef`.
- `decoder/decoder-report.json`: `7dcbfe96253cac18e65b530aa40554e2b5587d9f3772c575ff2ca6e4c0c2767f`.
- `hardware/report.json`: `605e77cc268e735c2fb572b0a69c5b9e8dd41369753a45f5a7f32b25aa6856d4`.
- `hardware/browser.png`: `5af110fd7ffb94ba1322c05e619d4ab85616ca1432773a35ebc85a91eeda003f`.
- `sabotage/report.json`: `32c15f3dfbd79a2e2d387c717ea00343223389f3d802709c0bea88d087de7d77`.
- `regression/receipt.json`: `5399f92c13de24443d92594d6ce1d8b30e69032a03ca67ec6ff71516c8bc29f2`.
- `flat-regression/report.json`: `41523722092f070afa5cfc8eca424a0ba2a25bc2d6b18b0ad77847c8946b4d99`.

Cold clone (`evidence/virgl-constants/cold-clone/`):

- `report.json`: `66cd6d29faf2546c1c46171f4ef86f4947c3f041482887732538030d3bd1118c`.
- `acceptance/receipt.json`: `3a17a70e164e0a43704473efa6e52dbd0a6233ffcfdfaeb045cbdb174ba3589a`.
- `cold.log`: `6fd21e47c64838b559906456e434e204ea9a24a57529aec28ae8e459dd5334be`.
- `acceptance/hardware/report.json`: `d3c3067dd5531557426f90c3564aac5b39119b01db6ab57819dfbd77106539c4`.
- `acceptance/hardware/browser.png`: `68596dbcbf2e33899169f8b5566a60809f6cb19f2d8840aa4828f6a6dca8de64`.

All32 worker record digests and35 copied cold artifact digests were independently
rechecked. The clone starts and finishes clean at the exact frozen head with
scrubbed toolchain/build environment, and remains at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-constants-cold-ghchol34/wasm-vm`.
Screenshots were visually inspected. The root receipt reconstructs complete
framebuffers, literal packet bytes and raw bank words without calling the
translator or decoder as its oracle. Driver-pruning wrappers are validation-only;
only actual inactive declarations and actual retained extents are GPU facts.
This remains an isolated renderer proof: no new guest execution, production
advertisement, live deployment, FPS improvement or300-MIPS desktop claim.
