# E5-T25b changed-hunk coverage

Scope: runtime/evidence producer through `a14bf5453a6799a67b5f66e85b4167223580e541`; `6793e0ef` changes only the task log/status and does not require runtime rerecording.

| Changed area | Disposition |
|---|---|
| `tools/verify/e5-t25b-browser.mjs` server launch, exact-head gate, headed Chrome, Foot discovery, five 300-point pointer loops, pointer deltas, scheduler snapshots, raw records/durations, aggregate/error/null checks, screenshot and JSON write | **Exercised** by the exact-producer retained success; raw fields and head are present. Cleanup/failure unwind also exercised by the fresh DPR-2 readiness timeout. |
| Browser runner stationary-window rejection | **Refuted/missing behavior.** The runner reads chrome only before each drag and checks pointer-frame count, but never compares before/after chrome geometry or damage displacement. The stationary sabotage passes. |
| `web/bench/desktop-perf.js` path generation, drawn summary, attribution checks, duration deltas, aggregate, CV and null sink | **Exercised** by focused tests, retained recomputation, and verifier attack matrix. Accepted stationary records expose the finding. |
| `web/desktop-terminal.js` dual gate, present/duration capture, scheduler sampler, exposed perf surface, clear/unload | **Exercised** by retained headed run and fresh boot attempt; dual-gating and teardown also inspected by release audit. The >4096 ring-buffer eviction guards are **waived** because each task run clears before collecting and retained runs contain at most 97 records. Import-error diagnostics are **waived** as an error-only path outside the successful measurement claim. |
| `tools/verify/e5-t25b-release-audit.mjs` including post-rework record-retention assertions | **Exercised** directly under hostile inherited environment. |
| `web/tests/e5-t25b-desktop-perf.test.mjs` | **Exercised**: 5/5 passed. It has no stationary-window case, which is the demanded regression test. |
| Make target declarations | **Waived declaration; commands exercised individually.** The browser command additionally reached the bounded DPR-2 readiness timeout. |
| `web/dist` copies, TypeScript re-export, roadmap entry | **Waived mechanically/declaratively** after direct source/dist byte parity and release-audit checks. |
| Prior verifier evidence and task/queue status-log commits after runtime producer | **Waived metadata-only.** No producer mismatch exists between artifact head and runtime files at current head. |
