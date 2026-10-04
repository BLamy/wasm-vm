Worker submission for E6-T12g6j1 at evidence head `d44d2683941ab4cb32df53d4dcb84f045046caf9`.
The runtime is unchanged from `ad31839ebc55e5f853c9d9853a44c9922767e7da`;
base is `322bb56ee95ef9e2fb26b85179d61ae51efbbf5f`. Authenticate the manifest, index and every archive member
before inspecting claims. The seal contains 135 actual recording members,
including both original sanitizer binaries/profiles, native/Wasm outputs, physical
GPU bytes and source/coverage/screenshot bindings, inherited guards, and the
pristine clone's complete output and report.

Commands: `make verify-E6-T12g6j1`; `python3 tools/virgl-sine/cold.py --output
target/evidence/virgl-sine-cold-final`; `python3 tools/virgl-sine/receipt.py
target/evidence/virgl-sine`; `python3 tools/virgl-sine/seal.py --hot
target/evidence/virgl-sine --cold target/evidence/virgl-sine-cold-final --output
evidence/virgl-sine/worker`.

Each recorded checkout passes 1,006 native/ASan/UBSan requests and Wasm singles
and pairs; 970 pinned FLOAT/REPL=2 parser/converter witnesses; 14,736 inherited
native/Wasm guards; 5,861 whole predecessor responses; 974 contracts, 580 metadata
attacks, 12 banks and four simultaneous whole-base compositions. Two original
sealed unsupported-SIN rejections become this explicitly declared new bounded
admission; the live negative declarations now use SIN_PRECISE. The old source and
original rejections remain archived and all other predecessor responses agree.

The independent reference uses exact binary32 Fraction inputs and alternating
Taylor enclosures at 220 bits with nested 280-bit checks. Every physical expected
operand, source version, mask and condition is derived independently from TGSI.
Three seeds per checkout check 24,480 actual transform-feedback words and 61,056
RGBA8 pixels; 12,240 words and 30,528 pixels use actual unmodified reference GLSL.
Canonical broadcasts account for 4,896 primary words. Two literal original SIN
broadcast statements are source-bound and isolated with known initializers;
neither their original computed argument domain nor either full body is proved.
All function/argument/broadcast shader-source corruptions fail the physical oracle.
GPU objects, resource budgets and browser error arrays return to zero.

The conservative maximum absolute error is about 6.859461500265203e-8 for both
backends, below the measured physical-host budget 2^-20. ESSL 3.00 specifies no
portable trigonometric precision guarantee. TGSI scalar post-swizzle-x replication
is authoritative; the pinned converter's componentwise lowering is retained and
checked against separately derived componentwise equations. Concrete deviations
are recorded without changing its original GLSL.

The first exact-source clean clone completed the whole acceptance command but
its collector used the preceding task's environment variable and failed to locate
the resulting receipt. Its failed report, complete log and successful acceptance
receipt remain in hot/cold-output-path-failure. Commit d44d2683 changes only
cold.py's output collection and receipt.py's allowed harness-repair set. The hot
runtime recording is authenticated again against that unchanged source boundary;
its original receipt is preserved. The corrected wrapper then passes one complete,
uninterrupted pristine clone at the final evidence head, with scrubbed environment
and empty before/after status. No runtime proof or failed collector is rewritten.

Production negotiation, caps, live demo imports, guest execution and FPS/MIPS
remain outside this private compiler claim. rr/ssh dev are waived by repo policy.
Fresh independent criticism remains required before verified status.
