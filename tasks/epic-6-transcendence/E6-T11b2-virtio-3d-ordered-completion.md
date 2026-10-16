---
id: E6-T11b2
epic: 6
title: Complete guest 3D submissions and DMA through ordered asynchronous jobs
priority: 525.026972
status: verified
depends_on: [E6-T11b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Connect SUBMIT_3D and TRANSFER_TO_HOST_3D/FROM_HOST_3D through Rust and Wasm to the
verified asynchronous job engine. Own immutable requests and response descriptors
across yields; define bounded admission and dispatch. Validate exact wire sizes,
all guest ranges and full u64 transfer offsets before narrowing. Embedded
TRANSFER3D/COPY_TRANSFER3D commands use the same fresh gather and actual-output
scatter as outer transfer requests. Copy through the bus, never retain guest or
Wasm-memory views.

Order control completion by device epoch and internal request sequence, never by
guest fence IDs. Preserve VIRTIO_GPU_FLAG_FENCE and the full fence ID, including
duplicates and nonmonotonic IDs. Validate the entire completion before scattering
precise dirty rows, then publish response, used.idx, trace and IRQ in that order.
Keep cursorq independent. Run host GPU polling outside Machine.run; pending but
not ready work remains idle, and ready completion wakes service without a new
guest kick or per-instruction GPU polling.

Context destruction is ordered after earlier admitted work. Device reset revokes
old queue ownership and releases pending host jobs; late or duplicate completions
must not touch RAM or old/new used rings. Unsupported commands and host failures
produce explicit errors and replayable diagnostics. Production 3D negotiation
remains disabled pending the truthful capability milestone.

## Admission and ownership

The transport admits one owned control head at a time. Descriptors behind that
head remain in the available ring; their request bytes and response spans are
snapshotted only when admitted. The renderer runs outside `Machine.run`; owned
DMA exchanges use explicit Machine methods, and a capacity-one completion
mailbox wakes the next bounded run without another guest kick. Reset and queue
configuration changes revoke pending ownership before late callbacks can DMA or
publish a used entry.

## Deterministic acceptance

`make verify-E6-T11b2` runs affected native/Wasm gates and recorded guest traces
plus headed browser submission/readback tests. Queue 100 fenced commands and
immediately destroy the context: every admitted request receives exactly one
ordered success/error response, and no freed backing is accessed. Document
admission semantics if the implementation leaves descriptors in the available
ring behind one active head rather than copying a large FIFO.

Assert exact native/Wasm wire parity, output-before-used/IRQ, fence echo and
ordering, event-loop/cursor progress, actual fresh uploads and readbacks, and
bounded pending work with varied deterministic completion schedules. Include
reference-decoded command logs and submit/fence/byte counters. Verify the ordinary
built demo and ship any resulting default artifact changes. Complete the high-risk
final pristine-clone proof.

## Adversarial verification

Delay or fail completion, detach backing during a queued transfer, destroy/reuse
context/resource IDs, and interleave independent contexts. Exercise duplicate and
nonmonotonic fence IDs, reset and late/duplicate callbacks. Reject overflowing
transfer arithmetic, malformed submit tails and incomplete response capacity.
Mutate unrelated guest bytes while readback is pending and preserve them. Test
both embedded and outer DMA. Introduce incorrect completion ordering and an early
readback signal and require deterministic failure. Explicit proof negotiation
must not enable production 3D.

## Verification log

### 2026-10-03 — worker — implemented, independent verdict pending

Frozen runtime and acceptance harness: `f0f125fd0578a22ce08c4bc255ca63708c6e6566`;
parent verified B1: `3e5bf674b019d3055bc880ffeb48f8bd4d8d7102`.
The proof transport now owns one pending request, its response spans, context and
resource/backing generations. Later heads remain guest-owned until admission.
GPU polling occurs between Machine calls. Fresh owned gather/scatter exchanges
use bounded checked RAM spans, invalidate every touched code page, and cannot be
replayed after completion, reset or queue reconfiguration. The separate bounded
mailbox publishes completion only after output and GPU readiness; terminal
uncertain failures preserve their successful prefix and explicitly require reset.
Guest fence IDs are exact 64-bit payloads, independent of internal order.
A valid `complete()` mailbox post is the completion commit point: a trusted
wrapper exception after that accepted post cannot retract the already completed
GPU success. The uncertain-output controls fail before accepting such a post.

Recorded command:

```
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
  VIRGL_SUBMIT_EVIDENCE_DIR=evidence/virgl-submit/worker make verify-E6-T11b2
python3 tools/virgl-command/submit-cold.py --output evidence/virgl-submit/cold-clone
```

The gate passed formatting and affected default/proof Clippy, nine new native
submission tests, seven existing native control tests, affected virtio/bus/Machine
tests, default/no-std Wasm builds, six Wasm protocol tests, both explicit proof
builds, the pinned shader build, synchronous browser regression and hardware
submission acceptance. `worker/receipt.json` binds exact source, capture inputs,
coverage, screenshots, logs and eight native/Wasm wire/ring/control/submit-state
records. Its SHA-256 is
`f3fa6b8ec0f642c93366b582d625d8987d2f40bebcd58a7130eb1a99fc770942`;
`worker/native-browser-parity.json` is
`0ad05710f625870e350b79c8104035de473789bd2ef1462ceb0abb3959c5b87e`.

Headed hardware WebGL passed 280,536 assertions and 46 named attacks, including
full-width/duplicate/nonmonotonic fences, reset and late callbacks, queue changes,
SG boundaries, fresh uploads, exact dirty-row output, Wasm memory growth,
interleaved contexts and resource ID reuse, malformed wire lengths/arithmetic,
reentrancy and post-scatter uncertainty. The original eight captured submissions
executed all 210 packets and three draws, checked 768 literal interior pixels,
and copied 12,288 actual readback bytes into guest RAM. Poisoning every saved
reference output byte left all three rendered frame hashes unchanged. The
100-draw queue followed by destruction completed exactly once per head with
maximum pending work one; recorded heartbeats and cursor commands progressed.
The two served-source mutations failed specifically at the signaled-readback and
GPU-before-completion assertions. These expected failures are controls, not
failed product runs. The old control regression retained exact 27-record parity.

`worker/hardware/report.json` SHA-256:
`52ef1cda3398cddfdbb2f3704b8761c7bb04542038972019cc7bf14dac577099`.
The screenshot was visually inspected. The ordinary committed demo passed 127/127,
zero errors, a live existing roadmap capability and absence of both proof exports.
`worker/default-demo/report.json` SHA-256:
`b7c148328c51fdbcb8d2d33484ac995ef5d30149e2d0f68c1744198490aaea52`.

Development corrections: moved a fixture staging arena beyond the proof hart's
JAL instruction; corrected a test's draw-count argument index; replaced per-yield
whole-RAM digest observation with explicit deterministic checkpoints; and changed
DMA from per-byte bus stores to checked bulk spans with complete code-page
invalidation. All are included in the frozen head. The approximately eight-second
browser run is harness duration, not a desktop frame-rate or MIPS measurement.

This demonstrates isolated real Wasm virtqueues, hardware rendering and guest-RAM
DMA. Captured commands are injected through the proof fixture; it is not a live
Mesa boot. Production VIRGL/capsets remain disabled, and scanout, full Mesa
compatibility and performance claims remain subsequent tasks.

The final pristine clone at `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-submit-cold-zw5058to/wasm-vm` passed the entire gate at the same
frozen head with scrubbed environment and empty Git status before and after.
`cold-clone/report.json` SHA-256:
`c3c2df6ef3493dce0c401e758507e066ff0cc5cb1b63b2a51199f4e0c20f2cb5`;
`cold-clone/acceptance/receipt.json` SHA-256:
`c641fd81027a37278835b0866f671ac40b7808d5e14fe848b1501cf52c617478`.

The required default bundle refresh was deployed with
`bash tools/deploy-cloudflare.sh` to https://81fe5427.wasm-vm.pages.dev and
https://wasm-vm.pages.dev. The fresh live load passed 127/127 and fetched the exact
1,634,057-byte committed Wasm, SHA-256
`0b926d93b2ef3de3092dc54184e7f6becd9509d0eaf63c8aa7b363a399b58eb8`; both proof exports are absent.
Console/HTTP capture has zero application errors; the first collector counted the
pre-existing favicon 404, so its report/script are retained in
`worker/live-first-run/`, and the final collector records that sole allowed 404
by URL and status. No runtime code changed. Deployed manifest copies are recorded
and their temporary URL rewrites were restored to committed bytes.
`worker/live-report.json` SHA-256:
`53676ce1356bdc75fbbf8aeac9913fa569761507a056adea67d8d721917575f9`;
`worker/deploy.log` SHA-256:
`b8325056c6d8c365a8ff6270a4bb5deb239c7ea31b1c1f69e385a281e7292b7f`. The live report binds its screenshot.


### 2026-10-03 — independent verifier — VERDICT: verified

- P01–P27 — HELD. The frozen source `f0f125fd` survived independent literal
  wire/SG and actual hardware attacks: 2,859 assertions, 42 records, three forced
  readiness schedules, fresh outer/embedded DMA, owned requests, queued detach,
  interleaved contexts, ID reuse, full fence IDs, late callbacks and reset recovery.
  Both own served-source sequencing sabotages failed at their intended assertions.
- P24 — HELD. Three independent native cases plus 16 existing scoped cases passed;
  a focused MMIO snapshot test also passed. Bulk DMA replaced a saved middle-page
  instruction, and resumed guest execution produced x6=11 at three span offsets,
  digest `5cfdaed9fdc7141cdf083d768f9974a1062eeb9e326194103eafd99842ca1401`.
- P25–P27 — HELD. Independently recomputed source/evidence hashes, eight complete
  native/Wasm parity records and canonical digests, clean exact-head clone and
  final live default bundle (127/0; proof exports absent). Audit checked 635
  bindings/assertions. Unchanged B1 results carry forward.
- COVERAGE — HELD. LLVM/V8 changed-source census and explicit narrow defensive,
  diagnostic and type/config waivers are in
  [`verifier/review.md`](../../evidence/virgl-submit/verifier/review.md).
  The review distinguishes accepted-complete commit semantics from uncertain
  pre-acceptance failure, and discloses a corrected verifier descriptor-hole
  expectation. No product code or worker harness was changed.
- SUITE — retain replayable independent wire/row/GL attacks, source controls,
  native tests, coverage data and digest audit under `evidence/virgl-submit/verifier`;
  compiled binaries/profiles stay in ignored `target/`. Full commands and each
  prediction citation are in the review. No production 3D, Mesa boot or FPS claim.

Verifier manifest SHA-256: `f6f6063975c59cd121c7c424ec85e6a72158be8906d82e06cd5b41c3f2d97aa1`.
Review SHA-256: `602ccffd9b9afe186a510c7f056c6bd11a30a49c5962234bdb9055d07cd086de`.
Audit SHA-256: `89bedcf6170d8a0fb1bc504f47464e47a023f56fea4f60264832af5660d80a47`.
