---
id: E6-T12e3b
epic: 6
title: Bound high constant uploads and active renderer reflection
priority: 525.02699035
status: verified
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

### 2026-10-03 — verifier — VERDICT: verified

Fresh independent critic `/root/constant_transport_verifier` recorded 20
predictions before inspecting the implementation/evidence, then reviewed the
diff from verified `5af5600c33c69e926c96a3dc82369c31da391565` to frozen
`81cd3a4c403176be4b0191fa00ed37f4fd1e1e35`. Worker claim
`68186f6edf63a6f3c0e2160892a2bc5b868ab8f8` changes no runtime/harness after
that freeze. A separate read-only helper audited evidence/source/clone binding.
No implementation fixes were made by either verifier.

- P01–P04 — HELD. Independent decoder sweep passed 1,046 cases with four new
  seeds, including exact limits, finite raw bits, non-finites, truncations and
  detached ownership. Recorded malformed tails apply zero commands; semantic
  failure after valid short prefixes preserves their truthful applied counts.
  Every runtime upload is bounded to 184 words; all 432 worker native objects
  and all state/resource budgets are released.
- P05–P10 — HELD. Full native/Wasm/actual-GL text binding holds for 19 originals
  and 8 exact fixtures. Actual extents are 46/46/46, 47/47/46 and 46/0/0 as
  claimed. Both poisoned host-only elements 46 remain unchanged. Independent
  stage-limit neighbors reject 183/187 and accept 184/188, respectively, in both
  VS and FS. Additional invalid metadata and host-limit attacks reject with
  exact late-VS-UBO cleanup; all 15 worker reflection rollback cases hold.
- P11–P17 — HELD. The helper independently interprets original TGSI/raw packets
  and reconstructs every byte of all 44 worker and cold framebuffers, without
  generated GLSL or reported expected colors as its oracle. Independent new
  asymmetric VS/FS owner attacks pass 19,654 assertions / 19,456 hardware pixels,
  including short replacement, A/B/A switching, numeric-ID reuse and detached
  async input at seeds `6da0c389`/`db81295b`, step budgets 4/7. Short state fails
  before index staging/draw; the pre-existing async drain fence may still be
  issued and collected. Independent served-source FS CONST45→CONST5 upload
  sabotage compiles, links and draws, then fails at pixel (4,12): expected
  [96,128,159,159], observed [191,223,255,159].
- P18–P20 — HELD. Source-bound V8 evidence accounts for all 20 added executable
  runtime lines, with no executable runtime waiver. The helper verified 431
  source bindings, 32 worker records, 35 copied cold artifacts against the
  retained clean frozen clone, hostile environment scrubbing and all 13 claim
  digests. Production activation remains disabled; no desktop performance or
  real Mesa execution claim is made.
- SUITE: committed verifier-owned raw decoder sweep, asymmetric hardware/async
  attacks, exact component-limit neighbors and alias sensitivity test are
  promoted as repeatable deterministic harnesses. Binding/coverage audits stay
  as reproducible frozen-record checks. See verifier `README.md` for commands
  and `findings.md` for all prediction citations and diff classifications.

Commands (repository root):

```sh
node evidence/virgl-constants/verifier/decoder-attacks.mjs
node evidence/virgl-constants/verifier/run-attacks.mjs normal
node evidence/virgl-constants/verifier/run-attacks.mjs alias-sabotage
python3 evidence/virgl-constants/verifier/coverage-audit.py
python3 evidence/virgl-constants/verifier/binding-audit.py
python3 evidence/virgl-constants/verifier/binding-audit.py evidence/virgl-constants/cold-clone/acceptance evidence/virgl-constants/verifier/binding-cold-acceptance-audit.json
python3 evidence/virgl-constants/verifier/binding-cold-claim-audit.py
python3 evidence/virgl-constants/verifier/final-audit.py
```

Evidence under `evidence/virgl-constants/verifier/`:

- `final-audit.json`: `07fde5d83336cd29e7c4b271bab7bfd1be9b70aa1bff6e4afca0c8bfd4b9bacf`.
- `findings.md`: `f8612dbb103db9017f0b5f7c8b42c30bded88bb1117ba73a71bc1f4b170666ac`.
- `normal/report.json`: `6847cad502aa615bac799bb7ff0e123b1be3b2f1a4bca356ce1056873c94a38c`.
- `alias-sabotage/report.json`: `0a291b4217a6ceace7bf0fccf23592259855e070d1a24c3e9947f333ac2115bb`.
- `decoder-attacks.json`: `bdc65c03ff34dffebc569fc455a43dc83db29706be387d389b4f253478f4b202`.
- `coverage-audit.json`: `1b73b69eb038529d49e83cd81fd5415f417a40379a1872032af0888e6bbf91d2`.
- `binding-worker-audit.json`: `356f2691034b652399e9d5bdbdd1db21bbf3c73ab934979c29b79d25aaaf579d`.
- `binding-cold-acceptance-audit.json`: `048f4089c498e2a1584c0c9cd71f488ef2266af9a2dd5ba2b030884b823543f3`.
- `binding-cold-claim-audit.json`: `f8c9067fd9c54f9d5781ececb3310e3a9aa429c54ac7754b505dbfd86e399ae8`.
