# E6-T12d fresh verifier predictions

Recorded before inspecting any E6-T12d implementation or worker evidence. Prior
verified state head is a768b341facfa30cc38a707f129fc4ada97ce9d9. I did not implement
this task. Read sources: task, original immutable capture and workload C oracle,
already verified decoder/resource/state contracts, pinned VirGL 1.3.0 decode/
renderer, and WebGL2 fixed-index restart specification. All predictions PENDING.
Final-source-specific predictions will be added separately before their attacks;
this file remains unchanged once frozen.

1. P1 exact complete replay — eight original raw submissions with counts
   39,3,6,3,8,3,6,142 execute all 210 packets, in event order
   161,173,185,197,209,221,233,249. DRAW_VBO at offsets5684/4184/4240 in events
   161/185/209 executes exactly three hardware draws. Each is TRIANGLES, six
   unsigned-short indices, one instance, base index-buffer byte offset0, index
   bias0, startInstance0 and no restart. No packet slicing or reconstructed
   geometry/state/shaders substitutes for the primary replay. The unchanged C
   factory still returns unsupported-draw at its original explicit boundaries.
2. P2 chronological dependencies — context2 creation is applied once despite
   nested context_create_with_flags; original resources3–7, attach-I/O-vector
   lengths, context attachment and first CPU input snapshots execute in recorded
   order before submit161. Independent boot scanout resources1/2 and unrelated
   fence/capability events are explicitly excluded/identified. Original cleanup
   removes public resource5 before submit249; complete submit249 executes once,
   then remaining public teardown and context destruction leave all counts zero.
3. P3 original inputs and output separation — original vertex64/index12/texel16
   input bytes are the only nonzero initial CPU inputs. Later output snapshots
   at events184/208/232 (and repeated later snapshots) cannot initialize backing
   or supply pixels. Poisoning every reference output snapshot leaves actual
   output unchanged. COPY_TRANSFER3D must write real GPU resource5 pixels into
   resource7 backing ranges64..4159,4160..8255,8256..12351. Sentinel bytes outside
   the selected readback range remain unchanged, including texture input0..15.
4. P4 literal independent pixels and orientation — for each phase, check the four
   8x8 interior rectangles with lower-left origins(4,4),(20,4),(4,20),(20,20), 256
   pixels per phase and 768 total. Expected RGBA rows are:
   phase0: (255,0,0,255),(0,255,0,255),(0,0,255,255),(255,255,0,255);
   phase1: (255,0,0,255),(0,128,0,255),(0,0,0,255),(255,128,0,255);
   phase2: (64,0,191,255),(0,64,191,255),(0,0,255,255),(64,64,191,255).
   These constants come from the independent guest C workload, not replay output.
   Asymmetric quadrant colors must detect Y inversion. Record all three actual
   output hashes and images, emitted GLSL/reflection and per-frame command/binding
   dumps. The latter must identify original source hashes, events and byte offsets.
5. P5 actual fetch bounds — original maxIndex UINT_MAX is an unknown hint; actual
   six GPU index words are0,1,2,2,1,3. Validate index byte offset/count against
   logical GPU buffer12 bytes, then validate every fetched attribute against its
   own buffer offset, source offset, stride and element size. Required extents
   are56 bytes for position and64 for UV in the original64-byte buffer. A forged
   small min/max hint cannot hide a bad actual GPU index; UINT_MAX must not cause
   huge allocation or arithmetic overflow. CPU backing contents are not authority
   for GPU index values, and stale cached values cannot authorize later draws.
6. P6 strict profile boundaries — nonzero indexed start, zero vertex stride,
   ushort0xffff, nonindexed draws, unsupported topology/instance/base-vertex/
   restart/indirect features reject explicitly before any draw call. Their
   rejection must not be reported as successful emulation of broader semantics.
   Pinned indexed calls use index-buffer byte offset, not a start addition;
   Gallium stride0 means a constant attribute, while WebGL's pointer stride0 is
   tightly packed; WebGL2 permanently enables fixed-index restart. The profile
   must avoid silently changing these meanings.
7. P7 state before draw — actual selected program, private VAO/FBO, vertex/index
   buffers, views/samplers, raw tint bits, system block and blend factors belong
   to the current context/subcontext generation immediately before each draw.
   Missing required bindings must not inherit a previous context's state.
   A/B/A and subcontext reuse, plus hostile program/buffer/texture/sampler/mask/
   scissor/viewport state, must restore correct actual output. Color-mask and
   blend changes must affect draws while full CLEAR preserves its C semantics.
8. P8 retained lifetime — bound surface/view/index/vertex/shader references hold
   exact object/storage generations across public removal and numeric reuse.
   Original resource5 unref before object teardown remains safe; framebuffer
   unbind releases its last storage. New draw-related caches, index scratch,
   instrumentation and failures cannot leak resources or alias reused IDs.
9. P9 invalid tail and recovery — a malformed tail in a raw submission prevents
   all prefix side effects, including a preceding valid DRAW in that submission.
   Valid earlier submissions remain committed. A semantic bad draw stops at its
   exact offset with no draw for that packet; subsequent corrected submission
   can render the original phase. Repeated rejects preserve bounded budgets.
10. P10 task mutation attacks — independently corrupt vertex/index input, one
    texture texel, raw tint constant, phase2 blend factor and readback offset.
    Each relevant literal-pixel/bounds oracle must fail for the correct reason.
    Mutations are source-addressed and independent of worker seeds. A readback
    redirected to another legal range must not be mistaken for valid pixels at
    the original range; an overflowing/out-of-backing offset rejects cleanly.
11. P11 novel attack — distinguish actual GPU indices from CPU backing/cached
    indices: alter a GPU index after a valid draw while leaving CPU backing or
    previous validation unchanged, require vertex-bound rejection, repair via
    valid transfer and recover exact pixels. Also test independent attribute
    extents so a valid position fetch cannot mask an out-of-range UV fetch.
12. P12 sabotage and sufficiency — a runtime sabotage skipping draw or bypassing
    actual-index bounds must fail an independent pixel/bounds oracle. Every
    changed runtime hunk needs precise executed evidence or a narrow explained
    host-defense/declarative waiver. Record true hardware identity, zero browser
    errors and screenshots. Worker/final cold-clone sources, generated translator
    bytes, inputs and evidence hashes match the frozen head; the pristine clone
    remains clean. No guest transport, Mesa initialization, production capset or
    FPS claim follows this isolated replay.
