# Frozen-diff supplement, before evidence inspection

Frozen implementation: `f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91`.
The original prediction document is retained unchanged. Read the final runtime
and acceptance-harness diff before any E3 recorded result. Parent notified this
critic that the driver may retain the declared uniform tail and the final diff
classifies excluded float-bit domains and recognized ADDR. These are new
predictions about those scoped details, recorded before examining results.

- **P15 amendment:** The earlier exact active-count prediction was too strong.
  GL may retain a statically declared tail. For a shader reading CONST45, the
  required addressable prefix is 46; reflected size may equal declared 46/47.
  Actual reflection must be recorded truthfully. Uploading only the required
  first 46 entries is legal when the remaining host-only tail is unread; poison
  entry46 independently and show unchanged output. This is a correction to the
  critic's expected host reflection, not evidence of a guest semantic defect.
- **P26 — excluded well-formed words:** UINT32 tokens that are bounded decimal
  words with delimiter comma/brace, but encode nonzero subnormals, nonfinite
  floats or absolute magnitude over1,000,000, reject with unsupported-feature.
  Zero, negativezero, and legal finite boundary encodings retain acceptance.
  Missingdigits, overflow and suffixes such as 1x/1e0/0x1 remain parse-error;
  valid excluded words with such malformed suffixes remain parse-error.
- **P27 — recognized ADDR:** ADDR declaration/source/destination remains
  unsupported-feature. Unknown file names still parse-error; ADDR-prefix names
  are not mistakenly consumed as recognized ADDR. High-bank availability does
  not admit ADDR nor any indirect operand.
- **P28 — diagnostic scope:** No source becomes newly accepted because of the
  diagnostic classification changes. Native/Wasm errors match fully, prior
  accepted byte bodies remain accepted, and seven unchanged originals retain
  explicit unsupported-feature. Every new changed diagnostic path must execute
  during a source-bound independent run.

Independent sanitizer mutation seeds chosen now, before any test output:
`0x0b69d3e1`, `0x57a2c90f`, `0xcd41e875`, `0x913ef246`.
