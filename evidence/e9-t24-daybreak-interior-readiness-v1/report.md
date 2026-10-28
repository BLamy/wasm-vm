I’ll perform the bounded independent audit only. I’ll first orient on the task and current diff, record a falsifiable prediction before opening v5 evidence, then inspect the JS/Rust guards and write only the requested diagnostic file.

Prediction before evidence inspection: the visible forward step is likely valid and published, while `inspectSelected()` is expected to reject it because that API reconstructs an exact replay frontier and requires a complete/public predecessor. I’ll test whether branch capture instead serializes the already selected interior state with RAM/digest bindings and still resumes through the public continuation guard; if any of those conditions fail, I’ll classify it as a runtime defect or evidence gap.

The prediction held against the recording: v5’s trace shows a successful immutable capture at transition 20000, a real visible forward click, publication at 20001 with digest `94dab4…`, and only then failure inside the harness’s `inspectSelected()` call. I’m now closing the source-level guard audit, especially the failed-command final frontier and the exact contents/bindings of branch capture.

DIAGNOSIS: harness-api

The interior step/publication is valid; `inspectSelected()` incorrectly invokes the frontier-only guard. Use `captureSelectedBranch().capture.native` only for GPU interior-step captures. Keep final capture on `inspectSelected()`.

[diagnostic.md](/private/tmp/e9-t24-daybreak-interior-audit-v1/diagnostic.md)
