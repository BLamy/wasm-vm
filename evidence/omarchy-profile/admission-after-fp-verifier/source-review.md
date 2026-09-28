# T03aa source review and carried coverage

## Frozen boundary

The only tracked changes between verified parent `53103e76` and the A/B
head `81f01ba31171b8d670f3842948e556b62bcb0d75` are the task file and generated
queue. All `crates/`, `web/` and `tools/verify/` source is identical. A pre-arm
documentation correction explicitly preserves T03m's actual user path.

`carry-forward.json` records independently recomputed source and evidence
hashes. All 69 division submission files match their sealed index. The T03k
dispatch implementation is byte-identical; the fixed trial policy and A/B
driver are byte-identical to T03m. Existing HELD semantics, isolation and
deployment/cold-clone findings carry forward only within those unchanged
boundaries. Broad historical CI failures are not relabeled green.

## Source-level invariants

- `omarchy-recycling-ab.mjs` launches one control then one candidate, clears
  every inherited `OMARCHY_` variable, supplies only arm and pinned pair/chunks,
  checks constant HEAD, pinned served WASM and confirmed browser closure before
  continuing. Each recorder creates its own `chromium.launchServer()` and fresh
  browser context; no attach-to-user-browser path exists.
- `omarchy-input-trial.mjs` fixes startup/typing/readback/capture/cleanup to
  300,000/60,000/120,000/20,000/30,000 ms. Runtime checks inspect actual executor,
  recycling selection/threshold/capacity, decoded cache, residency and clock.
  LP1 is inherited from the pinned R3 image; it is not a new GL attestation.
- `omarchy-desktop-live.mjs:1079` starts the navigation budget once. The real
  app's layers/pixels event, snapshot restore, screenshot and focus precede
  typing. The two `!inputTrial` guards at lines 1160 and 1169 preserve T03m:
  mapped-client and active-window recorder RPCs are omitted in this mode.
- The keyboard loop uses physical `press()` calls, 40 ms key delay and per-key
  canvas focus checks. Lines 1199–1213 anchor Enter before post-Enter focus and
  every read-only nonce lookup. The nonce and filename are independently random.
  Raw guest fences, not command echoes or host RPC success, supply readback.
- Final presentation must advance both received frames and successful presents.
  Screenshots capture actual canvas pixels. The evidence code observes traffic
  without creating input, guest output, readiness or pixels.
- Later optional render-mode/failure-checkpoint helpers are disabled in this
  driver because it removes inherited options. The default owned-trial
  post-verdict allowance is zero, preserving the 530-second navigation-through-
  cleanup watchdog. No task-specific limit or policy changed.

## New evidence and audit coverage

This task changes no runtime hunk. Task/queue metadata is waived from execution;
the new claims require the two actual recordings and independent raw/image
inspection. The worker's new offline audit runs over retained reports only.
Its negative result path is exercised by actual data; one in-memory forged
positive receipt will attack its raw nonce guard. This audit is an integrity
check and cannot manufacture product acceptance.

Worker narrow submissions are directly recorded: policy 7/7, wrapper 1/1,
recorder/adapters 54/54, zero failures/skips/ignores, runner syntax exit 0.
`commands.json` uses head `70c75998`; its only subsequent pre-arm commit is
the documentation clarification, with runtime/harness identity unchanged.
No redundant native build, cold clone, deployment or browser arm is required.
