VERDICT: verified

Independent incremental review of runtime/harness 66bb2a48019d089756cdfaee3d5ea578f156bc28,
handed off by worker claim 25323636. The prior runtime was independently refuted;
its two attack reports and initial worker evidence are preserved unchanged.

- F1 / P3 HELD after repair. Identical bounded novel attack now passes all 45
  checks on actual Canvas2D/WebGL2 at DPR 1, 1.5 and 2. Coalesced matching frames
  have zero pixel mismatches and sizeMismatch=false after paint at
  odd-transition-final-66bb2a48.json:395,858,1321,1784,2311,2838. Report SHA256
  6484176cf7eae41d935fdb828ab58172f770ae9845e5bad8010f6c7bdcb45501.
- F2 HELD. final-unit-tests.log:7 records the deterministic transition regression:
  web/tests/e5-t22b-viewport.test.mjs:169-177 predicts mismatch before drain,
  full matching damage after two receipts, then original partial damage on the
  next successful same-size paint. All seven scoped tests pass, no skips.
- F3 / P4 HELD. Independent immediate resize replay and partial old-resource
  oracles remain exact. Replacement context replay without any new frame has
  zero mismatches at final attack report:1847,2374,2901. Constructor, activation,
  resize and disposal paths execute in these runs and the scoped unit test.
- F4 HELD. Final worker evidence records exact runtime head 66bb2a48, 55 passing
  tests, 58 pixel oracles / 183108328 bytes, six backend/DPR cases, 126/0/126
  demo metrics and no collected errors. All eleven file hashes match current
  and frozen bytes; seven screenshot hashes match. viewport-proof.json:7099
  records real paused main-app controller ownership; :7134-7135 advertise
  1122x240, with no fabricated scanout resource. This closes the earlier initial
  main-app ownership evidence gap within the stated fixture boundary.
- P1/P2/P5 HELD carried forward. Viewport policy, DPR polling/listeners, RPC
  identity fences, pointer code, backend implementations, fixtures and WASM are
  byte-identical to the initial reviewed runtime. Final acceptance.log:40-44
  retains dimension/debounce/race/disposal assertions; final proof repeats the
  six DPR/pointer cases and one-request storm. T22a architectural hotplug and
  TRANSFER bounds remain unchanged, with WASM SHA256 563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc.

## Changed-hunk coverage

The delta contains one runtime module plus its byte-identical dist copy. Every
added runtime hunk is exercised; no changed behavior remains unproven or dead.

| Hunk in web/src/sink/presentation.js | Direct exercising evidence |
| --- | --- |
| 120 painted-resource initialization | Both real backend constructors in final attack; deterministic test constructor |
| 204 activation invalidation | Initial real backend activation and three context-loss Canvas2D replacements |
| 301-308 paint-time full/partial decision and successful painted dimensions | Six coalesced matching pixel checks; unchanged-size old frames; unit lines 169-177 explicitly assert full then partial rectangles |
| 368 validated receipt without repaint decision | Both synchronous receipts in each matching coalescing check |
| 404 resize invalidation | Three odd-size immediate resize replays per case, each read before another frame |
| 422-423 painted mismatch predicate | Unit checks before/after drain; independent reports before/after resource transition |
| 464 disposal clear | p.dispose() in each independent case and deterministic test line 181 |

Removed receipt-time promotion has no remaining execution obligation. Updated
test hunks run in final-unit-tests.log; updated browser harness coalescing,
fixture routing, actual app boot/binding/stopping and JSON serialization execute
in the worker's final successful acceptance run. Documentation changes are
waived as explanatory prose, and the duplicate dist module is hash-verified.
Unchanged initial hunks retain the prior scoped coverage. UI status strings and
roadmap labels are diagnostics/declarative metadata; guest compositor adoption
and a guest frame-producing main-app boot are outside this claim. This review
does not expand those into requirements.

## Evidence and retained suite

check-final-evidence.mjs records reproducible hash checks in final-integrity.json.
Worker JSON SHA256 d273f19eb6f5b7ce92505d049fada88dc73ee79f02776a3be83478cd66587690;
worker log SHA256 703d8693242638966c4c0b08d64a39a9d9b80e2ef5c7a9d039ecce24f9017a43.
The independent attack runs on claim head 25323636, whose runtime hashes equal
66bb2a48; no runtime was changed by the claim commit. Original attack report
hashes remain cd2be46575d0b6f4ab886a2435e36800739aab459f7dd6b4d9efe8d9ad0ac8b6.

SUITE: retain the worker's deterministic coalescing/partial-fast-path regression
and six recorded browser coalescing cases already under make verify-E5-T22b.
Commit the independent reproducible attack, original failures and successful
recheck as verifier evidence; no duplicate production test or implementation fix.
Functional Chrome SwiftShader proof only. No cold clone, unrelated Rust/CI,
performance/compositor claim, deployment, merge or external machine.

Commands: ATTACK_REPORT=odd-transition-final-66bb2a48.json node
evidence/e5-t22b/verifier/odd-transition.mjs; node --test
web/tests/e5-t22b-viewport.test.mjs; node
evidence/e5-t22b/verifier/check-final-evidence.mjs. All exited zero.
