# Original ordered primitive prediction, before native execution

New hand-selected original u32 stream (byte offset12), custom restart37:

`37,37, 4099,701,9031, 4099,9031,701, 4099,701,9031, 4099,9031,701,
 37, 4099,701,9031, 4099,9031,701, 4099,701,9031, 4099,9031,701,
 37,4099,701`

There are30 original source words: four restart markers,24 complete triangle
words and two trailing words. Native primitives are eight alternating copies of
`[4099,701,9031]` and `[4099,9031,701]`. The final two words are charged but never
form a primitive. With original front_ccw=false and lower-left viewport32x16,
positions are4099=(2,2),701=(18,2),9031=(18,10). Positive signed area means front.
Faces are F,B,F,B,F,B,F,B; LAST provoking IDs are9031,701 repeated four times.
Native u32 normalization is24 words/96 bytes,48 vertex visits and16 calls; call
offsets are0,0,12,12,24,24,36,36,48,48,60,60,72,72,84,84.

Both qualified formats20/126 and steps1/64 use an original selected mip with
S8=93 and depth=.75. Pixel(14,4), sample(14.5,4.5), is strictly inside every
triangle: all three signed edge distances are positive, so no coverage choice
or implementation-dependent edge is involved. Its depth remains unchanged.

Front: LESS, ref211, valueMask95, writeMask91, fail DECR_WRAP, zpass INCR_WRAP.
Back: NOTEQUAL, ref39, valueMask213, writeMask229, fail REPLACE, zpass INVERT.
Depth testing is disabled. Front comparison threshold is211&95=83; back is
39&213=5. Each operation merges `(old & (~mask &255)) | (operation &mask)`.

The original per-primitive transition calculation is:

| Primitive | Face | Test | S8 before | S8 after |
|---|---|---|---:|---:|
| 0 | F | 83 < (93&95=93), pass | 93 | 94 |
| 1 | B | 5 != (94&213=84), pass | 94 | 187 |
| 2 | F | 83 < (187&95=27), fail | 187 | 186 |
| 3 | B | 5 != (186&213=144), pass | 186 | 95 |
| 4 | F | 83 < (95&95=95), pass | 95 | 68 |
| 5 | B | 5 != (68&213=68), pass | 68 | 161 |
| 6 | F | 83 < (161&95=1), fail | 161 | 160 |
| 7 | B | 5 != (160&213=128), pass | 160 | 69 |

Final expected S8 is69. The original last passing primitive's provoking vertex
is701, so flat color is`[(701*17&255)/256,0,.75,1] = [.55078125,0,.75,1]`.
Original vertex-ID validity tags must produce w=1; compacted vertex IDs would
produce w=0 and fail native coverage. The expected final depth is the original
format's uploaded .75 under held conversion, with no depth write.

Wrong whole-front then whole-back order instead gives front93→94→95→68→71,
then back71→162→71→162→71. Final S8=71 must contradict the unchanged original
prediction after actual native completion. The mutant must preserve original
wire and shader/vertex/index inputs and must consume a distinct post-writer fence
from the completed common-state baseline. No expected-value rewrite qualifies.
