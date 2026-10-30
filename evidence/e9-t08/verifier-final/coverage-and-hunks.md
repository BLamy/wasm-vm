# E9-T08 changed-hunk sufficiency audit

Base `65ef3082`, frozen product/integration head `1b3c68c0def3fb98c8803ed6f95089f90ed7dfe7`.
Risk S/medium. No native/runtime/loader/store/library/pinned GPU implementation file changed.
Predictions were written before evidence inspection in `predictions.md`.

| Changed hunk | Evidence or explicit waiver |
|---|---|
| `Makefile:467-469` acceptance target | Frozen `make verify-E9-T08` actually invoked the new Python driver; outer report records all nine original gates and exact commands, each exit 0. |
| `e9-checkpoint-milestone.py:11-68,74-79` inputs, clean checks, narrow gates, browser/oracle admission, receipts | Outer original report SHA-256 `172eb74455cc91151d7d55d5112a97af6daeed45e543e6a897fe186cd418b2f4`, all retained file receipts independently rehashed, source receipt checked against frozen Git objects. |
| `e9-checkpoint-milestone.py:70-73` failure-report path | Waived: harness failure diagnostics, no runtime behavior or acceptance claim depends on a deliberate harness failure. |
| `e9-checkpoint-milestone-browser.mjs:11-57` arguments, coverage, UI helpers, original/active capture, restore checks | Original driver is retained verbatim at browser trace `resources/src@c0717b5d842ea4a1d120bbc05653d705c8793ef6.txt` (SHA-256 `2eb9672bb351b9e51452f429a73a0fb2ea4e3ae4f3bda1b1525abd678431c2ec`); recorded call arguments/results plus eight retained raw frames cover the helper paths. Original JS text is retained by coverage, Wasm bodies by trace. |
| `browser.mjs:59-84` frozen-source/local-server/browser setup | Local final is nondevelopment, clean at frozen head; trace has actual built-page load `call@11`. Static server served the original compiled JS/Wasm. Out-of-tree/missing-file/method assertions and fallback error handling are waived as harness rejection plumbing, not changed product behavior. |
| `browser.mjs:85-87` public-byte branch | Executed on production: eighteen public asset lengths/hashes match frozen Git objects. Original report SHA-256 `8beb9711992dca26e0c741787951e218e4609d04dbbd1e7b4a78d2f4b240dc79`; all 681 original public payloads independently authenticated. |
| `browser.mjs:88-116` suite, two fresh guests, typed stimuli, visible Start/rename/point limit/quota/Stop | Suite 127/0. Fresh guest shell preconditions recorded at `trace.trace:378/call@43` and `:612/call@81`; setup writes same file with distinct bytes. Quota request `call@117`, unsaved frame differs; immutable prefix is byte-identical. Rename Enter forms are recorded. |
| `browser.mjs:117-129` reload, independently addressed restore, fresh tab, preview, confirmed deletion, durable survivor | Reload `call@159`, Beta Open `call@177`; new page `call@201`, Alpha Open `call@219`; confirmed delete `call@251`; reload `call@271`, Beta Open `call@283`. Exact originals/raw restored frames match. Guest file/RAM commands are `call@189/191`, `231/233`, `295/297`. |
| `browser.mjs:130-139` keyboard, narrow viewport, docs, ext4 oracle and zero errors | Direct checks: Tab reaches Rename, mobile width/scroll 388/388, rendered doc text and screenshot; original report errors `[]`. Independent derived ext4 reads give Alpha/Beta/unsaved/reopened literal bytes. |
| `browser.mjs:140-150` catch/finalize/source inventory | Success finalize executed and its digests independently authenticated; failed-run screenshot/catch and defensive closure exceptions are waived as harness diagnostics only. Development mode bypass is explicitly not evidence; final development=false. |
| `e9-checkpoint-milestone-files.py:12-81,84-101` raw parser, component/native16/sparse RAM/input/disk roots/base and actual filesystem reconstruction | Independent separate parser rehashed every component and section, decompressed all eight raw tuples and expanded RAM digests, reconstructed four new ext4 copies under ignored verifier directory and read them with Docker debugfs. Expected literals are external hardcoded stimuli, not produced by VM code. Worker used pinned Docker image and retained fsck/debugfs logs. |
| `files.py:87` copy fallback | Waived: portability plumbing in disposable test image construction; successful local APFS clone branch executed. No product semantics or deployment portability claim. |
| storage guide 21 added lines, generated docs/catalog/wrappers | Direct source review, original rendered storage doc in trace plus screenshot. The generated Markdown is exact source bytes following a fixed provenance prefix; catalog changes only storage search content/hash; wrappers/reader change only content revision strings. Existing documented runtime boundaries carry forward from T05/T06/T07. |
| roadmap/tasks/queue/generated service-worker version | Declarative status/catalog bookkeeping. Roadmap touched pip recorded in-progress at frozen head; future verification status/catalog updates are metadata. Service-worker change is only content version and is waived from product execution (recording blocks service workers). |

No product acceptance hunk is unexecuted. The production branch and production raw tuples/source receipts are authenticated. Full branch coverage is not claimed; diagnostics and guarded rejection alternatives are explicitly waived above.

## Independent novel attack

N1 ran against a copied original profile on its exact recorded local origin. The literal name
`Beta <b id="e9-novel-marker">Ω & "quoted"</b>` remained literal display text after rename,
reload and independently opened fresh tab; no injected element or errors appeared. Before/after
captures are byte-for-byte equal to original Beta with hash
`a7368525958f378a505077777dd46f4ee995b6ca5af313124d4d373cb59d80e0`, paused, zero slices.
Original profile, reports and frames were never mutated. The final parameterized test was promoted and passed its narrow recorded rerun after tracked submission readiness. It additionally chooses Alpha→Beta independently, rehydrating deleted original Alpha only in the cloned profile through the existing save API using its original authenticated frame and the shared original configuration. Before/after Alpha frame and disk root agree, actual paused frames/input/held keys agree, and resumed guest file/RAM/queued values agree for Alpha then Beta. The full original local/public recordings carry forward unchanged.


## Promoted regression and incremental admission

`tools/verify/e9-checkpoint-metadata-critic.mjs` is the independent N1/N2 regression,
now a post-browser gate in `make verify-E9-T08`, with a syntax gate and source receipt.
The actual promoted command completed with eight checks, no errors and exact original
Alpha/Beta/fresh-tab frames. Its original trace, cloned profile and raw captures remain
at `target/evidence/e9-t08-verifier-promoted/`; report SHA-256
`076281aa2ca3d88b882db278136ba9150ae5586c4522f128606551cfeb9f8555`, source SHA-256
`d372c329048d513b9d8ec3ebf3476ed3474450c826269b56112efc922b0a3e17`.
The driver syntax and updated Python source compile passed; all three added admission
assertions were executed directly from the actual wrapper AST against the original and
promoted reports through read-only directory links. `incremental-gates.json` records the
source digests and exact affected command. The new source-inventory path is declarative;
existing run/finalization machinery is already proven. Failure-only catches/404 handling
and missing-output receipt fallback in the promoted test are waived as harness diagnostics.
No product code changed and no earlier unrelated gate is restarted under incremental policy.

Production independently matches every component/native section, expanded RAM, canonical
disk root and literal ext4 witness. Its raw original/restored hashes are Alpha
`df780f05a35317c48dced9fefd6354686a03ccb915d630bc20f270abb2f0cc2e` and Beta
`ffc5918032ed197f67c3bc0679bec8d047ce80b712074e60fefabbfe58b19808`.
Public original trace SHA-256
`f3c5e4d9651ff737f884b1f6e9cbef5537f400f68500065e89fbf0be530bd437`
contains no unexpected console/page/HTTP error; its one favicon 404 is the explicit allowed exception.
All 733 files of the successful deployed payload, all 728 tracked identities, five release
extras and eleven normalized R2 URL references were independently authenticated.
