---
id: E6-T12a
epic: 6
title: Decode captured VirGL packets with bounded portable byte parsing
priority: 525.02692
status: in-progress
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

Success returns the whole validated submission with command provenance: original
submission SHA256, capture event, byte offset, payload dword length and packet
byte length. Failure returns a structured error with its location and no partial
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
fields and original shader bytes, command order, offsets, lengths and computed
SHA256 provenance against the raw protocol/corpus. Record Node/browser results,
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
