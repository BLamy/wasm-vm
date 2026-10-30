---
kind: "Current reference"
source: "docs/design/session-format.md"
source_revision: "c396efe1ecd061721865a5929235e6d0a6268561"
source_sha256: "64b5552f6584ff3869e0ebdfb071e497f51e18d73d7ce74d0d19aa35bc863b76"
scope: "Current source at the stated revision; not part of the pinned migration inventory"
---

# Session format

{% hint style="info" %}
Current reference. Published from the exact source at revision `c396efe1e` (the PR 626 stack), separately from the pinned migration inventory. It describes the shipped format and its stated limits; read it with the time-travel guide. Contracts at the same revision: [Replay contract](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-replay-contract.json) · [Workload qualification (v11)](https://github.com/BLamy/wasm-vm/blob/c396efe1ecd061721865a5929235e6d0a6268561/docs/design/session-workload-qualification-v11.json).
{% endhint %}

`wasm_vm_storage::session` defines the shared no_std codec. Its native and wasm32 tests
use the same literal JSON fixtures. This slice supplies metadata admission only;
executability and installed capture adapters must come from the actual runtime.

A manifest identifies the VM and Wasm builds, immutable base image, kernel, optional
initramfs, RAM, one-hart device topology, replay policy, and optional GPU renderer/profile.
It binds the precise event, checkpoint and delivery-boundary versions. Every runtime
asset has a SHA-256 and byte length. Asset availability requires hashing the actual
retained bytes; a historical runtime that is absent returns `UnavailableRuntime`.
Admission uses shared references and never migrates, deletes or rewrites saved data.

All wide positions and lengths serialize as canonical unsigned decimal **strings**.
JSON numbers, leading zeroes, overflow, duplicate fields, unknown fields and versions
are refused. Transition/phase/ordinal order and global sequence are checked separately
from the retirement witness. Retention can start above zero without renumbering events.
Each checkpoint binds its machine payload, disk root, next event cursor and, for the
GPU profile, renderer checkpoint payload. The first checkpoint is the retained beginning.

The decoder caps metadata at 1 MiB, indexes at 4,096 entries, device identities at 32,
and runtime assets at 16. Inline event payloads are at most 1 MiB; referenced event
payloads are at most 4 MiB, except required `gpu` events may reference a single
owned readback object up to 32 MiB (E9-T18c). The object store streams that object
through its existing bounded parts; it is not an inline event or a larger event
index. Serialized event chunks remain at most 4 MiB. A chunk holds at most 65,536
consecutive events and authenticates its exact bytes, count and endpoint positions.
The sum of indexed event and machine/GPU checkpoint payloads is at most 4 GiB;
the later store and retention slices account for referenced disk and runtime assets.

Unknown required event kinds/extensions return typed refusals. Optional events are
limited to `annotation.*`; a known guest effect cannot be made skippable. Exact-replay
metadata must declare the capture sources implied by its devices and clock policy.
The runtime must separately attest that it has installed every declared adapter.
Declaring capture sources does not qualify a new runtime profile for replay.

`make verify-E9-T02` records format/lint, the affected storage test wall, no_std Wasm
build, Wasm lint and the shared nine-case corpus running in Node. It requires a clean
head and writes logs, source/evidence hashes and independent fixture asset oracles to
`target/evidence/e9-manifest-final` (override with `E9_MANIFEST_EVIDENCE_DIR`).
The isolated `tools/verify/session-wasm` harness uses the same storage source and cases,
without linking the VM or changing its production Wasm build identity. There is no guest
run or browser-facing behavior in this codec boundary.

## Related field guide

{% content-ref url="./docs.html?page=time-travel" %}
Record, rewind, and branch
{% endcontent-ref %}
