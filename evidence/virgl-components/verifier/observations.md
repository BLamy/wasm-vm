# E6-T12e1 final prediction results

Initial predictions remain immutable. The task is a new shader boundary; no T11c
verdict was reused. Source and input preparation preceded worker results. The
only carried results are unchanged dependency/default-web behavior and final
same-source recorded shader regressions.

| Prediction | Result | Concrete evidence |
|---|---|---|
| C01 | HELD | `binding-audit.json`: all19 original bodies match baseline/frozen hashes; exact11 accepted identities. Own native original records and actual browser parity independently agree. |
| C02 | HELD | `native.json` bank/index cases; `supplemental-cases.json` positive index7 controls for CONST/IN/OUT/IMM/SAMP/SVIEW/GENERIC, actual browser native parity; TEMP9 exercised through all lane tests. |
| C03 | HELD | All TEMP/CONST range endpoints, overlaps, duplicates, huge numerals and operand/nonpermitted ranges reject as predicted; every primary rejection has exact known-good recovery. ASan/UBSan stderr empty. |
| C04 | HELD | xyz/xy inputs and outputs, malformed declaration masks and partial POSITION rejection; reflected metadata masks match actual linked programs. |
| C05 | HELD | Seven MOV/ADD/MUL masks; partial MAD/TEX rejection; malformed destination masks; unchanged full-vector originals/old gates. |
| C06 | HELD | `alias-*` cases test all initialization subsets with read-before-write/self-aliasing; admitted writes cannot initialize their own source. |
| C07 | HELD | 28,672 exhaustive MOV combinations and 4,096 TEX cases match independent set mapping; native source-selector omission fails `lane-1-xxxx-w`. |
| C08 | HELD | Repeated/swapped selectors across every four-letter swizzle; actual original fragments and full vertex vectors, not just accepted grammar. |
| C09 | HELD | TEX xy-only initialization matrix plus actual texture samples at four distinct UV centers for both new original fragments. |
| C10 | HELD | Missing each full-output component rejected; declared xyz/xy and correct end coverage accepted. Native/Wasm metadata has exact writtenMask. |
| C11 | HELD | `gpu.json` original fragment actual pixels: preselected half-brightness literals at all four asymmetric texels, unequal alpha unchanged, 4,608 own pixel checks. Worker adds brightness0/1 and prior draws. |
| C12 | HELD | Own actual transform-feedback vectors: affine `[0.5,-0.4375,0.6875,1]`, matrix `[0.59375,-0.125,0.3125,1.375]`; exact preselected constants/input and preserved affine varying. 1,630 additional actual triangle pixels with independent geometry. Z-only source corruption gives z0.5625 instead of0.6875 and fails. |
| C13 | HELD | 845 selected cases have exact native/Wasm GLSL+metadata parity in actual browser; original programs compile/link, system block656/offset640 reflected, constant uploads use raw float bits. |
| C14 | HELD | All seven PRECISE originals and flat original remain rejected by exact hash; targeted new-opcode/qualifier/ADDR/modifier negatives plus recorded old grammar corpus. |
| C15 | HELD | At/over 16KiB and128 instructions, old token8192/static memory/output caps source-bound, sanitizer runs with assertions enabled. No new unbounded numeric path. |
| C16 | HELD | Bound final nine literal draws/4,336pixels and three captured phases/768pixels; unchanged upstream/Rust/default-web bytes and production-disabled contract. |
| C17 | HELD | `sabotage-native.json` catches consumed-lane mapping removal; `gpu-sabotage.json` catches z-only ordered source selector corruption. Worker masked-write control also fails its intended pixel. |
| C18 | HELD | Independent helper binding audit14,355 checks, exact final clean cold; own source-bound Clang coverage hits all24 added executable lines and reachable changed conditions, with one explicit parser-invariant waiver. |

The helper found an authentic limitation in worker depth-only sensitivity: a
z-only wrong swizzle could retain every tested depth decision. This was a proof
question, not a runtime refutation. Own original-body hardware transform feedback
now directly checks all four coordinates using constants recorded before results,
and the specific swizzle corruption fails. The bounded task proof is therefore
sufficient with the committed independent supplement; the earlier pixel proof is
not described as detecting that particular mutation.
