---
id: E6-T12g6m4b
epic: 6
title: Bound the original c580 fragment-coordinate prefix before its zero-cap branch
priority: 525.027010589
status: implemented
depends_on: [E6-T12g6m4a]
estimate: S
risk: high
capstone: false
---

## Boundary

Establish a checked, finite non-NaN numerical envelope for the unchanged c5806d5f fragment prefix through the pc27 `MIN_PRECISE` values consumed at pc28. Bind it to the authenticated fragment-coordinate convention and an enforceable complete slot-zero exact bank, including all three original draw-bank variants. Preserve every value version, swizzle, arithmetic rounding, and original ordinary-result byte. Reject a missing/wrong/short bank, a changed prefix, and any coordinate or arithmetic path outside the proved envelope. This leaf grants no MIN predicate fact, branch pruning, new POW domain, full-original admission, public import, guest offload or MIPS claim.

## Deterministic acceptance

`make verify-E6-T12g6m4b`: bounded source and draw-state replay proving the exact original pc0..27 numerical dependencies from authenticated command packets and the WebGL2 fragment-coordinate contract. Native/Wasm interval results must enclose independent high-precision sample equations for all three captured banks and viewport-edge/half-pixel cases, including signed zero and extreme legal viewport values. Source-fault and altered-bound sabotage must fail; wrong/short banks and mutated shader prefixes must reject. Record changed-hunk coverage, physical browser samples, exact-head hot and one pristine clone, then submit to a fresh critic. Both complete original pairs remain rejected.

## Adversarial verification

Attack NaN/nonfinite provenance, coordinate origin and pixel center, viewport extremes, intermediate overflow/cancellation, exact bank completeness and source-version staleness. Predict interval endpoints before inspecting the run. Demand a point citation for every original instruction the certificate covers and every changed runtime hunk.

## Verification log

### 2026-10-05 — worker — activation and unsound shortcut rejected

Authenticated c580 draws bind `CONST[29].x` to zero, but that alone does not prove `0 < min(x,0)` false for *all* GLSL ES executions: section 4.5.3 of the [GLSL ES 3.00 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf) does not require operations on NaN to return NaN. An exploratory zero-cap inference translated the entire original c580 pair before its source range or full-body physical proof existed. Those uncommitted runtime edits were removed. This leaf first proves the actual pc0..27 input envelope; a later leaf may use it for a sound zero-cap comparison.

### 2026-10-05 — worker — implemented; fresh verification requested

Source commit `68744083cede96b774c4ddb68149b078bc0cf886`. `make verify-E6-T12g6m4b` passed at that exact head, then `python3 tools/virgl-coordinate-prefix/cold.py target/evidence/virgl-coordinate-prefix-cold` passed the same command in one scrubbed, pristine clone (clean before and after). `python3 tools/virgl-coordinate-prefix/seal.py target/evidence/virgl-coordinate-prefix target/evidence/virgl-coordinate-prefix-cold evidence/virgl-coordinate-prefix/worker` sealed 93 hot/cold recordings and exact generated binaries. The archive SHA-256 is `9060f8506ee3dfa162108f91c53ad80d0458b7e60eada6bd06b13b22d9aa668f`; the index SHA-256 is `c87a9b3810b4c47edf707f927189c2219aec7efb0fd4ecc64ca71b81e91f080d`. A separate pass rehashed all 93 archive members against the index. The hot and cold receipt SHA-256s are `10fe52f56e2fa20006069d1f79c62d8c7654be85fcfd35d8b996ec4ab073fb04` and `a13904859f8038cd968710031a90122610dd6ac2c7618ab8a16f44c400dec0ff`. Reopen `evidence/virgl-coordinate-prefix/worker/{manifest.json,records.json,recording.tar.gz}` or the corresponding `target/evidence/virgl-coordinate-prefix{,-cold}` paths.

The recording authenticates 2,271 original c580 draw packets and all three complete 136-word banks, then replays the literal original pc0–27 prefix in native and Wasm with identical `pc25.x ≤ 2^46`, `pc25.y ≤ 2^50`, `pc27.x ≤ 2^50` bounds for each bank. The independent Decimal oracle encloses 12 pixel-center/viewport-edge samples and confirms the captured positive-zero bank produces signed negative zero at pc15. Native attacks reject a changed pc8 source, absent coordinate convention, missing or short bank, a complete bank with an unrelated changed word, an uncaptured negative-zero word, a zero divisor, and an overflow-capable coefficient. Six negated-source executions confirm an unrelated signed path cannot inherit the prefix bound; a high-bit-only fact cannot grant float authority. An isolated real C source fault that shrinks the bound ceiling fails the native replay. The actual built shader prefix passes 48 float pixels on physical Chrome/ANGLE Metal WebGL2; a coordinate-source fault contradicts the independent pixel oracle. Browser console/page/request errors are empty. The inherited reciprocal regression passes 40 native/Wasm cases, 25 bank attacks and 100 metadata attacks, and both complete original shader pairs still reject. Native coverage records 3 true/3 false terminal prefix matches (`raw_bits.c:220–245`), 6 negated-source hits (`raw_bits.c:317–323`), and bound producer/RCP paths (`raw_bits.c:680–698`); the WebGL2 browser run executes the early `bridge.c` coordinate-property path.

`make ci` was attempted at the same head. Formatting passed, but workspace Clippy stopped on the pre-existing macOS-incompatible Linux-only `crates/wvseccomp` uses of `libc::prctl`, `PR_SET_NO_NEW_PRIVS`, and `SYS_seccomp`; the exact log is `hot/make-ci.log` in the sealed recording. This task proves a private finite prefix certificate only. It does not admit either full original program, execute guest graphics, negotiate the production compositor, deploy a demo change, or claim a MIPS gain.
