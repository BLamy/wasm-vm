# E6-T12d reference orientation

Read before D implementation/evidence; this is reference analysis, not a verdict.

Pinned source: VirGL1.3.0 ca50e008863837e094747a69974dde3ae148aeaa,
`/tmp/wasm-vm-virgl-pinned-inspection/{vrend_decode.c,vrend_renderer.c}`.

- Decoder463–501 fills pipe_draw_info verbatim. Original three draws are
  indexed TRIANGLES,count6,instanceCount1,start0,indexBias0,startInstance0,
  restart=false,minIndex0,maxIndexUINT_MAX. Draw packet offsets are5684 at161,
  4184 at185 and4240 at209. Packet totals39+3+6+3+8+3+6+142=210.
- Renderer6011–6034 checks index-buffer logical size using indexSize*count plus
  index binding byte offset. Renderer6136–6157 indexed GL calls pass that byte
  offset directly; info.start affects only nonindexed calls around6094–6095.
  No justification exists for silently adding nonzero start to indexed offset.
- Legacy vertex binding5129–5150 handles Gallium stride0 by mapping one value,
  writing a generic constant attribute and disabling its array. A WebGL pointer
  stride0 alone has a different meaning. Rejecting it in the strict draw profile
  avoids expanding this task into a new constant-attribute implementation.
- Renderer6047–6058 conditionally enables restart only when the guest requests
  it and disables it afterward6160–6168. WebGL2's fixed-index restart is always
  enabled; ushort0xffff must be rejected in this no-restart profile even if a
  sufficiently large vertex buffer would otherwise make index65535 valid.
  Primary spec checked2026-10-03:
  https://registry.khronos.org/webgl/specs/latest/2.0/#NO_PRIMITIVE_RESTART_FIXED_INDEX
- COPY_TRANSFER3D_FROM_HOST renderer10166–10184 validates the GPU primary's box
  and secondary staging IOV bounds. The secondary resource's attached backing
  capacity, not a guessed GPU allocation, authorizes the destination byte range.
  Original reads at events173/197/221 byte4104 use resource5,32x32 RGBA8,
  stride128,layerStride4096,resource7 staging offsets64/4160/8256,flags3.
- Public timeline starts context_create96 with nested create_with_flags97;
  resources3–7 create at100/111/122/133/144, attach backing104/115/126/137/148,
  and context attach107/118/129/140/151. Attach snapshots105/116/127/138/149
  are zero. Before first draw snapshots156/157/160 supply respectively64 vertex,
  12 index and16 texture bytes; all other initial backing bytes are zero.
- Later snapshots184/208/232 contain outputs, not new external CPU uploads.
  Initial staging bytes0..15 contain RGBA red/green/blue/yellow texels. Replaying
  later snapshots as initialization would invalidate proof of the draw/readback.
- Resource5 public detach238,backing detach240,unref242 precede submit249;
  inside249 surface3 destroy11376 precedes framebuffer unbind11384. Preserve
  chronology; subsequent resource cleanup251–273 then context_destroy275 ends it.
- Original pixel oracle lives in tools/virgl-capture/workloads/textured-scene.c:
  lower-left interior quadrants are4+16*(q%2),4+16*(q/2), size8x8. Literal expected
  arrays are independent of shader translation/replay. Phase2 uses quarter alpha
  to avoid half-value rounding ambiguity: RGB64/191 and alpha255.
- E6-T12c state generation/refcount/restore and E6-T12b transfer behavior are
  independently verified. Reuse their unchanged evidence; attack new draw
  integration and any changed shared branches, not unrelated compiler language.
