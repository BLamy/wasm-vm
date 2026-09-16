# E5.5-T03at frozen diff coverage ledger

Frozen source: 2e61bf3e971595741c627e8b68fcaee055c27945, compared with
activation af253faa. Runtime, device and browser evidence is audited below; publication identity is independently verified against submission 31acd7e8.
`frozen.diff` preserves every non-dist hunk. Only the one source-origin
calculation changes production guest-device semantics.

| Changed hunk | Recorded evidence / classification |
| --- | --- |
| resources.rs source `first_row = offset` | Literal Linux source24 regression, independently chosen byte-offset3 SG/page/end attack, 3 independent SG seeds, actual queued five-command traces, WASM literal test, real physical browser trial. HELD: final/cold device recordings plus clean/restored critic logs; browser exercises the corrected runtime but remains visibly negative. |
| resources.rs corrected partial callers / model oracle / tile oracle | Affected GPU tests, all three existing model seeds (30,000 cases total), and independent literal attack. Existing fixture destinations must remain unchanged. HELD: final/cold acceptance logs and independent literal/seed probe. |
| resources.rs new literal and rejection tests | HELD: recorded affected tests plus worker-literal-sabotage.log and worker-queue-sabotage.log; clean/restored controls pass. |
| gpu/mod.rs corrected queued transfer offsets and emitted records | Actual descriptor-backed transfer/fence test and five-pattern CREATE/ATTACH/SET_SCANOUT/TRANSFER/FLUSH sequence under `gpu-trace`; emitted requests, responses, shadow and sink CRC. HELD: final/cold-device-recording.json independently decodes all five request/response sequences and CRCs. |
| WASM gpu_protocol source/destination test | Execute wasm-bindgen test on wasm32 and verify literal destination words; native success does not cover this hunk. HELD: final/cold acceptance logs. |
| GPU runtime JSON and loader | HELD: `runtime-attacks.json` checks all three frozen source/WASM byte identities and 26 mutation/default-compatibility attacks. Both final and cold wrappers exercise the explicit loader and record this exact manifest. |
| input audit / response audit optional runtime argument | Historical AS report remains accepted with its unchanged AO default; runtime substitution is rejected. New explicit argument is covered by both actual AT report audits. |
| response wrapper explicit `--gpu-transfer-offset` branch | Physical run must record explicit candidate manifest and new WASM while preserving exact AR/AQ input identities. HELD: final/cold acceptance logs. |
| desktop-live recording scope extension | Report helper hashes and clean scoped status must cover the newly included GPU subtree and runtime files. HELD: final/cold-recording.json independently checks all 45 helper hashes and 67 distinct git-backed resource identities. |
| Make acceptance targets | Record each affected gate and browser path at frozen head, including one scrubbed pristine-clone invocation. HELD: final/cold acceptance logs. |
| roadmap row | Declarative metadata; visibly honest `partial` status and unresolved desktop claim. Built demo must display task and pass all 127 ISA fixtures with zero errors. HELD: actual final screenshot inspected; demo-suite.json binds the 127/0 suite and zero errors. The task/roadmap remains honest about unresolved responsiveness. |
| generated web/tasks.json and dist/tasks.json | WAIVED as generated declarative task inventory; task status must remain honest. No new execution semantics. |
| generated dist WASM | Runtime identity is independently pinned; native source tests, wasm32 literal test and real browser path must all pass. HELD: both actual AT browser reports bind the new WASM. P9 remains a measured visual failure. |
| generated dist roadmap/service-worker version | Roadmap duplicates reviewed source; cache namespace is a content-derived build value. Built browser proof and cold rebuild cover distribution. HELD: final/cold acceptance logs. |
| generated dist artifact manifests | Build regeneration preserves artifact hashes/sizes and changes deployed URLs back to source-relative staging paths. The post-freeze deployment rewrites URLs back to content-addressed public objects without changing artifact identities. HELD: public.json independently verifies exact committed WASM, manifest and honest partial roadmap on deployment and production; worker-seal.json protects the full 12-check worker receipt. |
| worker baseline metadata/source excerpt/recording script | Metadata and logs are audited by hashes. Recorder's ordinary and cold branches both must execute; external preverified guest artifacts may be copied, compiler outputs may not. HELD: cold-integrity.json checks seven successful commands, initial pristine state, rebuild identity, and explicit copying of external guest artifacts only. |

No unrelated dirty E6-T22/build-rootfs/e5-t22c changes are part of this diff or
verification. Inherited broad-gauntlet failures are not declared green.
