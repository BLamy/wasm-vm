# Original 92cb draw geometry

`make verify-E6-T12g6m5b1` authenticates the complete es2gears capture, then
walks all original 7bf4/92cb compositor draws. The 1,957 selected draws use the
same live resource 41 as two `R32G32_FLOAT` attributes, with 16-byte stride and
offsets 0/8. They draw a nonindexed, single-instance four-vertex triangle strip.
Each of the 1,068 submission snapshots contains the same first 64 bytes: four
`(position.xy, uv.xy)` vertices `(0,0), (0,1), (1,0), (1,1)`. A single original
`TRANSFER3D` packet uploads the backing before the first draw. The artifact
retains all draw and snapshot citations and the three complete paired banks.

The unchanged vertex source moves `IN[1].xy` to perspective `GENERIC[0].xy` and
sets clip W to 1. Finite affine clip positions, clipping, and triangle
interpolation therefore keep a covered fragment's UV inside `[0,1]`. For the
three captured fragment banks, `CONST[0].xy = (4,4)`, `CONST[6].x = 2`, and
`CONST[4].xy` is `(310,310)`, `(1034,778)`, or `(992,736)`. The original
pc218–220 first-power bases `abs(CONST[4].xy * uv - CONST[0].xy)` have exact
endpoint maxima `(306,306)`, `(1030,774)`, and `(988,732)` respectively.

This is a fact about the recorded draw inputs, not a certificate for the
private shader translator. Its API owns shader text and constant banks but has
no draw-time vertex-buffer binding. Also, an upper bound alone does not
exclude positive subnormal bases near the center crossing. Both ordinary and
private translation of the unchanged full pair remain rejected. E6-T12g6m5b2
must settle the first `POW` domain without silently borrowing this evidence.
