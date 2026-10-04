`make verify-E6-T12g6a` proves four additional original G1 shader bodies on
hardware WebGL2. It authenticates the unchanged capture and reassembles the
CREATE_OBJECT packets, including continuation fragments, before compiling.

The gears lighting/material vertex `80a42bf3` and color fragment `86d0ee79`
execute together. The compositor texture fragment `c2474531` executes with its
captured, byte-identical F6 vertex partner `403b0529`. Vertex `7bf4d0d0` is
measured through transform feedback in a compatible isolation program: its
actual captured fragment partner `92cb866a` remains rejected. The second larger
fragment `c5806d5f` and its complete original program also remain rejected.

The independent oracle contains explicit transform, normalized lighting,
ambient/material, coordinate and texture-alpha equations. It never reads the
compiler IR or emitted GLSL. All written vertex lanes are compared, with a
12-ULP budget only for lighting-dependent RGB; other words are exact, including
signed zero in precise arithmetic outputs. Raw RGBA8 pixels use a one-byte
rounding budget. Neither captured output nor an inverse renderer conversion is
an expected value.

Three seeds, uniform/attribute readback, GL reflection, object disposal and
physical output faults are recorded. The unchanged nineteen-body F6 numerical
suite runs once; G1–G5 HELD leaf evidence is carried with its unchanged runtime
and archive identities. `cold.py --output <directory>` repeats the acceptance
once in a pristine exact-head clone with compiler/runtime environment overrides
removed. Production negotiation and all full guest-offload/FPS claims remain
disabled. These checks do not replay original draw state or prove complete
programs containing the two larger unsupported fragments.
