# Original 92cb physical first-power domain

`make verify-E6-T12g6m5b2b1` replays the verified 1,957-draw capture and
draws the authenticated original 7bf4 vertex program with each of the three
captured bank pairs on a physical WebGL2 context. Its fragment shader is a
literal probe of original 92cb pc2,208,215,218–222, including both `POW`
lanes and their branch. It is **not** the translation of the full fragment
program and gives neither the compiler nor production DRAW any authority.

The ideal oracle treats each of the 1024×768 single-sample pixel centers as
`(x + 1/2, y + 1/2)` and computes the two affine axes from exact binary32
bank words with rational arithmetic. The browser stores all four actual
binary32 output lanes for every pixel in compressed, SHA-bound float
readbacks. A separate Python receipt decompresses and rechecks every pixel,
including uncovered pixels, active and inactive branches, the vertex program
reflection, draw state, source bytes, and bank identity. A native/Wasm-identical
C auditor checks the same ideal center envelope. The physical run must have
no more than 0.1 absolute error between each observed delta and the rational
ideal. This is an **observational error budget for every pixel in the recorded
draw**, not a claim that GLSL mandates 0.1 error on every implementation.
The complete scan must keep every active first-`POW` base above 0.25 and at
most 2048, and each observed `POW(base, 2)` within 2^-14 relative error of
the squared observed input. Captured bank 1 has no active first-power branch;
banks 0 and 2 each have 16 active centers.

GLSL ES 3.00 [§4.3.9 and §4.5.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
specify single-sample pixel-center interpolation and highp operation
precision. This harness records actual interpolation, arithmetic, and shader
precision on the named GPU; it does not extrapolate this run into a portable
future-draw certificate. The next task must bind a compiler exception and
production draw to a separately checked, current certificate.

The gate injects source, bank, negative, nonfinite, quad geometry, viewport,
and half-pixel zero-crossing faults. It records native and browser rejection
locations and exports C/JS coverage. After a source commit, run the gate,
`python3 tools/virgl-92cb-power-domain/cold.py
target/evidence/virgl-92cb-power-domain/cold-exact`, then seal the two exact-head
records with `seal.py <hot> <cold> <output>` for a fresh verifier.
