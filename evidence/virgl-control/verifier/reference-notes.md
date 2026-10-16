# E6-T11a reference and baseline notes

Orientation only, recorded before E6-T11a runtime inspection. Source boundary is the task plus root's explicit proof profile; a spec-permitted behavior outside that profile is not an acceptance requirement.

## Primary protocol references

- [Virtio 1.2, GPU device](https://docs.oasis-open.org/virtio/virtio/v1.2/virtio-v1.2.html), sections 5.7.3 and 5.7.6.9: VIRGL is feature bit 0; CONTEXT_INIT is bit 4 and depends on VIRGL. Three-dimensional commands require VIRGL negotiation. A context ID is carried in the common header. `context_init` interpretation depends on the negotiated feature; proof-only strict rejection must not be confused with production capset support.
- [Linux v6.6 virtio_gpu UAPI](https://raw.githubusercontent.com/torvalds/linux/v6.6/include/uapi/linux/virtio_gpu.h): independently confirms little-endian layouts. Common header 24 bytes; context create 96; context destroy 24; context resource 32; resource create 3D 72; memory entry 16; backing header 32; detach/unref 32. An entry has address, length and padding; create3D includes flags and padding after dimensions/sample fields. Exact-length rejection is a proof-profile rule rather than an assertion that every extensible transport must reject all trailing bytes.

## Existing implementation traps to recheck

At activation HEAD `0b7c9341`, before any new control implementation:

- `crates/core/src/dev/virtio/gpu/mod.rs:804` `read_request` reads a fixed prefix. Existing 2D request acceptance does not establish exact proof request length.
- `crates/core/src/dev/virtio/gpu/mod.rs:962` `write_prefix` allows truncation. New host mutation must be preceded by full response-capacity/range validation.
- Existing 2D backing handling validates RAM spans while building a temporary vector, then publishes. Its general transport behavior is not automatically the bounded 3D contract; SG overlap and short aggregate remain permitted in the requested proof profile, with no future DMA claim.
- `crates/core/src/lib.rs:2212` desktop save and `:2862` save_resume enter quiescing; a later GPU-only denial may already have consumed a queued command.
- `crates/core/src/lib.rs:2105` desktop restore has multiple early `cold_boot_desktop_fallback` calls. Reject proof ownership before even those error paths.
- `crates/core/src/lib.rs:3080` load_resume validates detached payloads using normal device instances. Validation on a normal temporary GPU cannot by itself enforce a proof-owned destination's refusal. Guard the outer destination before any CPU/RAM/device commit.
- Preserve normal feature negotiation even with the proof Cargo feature compiled; explicit construction and negotiated wire state must remain distinct.

No verdict, status change, implementation edit, or final evidence claim is made by these notes. Wait for root's frozen-head handoff.
