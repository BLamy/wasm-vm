# E5.5-T03ai verifier findings

## F1 — the actual Lua guest rejects the legacy direct-property syntax

**VERDICT: refuted at R1 head `f55923bda86172359f73db8ea998692ceb155fae`.**

P1 predicted that the fixed dispatch batch would reach direct setters. The
actual response at `direct-opaque-r1/desktop/report.json:6776` and `:6785`
contains eight Lua syntax errors, and the values subsequently read remain
`false,false,0.985,0.96,1,false,false,false`. Report SHA-256:
`edf2736a39f59d2035d8e9f0607e031b1cdefe9fba9e305e734b9c13eed63411`.
The reply completes at 04:48:02.924Z (see the independently reconstructed
raw record in `direct-opaque-r1-audit.json`); the shell exit code is zero.
The strict changed parser correctly refuses it before any physical key.

The cause is in the pinned primary source:
[HyprCtl.cpp lines 1043–1056](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/debug/HyprCtl.cpp#L1043)
selects Lua syntax before reaching the legacy dispatcher audited initially.
The changed command at `tools/verify/omarchy-direct-opaque-command.mjs:9`
uses that legacy syntax. My initial source audit overlooked this caller
branch; this note explicitly corrects that inference and preserves the
failed prediction.

**Demand:** preserve R1 as a harness-route failure, correct the command for
the actual Lua configuration using the pinned source, freeze its new head,
rerun affected harness proof, and record the single corrected trial. Runtime
proof and unchanged input-audit/fence proof carry forward. No successful
configuration, physical-input result, or desktop response is established
by R1.

P2, P3, P4, P5 and P8 held for this negative run: the bad reply is rejected,
the exact source/resources match, startup stays within 300 seconds, and
cleanup closes normally in 165 ms. P6/P7 have no actual input evidence.
Both personally inspected initial/final images show the same empty prompt
(SHA `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`).
The two synthetic controls and six independent attacks in `attack.json`
were run twice and behaved as predicted, but cannot repair F1.

## F1 correction independently verified on R2

At corrected head `141bdd5a055aa3f03592f127246a8b6e131f9125`, the actual
raw serial record completes at 04:56:18.471Z with eight `ok` acknowledgments,
`true,true,1,1,1,true,true,true`, and mapped visible active Foot JSON.
Citation: `direct-opaque-r2/desktop/report.json:11165`, receipt at `:27670`,
SHA `b7f4b5578d1beba34661417f5a535639b7644f7473694d8c36a30ade63f78ef7`.
`direct-opaque-r2-audit.json` independently reconstructs this response and
binds it to the corrected fixed command. F1 is cleared for the final head.

The actual response hypothesis still fails: 128 trusted physical events
complete, but all 14 completed reads return exit75, one is pending at
Enter+120 seconds, presentation stays3→3, and all personally inspected R2
images remain the original empty prompt. This is the worker's stated
negative diagnostic result, not an unaddressed false success in the code.
See `final-verdict.md` for the scoped verdict.
