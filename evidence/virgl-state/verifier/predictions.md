# E6-T12c independent verifier predictions

Written at active-task base 7d541e99 before new state runtime/harness or worker
evidence exists. Sources reviewed: task, repository AGENTS.md, pinned local
VirGL 1.3.0 renderer/decode C sources, verified bridge/browser binding mechanics,
and original recorded command inputs through the already verified decoder.
I have not implemented E6-T12c. Final diff orientation and exact evidence head
are pending; no verdict or task status is assigned here.

1. P1 source/scope — original submit 161 has 39 commands. Its successful prefix
   executes the first 38, with explicit unsupported DRAW_VBO at byte 5684 and no
   issued draw. Recorded later state/teardown packets are separately identified.
   The two shader bodies remain exact SHA e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33
   and 80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808.
   Frozen sources, built bridge bytes, served inputs/evidence and final scrubbed
   clone will match. No whole-scene, guest activation, capset or FPS claim follows.
2. P2 typed namespaces — every object belongs to its context generation and
   subcontext, with typed lookup. Reused numeric handles in A/B/A contexts and
   separate subcontexts cannot alias old objects/programs/resource storage.
   Wrong-type or destroyed handles reject without changing prior valid state.
3. P3 subcontext semantics — creating new subcontext selects it; explicit select
   resolves that context's existing subcontext; active nonzero destruction returns
   to default subcontext 0 and releases its state/storage references. Subcontext0
   remains valid. Invalid operations follow a documented bounded error policy
   rather than silently selecting another guest's state.
4. P4 linking versus binding — LINK_SHADER validates/compiles the named pair but
   preserves current stage bindings. BIND_SHADER controls the active typed stages;
   missing or mismatched shader bindings cannot inherit a previous context's
   program. Exact original shaders link in actual WebGL2. Program identity/cache
   ownership must include shader generations and context/subcontext identity.
5. P5 actual reflection — reflected active attributes map to original elements:
   two GLSL vec4 inputs, two FLOAT components each, stride 16 offsets 0/8, u16 index
   buffer offset0. fsconst0 is UNSIGNED_INT_VEC4 with float32-bit words, sampler 0
   is SAMPLER_2D at the assigned texture unit, and VirglBlock is 656 bytes with
   winsys_adjust_y FLOAT at byte 640 equal 1. Locations/block indices come from the
   actual linked program and are not reused across relinks or foreign programs.
6. P6 constants — original constant words are four 1065353216 values, preserved
   exactly by uniform4uiv. Subsequent updates alter actual reflected uniform
   values on the intended program/stage only. Independent -0 and subnormal bit
   patterns must remain their original u32 words if accepted; no numeric integer
   conversion or unrelated stage/index leakage is allowed. Empty resets must
   not advertise unsupported active UBO/stage functionality.
7. P7 clear — original CLEAR at 4848 produces 1024 exact blue RGBA8 pixels from the
   actual retained resource 5 framebuffer. Gallium full CLEAR ignores guest color
   masks/scissor (and selected depth/stencil masks) during clear, then restores
   virtual state. A hostile physical mask/scissor cannot clip or suppress clear.
   The independent pixel oracle comes from literal clear bytes, not renderer
   output snapshots or the code under test.
8. P8 full state application/isolation — hostile physical program, VAO, framebuffer,
   buffers, texture/sampler, blend/color/depth/stencil masks, viewport/scissor and
   rasterizer enables cannot leak into a restored virtual state. A/B/A with reused
   handles restores A's actual GL query results and clear pixels. Texture format,
   sampler/view compatibility and swizzles are either faithfully implemented or
   explicitly rejected before publication; unsupported active features cannot
   hide among accepted all-zero/inactive reset records.
9. P9 object/resource lifetime — resource 5 public unref does not destroy storage
   held by surface 3. Submit 249 destroys public surface 3 at 11376 while it is still
   framebuffer-bound; storage remains alive until empty SET_FRAMEBUFFER_STATE at
   11384 removes the final bound reference. Destroyed/reused names cannot retarget
   old bindings. Sampler views and bound shader selectors similarly distinguish
   namespace and binding references; plain state object destruction follows its
   documented/pinned unbind semantics. Final teardown releases GL and resource
   leases exactly once with zero counters.
10. P10 failure atomicity — wrong-type handles, incompatible attachment, invalid
    sampler swizzle, missing stage, malformed flags, compiler/link/reflection or
    GL allocation errors leave no unreachable objects, leases, programs, FBOs or
    partially committed bindings. Independent repeated reject/recover cases
    retain bounded counts and permit the prior valid state to apply afterward.
11. P11 evidence sufficiency — every changed state/resource/backend hunk must be
    exercised in exact-source native/browser counters or have a reasoned scoped
    waiver. Hardware context, zero console/page/request errors and screenshot are
    recorded. Unchanged compiler semantics and unrelated production surfaces carry
    forward their existing proof; new integration calls must actually execute.
12. P12 sabotage/novel attack — sabotaging an applied color mask or constant must
    fail actual GL state/uniform assertions. CLEAR pixels alone cannot detect a
    color-mask sabotage because full clear intentionally overrides masks. A
    bounded independent attack combines A/B/A reuse, link-without-bind, preserved
    raw constant bits, retained-object destruction and fresh host state poison.

All predictions are PENDING until final implementation/evidence handoff. Any
new final-code-specific prediction will be recorded before inspecting the
corresponding state or executing its attack.
