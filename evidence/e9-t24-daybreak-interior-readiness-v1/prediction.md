# Pre-evidence prediction — 2026-10-28

Before opening the v5 report or trace, predict `harness-api`: the visible forward control has
published a valid selected interior transition, but `inspectSelected()` is a frontier-only
diagnostic that calls `exactReplayFrontier()` and therefore rejects a selected point whose
predecessor is incomplete/private. The existing `captureSelectedBranch().capture.native` should
be a valid test-only capture route only if source inspection proves that it serializes the full
selected CPU/RAM/device/disk state, binds the capture to recorded RAM/digest state, preserves all
failed-job/private-frontier guards, and its continuation crosses the actual public boundary.
Otherwise classify `runtime-defect` or `needs-evidence` and name the smallest repair.
