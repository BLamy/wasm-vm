E6-T12f6 closes the unchanged 19-body input corpus through the existing compiler
and its explicit consumer contracts. `make verify-E6-T12f6` records every native
and Wasm original/pair result, physical compilation of all 57 compatible pairs,
and independent output observations. The other 31 requests are rejected by the
declaration-level interface rules. Pair interpolation follows the original
fragment declaration; the flat color pair consequently changes its vertex
metadata from smooth to flat while keeping all domain obligations.

`original-corpus.json` binds the exact captured bytes and reviewed metadata.
Eight vertex bodies are observed with actual transform feedback. Their position,
texture-coordinate, color and lighting equations live in `oracle.mjs`, independent
of the emitted GLSL and compiler IR. Position/copy samples have zero numerical
ULP distance. The two lighting bodies use an eight-ULP budget for these specified
finite, nonzero-normal samples; this is an observation budget, not a global error
bound for arbitrary lighting inputs. The fourth varying lane of the two lighting
shaders is undefined and is never counted. Float zero signs, interpolated NaN
payloads and subnormal retention are outside this numerical-output claim.

Seven ordinary fragment bodies run unchanged against literal texture/color
inputs. Four original gradients run unchanged against an independent literal
TGSI interpreter retained from the radial proof. Its reference inputs never read
compiler metadata, IR or GLSL. Samples cover spread modes, endpoints, interpolation,
transparent paths and eighteen-iteration counted loops; actual RGBA8 pixels have
an explicit zero/one-byte budget. Integer PRECISE rounding/contraction remains
the separate verified F5 boundary and is retained on the GPU here.

Runtime obligations remain explicit:

| Original family | Existing admission contract |
| --- | --- |
| Ordinary v5 | Checked declarations, defined output lanes, reflected raw-u32 bank and sampler ABI. No additional conditional-bank promise. |
| Two MAX_PRECISE lighting vertices | Finite-binary32 active constant prefix; local comparison/selection certificate. Test normals and projective divisors are nonzero. |
| 3f78a90d color vertex | Finite active bank, binary32 ADD/MUL nearest-even with separate rounds, canonical quiet NaN and gradual private-word underflow. Arithmetic supplies output authority only from already numerical operands. |
| Four original gradients | Full declared finite bank; copied alpha lanes are finite normals or signed zeros, according to the exact raster component list. |
| Two loop gradients | Complete addressable table; raw signed count at C9.x is at most 18. Negative signed counts remain admissible. |
| Two radial gradients | C4.x magnitude is at least the exact 0x3727c5ac threshold. The undefined linear predecessor remains excluded. |

Consumer tests reject contract erasure/accessors, short banks, non-finite words,
unsafe counts, unsafe radial coefficients and unsafe copied alpha encodings.
The retained shared-renderer raster leaf still proves enforcement before GPU
effects; this direct shader harness does not invent a second production renderer.

Four historically negative authored grammar fixtures are now supported by the
verified mask/PRECISE boundaries. `captured-grammar-migrations.json` names their
exact input hashes, full metadata and rationale. They execute on the GPU as
identity-position shaders. The retained captured textured scene still rejects
the other 108 fixtures and retains all 1,792 mixed recovery conversions and its
three independent pixel phases. These authored fixtures are counted separately
from the nineteen original bodies.

One isolated actual compiler fault inverts the exercised MAX_PRECISE selection,
then recompiles the Wasm compiler. The unchanged original lighting shader must
produce a physical word outside its independent numerical prediction; a generic
compiler/browser failure does not count as fault sensitivity.

The final acceptance runs from the exact frozen source in a pristine clone with
compiler/build/browser environment overrides scrubbed. All raw bytes, source,
toolchain, native/Wasm results, browser errors, counters, pixels, screenshots and
fault artifacts are retained for a fresh verifier. This closure enables the next
resource-format/view task. It does not enable production guest 3D negotiation,
establish full compositor suitability or measure desktop MIPS/FPS.
