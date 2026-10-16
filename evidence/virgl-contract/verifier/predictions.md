# E6-T10c independent verifier predictions

Recorded before opening worker evidence on 2026-10-03 UTC. Oriented by the task,
full changed implementation/contract sources and diff from 0abd0745 to 2cd2572e.
Scope: medium-risk contract/prototype. No guest GPU, Mesa initialization,
Hyprland compatibility, portability, deployment or complete isolation claim.

1. P1 provenance: worker receipt SHA256 will equal
   50b671b094c04d6b1d95eea802ada0c4e1f69689ef9e1acb18c0e800723d4daf,
   browser report SHA256 will equal
   555ddecbf28bdf693a593247df26ff94678b583ecd28b012f96e818d7a0715b1.
   Receipt source hashes and browser source/served bytes will match checkout;
   receipt/head will identify frozen source 6cf7981877fc4dab83cd902cd69d56a8795f051b.
2. P2 completeness: raw manifest/event/blob reconstruction will equal every
   matrix key/count (33 opcodes, 8 objects, 37 shader instructions, 17 APIs,
   2 stages, 9 formats; vertex29=10, vertex30=6), with exact pinned guest versions.
   All 19 distinct captured shader bodies will reject, 15 unsupported-feature
   and 4 parse-error. Current capsets will remain empty and VIRGL false.
3. P3 literal proof: actual headed hardware Chrome will execute 9 translated
   literal draws with 4336 exact pixel checks and no console/page/request errors.
   This proves the bounded bridge only, not captured guest shader support.
4. P4 hardest mappings: handwritten ESSL probes will report A/B/A state identity
   and all 128 state-replay pixels (red left half A, blue right half B, transparent
   opposite halves), exact independently stated BGRA/BGRX/RGBX bytes, baseline
   compilation true and precise false with a diagnostic. Format17 remains rejected.
5. P5 bounds and ABI: measured host limits will meet declared future prerequisites
   while unsupported browser tuples reject. C ABI oracle will match all committed
   fields/masks, including v1=308 and v2=1408 bytes. Fence first poll times out,
   completion follows an unrelated timer, and four green pixels are visible.
6. P6 novel bounded attack: deliberately corrupt program, VAO, framebuffer,
   viewport, texture unit, blend/depth/stencil/cull/scissor/dither and color mask
   after every probe draw. Subsequent state replay must restore its stated state
   and preserve all probe pixels. This attacks only the explicit state-restoration
   subset; resource isolation/lifetime and a full guest state cache remain future work.
