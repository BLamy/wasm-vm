# E5.5-T03v worker evidence

This submission demonstrates generated FEQ.S/FLT.S/FLE.S with exact integer
results, NaN-box rules and sticky invalid flags. **The actual Omarchy desktop
is still not responsive.** Its physical keyboard trial failed the unchanged
120-second nonce deadline and displayed no typed text. T03q remains gated;
the measured FADD.S/FMUL.S helper boundary is planned as T03w.

## Frozen implementation and exact browser artifact

Runtime, promoted worker/critic fixtures and built bundle:
`2e7cd66994e63c1ca39f492d49c5764a31c87739`.
The later `fe39233d` plans the next task, and `6b76f786` records only the
content-addressed deployment manifests. Neither changes runtime semantics or
WASM bytes. `submission.json` identifies final acceptance and cold-build heads.

WASM SHA-256:
`4e1dae976924fb1857a70fc1a8ec357e18475e15f4a8f74ef2980838d0a089dd`
(1,592,252 bytes; service-worker version `0385f10918f4`).

## Recorded behavior

`affected-commands.json` records all seven focused commands and successful
process exits. Native worker evidence covers 7,648 comparison cases (FNV
`5d33ab4828b8874f`), 80 handoff/fault/same-source cases, and real run-loop
FS-Off/later-fault prefixes. Exact assertions compare all X/F registers,
PC, trap parcel, FS, flags, frm and reservation with the interpreter, alongside
independent bit-pattern result and flag goldens. The digest label is deliberately
narrower than a full-machine hash; it does not include RAM or device state.

The independent critic supplies 2,016 literal/all-initial-flag cases, 4,608
seeded alias/FS cases (1,152 disabled-FP exits), and ten control/fault cases.
Native/private/shared receipts agree: literal FNV 4642228140795119653,
seeded FNV 5348346956590961504, control FNV 14645582373884930759.
Actual same-/cross-module links execute at fuel6, refuse entry at fuel2,
and retain flags on precise successor faults. Actual browser memory growth
covers success, growth-store failure and a subsequent load failure. A real
interpreted CSR-only clear with unchanged FPRs proves stale NV is not revived.
See `acceptance.log` and the sibling `fp-comparisons-verifier` directory.

A pre-freeze combined Node process printed successful tests but failed to exit;
its stop receipt remains incomplete evidence. An instrumented worker-only
rerun exited normally without source changes. The final ordinary combined run
at the frozen head passes both worker and all six critic WASM tests and exits
normally. No forced process exit or test-runner modification hides the earlier
stall. The critic's isolated wrong-golden experiment fails actual1/expected0
for FEQ(+0,-0), then passes after the expected value is restored.

The built-browser fixture is an actual ELF running through WasmMachine. It
retires 4,000 instructions, 3,621 via compiled code, with 31 host entries,
1,115 direct entries and 1,084 links. Its RAM-only SHA-256 is
`02de371a30fadf1337684a3e37cdeef855f7783c15e77632fe6e6b05b3cc565e`;
the harness separately compares exposed integer registers, actual FPR spills,
fcsr-derived flags/frm/FS and execution statistics with the interpreter.
The ELF SHA-256 is
`3b5d782bf228c0c9ef8d1960f4f1dafe60510e67d6fc53f3ac500bfc10248dff`.
All 127 live ISA tests pass with zero page/console/HTTP errors, and the comparison
capability is live1/1. The legacy capability container is revealed only for
its labeled inspection screenshot; the physical desktop trial has no hooks.

## Actual physical input: failed

Command: `node tools/verify/omarchy-desktop-services.mjs
evidence/omarchy-profile/fp-comparisons-r1/physical-input`.

The unchanged R3 snapshot/delta/kernel/chunks, original 1280x800 mode,
cache/batch settings and deadline are bound in the complete receipt. Enter
completed at `2026-09-15T20:41:37.042Z`; the deadline remained exactly
`2026-09-15T20:43:37.042Z`. The failure callback ran two milliseconds later.
All 128 keyboard events were trusted and accepted, with none pending, dropped
or rejected. Thirteen independent file reads returned exit75 and a fourteenth
was pending at timeout. The generated nonce never entered the serial wire.
Frames remained2→2. The actual Foot image contains no typed text; the fresh
critic also confirmed failure.png is byte-identical to desktop.png.
Guest retirement advanced1,615,987,937→2,870,438,905 and final JIT share was
0.3979468704281654. These are recorded counters, not a controlled speedup claim.
The owned browser closed normally with no watchdog and no competing task-owned
build during the input window. `physical-summary.json` links the full report,
whose SHA-256 is
`5c09fcb09292d86025ccb0f9c950697e3a8d2f7b3064dc72f99c5858308c145f`.

## Local gauntlet, pristine clone and publication

`ci-commands.json` and `ci.log` retain the prescribed `make -k ci` and exact
outcomes. The broad gate is not green: the existing Linux-only wvseccomp
compile on macOS, all-feature dead code, stale VIRTIO_RNG resume assertion,
zicsr-stub helpers and lexical test-clock scan remain outside this change.
`unchanged-gate-files.json` binds those source boundaries to verified T03u.
The native ISA suite passes 128/128; the uncontended performance smoke result
is 25.6 MIPS against the 15 MIPS floor. The focused gates cover the changed FP
control boundary and preserve previous
move/memory/precise-trap proofs; unchanged verification results carry forward.

`cold/report.json` records the one final pristine clone with RUSTFLAGS,
RUSTDOCFLAGS, RUST_LOG and CARGO_* scrubbed. It records the committed and rebuilt
WASM digests and every acceptance process result. Its own browser captures and
report live in `cold/browser`. No modified checkout is substituted for it.

`cloudflare-deploy.log` records publication to
https://fb8fea2d.wasm-vm.pages.dev and https://wasm-vm.pages.dev.
`cloudflare-public.json` records eight TLS-verified exact-byte checks of the
WASM, glue, roadmap and app document across both origins. The deployed capability
is comparison support, not a usable-desktop claim. All PRs remain open.

`sha256.txt` seals the evidence files; the task log records its own digest.
