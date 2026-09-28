VERDICT: verified

# E5.5-T03ba — R3 incremental fresh-critic verdict

Verified the decoded-cache page index at implementation head
`ff39120a385d31efcbb5021fced43b4bede8fa9f`. Worker submission `fd0cc60a` changes
only the task and queue after that head. This verdict includes a **negative
desktop experiment**: desktop responsiveness is unresolved and T03q stays gated.

Predictions were recorded in `PREDICTIONS.md` after reading the correction and
before executing the R3 tests or inspecting the R3 recording. Unchanged earlier
held results carry forward; both previous counter refutations were rerun against
the actual core crate. No implementation code was edited by this verifier.

## Predictions and observed points

- **P1 public counter regressions — HELD.** The original stale-generation
  same-page case returns `(1, 2)` at `first-counter.log:4`. The reduced
  nine-operation, multiple-generation case returns `(2, 4)` at
  `multiple-generations-counter.log:3`. Both executables import the real core
  crate. The two earlier refutations are resolved by physical slot ownership.
- **P2 baseline parity — HELD.** `counter-differential.log:1–15` records
  1,500,000 operations over capacities 1, 2, 8, 64, and 16,384 and seeds 297,
  29164, and 24301. Every operation preserves both public invalidation counters
  and the `flush_page` return value against pre-index baseline `b5308fc4`.
  This includes the previously failing seed 24301/capacity 8 combination.
- **P3 exact ownership — HELD.** `bounded-attacks.log:1,4–19` covers same-page
  replacement, target-only removal, reinsertion, stale generations, and an
  evicted page whose empty current-generation membership must still return
  true with zero discarded blocks. A separate 150,000-operation model checks
  that each physical slot, including old-generation slots, appears exactly
  once under its owning page. Capacities are 1, 2, 8, 64, and 16,384; seeds are
  33, 39297, and 340413.
- **P4 malformed private index — HELD.** `bounded-attacks.log:2–3` records the
  forged other-page index, `usize::MAX`, and missing-entry attacks. A target
  flush retains the other page, does not panic or inflate the counter, and a
  missing map entry returns false without a capacity-scan fallback. Reinsertion
  repairs the deliberately removed ownership entry. These attacks mutate
  private test state; they do not introduce a supported corruption interface.
- **P5 sabotage sensitivity — HELD.** The exact worker test passes at
  `worker-test.log:3`; requiring the block's generation to match again makes it
  fail with `(1, 1)` instead of `(1, 2)` at `worker-test-sabotage.log:9–12`.
  Removing the target-page guard makes the independent forged-index assertion
  fail at `sabotage-attacks.log:3–4`. Both mutations are confined to extracted
  verifier sources and fail as intended.
- **P6 guest semantics and final clean clone — HELD.** `cold.json` records
  every command, exit code, duration, and log digest. A detached exact-head
  clone was clean before and after acceptance, with fresh build and npm
  directories. Environment variables matching `CARGO_*` and `OMARCHY_*`, plus
  Rust flags/logging and Node configuration, were removed before execution.
  Only immutable Git objects and offline package caches were reused.
  Formatting, strict core clippy, WASM target checking, 357 core tests
  (`cold-core.log:439`), eight capacity tests (`cold-capacity.log:29`), and 57
  harness tests (`cold-node.log:60–61`) all pass. The hostile SMC guest trace
  retains hash `568b64d33599f3f5` and 20 retired instructions at both supported
  capacities (`cold-capacity.log:5,8,13`). Pending code patch cases preserve
  the stated guest register values and trace hashes (`cold-capacity.log:6–26`).
- **P7 physical evidence and product verdict — HELD.** `browser-check.json`
  independently binds 47 helper sources, 67 deployed Git-backed resources,
  exact R3 head, runtime, and WASM
  `4e7f87b37ed522a3c1e07514c10eab2585608c85f09864853da0e99adf5f96c1`.
  The unchanged runtime is cap 1024, cold-counter recycling enabled, 16,384
  decoded entries, dynamic chaining disabled, region chaining enabled,
  ICount64, quantum 500,000, and 1280×800. Original budgets remain
  300/60/120/20/30 seconds. The raw successful serial fence `mu500jsu29`
  returns independent nonce `289fb5bca5ef6124`; it is absent from injected
  serial input. There are 128 trusted physical events and 128 matching
  keyboard calls; the audited input/acknowledgment and cleanup chain holds.
  The independent readback interval is 77,796 ms. I personally inspected
  the actual `code-page-index-r3/desktop/desktop-keyboard.png`: the old empty
  prompt remains, without the typed command or a returned prompt. Its SHA256
  is `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  `machineAcceptance: true` is supported; `desktopAcceptance: false` remains
  the product result. No responsiveness or measured speedup claim is made.

## Diff coverage and fixture audit

`correction.diff` freezes R2-to-R3; `cache-and-harness.diff` freezes the full
cache/harness boundary from the pre-index baseline. At the R3 source:

| Changed boundary | Execution or waiver |
| --- | --- |
| `dispatch.rs:119–144`, `with_capacity` | Storage declarations are structural; construction and empty membership execute in actual-core and extracted tests. |
| `dispatch.rs:206–243`, generation and indexed page flush | Baseline differential, both public regressions, target/non-target and stale-generation attacks execute success, miss, and old-generation paths; forged indices execute the defensive target and bounds checks. |
| `dispatch.rs:246–258`, slot unlinking | Replacement, stale replacement, evicted membership, and missing private entry cases exercise the changed ownership behavior. |
| `dispatch.rs:302–330`, insertion | Same-page replacement, reinsertion, page activation, collision/eviction, and structural model cover the changed index updates; probe and lookup policy remain unchanged. |
| Expanded worker regression | Executes in the full real-core run (`cold-core.log:289`) and the isolated sabotage test. |
| Candidate browser identity harness | Unchanged from prior held harness review; exact R3 identity is rerun by `check-browser.mjs`, and all 57 affected tests pass in the clone. |
| Documentation, type derivations, generated deploy artifacts | Structural/derived data, waived as independent execution claims; the browser receipt and Git-blob audit bind the deployed candidate. |

The page-miss path returns before any slot access; the hit loop visits only the
captured page indices. No full-capacity fallback was added. The model's expected
ownership is derived independently by enumerating physical slots. The public
counter differential uses unmodified baseline and candidate cache source,
verified byte-for-byte in `source-and-receipt-integrity.json`. The `MicroOp`
stub is opaque to bookkeeping; it cannot prove instruction semantics, which
are covered separately by the actual-core guest tests. No new ignored tests or
test-only runtime semantics were introduced. Cold acceptance does not depend
on dirty workspace changes or the prepared browser artifacts.

The report hash is
`ae8f484e39bbe94ab04afb31293d8329102ed97a18b1ae88d53f8db0bf3bdd69`.
`source-and-receipt-integrity.json` binds the 16 worker receipt, desktop, and
submission files used here; the unrelated subsequent profile is outside this
verdict. `sha256.txt` seals the verifier artifacts.

## Reproduction and retained suite

- Actual-core probes: run Cargo with `--offline --manifest-path` against
  `evidence/omarchy-profile/code-page-index-verifier/public-counter/Cargo.toml` and
  `evidence/omarchy-profile/code-page-index-verifier-r2/public-counter/Cargo.toml` from the repository
  root, setting `CARGO_TARGET_DIR` to the repository target directory.
- Extracted bookkeeping: compile `counter-differential.rs` and
  `bounded-attacks.rs` with `rustc --edition=2024 -A unused -O`, then execute.
  Compile `worker-test.rs` and `worker-test-sabotage.rs` with `--test`.
  The two `*sabotage*` executables are expected to fail.
- Recording audit: `DEVELOPER_DIR=/Library/Developer/CommandLineTools node
  evidence/omarchy-profile/code-page-index-verifier-r3/check-browser.mjs`.
- Clean clone: commands and isolated environment are fully recorded in
  `run-cold.py` and `cold.json`. The recording script intentionally refuses to
  overwrite existing phase logs; use a new output directory for a fresh run.

Retain the expanded worker regression for both historical counterexamples and
evicted membership, plus the existing guest-trace/capacity suite. Retain this
bounded differential, structural attack, and sabotage evidence for later
bookkeeping changes. No additional runtime test edits are required by this
incremental verdict. Positive demo/deployment acceptance does not apply to this
negative product result; T03q remains gated.
