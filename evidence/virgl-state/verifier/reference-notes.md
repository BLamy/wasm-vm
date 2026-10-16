# Pinned-reference orientation for E6-T12c

No implementation or worker evidence inspected. These notes identify semantic
boundaries to attack when the final state runtime is frozen.

- Object insert/destroy use `ctx->sub->object_hash` (vrend_renderer.c11633-11643);
  each created subcontext allocates its own object table (13208).
- CREATE_SUB_CTX selects the newly allocated subcontext (13212); duplicate IDs
  return before selection (13157-13160). Active nonzero destruction selects subcontext 0;
  destroying 0 is ignored (13234-13248). SET selects only a found subcontext
  (13252-13258). A stricter structured invalid-input policy can be bounded and
  documented, but must not accidentally change successful selection semantics.
- BIND_SHADER finds a typed shader in the active subcontext and validates stage
  (4646-4682). LINK_SHADER is a precompile hook: it temporarily binds named stages
  then restores previous shader references, IDs and program (5831-5887).
- SET_CONSTANT_BUFFER's wire index is ignored by the pinned legacy-inline-constant
  decoder (vrend_decode.c333); constants are stored per stage and memcpy preserves
  u32 bit patterns (renderer3480-3505). The tiny profile uses inline index 0; empty
  resets at other indices must not be misrepresented as implemented active UBOs.
- Full CLEAR disables scissor (4820), sets all selected clear write masks and
  disables rasterizer discard (4716-4748), then restores bound masks/scissor and
  discard (4751-4795). It temporarily unbinds the program (4818); a browser engine
  may restore the entire virtual state immediately after clear, but must not let
  the old physical GL program/masks dictate the operation.
- Surface/view namespace destruction drops a reference (2418-2429); framebuffer
  assignment retains surfaces (3168-3202). Their resource references end only when
  the objects' last references end (1260-1293). Shader object destruction similarly
  drops a reference (3964-3969). Vertex-element destruction clears its active bind
  (2459-2469); DSA unbinds when destroyed (2505-2512); sampler-state destruction
  removes affected bindings and deletes GL samplers (2472-2502).
- Original submit 249 DESTROY_OBJECT SURFACE 3 offset 11376 precedes framebuffer
  unbind 11384. Resource 5 is already publicly removed. The short interval is a
  concrete test of namespace lifetime versus bound storage lifetime.
- Subcontext destruction releases shader refs/programs/constants/views/surfaces,
  vertex/index resource refs and the object table (7803-7916).
- Verified bridge metadata names VirglBlock 656 bytes with winsys_adjust_y FLOAT
  offset 640 default 1 (bridge.c396, renderer/virgl-shader/README.md135). The reflected
  constant array is uvec4[]/float32-bits, requiring uniform4uiv. Actual program
  attributes are vec4 while original vertex elements provide 2 FLOAT components,
  stride 16 offsets 0/8. Relinking for varying reflection invalidates cached
  uniform locations; do it before location discovery (captured-textured-scene.mjs).
- The contract restores complete virtual state on one physical WebGL context
  (docs/gpu-3d-decision.md121-129). WebGL2 has no texture object swizzle API;
  nonidentity sampled swizzles require explicit lowering or rejection (131-139).

Reference local files: `/tmp/wasm-vm-virgl-pinned-inspection/vrend_renderer.c` and
`vrend_decode.c`, supplied as pinned VirGL 1.3.0 inspection sources for commit
ca50e008863837e094747a69974dde3ae148aeaa. No new language-compiler claim is made.
