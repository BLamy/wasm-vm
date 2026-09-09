# E5-T26e remediation 3 verifier predictions

Frozen before inspecting the submitted gate results or focused test bodies.

1. **P1 fresh application HELLO.** A restore with transport/device READY but no newly decoded
   T23d application HELLO must refuse. One fresh HELLO permits exactly one restore; a second
   restore without another HELLO must refuse. A HELLO received before the restore fence must not
   be reusable after the fence.
2. **P2 production presentation composition.** The production page/worker/wasm path must carry a
   successful restore report to the retained live T22 `PresentationController`, call its real
   viewport application path using the retained dimensions, and clear it on refusal. This task
   need not prove reload or pixel CRC; those remain E5-T26f.
3. **P3 pre-backend atomic fallback.** Every refusal before backend staging, especially a missing
   agent with a dirty sink and dirty GPU/input/sound state, must clear presentation, restore true
   cold device snapshots, restart/reset agent state when present, and clear retained host state.
4. **P4 identity and coverage.** Evidence must name implementation commit
   `ea14c48f12a323ff60fb21744a34c10e814cd68a`; all changed semantic hunks must execute in the exact
   gate/focused tests or receive a narrow, justified compile/generated-artifact waiver.
5. **Novel attack.** After one successful fresh HELLO restore, re-open transport/device flags and
   attempt restore again without decoding another application HELLO. Expected: refusal with cold
   fallback, proving the consumed generation cannot be revived by transport state.
