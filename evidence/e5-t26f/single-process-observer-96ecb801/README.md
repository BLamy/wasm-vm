# Post-SPP browser screen: timing failed

Producer: `96ecb801fdf8b67af75cd150db82d115bcf046cd`.
Command: `env -u RUSTDOCFLAGS node tools/verify/e5-t26f-browser-single-process-observer.mjs`.
Cold child exited 0; unprofiled reuse exited 1 at the unchanged two-second
assertion, proper runner line 1930. Outer exit 0 admits this diagnostic failure;
it does not verify F. Neither this screen nor the separate CPU replay is acceptance.

## Original unprofiled run

Original restore T0 `1177.8450000286102`, frozen end `5282.0199999809265`:
**4104.174999952316 ms > 2000 ms: FAILED**. The later interaction-object
timestamp is not substituted for either endpoint. Raw failure SHA-256:
`a25418d4dd387ae10af687e8cfffb615a3a74eb6bc1bd81aea88a50e10dfef96`.

The new cold profile and copied iteration bind the same runtime, origin, image
and actual Chromium identity. Snapshot `b9eac0eb045945eed648c90537a9e11819e882b7f4c57fb3bd2b9690513fce49`
is 2,808,262 bytes, with matching saved/first-present CRC `168fc7fa`. Served
WASM SHA-256 is `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`;
150-file runtime digest is `65935dd0535eb38ed23d78956f63ec800daf3f6bb63094c9c694e236786f74e1`.
The unchanged 1-GiB observer image is
`d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`.

Main viewed both `cold/resident-prepared.png` and
`reuse/failure-post-restore-interaction-checks.png`. They show two terminals,
matching pre-1/pre-2/post PID999/start28938, read-only FIFO3, parent writer3,
no child writers, PCM4 owned by999/PREPARED/zero pointers, and fresh visible
conditional completion. Numeric identity transcription is from the PNGs;
unprinted parent/inode equality is supported by the unchanged held helper guards.
Restore reaches physical cursor/focus/play input, ten matching keyboard edges,
fresh visible text, and attached/running audio with **1440 written, 1440 inspected,
1440 non-silent frames**. This is not an exact first-arrival or payload-length claim.

Daybreak's separate original-run audit lives in `../spp-runtime-verifier/`.
Later coherence, drag and second-reload phases are not reached. The cold browser
and HTTP error arrays are empty, but complete reuse error arrays are absent;
presentation-local empty errors do not prove the whole reuse had no errors.
Cold serial includes hwclock timeout and a DHCP lease failure followed by
background continuation. No clock fix or zero-all-errors claim is made.

The before/after JIT RPCs retain JIT enabled, decoded4096, repack-off24,
compile-queue256 and disabled entry-cost timers. Their sequential lifetime
counters are not exact T0/end measurements. Queue conservation holds:
2797 staged = 548 submitted + 260 popped-unsubmitted + 82 pending-depth delta
+ 1907 dropped; dropped = 1286 incoming-rejected + 621 resident-displaced.
These counters do not identify a cause or establish a stable speedup over older runs.

## Separate CPU diagnostic

`node evidence/e5-t26f/single-process-observer-96ecb801/run-cpu.mjs` was refused
by the proper runner's diagnostic-options guard before starting a server or
browser: CPU profiling cannot be combined with explicit JIT comparison selectors.
The original `cpu/` invocation, log and exit1 are retained. Its driver subsequently
reported the absent browser record; there was no measurement from that attempt.
No runner guard was changed.

`node evidence/e5-t26f/single-process-observer-96ecb801/run-cpu-default.mjs`
then ran once against a new copied iteration at the same frozen head. It removes
the explicit JIT/residency selectors and uses the proper runner's default `jit=1`
and loader's default `repack-off`. These are source/config defaults, not separately
captured before/after JIT RPC statistics in this CPU record. No latency, guest-PC,
COMPLETE, command, pacing, clock or budget override is present. Source pins and
HEAD are checked before and after; the original records and sealed baseline are
not rewritten.

CPU replay T0 `1150.2600001096725`, end `5173.460000038147`:
**4023.1999999284744 ms: FAILED**. Child1, diagnostic collector0. Raw SHA-256:
`677544f3f9137e7e542a9c4e2ad6b143bfd5f25659132e50cf2cb5ed085d95ea`.
It observes 1440 fresh non-silent PCM frames at completion. The saved worker CPU
profile has 2608 samples and SHA-256
`21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a`.
Profiling starts at `1916.6100000143051`, after restore T0; it does not cover the
whole acceptance interval. Sampling may perturb execution. It cannot replace the
unprofiled timing, establish exact per-function wall time, or demonstrate causation.

The offline mapping in `../spp-cpu-symbols/` authenticates all11 noncustom WASM
sections before applying1890 names. Named companion SHA-256 is
`372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116`.
`named-wasm-372815ed.wasm.gz` preserves it for later review; archive SHA-256
`5225951cfc6c9e67b1949b8348babb341f01d4b3b4c1f1740cb01c68aa687e63`.
`cpu-symbols-worker.mjs` is a byte-identical copy of the successful target driver
(SHA-256 `aea606c91b96c97159182309de3e2d3b42e4d26bbe74c74ffc1bcdd8732edd9f`).
The sidecar's original pre-generation wrong-expected-digest failure is retained;
its original full script was not preserved and the later minimal reproduction
is explicitly reconstructed, not original. See its `script-provenance.json`.
No second companion or guest run was needed. The sample denominator is3260775us;
`Machine::sync_plic` accounts for208905us (6.407%) self weight, not an exact
unprofiled cost or proof that PLIC selection explains F's failure.

## Reuse and completion boundary

All inputs, commands, exits, raw records and PNGs remain in their original paths.
The retained profile is named in `invocation.json`; drivers refuse output
overwrites. Any later HEAD/runtime change invalidates this historical seal.
Never rebind it. F still needs a complete normal `make verify-E5-T26f` and fresh
independent review; no Epic5 completion, merge, deployment or Omarchy claim follows
from these diagnostics.
