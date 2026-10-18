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

T09 implements this common boundary in `crates/core/src/session_clock.rs`. Its quiescent
coordinate is the `before` phase, with checked u64 transition/retirement/sequence counters
and a checked u32 ordinal matching the manifest codec. A bounded owned mailbox orders
future deliveries by target transition and admission ticket; sequence numbers are assigned
in delivery order. Paused controls can be delivered without executing an instruction.
The native `SESSION_CLOCK` section (18, `WVCLK001` version 1) retains the coordinate,
pending owned effects, pending WFI idle action and declared external-pending state. Applied
receipts must be drained before capture; omission, malformed queues or unsupported clock
policy refuse before restore mutates the destination.

Session execution uses `run` or `run_session_until`, which stops before deliveries at its
target. Raw `step`, `hart_mut` and `bus_mut` remain trusted architectural/debug primitives;
an admitted recorder cannot use them to deliver a callback. Pure compute/control blocks
execute in the actual JIT when they fit the next event, timer and seek fence. Observable
blocks use bounded interpretation until their observation adapters exist. Both engines
finish derived timer bookkeeping before exposing a stop. WFI retirement, a genuine idle
advance and interrupt delivery are separate transitions. Wall/paced policies and multiple
harts are refused by the common clock.

The demo's **Execution boundary check** runs this mechanism on a small real guest. It does
not by itself admit the Linux providers into exact replay. T10 adds the input-only
`capture-prefix` mode below; T11–T13 own observations, completions and network adapters.
The saved software-frame decoder still refuses an event clock under an unbound old context.

WFI fast-forward and CLINT/SBI interrupt levels are regenerated when purely derived
from guest state. RTC alarm polling is different: it samples the host wall clock even
without a TIME_LOW read, so its observation must be recorded. Guest `rdtime` is derived
from the frozen time policy, whereas `JsWallClock` and audio clocks are external inputs.
Host scheduling and pending-external-I/O state can change WFI decisions; replay must
preserve the recorded pending state and delivery order, not recompute it from live I/O.

### Input capture implementation (E9-T10)

`startInputRecording` starts only at a paused, quiescent single-hart software ICount
boundary, with at most 256 MiB RAM, no secondary disk, persistence pump, outbound connector,
interactive clock policy, microphone or attached audio clock. Local SLIRP file transfer is
permitted before any transfer has started. Its network/time observations remain incomplete.
The recorder retains an exact native/input/disk **witness**, runtime/kernel/Wasm assets and
initial host key ledgers. Its `WVINPUT1` machine object is version 1: an 8-byte magic,
`u32 version`, `u64 native_length`, `u32 pending_uart_length`, `u32 host_output_length`,
then those three exact byte components. Pending pre-capture UART bytes remain in the initial
witness and acquire FIFO delivery events when execution resumes; they are not discarded or
relabelled as new offers. Each host queue is bounded to 1 MiB. The disk root binds the same
native header/generation. This is deliberately not an executable provider checkpoint.
`CapturePrefix` manifests preserve input evidence, and `SessionManifest::admit` always
refuses them as full replay. They cannot be promoted by changing the immutable policy.
A T14 exact recording must start with all required adapters present.

Every ingress is copied into the T09 owned mailbox before applying a synchronous adapter.
The normal execution loop stops with `HostInputPending` until that adapter acknowledges
it; an opaque input is never a no-op that execution can pass. Space/counter reservation
precedes mutation. The receipt retains its exact before-boundary coordinate and a fixed
outcome tuple. No DOM timestamp is an execution key. Core `HostInput` channel zero is
invalid; provider payloads are at most 1 MiB, with the existing 256-event/4-MiB outbox.

Input adapter version 1 uses these little-endian payloads. Every wide position/outcome
crosses JS as a canonical decimal string; fixed device wire values retain their native width.

| Channels | Operation / payload | Outcome `[status, amount, detail, detail]` |
|---|---|---|
| 1 / 2 | UART offer bytes / actual FIFO batch (at most 16 bytes). The offer enters an owned, bounded 1-MiB pending queue; FIFO receipts occur at each real refill, before execution. | Accepted bytes, remaining pending bytes. |
| 3 / 5 / 7 | Keyboard / tablet / relative mouse staging: `u16 type, u16 code, i32 value`. | Pending events, total dropped frames, total rejected events. Successful staging is labelled `staged`. |
| 4 / 6 / 8 | Frame publication: `u64 accepted_count, u32 retained_count`, retained 8-byte evdev events, then an 8-byte SYN_REPORT if nonempty. Overflowed accepted events remain represented by the count. | Pending events, total dropped frames, total dropped events. `published` or `drop-policy`; replay compares the entire pre-publication frame before syncing. |
| 9 | Preferred display dimensions: two `u32`, each 1…4095. | Device presence/application; guest mode adoption remains a separate guest action. |
| 10 / 11 | Exact agent-port bytes (including offered clipboard/control frames) / application HELLO confirmation. Serial clipboard paste uses channel 1. | Accepted byte prefix / handshake outcome; a denied clipboard read with no guest effect creates no event. |
| 12 | Upload begin: `u32 slot, u32 total, 32-byte SHA-256, UTF-8 basename` (at most 255 bytes). | Stream ID, or exact WVFT error code in the last field. |
| 13 | Upload chunk: `u32 stream, u8 finished, bytes`. | Accepted bytes, buffered bytes; WVFT error code in the last field on failure. |
| 14 | Upload cancel: `u32 stream`. | Application or WVFT error code. A cancelled source accepts no late chunk. |
| 15 | Host pointer route: `u8` absolute=0 / relative=1, ordered after old-mode releases and before new-mode frames. | Acknowledged route. This is host-control intent, not a new guest device. |
| 16 | Lifecycle: `u8` pause=0 / resume=1 / stop=2. | Acknowledged control. Pause/stop prevent subsequent ordinary execution; stopped input accepts no late callback. |

Status codes are 0 applied, 1 failed/refused, 2 accepted prefix, 3 device-contract rejected,
and 4 device frame drop policy. Invalid wire shapes, unsupported controls and exhausted
reservation refuse before an effect and consume no event ID. Device publication/drop is
recorded separately from its later DMA/interrupt completion (T12). File controls similarly
record acceptance/cancellation and exact submitted bytes; TCP/time/completion observations
belong to T11–T13. No successful whole-VM replay is inferred from input-only evidence. Cancellation follows the existing WVFT policy: the guest closes the upload handle and retains the private `.part` prefix for inspection, without publishing the requested completed basename.

`SessionInputJournal` packs immutable, codec-validated chunks up to 4 MiB. Payloads over
64 KiB use SHA-256 blob references, rooted by the same atomic manifest publication as their
events. A failed write retains the pending owned batch and leaves the previous published
prefix byte-identical. The loader pauses before another guest slice; Retry/Save can commit
the missing batch without duplicating earlier IDs. New paused inputs are retained within
the bounded outbox. A stop that cannot reserve/write leaves the last committed prefix
available rather than inventing a final event. Successfully recorded stop freezes the guest;
a fresh machine is required to return to ordinary live input.

Replay mode is an ingress firewall and a checked input-adapter seam at this milestone.
It accepts only recorded input at the exact next coordinate and compares the outcome.
All ordinary live input, unsupported mutation and general execution refuse. It never reads
a live clipboard/File/Blob. Outcome divergence stops the candidate; T14 owns admission,
provider replay and general execution. The demo's **Input recording check** executes a
small real RV64 guest, checks UART and eventq DMA bytes, reopens its durable prefix and
checks this firewall. The library's input controls expose incomplete saved prefixes without
enabling Open/seek for them.

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

### Software checkpoint implementation (E9-T05)

`captureSoftwareCheckpoint()` requires a paused single-hart chunked software guest with
ICount time, at most 256 MiB RAM, no secondary disk, microphone, active PCM stream,
host audio bridge or external network backend. Larger RAM checkpoints await T15's bounded
incremental representation; capture refuses them before allocating a snapshot.
The owner fences host mutations and joins its existing task barrier. Up to sixteen native
passes finish the original disk reads and durable writes without retiring instructions or
advancing time. One uninterrupted machine borrow then owns CPU, sparse RAM, every assembled
device, exact input ledgers, the complete COW map and pending UART/output queues. The
`WVSOFT01` envelope hashes all five components and binds the native and disk base/generation.

Session checkpoints use explicit exact-input and console codec families. They retain
pressed keys, partially delivered frames, staged events, pending console controls and
partially consumed agent input. Legacy desktop resume keeps its existing physical-key
release and fresh-HELLO behavior. Exact restore validates the complete native topology and
every component before changing the destination. A same-generation sibling COW map still
fails the full disk-byte comparison.

`SessionCheckpoints.save()` stores immutable objects and disk leaves first, then publishes
one session manifest through the existing strict commit transaction. A failed capture,
object write, or publication cannot replace the previous committed cursor. Restoring by
session/checkpoint ID authenticates retained assets, the current runtime build, the complete
envelope and every historical disk leaf before constructing a private seeded candidate.
The candidate restores while paused and cannot acquire the live overlay writer. No guest
instruction executes before admission succeeds.

These are **checkpoints-only** sessions. Their log cursor remains zero until the event
engine exists; native architectural counters and clock phase are retained in the native
snapshot. T09 onward owns transition positions and exact replay, T06 owns the visible saved
session library, T07 owns transitive retention, and T21 owns portable runtime bundles. An
unavailable runtime is refused instead of being silently resumed by a newer build.


### Time and entropy observations (E9-T11)

The admitted source policy is version 1, ICount with a frozen divider from 1 through
1024 and a 10 MHz timebase. Retired instructions, divider residue and WFI advancement
remain deterministic machine state. Host elapsed time cannot rebase this profile.
Wall and paced clocks remain outside this admission boundary.

The real Goldfish RTC provider records each low-word read, time-set half, alarm arm
and armed alarm poll. Its high-word latch, offset and alarm state stay in the native
snapshot. While an alarm remains armed, session dispatch permits at most one guest
transition before polling again, independent of the interpreter/JIT host budget. A disarmed
RTC leaves pure compiled blocks available; its MMIO accesses use exact interpreter fallback.
The real virtio-rng provider records each requested fill, exact supplied bytes
and provider failure. A captured descriptor chain stages every fill before publishing
DMA or the used ring. Failure or a recording quota cannot publish a partial chain.
Ordinary unrecorded RNG retains its streaming allocation policy.

Both adapters assign an `observe` key before applying an external value. Before-phase
input and lifecycle deliveries share their global sequence and ticket allocator.
An observation uses that transition's retired count and its own within-phase ordinal;
RTC polling and a guest read can share a transition. Replay authenticates the frozen
policy, call intent, requested length and complete position before consuming owned bytes.
No replay path calls the live RTC or entropy provider, including failure replay.
Missing, extra, reordered and malformed observations produce typed `SessionDivergence`
errors and fence execution. An outbox approaching its bounded capacity yields between
complete transitions so the caller can publish receipts without repeating a device poll.

The bounded `WVOBLOG1` source tape has a 32-byte policy/count header and at most 256
records. Each record has a 38-byte position/intent/length header and owned payload,
with at most 1 MiB per observation and 4 MiB total. Native section 19, `WVOBS001`,
contains the policy and consumed observation count. Immutable prefetched log bytes stay
outside the machine frame; a fresh replay owner restores the cursor with an empty prefetch
queue and reloads the authenticated suffix. Policy, cursor and topology validation precede
all destination mutation.

The library's optional **Include time and random inputs** control admits these adapters
on the existing offline software ICount recording. Its saved VM configuration and required
input inventory bind the policy. A terminal guest slice publishes its source receipts and
stop control before releasing the session writer. These sessions remain incomplete
`capture-prefix` histories: device completion and network adapters, then full Linux replay,
are T12–T14. The separate public **Time and entropy check** runs an actual bounded RV64
RTC/RNG/WFI guest and proves source adapter replay under hostile providers; it does not
admit an arbitrary saved Linux session as executable replay.


### Owned device completions (E9-T12)

The qualified adapters are installed before execution through
Machine::enable_session_devices or the ordinary WasmMachine installDeviceSession API.
The immutable-base block backend owns local sector COW state; a missing frozen base
chunk creates a request. Posted named-console application receive buffers and due
48 kHz mono/stereo S16 capture buffers create requests from guest state as well.
Each request has one non-wrapping ID and one accepted supplied, failed or cancelled
completion. Request intent and immutable bytes have identities independent of callback
delivery time. Accepted delivery uses the common before-phase sequence and cursor.
The journal stores immutable base payload bytes in separate content-addressed objects
and puts delivery metadata in the event intent.

The host receives a private callback lease. Restore replaces its allocation identity,
so a reply from before restore cannot mutate the rewound machine even when a request
number repeats. Replay refuses all live leases, applies owned envelopes at exact guest
positions and never consults a host cache. Guest DMA, used-ring publication and IRQs
remain in the original device services. An awaiting capture result parks the existing
transfer without substituting silence or acknowledging its descriptor.

Section 20 preserves pending requests, request/completion cursors, immutable cache,
local COW sectors, capture results and parked block chains. The qualified sound codec
retains actual pending capture segments and deadlines. Guest STOP/reset derives
cancellation before paused callbacks can run. Complete prevalidation, including capture
request/descriptor consistency, precedes destination mutation and lease revocation.
A failed restore leaves the original live leases and machine intact.

The v1 bounds are 256 pending requests, individual payloads no larger than 1 MiB minus
256 bytes, a 16 MiB immutable cache, and 256 MiB of local COW sectors. Completion-order
eviction cannot evict data pinned by pending reads. The microphone clock derives from
frozen guest ICount time. Live worklet playback, legacy shared microphone rings,
persistent host writeback and already installed unrecorded transports refuse this
admission. The initial live-microphone and GPU-result gates remain in force.

The new demo check drives real block, application-console and sound queues and retains
an explicitly incomplete capture prefix. Existing Linux provider assembly remains
outside complete replay until T13/T14 compose network and executable replay ownership.
The source matrix retains its planned overall runtime status; these source/hash updates
identify the new owned boundary and the still gated legacy paths, not capstone completion.

### Owned network boundary (E9-T13)

The qualified network assembly installs an owned Ethernet broker before the first
session transition. The machine retains guest TX intent bytes, queued RX bytes,
connection/error and external-pending observations, cursor and virtqueue kick/reset
state. Host transports remain outside the machine. Recording obtains a private
incarnation-bound lease before constructing a provider; replay refuses that
construction and every live callback. Restore and virtio reset revoke old leases.
Replacing the qualified backend with a live adapter is refused.
Checkpoint decoding also bounds the jointly represented send acknowledgements,
queued receives, current link outcome and external-pending flag by the accepted
network cursor, using checked arithmetic. Impossible results refuse before any
state or callback incarnation changes.

Exact capture omits service-ring views already invalidated by a pending transport
reset. The reset flag remains recorded; capture neither polls the backend nor
advances the guest. Restoring before the next service roundtrips that canonical
state and resumes with the same instruction trace.

Outstanding guest sends and recorded external-pending work suppress WFI idle
fast-forward under the common session clock. Record and Replay consult the same
owned state before deciding whether to jump to the next timer deadline. The live
network check exercises both pending sources and the idle controls with matching
complete checkpoints and instruction traces across execution budgets.

Channel 20 envelopes bind each outgoing intent acknowledgement, incoming frame,
connection outcome or external-work change to the common before-boundary coordinate.
Frames are bounded to 65,535 bytes, each queue to 256 entries and combined owned
payloads to 4 MiB. Persistent event chunks keep the envelope metadata separate from
hash-addressed frame payloads. Missing/corrupt objects fail the ordinary durable
read. Replay checks exact positions and outgoing bytes, stops on trace exhaustion,
and retains a stopped divergence state; it has no transport factory or retry path.

The public **Offline network check** executes pinned RV64 instructions which
negotiate virtio-net, post descriptors and copy actual used-ring/IRQ/DMA state into
a guest report. Its experimental Ethernet type carries a fixed HTTP request through
a bounded proof bridge. The native bridge forwards the exact HTTP request to a
local state-changing counter server and records its response and EOF. The browser
bridge maps that pinned request to one safe same-origin GET, records the observed
HTTP response and completed-body close, then performs six offline replays from
initial and pending checkpoints. The acceptance server independently counts the
original side effect and transport attempts, and removes the original listener
before replay; no replay factory is called.

This qualifies the network transport boundary, not a guest TCP stack or complete
Linux replay. Existing SLIRP, WebSocket, DNS, Tailscale and file-socket providers
remain outside this assembly. T14 composes the software VM and replay driver;
provider timing is represented by recorded frame/outcome/pending deliveries rather
than live provider timers during replay.

### Deterministic software replay (E9-T14)

The initial exact session uses the pinned Alpine kernel and 512 MiB base image, one
RV64 hart, 256 MiB RAM, ICount10 and the full software device profile. A recording
contains the initial native machine frame, ordered delivered inputs and external
observations, and state-digest witnesses. The session store commits witness
metadata with the initial identity before event chunks are appended; it refuses
changes to that identity. Reopening for execution checks the current runtime,
kernel, base, device topology, clock and required provider inventory before the
replay driver receives the initial frame.

The driver restores only the initial frame and runs toward the declared end. It
matches each guest observation, host delivery, device and network completion in
sequence, comparing full CPU, RAM, device and disk resume digests at selected
positions. Browser console draining is itself an ordered channel 21 event: the
host cannot discard UART/SBI bytes at a different scheduling boundary on replay.
The replay's end fence persists across run calls; exhaustion cannot resume live
execution. A changed input, missing DMA payload, extra or misordered delivery, or
state-digest mismatch stops at the first observed coordinate without seeking to
a later checkpoint. Branching back to live execution is a separate T20 action.

The source-matrix hashes below were re-audited for T14. The changed core clock
and machine paths add only replay fences and the full software installer; the
existing user-input, time, device and network anchors retain their recording
roles. The wasm paths add exact record/replay entry points and suppress live
providers during replay. The browser journal adds durable exact events and
immutable state witnesses. The contract's planned status still denotes the full
Epic 9 qualification, including keyframes, seeking, GPU replay and branching.
