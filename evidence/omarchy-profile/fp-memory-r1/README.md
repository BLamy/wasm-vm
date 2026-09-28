# E5.5-T03u worker evidence

This submission demonstrates compiled FLW/FSW/FLD/FSD transfers through the
existing checked memory path. **The actual Omarchy desktop is still not
responsive.** Its physical keyboard trial failed the unchanged 120-second
nonce readback deadline and displayed no typed text. T03q remains gated; the
measured single-precision comparison boundary is planned as T03v.

## Frozen implementation

Runtime and built browser bundle: `7048847fb542d66618b836b965b94c8c9db771d5`.
Independent fixtures were promoted in `21bce8df`; test-only isolation repair
`a593f942a004ee43c1bf5b4c84eeb22522eeeb16` keeps FS constant while changing
MPRV. The intervening `6854af68` is task planning only. These later changes do
not alter runtime or deployed WASM bytes. `submission.json` identifies the
final source, acceptance, cold-build and artifact heads.

WASM SHA-256:
`1f989758c67c9dfdf514d2e03c0e4fa2cadb15a2dc0a465f5cb538661446473b`
(1,590,511 bytes; service-worker version `718190e57c86`).

The original critic independently reproduced an inherited whole-page inline
TLB publication error with both FP and integer memory controls: an allowed
four-byte access admitted another address outside its PMP grant. The patch
requires full-page ordinary-RAM/PMP authority before publishing load/store
inline tags. The original failing recording is retained in the sibling
`fp-memory-critic/pmp-r0-recheck.log` (SHA-256
`fdef6c58eed33a96b07f5ba5881e5ae534ce6784b109df37d03b9170a967bce3`).
All four promoted narrow-PMP controls now pass. This was an inherited shared
memory cache defect, not an FP-only memory import.

## Deterministic execution

`affected-commands.json` records every exact focused command, source head,
timestamp and outcome; its sibling logs retain complete test output. The
worker corpus contains 1,472 transfer cases (state FNV `98a95999f6d6a9fc`),
80 virtual crossings (state FNV `ff5e630874ab4138`), 32 MMIO/FS/fault cases,
and precise run-loop prefixes. It compares all X/F registers, PC, FS, flags,
rounding mode, reservation and written RAM against the interpreter, with
independent exact raw payload assertions. Native/private executors retain the
legacy zero retirement marker; the run loop separately checks derived prefixes.

Shared/private browser tests execute the same fixture plus direct successors,
code-write/reservation barriers and a 129-store chain that fills the 128-record
inline store log. An Sv39 counter test proves real warm inline hits for every
FP transfer: zero new shared-path software translations, compared with one for
each private imported access. FS is stable during that hit proof.

The fresh verifier adds 112 native cases and 224 private/shared browser cases:
independent seeds, compressed offsets/parcels, effective privilege changes,
locked/interior PMP regions, partial RAM pages and data triggers. A separate
fixture executes actual WebAssembly.Memory.grow during MMIO, covering six
success/fault outcomes. Its isolated wrong-payload assertion fails as required;
see the sibling `fp-memory-verifier` directory. Unchanged T03t identity/version
and FPR handoff evidence carries forward.

`browser/report.json` is the initial built-page proof; `acceptance-browser`
and `cold/browser` are the recorded final acceptance executions. Each runs an
actual generated FP memory guest and the full live ISA suite. The guest retires
4,000 instructions, 3,617 through generated code, with 30 host entries, 1,118
direct entries and 1,088 links. The ELF SHA-256 is
`957b10e74c0c5279a8eb27c7e0459cd18b0bfb83324e60f27c37302f05329042`.
Its RAM SHA-256 is
`164f86c9b0c09c224f19ee8fda70f0877dbb9a5835bdd43aab99d0f40a08cf4b`.
This is a RAM-only hash; the harness also compares exposed integer registers,
spilled FPR payloads and fcsr, plus statistics. The Rust corpus checks all FPRs.
The full browser suite is 127/127 with no console/page/HTTP errors. The computed
FP memory capability is live, 2/2. Its inspection capture reveals the existing
legacy container without changing its result. These hooks are never used for
the physical desktop trial.

## Actual physical input: failed

Command: `node tools/verify/omarchy-desktop-services.mjs
evidence/omarchy-profile/fp-memory-r1/physical-input`.

The source head is the runtime freeze. The unchanged R3 snapshot, delta,
kernel, manifest, 1280x800 mode, cache/batch settings and 120,000 ms deadline
are bound in `physical-input/desktop/report.json` and `physical-input/run.json`.
All 128 keyboard events were trusted and accepted; none was dropped or
rejected. Enter completed at `2026-09-15T19:31:51.262Z`; the original deadline
was `2026-09-15T19:33:51.262Z`. The failure callback ran one millisecond later.
Thirteen completed independent file reads returned exit 75, with a fourteenth
still pending at timeout. Presentation remained at two frames, and the actual
Foot screenshot contains no typed text. `physical-summary.json` records the
counts and points to the full receipt. The owned browser closed normally;
there was no watchdog stop or competing task-owned CPU build.

No nonce was written through the serial control channel. Restore, compositor
readiness, accepted events and instruction correctness do not prove a usable
desktop. No unchanged retry is substituted for this failed result.

## Local gauntlet

`ci-commands.json` and `ci.log` retain the single prescribed `make -k ci` run.
It is **not green**. Unchanged failures are Linux-only `wvseccomp` on macOS,
all-feature dead code (`live_blocks`, `fetch_phys`), a stale default-WASM
resume fixture that still calls the now-supported VIRTIO_RNG section reserved,
stale zicsr-stub test helpers, and the lexical determinism scan matching
existing test-only clocks. `unchanged-gate-files.json` and `core-diff.txt`
record provenance; those failures are not reported as passes.

The local performance floor passes without competing task builds: **25.6 MIPS
against 15 MIPS**. Native ISA compliance passes 128/128. Focused production
Clippy, affected virtual-memory/JIT paths and no-host-float results are recorded
separately. Existing ignored stress campaigns are not counted as executed.
No new platform workaround or unrelated runtime change was made for this slice.

## Clean build and publication

`cold/runner.py` records one pristine clone at the final test head, scrubs
RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG and CARGO_* variables, rebuilds with
`make web-dist`, requires an exact WASM match, and runs `make verify-E5_5-T03u`.
Its report contains command exit codes, environment policy and clone location.
`cloudflare-deploy.log` retains the deployment result. `verify-public.py`
checks both the immutable deployment and production with TLS-verifying system
curl; `cloudflare-public.json` contains HTTP status and byte-identity checks
for WASM, JS glue, roadmap and app. The publication exposes the FP memory
capability without a desktop responsiveness claim. No Actions or merges.

Deployment: <https://92ad7b7b.wasm-vm.pages.dev> and
<https://wasm-vm.pages.dev>. All eight fetched files return HTTP 200 and match
the tested local bytes. Commit `5d7a313d` retains the four content-addressed
artifact manifests produced by the deployment script.
