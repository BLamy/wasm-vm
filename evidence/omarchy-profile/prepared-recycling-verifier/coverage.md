# AM frozen-hunk coverage

Scope: AK `88212705` → AM `e7e378288581069ae0471e3ca141507e1f5faf30`.
The saved `implementation.diff` includes all implementation and gate changes.
No runtime/web/Cargo diff exists. The 26-module recorder closure, 31 recorded
helper pins, served web files, and the frozen Git blobs agree (`source-audit.json`).

| Changed hunk | Evidence and disposition |
| --- | --- |
| `omarchy-input-trial.mjs:28` options | **Executed.** Actual candidate report and exact URL show recycling ON/cap256. Frozen tests at affected-harness.log:29 reject a control arm and prove the sole URL option difference. Offline attack also calls the real options helper. |
| `omarchy-input-trial.mjs:44` URL | **Executed.** Actual `/app.html` URL matches the fixed settings. Frozen option tests compare the complete candidate/control URL after reverting only recycling. |
| `omarchy-input-trial.mjs:72` runtime | **Executed.** Both actual runtime observations show ON, threshold512, capacity65536, decoded4096, cap256, ICount64 and timing OFF. Frozen tests at affected-harness.log:30 reject seven independent drifts. |
| `omarchy-input-audit.mjs:12` trusted opt-in | **Executed.** Real parent result uses both prepared flags. `attack.json` exercises synthetic positive and false-success paths through this exact auditor; absence of timely raw nonce rejects despite success flags/counters. Old OFF path remains covered by frozen affected tests and unchanged AK evidence. |
| `omarchy-desktop-live.mjs:67,104,120` mode isolation | **Executed.** Real AM initialization selects prepared+worker-cost and reports a clean frozen scope. Existing isolation conditions remain restrictive; rejection branches have no new guest semantics. |
| `omarchy-desktop-live.mjs:460` helper inventory | **Executed.** The new wrapper appears in actual report helper hashes and matches frozen Git. |
| `omarchy-desktop-live.mjs:1323` fence reuse | **Executed.** One actual acknowledged CDP fence is identical in both report fields. Frozen actual-runLive synthetic test at affected-harness.log:75 confirms one fence, original deadline, and four failure controls. |
| New wrapper `omarchy-prepared-recycling-input.mjs:18–47` | **Executed.** Actual exact pair/runtime pins, owned child, fixed environment and 180s post-verdict allowance. `wrapper-test.json` exercises the actual wrapper body with explicit synthetic I/O for pin-size/hash/WASM rejection and inherited-environment cleanup. |
| Wrapper `:48–51` abnormal close | **Synthetic coverage.** Watchdog case executes owned cleanup and throws UNPROVEN; no acceptance. Carried owned-watchdog module is byte-identical to AK/AC. |
| Wrapper `:52–68` audits | **Executed.** Actual report/raw response/configuration/geometry/fence; synthetic audit-error and late-fence cases reject. |
| Wrapper `:69–70` successful-input profile skip | **Synthetic coverage.** Complete wrapper control requires `skipped-input-passed` and still writes `desktopAcceptance:false`. The real run is negative; this fixture is not guest evidence. |
| Wrapper `:71–86` failed-input profile | **Executed.** Actual capture and original failed verdict, failure PNG/profile hashes, exact owned worker and no post-verdict ingress pass both parent and independent raw audits. |
| Wrapper `:87` pre-input failure | **Synthetic coverage.** Startup-negative wrapper control requires profile absent. |
| Wrapper `:88–92` nonacceptance/error/final save | **Executed.** Actual parent0/child1 result and explicit false desktop acceptance; synthetic rejection cases exercise catch/finally. |
| Changed test-fixture/options and new tests | **Executed in frozen gates.** `commands.json`, affected-harness.log:29,30,75,94–99:89 passed, zero failed/skipped; two syntax checks. Test-only state is explicitly synthetic and never contributes guest success. |
| `freeze.py`, `record.py` | **Executed.** Frozen commands and receipt precede the real launch. Independent source audit repeats the exact closure and chronology checks. |
| `symbols.py`, `bind-names.mjs` | **Executed.** Symbol-build command log and 11-section binding; independent ULEB/name parser and exact weighted recount agree with the entire worker CPU summary. Existing AL object is transformed, no runtime rebuild. |
| Task/queue metadata, comments, imports, logging, seal helper | **Waived as metadata/glue.** No independent runtime behavior; actual artifacts and 32-entry worker seal were rehashed. |

All changed behavior is executed, covered by a bounded deterministic control, or
explicitly waived. No unproven acceptance hunk and no dead-code demand remains.
The independent checks do not rerun a guest, negative control, native build,
browser, cold clone or broad suite. Unchanged AK/AJ/AL/AA/AC boundaries and 237
sealed files are carried in `prerequisites.json`.

Suite: retain the worker's three new deterministic option/runtime/input tests,
the bounded false-success control, and this exact negative recording/profile.
The synthetic wrapper adapter supplies harness branch proof only.
