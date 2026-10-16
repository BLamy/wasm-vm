# Original 92cb raster domain

`make verify-E6-T12g6m5b2a` first reruns the verified complete original quad
and bank provenance, then independently replays every selected draw's active
viewport, framebuffer surface and resource lifetime. All 1,957 original
7bf4/92cb draws use the viewport packet at event 648, offset 4844: scale and
translate `(512,384,0.5)`. They render to an ordinary, single-sample 1024×768
color target. There are 400 distinct framebuffer packets; the color resource is
21 for 1,953 draws and 72 for four draws. Both resources have `nrSamples = 0`.

The unchanged vertex shader writes clip W = 1 and passes the `[0,1]` quad's UV
as smooth `GENERIC[0].xy`. OpenGL ES Shading Language 3.00, §4.3.9 requires
single-sample inputs to be interpolated at pixel centers. The six exact-bank
ideal-center envelopes are recomputed independently with rational arithmetic
and by a native/Wasm C auditor. For banks 0 and 2, the closest centers to the
first `POW` zero crossing are about 0.5 away in each axis; bank 1's crossing is
outside the framebuffer and its branch is absent at ideal centers. The
conservative source-only endpoint upper bounds remain those of E6-T12g6m5b1.

This artifact proves original captured raster state and ideal center geometry,
not an unconditional floating-point lower bound on a future GPU. Any shader
numeric certificate must separately account for interpolation and arithmetic
precision and enforce these exact geometry, bank and viewport preconditions at
the physical draw. The current private compiler does not receive those draw
inputs. The full original pair therefore still rejects and no production
graphics/MIPS claim follows from this step.

Primary specification: <https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf>.
