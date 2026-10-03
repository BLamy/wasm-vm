---
id: E6-T12a
epic: 6
title: Decode captured VirGL packets with bounded portable byte parsing
priority: 525.02692
status: implemented
depends_on: [E6-T10d]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement a byte-addressed portable JavaScript module shared unchanged by Node
and browsers. Decode and syntactically/profile-validate the original eight
E6-T10b textured-scene submissions into typed commands. This boundary does not
look up resource/object identities, execute state transitions, call WebGL,
translate shaders, modify guest memory, complete fences or advertise guest 3D.
Those identity and execution checks belong to the following S tasks.

Use pinned VirGL 1.3.0 protocol fields and explicit little-endian reads, including
nonzero-offset byte views. Validate submission alignment, header/payload bounds,
fixed and variable payload lengths, enum/flag fields, finite numeric fields and
documented count/slot/size budgets before returning a result. Extract each
supported field, including shader text framing, without replacing recorded
bytes or treating a capture hash as an input allowlist. Reject unknown commands,
unknown object types, malformed shapes and unsupported active feature values.
Document the accepted profile and distinguish structural errors from unsupported
features. Resource handles remain bounded wire integers; existence, type,
attachment, ownership and draw-state compatibility are explicitly deferred.

Success returns the whole validated submission with command provenance labels:
caller-supplied source SHA256 and capture event, plus decoded byte offset, payload
dword length and packet byte length. The synchronous runtime validates label
syntax only; the acceptance loader computes/verifies the original submission
hash before providing that label and separately hashes the browser transport. Failure returns a structured error with its location and no partial
command result or externally visible side effect. Bound input bytes, packet
count, text and allocation; decoded data must not change when callers mutate
their input after the call. Define the public API and error schema in the module
README. Keep caller-supplied capture labels distinct from computed byte hashes.

`END_TRANSFERS` is length-framed opaque padding, not an empty or zero-filled
marker. Correct that mapping in the current contract while preserving previous
verified evidence. At textured-scene event 173, blob
`11d7a8a13799e2c6a35a34ce40afd121e0d2e62370b9f0ca6b18002d4257470c`,
the three packets are offset 0 / length 1023 / 4096 bytes END_TRANSFERS,
offset 4096 / length 1 / 8 bytes SET_SUB_CTX, and offset 4104 / length 14 /
60 bytes COPY_TRANSFER3D. The opaque payload contains nonzero old command words:
never recursively decode it or require zero padding. The first submission has
two TRANSFER3D packets before its shorter END_TRANSFERS packet ending at 4096.

Accept the recorded inactive reset shapes for unsupported shader stages and
features only when their fields satisfy the documented inactive profile.
Nonzero active bindings remain unsupported. Inline constants, sampler arrays,
shader/atomic-buffer arrays and image arrays need exact divisibility and range
checks. Parsing these resets does not implement compute, tessellation, atomics,
images or shader storage buffers. The textured scene has 32 command families;
the full corpus's additional SET_SCISSOR_STATE family is not a tiny-scene claim.

## Deterministic acceptance

`make verify-E6-T12a` is the complete scoped high-risk submission. It validates
raw capture hashes, runs static JavaScript syntax checks, deterministic Node
decoder tests and browser parity with the same module/bytes, exhaustive byte
truncations and bounded reproducible property/mutation tests, sabotage, and one
final scrubbed pristine-clone run. Unchanged C/Rust/Wasm/shader evidence carries
forward; this parser-only task does not rebuild or deploy production web code.

Require the untouched events 161/173/185/197/209/221/233/249 to decode into
39/3/6/3/8/3/6/142 packets respectively: 42,380 bytes, exactly 210 packets,
32 command families and eight created object types. Independently check typed
fields and original shader bytes, command order, offsets, lengths and acceptance-loader-computed
SHA256 provenance against the raw protocol/corpus. Do not present a caller label
as a runtime-authenticated hash. Record Node/browser results,
served source hashes, zero browser errors and matching canonical results.

Valid structural variations must not be rejected solely for differing from
recorded handles, values or hashes. Invalid tails must reject the whole result.
Repeat invalid-to-valid calls to prove no retained parsing state. Record a
bounded memory/time budget for maximum accepted input and rejection boundaries.
No complete renderer, Mesa initialization, GPU pixels or FPS claim follows.

## Adversarial verification

Predict before inspecting evidence. Attack every length/count arithmetic edge,
unaligned/truncated headers and payloads, unknown opcodes/types, invalid enum and
reserved bits, NaN/Inf numeric fields, oversized text/counts, malformed shader
NUL/padding/continuation framing and supported inactive-versus-active fields.
Exercise nonzero-offset input views and post-call input mutation. No throw,
unbounded allocation, hang, partial result or input mutation may escape the
documented error contract.

Inject apparent DRAW_VBO, invalid opcode and oversized header words inside the
event-173 END_TRANSFERS payload: it must still yield exactly the same three
outer packet shapes. Moving an invalid header outside the padding or extending
the outer length beyond the submission must fail. Sabotage the decoder's packet
length or typed-field extraction and require the independent oracle to fail;
do not generate expected values using the decoder under test. Carry forward
unchanged shader proofs, and classify every changed executable branch as
exercised, justified unreachable, or needing evidence.

## Verification log

### 2026-10-03 — worker — activated (UTC)

Continues the explicitly requested graphics-offload lane after independently verified
E6-T10d (`af6b5509`, PR #406). This S slice isolates hostile byte decoding before
resource/state execution. Original L transport/renderer containers are being replaced
with ordered S tasks; no other task is active.


### 2026-10-03 — worker — implemented (UTC)

Frozen runtime/harness head `b2636b5073b1e81f2172b6b0b268fea7ce381f0d`.
`renderer/virgl-command/decoder.mjs` provides the documented synchronous,
stateless `virgl-tiny-commands-v1` profile. It snapshots non-shared byte views,
parses little endian fields, validates shapes/limits/profile features, and
returns one deep-frozen complete result or a structured error. Resource identity,
shader grammar, bindings and actual GPU execution remain later boundaries.
Provenance labels are caller supplied; the independent acceptance loader
computes and verifies their hashes. END_TRANSFERS padding and the upstream-unused
transfer usage word are opaque. The contract's earlier empty-marker wording is
corrected; historical evidence remains unchanged.

Final command:
`VIRGL_COMMAND_EVIDENCE_DIR=evidence/virgl-command/worker make verify-E6-T12a`.
Receipt `evidence/virgl-command/worker/receipt.json` SHA256
`d017e3cfd7176b4321dbed565c72859b8eb530c43733f0aeed429b61a9af1097`
binds runtime, harness, protocol, raw input and report/screenshot hashes.
The gate passed syntax checks, all21 existing capture tests, all4 full raw capture
validations, and identical Node/headed-Chrome acceptance results: all8 original
submissions /42380 bytes /210 packets /32 families /8 created object types;
586628 assertions,283 named cases,42380 exhaustive byte prefixes,4096 mutations
with seeds6a09e667/bb67ae85/3c6ef372/a54ff53a,1399 accepted/2697 rejected mutations,
and779 recovery checks. Independent field oracles cover all command families and
object types, exact shader text, transfer directions/offsets, geometry/state and
three draw packets. No backing snapshots are consumed. Zero browser console,
page or request errors. Shared memory input rejects in both environments.

Node acceptance took774.4ms and headed Chrome154.0.8037.93 took580.4ms on this
Apple Silicon host; these are parser-suite observations, not VM MIPS/FPS results.
The hard budgets accept262144-byte opaque input and4096 commands, and reject the
next excess. Their serialized results are355 and645970 bytes respectively;
16384 text bytes and8192 declared tokens are exercised at the boundary. The whole
Node proof process peaked at140048KiB RSS (including runtime/harness); this is
not a per-decoder-allocation measurement. The runner bounds browser acceptance
at120seconds and the clean-clone gate at240seconds. V8 counters for46 functions
are retained in `worker/coverage.json`: only allowlist-unreachable object/command
defaults and the deliberate unexpected-programmer-error rethrow are unhit.
All other recorded branch ranges have positive counts.

The trusted sabotage serves a decoder with only returned command.byteLength
increased by4. Node's original module still passes; the browser oracle fails
specifically at event161 command0: expected56, got60. Report and failure screenshot
are under `worker/sabotage/`. The success screenshot was inspected and its SHA256
is `24a974044765c347faee9cf2858b922fac4dfe361c015149476742eb2c0b17d9`.

Final pristine clone command:
`python3 tools/virgl-command/cold.py --output evidence/virgl-command/cold-clone`.
It checks out the frozen exact head, removes compiler/Node/Python/Cargo injection
variables and runs the same acceptance with fresh npm dependencies. Git status
is empty before and after; report `cold-clone/report.json` records the retained
scratch checkout. Its full acceptance receipt SHA256 is
`1df3c66ee891cc57bab23df78ac70b9d9ddb7030e5f48505af691f9f064b6445`;
log SHA256 `b6d8a5745b1f053e1080cf4f3c190eebe7379533d32f5253787c83b6d6d906a9`.
No C/Rust/Wasm or production page/device behavior changes in this slice; their
unchanged shader/execution proofs carry forward. No GPU rendering, guest Mesa
activation or performance gain is claimed by command decoding.
