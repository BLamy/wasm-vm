# Original stream output

`createVirglStandardStreamOutputSubmitBridge` selects the checked D65 shader
compiler and the original target/buffer protocol. This remains a selected test
consumer until production qualification and guest bring-up are verified.

Object 10 retains a buffer generation and its original byte range. Opcode 25
selects a complete target tuple. The pinned renderer ignores `append_bitmask`:
a retained tuple resumes its cursors, a new generation/tuple starts at its offsets,
and an empty binding pauses without deleting existing cursors.

WebGL2 forbids indexed draws during transform feedback. The consumer enumerates
complete original primitives and runs legal GPU POINTS array captures with the
original vertex and instance identities. It uses the unchanged C/Wasm vertex
compiler and an internal C/Wasm fragment that has no guest effects. It does not
rewrite GLSL or evaluate shaders on the CPU. Each buffer links its own checked
raw-word varying list, avoiding the native separate-attribute limit. Indexed
capture vertex IDs must fit a nonnegative native GLint; larger IDs are refused
before capture. A future qualified host must report this limit accurately.

Job-owned packed buffers and feedback objects remain charged until the final
fence or explicit failure retirement. GPU copies scatter the raw words into the
original offsets/strides while preserving all holes. Capacity is shared across
active output slots and only complete primitives fit. An uncertain partial
native capture invalidates its tuple; replacement or reset is required.

Output/input aliases are refused before capture. Completed captured storage may
subsequently supply vertex, index or uniform data, using the existing fenced
materialization for WebGL's element-array storage class. Bound targets retain
object/resource generations independently of recycled public names. Disposal,
cancellation and reset release every job and subcontext owner.

`make verify-E6-T11d66` records original Wasm queues, native hardware calls, full
original206 output and guards, varied schedules and physical scatter faults.
