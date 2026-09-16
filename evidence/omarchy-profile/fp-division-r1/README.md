# E5.5-T03z division worker evidence

The boundary is FDIV.S through a pure packed-result software helper, with
existing FS/rm/source-box guards and FPR/flags publication. Optional helper
indices follow arithmetic, from-integer and to-word imports. The three older
native verifier rejection witnesses change only from newly admitted FDIV.S
to still-unsupported FSQRT.S; their other assertions stay intact.

## Independent arithmetic preflight

`derive-goldens.py` uses Python exact rational arithmetic, not the emulator
backend or host floats, to derive 39 operand pairs across all five rounding
modes. It canonicalizes malformed source boxes and handles exceptional operands
separately. Tininess is determined by precision-24 rounding with an unbounded
exponent, separately from final subnormal rounding. The resulting JSON is
expanded as literal assertions in the actual generated-module fixture.

`backend-preflight.log` records 16 missing exception-flag results in the
unchanged software backend: six missing UF flags for tiny values rounded to
the smallest normal and ten missing OF flags for directed finite overflow.
All result bits match. `backend-before.json` identifies the original source
and log. The correction changes F32 division flags only, with exact normalized
integer-significand comparisons. Other operations, F64, result bits, decoder,
interpreter, handoff ABI, scheduler and guest artifacts are unchanged.

The corrected direct regression passes. Native actual generated-module
preflight passes three tests: 30,720 corpus cases (register/flags FNV
`fc9d8c60370e34a2`), 80 CSR/later-fault/invalid-prefix/alias cases, and three
actual machine-run-loop traps. The corpus covers 39 pairs, all encoded and
dynamic rounding/FS combinations, writable f0/f31, seeded raw/malformed boxes,
sticky flags and all architectural registers against the interpreter, then
checks the independent literal results and flags. These are pre-freeze checks;
the final frozen recording, build, browser, physical and deployment proof
will follow separately.

Worker private/shared WebAssembly tests pass 2/2 with normal exit. Each runs
the same literal/differential corpus, CSR/fault cases and real run-loop tests;
their runner suppresses the passing test's eprintln digest, so the native
worker digest is not presented as a separately printed WASM receipt. Production,
core-fixture and native-worker Clippy pass. The fresh critic separately records
native/private/shared digest agreement in its own logs.

## Built-page self-check before freeze

`make tasks-json` and `make web-dist` build 1,597,495-byte WASM SHA-256
`1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`,
with service-worker version `d4e82fe7e700`. The preflight browser records the
activation HEAD with an uncommitted implementation; it is labeled self-check,
not the final frozen proof. It passes all explicit integer/FPR spills, flags,
frm/FS and interpreter comparisons for 5,000 retirements, 4,601 through JIT.
The guest exercises directed finite overflow, tiny values rounded to normal,
divide-by-zero, invalid zero division, dynamic rounding, and mixed arithmetic
and both conversion imports. All 127 live ISA tests pass with zero errors.
Root inspects all three captures: green 127/127, the division capability live
1/1, and the correct T03z task detail in the 322/498-task bundle.

Guest ELF SHA-256: `b587726be44a8f2ced1e146946861bd5db0d2492b1575eb6eb80c70ec88bbe46`.
RAM-only digest: `fba6d266740297e684328e066f7b134589bcbf96acc2320629cc44563602a6ca`.
This is not a full-machine digest or a desktop response verdict.

## Frozen affected submission

Runtime, fixtures, harness, policy and built dist are committed at
`f7bcf1a5dfee5c69e69fbe2994bcb8c754e5d64a`. The final affected recording
(`record-submission.py affected`) passes all 11 commands, from
2026-09-16T00:37:35Z through 00:43:13Z. It includes production and fixture
Clippy, software-FP regression, core handoff, the previous FP families and
precise traps, native FP ISA parity, the WASM library, no-host-float enforcement,
and the six-target division acceptance (18 tests) with the actual built page.

The final `browser/report.json` repeats the literal architectural results,
5,000 retirements/4,601 JIT, exact ELF and RAM hashes above, and 127/127 live
ISA results without browser errors. Root viewed all three final PNGs. The
fresh critic independently reconstructed the full 8 MiB guest RAM from the
ELF and seven literal FPR stores and matched the digest; this is stronger
than interpreter/JIT agreement alone. Actual desktop acceptance is separate.

## Actual desktop result: failed at the unchanged deadline

`node tools/verify/omarchy-desktop-services.mjs .../physical-input` ran alone
with no competing build, using the committed binary and unchanged R3 artifacts
and settings. Startup qualified in 130,927 ms. All 128 physical events were
trusted and accepted; Enter was at 2026-09-16T00:45:57.719Z. Thirteen completed
independent file reads returned 75; one remained pending at the original
00:47:57.719Z deadline. No nonce or typed output was demonstrated. Frames stay
2→2 and the personally inspected baseline/failure Foot PNGs are byte-identical.
Browser errors are empty and cleanup closed normally without a watchdog.

Raw report SHA-256:
`6c220572738d7bcb6a7a03c184823a2dbf310dc1f0492a7f66a8262eb455425e`.
`physical-summary.json` preserves the precise times, nonce, file and counters.
The recorder's deadline exception is an acceptance failure, not evidence that
the guest crashed or that its eventual response was impossible.

`admission-summary.json` derives only interval arithmetic from the raw report:
1,311,948,497 instructions retired, 428,254,746 through JIT (32.642649%). The
tracking map stays at 65,536/65,535 entries; full-map refusals grow from
10,348,545 to 27,786,503. This motivates pending T03aa's single existing-policy
control/candidate trial after the measured FP families became admissible.
It does not establish a cause, a speedup or a desktop fix. T03q stays gated.

## Published artifact

`bash tools/deploy-cloudflare.sh` publishes the frozen bundle at
https://1a65f9cb.wasm-vm.pages.dev and https://wasm-vm.pages.dev. The worker
`check-public.py` verifies eight HTTP 200 responses: WASM, generated JS,
roadmap and app page at both origins all match local SHA-256 values exactly.
Deployment only rewrites the four committed artifact manifests to the
existing content-addressed R2 URLs; their commit is `619a569e`. Runtime source
and tested WASM remain unchanged. This is publication of the tested instruction
capability, with no claim that the actual desktop has become responsive.

## Full local gauntlet and inherited failures

`record-submission.py ci` records `make -k ci` from 00:48:34Z to 00:58:33Z
on 2026-09-16; it exits 2 and is not described as green. The same five targets
as T03y fail: clippy/test hit the Linux-only wvseccomp libc APIs on macOS,
clippy also hits existing all-feature dead methods; wasm hits the old
VIRTIO_RNG resume-section assertion; test-riscv hits zicsr-stub methods missing
from its test build; determinism flags the pre-existing GPU test-only Instant.
The eight unchanged source/dependency boundaries are recorded separately.

The native ISA regression wall passes 128/128 with corpus FNV
`12ffd571f24eb40e`; the release ALU smoke median is 24.8 MIPS against a 15 MIPS
floor. These broad checks do not measure desktop responsiveness. The recording
starts at f7bcf1a5; only pending-task metadata and deployed manifest commits
occur during it. All runtime and test source remains the exact frozen source.

## Final pristine-clone proof

`run-cold.py` clones and checks out
`619a569e4f97ad3d7d68dbf68fb8c3693082da79` in
`/private/tmp/wasm-vm-fp-division-cold-bpv12v0l/repo`, asserts a pristine tree,
and removes RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG and every CARGO_* override.
`make web-dist` reproduces the exact committed 1,597,495-byte WASM hash.
`make verify-E5_5-T03z FP_DIVISION_OUT=.../cold/browser` then passes all
six targets/18 tests and the production browser proof at 01:08:38Z.
The browser again records 4,601 JIT retirements out of 5,000, the exact RAM
digest, 127/127 ISA tests and zero errors. Root views all three cold captures.
All command exits and timestamps are in `cold/report.json`; no second cold
run or runtime change occurred. The real desktop failure remains unchanged.

Primary references:
- https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/f32_div.c
- https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/s_roundPackToF32.c
- https://docs.riscv.org/reference/isa/_attachments/riscv-unprivileged.pdf
