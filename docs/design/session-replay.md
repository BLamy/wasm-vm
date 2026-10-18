# Full-system session replay contract (E9-T01)

Contract version: **1.0**. This is the implementation contract for Epic 9, not a claim
that recording or time travel already works. The machine-readable inventory, fixture
identities and budgets are in
[`session-replay-contract.json`](session-replay-contract.json). Run
`make verify-E9-T01` to check those definitions against this checkout's actual adapters.
Changing an inventoried source requires reviewing its row and updating its digest.

E9-T04 implements the immutable disk portion in
[`historical-disk-roots.md`](historical-disk-roots.md). Its separate software image manifest
describes the exact pinned 512 MiB raw image; the ordinary public Alpine chunk manifest
describes a different image and is not substituted for that fixture. This adds a concrete
chunk layout without changing the frozen raw-image hash, workload or acceptance budgets.

## Capability and admission

The first executable profile is `rv64-linux-software-v1`: the existing full-system
RV64 Linux machine, one hart, built-in SBI, instruction-count time with divider 10,
256 MiB RAM, the pinned Alpine disk and software virtio-gpu. Interpreter and browser
JIT must produce the same guest state. A recording binds the selected clock policy,
CPU/device layout, execution semantics, exact VM build, base assets and initial disk
root. A different host is supported only after the corresponding replay proof.

T01 changes documentation and acceptance tooling only. Until the named capture tasks
and replay driver are verified, the profile is **planned**, not admitted by the product.
T02 must implement admission checks before any recording is published. Reject an
unknown device, absent required capture adapter, unsupported execution mode, incompatible
asset/build or an incomplete initial checkpoint before recording or restoring state.
There is no implicit fallback to a different execution mode.
The shipped boot snapshots are pinned fixture candidates, not an exception to the existing
build/base/overlay coherence guard. If a candidate cannot resume under the selected build,
cold-boot its pinned kernel/rootfs before recording and capture a new coherent initial
checkpoint. Do not splice an incompatible old RAM image into a new recording.

The initial exclusions are SMP/parallel harts, the userspace Linux ABI runtime,
RP2350/Hazard3, host shared folders/9p, external extra disks without their own immutable
roots, live microphone capture, guest 3D acceleration, opt-in wall-clock/paced `mtime`
and interactive keyboard-triggered clock switching. Microphone, host-paced clock and 3D
recording require the owners below plus separate qualification;
the presence of a browser API does not admit them. Hot attachment or execution-policy
changes during a recording must be refused unless represented by a supported event.
Profiling and JIT compilation are derived host work, not guest time sources.

The saved-checkpoint milestone T01–T08 may save and restore coherent points without
claiming events between them were recorded. T09–T16 add exact software replay; T19 can
expose its timeline before guest 3D support. Epic 6.5 and cancelled Epic 8 are not gates.

## Four different user operations

| Operation | Meaning and required state |
|---|---|
| Saved checkpoint | Atomically published machine, disk root, policy and any required device/renderer state. Only this saved position can be restored without an event history. |
| Visual preview | A thumbnail labelled with its position. It can appear before restoration finishes; it is never the active machine or evidence of restoration. |
| Exact replay/seek | Restore an earlier complete keyframe, then consume recorded observations to the requested instruction boundary. Validate state and publish only the newest completed seek. |
| Live branch | A new recording identity and private writable disk root from a historical point. Preserve the parent's future. External connections remain offline until a separate explicit go-live action establishes fresh connections. |

Recording starts at its initial coherent checkpoint. It cannot reconstruct earlier
history. Reaching log exhaustion pauses replay at its declared end; it never turns
replay into live execution automatically. Seek must not transmit packets, write external
files, ask for microphone/clipboard permission or persist changes into the source disk.

## Exact execution positions

Guest `instret` and the existing instruction trace alone are insufficient: traps and
interrupt delivery do not retire instructions, multiple observations can occur at one
retirement count, and host callbacks may run between `runChunk` calls.

Use a session-owned, non-wrapping `transition` counter, a `phase` and an `ordinal`.
A transition is one architecturally visible instruction retirement, exception delivery,
interrupt delivery or idle-clock advance. The coordinate is independent of JS tasks,
run-loop quanta, decoded blocks and host JIT compilation. The phases are ordered
`before`, `observe`, `after`. `ordinal` orders observations within a phase; a separate
strictly increasing `sequence` orders all stored events, including multiple controls
while paused at the same transition. Keep a session-owned retirement count as a witness;
do not use guest-writable or wrapping CSR counters as the unique position.

An exact instruction stop is before the next architectural transition, after the preceding
transition's bookkeeping. Reverse-step returns to the preceding transition, including
non-retiring trap/interrupt transitions. Expose retirement and transition coordinates so
an instruction-only UI cannot silently skip an exception. Define the beginning and end
of history explicitly; never underflow counters or wrap into a different position.

T09 owns the common delivery boundary. Host callbacks may stage owned immutable results
but cannot directly change guest RAM, device state, rings, interrupt levels or guest
clocks. At the recorded `before` boundary, deliver queued controls/payloads, perform the
recorded device effects, refresh interrupt state and then execute the next transition.
On-demand observations inside that transition (RTC/MMIO reads, entropy fills and sound
clock/sink calls) pass through an `observe` adapter that records intent and result before
the result is applied. Log the exact call ordinal, including failed/short observations.
T09 must settle deferred interpreter/JIT counters and cap execution at the next delivery
or seek position. Fall back to bounded interpreter work for a block tail if necessary.
An engine must not run past a target and repair the appearance with a later snapshot.

WFI fast-forward and CLINT/SBI interrupt levels are regenerated when purely derived
from guest state. RTC alarm polling is different: it samples the host wall clock even
without a TIME_LOW read, so its observation must be recorded. Guest `rdtime` is derived
from the frozen time policy, whereas `JsWallClock` and audio clocks are external inputs.
Host scheduling and pending-external-I/O state can change WFI decisions; replay must
preserve the recorded pending state and delivery order, not recompute it from live I/O.

## Source-to-owner matrix

The JSON inventory pins each row to concrete source paths, symbols and file digests.
Owners name implementation tasks; an assignment does not mean the adapter exists yet.

| Source ID | Current seam and guest-visible effect | Owner / disposition |
|---|---|---|
| `uart` | `WasmLinux::send_input`, pending bytes and FIFO refills in `run_chunk`; serial typing/paste and generated RPC nonces become guest bytes. | T10; record delivered bytes, acceptance/drop behavior and ordering. |
| `keyboard` | `send_keyboard_event` / `sync_keyboard`; evdev frame contents, focus release, lock reconciliation and SYN_REPORT. | T10; retain frame boundaries and bounded-queue/drop outcomes. |
| `pointer` | Tablet/mouse send/sync methods; absolute coordinates, relative motion, buttons and wheel. | T10; record delivered device frames, not raw DOM events. |
| `display` | `set_display`; guest display configuration, pointer geometry and config-change interrupt. | T10; record accepted dimensions and outcome. Host CSS-only reflow is presentation. |
| `lifecycle` | Loader pause/resume, `createGuestClockLifecycle`, restore rebases and clock/divider changes, including `beforeKeyboardEvent` selecting paced/wall mode. | T10/T11; freeze clock policy, record admitted transitions, refuse an unsupported change. |
| `mtime` | `sample_wall_clock_now` / `TimeSource::sample_wall` and `IdlePacer::limit_deadline`; host samples, idle ceilings, clamps and rebases affect counters/interrupts. | T11; initial profile uses ICount. Wall/paced modes and interactive switching are gated until their samples/order are captured. |
| `rtc` | `JsWallClock`, `GoldfishRtc::read` and `poll`; TIME_LOW sample/high latch and alarm polling. | T11; capture all guest-affecting samples and their call intent, not just user-requested date reads. |
| `entropy` | `CryptoEntropy::fill` and virtio-rng service; random bytes are DMA-written into guest buffers. | T11/T12; capture the actual byte slices and completion effects; never reseed from live Web Crypto during replay. |
| `timers` | CLINT/SBI synchronization and WFI fast-forward, including external-I/O-pending inhibition. | T09/T11; regenerate deterministic state, replay external observations/pending state. |
| `block-read` | `ChunkedBackend::read`, `fetch_pending`; miss/resident/error transitions determine when sectors complete. | T12; pin immutable chunks and capture completion intent, status, payload references and delivery. Warm caches must not change replay timing. |
| `block-write` | Chunked write/flush barriers and `IdbStore::persist_overlay_batch`; transaction completion, abort/quota/read-only choices affect the guest. | T12; capture guest-visible outcomes/order. Replay uses a private overlay and does not repeat live persistence. |
| `dma` | Core virtio service, bus writes, used rings, PLIC synchronization and code-write invalidation. | T09/T12; couple payload, destination/length, queue generation, used index and interrupt publication in one ordered effect. |
| `network` | Virtio-net, SLIRP poll, relay/WebSocket, Tailscale and DNS adapters; frames, errors and completion/pending state. | T13; capture every delivered result; validate outgoing intent and suppress all replay egress, including DNS and reconnects. |
| `network-time` | SLIRP's `Date::now` closure influences DHCP leases, TCP timers and generated packets. | T11/T13; capture at the guest observation boundary; provider timers must not run against live time on replay. |
| `file-transfer` | Browser file-transfer upload/download queues, readiness, cancellation and persistence notifications over virtual sockets. | T10/T12/T13; capture controls and resulting guest-visible bytes/status once at a declared boundary. No live File/Blob reads or downloads on replay. |
| `agent` | `send_agent_input`, `confirm_agent_hello`, named virtio-console queues and host guest-RPC messages. | T10/T12; capture frame bytes, admission/handshake and queue effects. Guest output alone is not an input. |
| `clipboard` | `ClipboardService` and the desktop agent bridge; permission outcomes select which host text/control frames reach the guest. | T10; capture delivered frames and relevant outcomes. Never re-read the live clipboard or request permission while replaying. |
| `audio-playback` | `SharedAudioClock`, `SharedAudioSink`, JsHostTimer and virtio-snd pacing; atomic ring fill, clock and sink success/failure alter completions/XRUNs. | T12; capture guest-visible observations even if the output is muted. Live playback is presentation only during replay. |
| `audio-capture` | `SharedAudioCapture`, capture lifecycle/XRUN notifications and microphone ring; PCM bytes, short reads, silence and errors. | T12; initial admission refuses live capture. Qualification must record the exact observed bytes and status/order, including samples arriving concurrently through SAB. |
| `software-gpu` | The software assembly uses virtio-gpu `NullSink` plus shadow resources and a host presentation callback. The production VirGL assembly is separate. | T05/T10/T12; checkpoint device state and record external configuration. Host framebuffer presentation is not proof of guest 3D acceleration. |
| `gpu-results` | Production `attach_virgl`, `scatter_output`/layered writes, `complete` mailbox, synchronous control results, physical query availability/results and renderer errors. | T17/T18; whole-session replay remains gated. Capture guest-visible bytes, shared writes, success/failure and completion order through the existing production adapter. |
| `checkpoint-control` | Loader `saveGpuCheckpoint` releases held input, pumps/drains original GPU work and binds native/RAM, disk, renderer, epoch and clock state. | T05/T10/T12/T17; record generated releases and drain effects even while paused, before publishing the keyframe. Reuse the authenticated pair and reconstruct fresh host resources; its renderer journal alone is not a complete VM recording. |
| `storage-control` | Writer lock, quota resume/read-only/reset choices and imported/extra disk roots. | T04/T10/T12; immutable historical roots and recorded outcomes. Refuse destructive reset, foreign imports and unbound extra disks inside an admitted recording. |

Read-only profiler timestamps, heartbeat deadlines, renderer FPS and UI animation clocks
are waived only while they cannot influence guest state. Any timeout, permission callback
or context-loss result that changes a guest completion belongs to the corresponding row.
New provider/device adapters must be inventoried before admission, even if they do not
enter through the browser's input-event handlers.

## Format, compatibility and publication

Version the session manifest independently from the core snapshot and event codec. Version
1.0 records an exact runtime/build identity; compatible migration requires a separately
verified converter. Refuse unknown major versions, unknown required fields/event kinds,
missing payloads, mismatched lengths/digests, duplicate/out-of-order sequences, invalid
positions and mixed machine/disk/GPU identities. A minor addition is skippable only when
explicitly optional and incapable of affecting guest execution. T02 owns wire encoding
and bounded parsing; T01 does not introduce a binary decoder.

Each event carries `kind`, `required`, `transition`, `phase`, `ordinal`, `sequence`,
`retired`, `device`, `intent`, `status` and `payload` (inline bytes or content-addressed
blob references). Store wide integers losslessly; JSON uses canonical unsigned decimal
strings and the eventual binary codec uses checked integer widths. Payloads bind length
and SHA-256. The fixed initial bounds are 1 MiB inline event payload, 4 MiB blob/chunk,
4 KiB RAM page, 4 GiB logical session size and 65,536 events per log chunk. Stream larger
observations across bounded referenced chunks without breaking their single publication.
Budget overflow pauses recording before an unrecorded guest effect can execute.

A keyframe atomically binds machine/CPU/RAM/devices, immutable disk root and overlay
generation, next event sequence/position, clock state/policy, pending observations,
asset/build identities and applicable renderer state. The external pending state includes
UART bytes outside the core snapshot, device queues, virtual connection/wait state and
staged callback results. Do not serialize live browser handles or use the mutable latest
overlay as an old disk root. Keep referenced chunks until all sessions/branches release
them. T03/T04/T05 own atomic publication, immutable disk history and coherent capture.
Rebuild derived JIT modules/TLBs after restore; preserve exact architectural state.

Replay supplies recorded results to validated intent and compares CPU, RAM, device and
disk witnesses at declared positions. Report the first missing/extra event or state
divergence and preserve the source recording. Never hide divergence by jumping to another
keyframe. Recorded data remains local by default. No credentials or host permission
handles are required to replay the captured observations offline.

## Frozen workloads and measurement

The JSON file pins the exact current software and Omarchy manifests (and every advertised
artifact hash/size), stimulus, expected file bytes and observation set. The software
fixture writes `e9:before\n`, checkpoints, waits for the literal serial input `advance`,
writes `e9:after\n`, consumes entropy/time and a witnessed local HTTP response, then
checkpoints again. At the first checkpoint the file must contain the before bytes; at
the second it must contain the after bytes. Seek positions before/after every delivery,
including between keyframes, must match original CPU/CSR/RAM/device/disk witnesses.

The accelerated fixture pins `web/artifacts-omarchy-virgl.json`, the published 204,057,731
byte RAM/disk/GPU pair, its 4 GiB image-manifest identity and the production renderer/build
identity. The already verified E6-T11d74a/b/c/d path supplies native checkpointing, physical
renderer reconstruction, atomic worker restore and the accelerated warm boot. T17 must
integrate these successors rather than depend on the cancelled E6-T11 planning container.
The production renderer's reconstruction journal already records transport exchanges;
it does not replace exact whole-VM input/time/network replay.

The fixture freezes the same file/input stimulus, 640×480 → 803×603 resize, and the GPU
probe source in `session-gpu-probe.c` (clear, finish, readback and error observations).
Its current launch policy is ICount/divider 64 with `paced-on-keyboard`; an authenticated
warm pair may already contain paced-clock state. T11 must capture idle-clock samples and
the exact interactive switch before this profile is admitted to E9 recording. Do not
silently convert its time policy to divider 10 or apply a fresh unrecorded host rebase.
T17/T18 must reuse the verified production renderer and compile/run the frozen probe in
the guest before admitting session replay. No software-rendered screenshot may stand in
for accelerated qualification. The asset/renderer predecessor is verified; E9 recording
qualification remains pending. Updating any pin requires a new contract version and
documented reason.

The reference host is the inspected Apple M4 Max, 16 CPU cores, 128 GiB RAM, macOS
26.6.2 (25G83), Chrome 155.0.8059.80 and Playwright 1.49.1. Use a fresh browser profile,
one VM, foreground, AC power, no profiler and no background emulator/compiler. Record
actual OS/browser/runtime versions for every later measurement; a changed reference needs
an explicit amended baseline, never silent replacement of a slow run.

These are future **acceptance budgets**, not measurements or speed claims:

| Metric | Software, 256 MiB | Qualified desktop, 1 GiB |
|---|---:|---:|
| Recording wall time / same-work unrecorded wall time, median | ≤ 1.25× | ≤ 1.50× |
| Preview response, p95 | ≤ 100 ms | ≤ 100 ms |
| Actual checkpoint state ready, p95 | ≤ 5,000 ms | ≤ 15,000 ms |
| Actual seek state ready between keyframes, p95 | ≤ 5,000 ms | ≤ 15,000 ms |
| Superseded seek cancellation acknowledgement | ≤ 250 ms | ≤ 250 ms |
| History growth for the fixed 10-minute workload, excluding pinned initial assets | ≤ 256 MiB | ≤ 1,024 MiB |
| Additional recorder working memory, excluding VM RAM and derived renderer/JIT data | ≤ 64 MiB | ≤ 128 MiB |

The workload contains 100 delivered input frames, 10 witnessed 1 KiB HTTP responses,
10 file rewrites and 20 independently selected seeks; positions and request bytes come
from seed 17. Transition offsets are relative to the `E9_AFTER` setup completion: frame
1 is at offset 500,000 and each next frame is 500,000 transitions later. Substitute the
decimal 1-based frame index into `FRAME_INDEX`; append the rewrite command to every tenth
frame, substituting its 1-based rewrite index into `INDEX`. The LCG32 formula in the JSON
freezes the 20 seek targets independently of the recorded state. The harness records this
schedule in its fixture receipt and preserves all attempts. Repeat the same instruction/input
work with recording off/on in five alternating A/B pairs; use both directions of order,
report medians, p95 samples and raw data. A 10-minute host observation window must not
truncate slow runs or change the amount of work used in the A/B comparison. Maintain a
maximum keyframe gap of 50,000,000 guest transitions for the seek measurement. Separate
preview response, cancellation acknowledgement and real restored-state readiness.
T22 implements these measurements; failures require an explicit scope/budget decision.

## Proof and successor tasks

`make verify-E9-T01` validates the contract definitions, every source anchor/digest,
owner task, asset manifest pin, workload/probe identity and numeric bounds. Its JSON
receipt records the source commit and content digests; it does not execute a guest,
measure performance or certify a replay engine. The separate low-risk verifier reviews
this direct result and looks for a real adapter or observation absent from the matrix.
Rust/browser regression suites are unchanged because this task changes no runtime code.

T02 can now implement bounded manifests/admission. Capture tasks must prove their actual
adapter effects; T14 requires matching original/replay state with providers offline and
T16 exact stops around traps/events. Guest instruction traces and state digests remain
proof artifacts rather than the production per-instruction storage format. The host rr
layer remains waived under AGENTS.md. No GitHub Actions or new external service is added.
