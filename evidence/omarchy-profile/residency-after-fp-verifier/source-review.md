# T03ab source and coverage review

Reviewed frozen harness `f730bc553ee63eec303aa36ab8291e3af2afac24` against
verified parent `0879464ea33b02c86371a3098abe6311e25f4067` before reading the
new physical result. The task is medium risk and harness-only.

## Runtime continuity

`audit-carry-forward.py` independently rehashes all 69 sealed T03z files,
all 29 sealed T03aa worker files, earlier T03m/T03k report pins, the exact
current WASM and R3 kernel/snapshot/delta/manifest. It checks the entire
tracked crates/web/Cargo boundary against both verified heads and verifies
the worktree is clean within that boundary. No runtime/deployment claim is
re-earned by a new build here; unchanged HELD proof carries by identity.

The existing selector at `crates/wasm/src/lib.rs:503-544` maps repack-off to
24 and cap-256 to 256, obtains the existing executor budget, and assigns only
`budget.max_batches`. `BrowserExecutor` still initializes other fields from
`JitCacheBudget::DEFAULT` (32 MiB code, 32,768 table slots, 8 MiB metadata).
Eviction policy and translator are unchanged. These values are source-bound
proof, not new runtime measurements. Actual selected cap is checked in the
browser reports. The September 10 diagnostic is still retained and hashed.

## Changed harness behavior

- `omarchy-input-trial.mjs` has a closed experiment choice. Omission preserves
  the original recycling option shape and false/true arm policy. Residency
  uses a fixed arm-to-policy mapping and keeps recycling false. The URL path
  rejects inherited query tuning and derives the residency selection from
  that mapping; the runtime validator independently derives the expected
  policy/cap instead of trusting option metadata supplied by a caller.
- `omarchy-residency-ab.mjs` is a five-line CLI wrapper selecting residency.
  The original recycling file now exports the shared pair function while
  retaining the original direct CLI default. The moved driver body keeps
  one control then one candidate, scrubs every inherited OMARCHY_ variable,
  pins head/WASM, and waits for owned closure before advancing. New post-arm
  assertions reject incorrect experiment/recycling metadata.
- `omarchy-desktop-live.mjs` passes the explicit experiment into the actual
  option path, rejects it outside input-trial or when mixed with other
  experiments, and adds the new wrapper to the scoped source/hash list.
  The entire `runLive()` function and following failure/evidence/cleanup
  source is byte-identical to the verified parent. No readiness/input/output
  generator or new guest query is introduced.
- `omarchy-input-trial.test.mjs` retains the original six tests and adds
  three actual-function tests: fixed residency URL equivalence; runtime
  policy/cap/recycling drift; unsupported driver selection. Invalid experiment
  mutations also extend the existing options test.

## Unchanged physical proof path

The actual recorder starts `chromium.launchServer()` for each input arm and
uses a fresh context at 1280x800, DPR 1, with service workers blocked. A
navigation-anchored startup deadline includes app readiness, real screenshot,
restored state, canvas click/focus and pre-input runtime capture. T03m's
`!inputTrial` guards continue to omit clients/activewindow recorder RPCs.

Typing remains physical key calls with 40 ms delay and focus checks. Enter
completion fixes the readback deadline before post-Enter focus. The nonce
and filename are independent random values; the serial path can only read
the named file. The positive path separately waits for received frames and
successful presents to advance, then captures actual canvas pixels. The
unchanged parent watchdog allows 300+60+120+20+30 seconds once and aborts the
batch on watchdog involvement; it never resets for late progress.

## Executed coverage before result

The worker's frozen gate records 62/62 tests, zero skipped/cancelled, plus
syntax checks for both CLIs and the recorder. This includes the original
recycling semantics, new options/URL/runtime branches, deadline/readback,
owned-process lifecycle, app readiness and adapters.

`check-preflight.mjs` independently exercises two actual CLI rejection
branches: residency outside input-trial and mixed residency/checkpoint.
Both exit 1 at their expected guard before output setup. A nonexistent
output parent is a second barrier before any local server or Chrome launch;
the receipt records zero browser or guest runs. This covers the otherwise
unvisited new preflight branches without repeating a physical arm.

The current recorded pair must still exercise the wrapper and both real
residency option paths. Final raw audit must supply selected-cap observations,
source identities, trusted keys, nonce fences, cleanup and image inspection.
An offline forged-result attack will cover rejection at the result-audit
boundary. Task/queue/log metadata is waived from execution; it states the
experiment and cannot alter runtime behavior. No changed runtime hunk exists.

## Attribution limits

At `jit_browser.rs:1882-1885`, retranslation accounting tests a physical PC
against a set of previously evicted PCs. It does not compare code bytes or
prove that the evicted work was hot. Installs increment per block. The
eviction counter increments once for an evicted batch at `:1340`; it is not
a block count. A candidate counter improvement or faster startup cannot
supply a successful nonce, visible response, cause or comparative speedup.

## Final coverage

The completed pair exercises both real selections and the shared driver at
the frozen source; raw runtime cap observations agree. Independent CLI
preflight checks cover the new rejected-mode combinations, and the copied
report attack rejects incorrect observed cap despite forged favorable
result fields. Worker freeze/record/audit/counter/seal scripts execute and
their results match the independent audits. All 32 sealed worker artifacts
and their exact recording sources rehash at submission `9245901f`.
Both negative outcomes are sufficient for this bounded experiment claim;
no desktop-success or speedup claim is credited. See `final-verdict.md`.
