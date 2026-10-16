---
kind: "Preserved source record"
source: "docs/perf/cursor-plane.md"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
source_sha256: "1e01b8c8ee024033083bf9f374846840ae28d87ee79cb44ee08723c805194607"
scope: "Pinned source; publication does not refresh verification"
---

# Cursor-plane integration proof

{% hint style="info" %}
Historical record. Numbers and verdicts belong to the original run and its stated revision, host, and workload; publication here does not refresh that verification.
{% endhint %}

E5-T15d closes the browser/native proof for the cursor plane. The core cursorq path publishes a
resource update with a temporary host-owned pixel view, publishes MOVE_CURSOR as state-only
events, and canonicalizes resource 0 as hidden. The browser copies UPDATE pixels into the bounded
`CursorSink`; CSS cursors are used through 128×128, while larger resources use one absolutely
positioned overlay. Relative movement updates only that overlay's `transform`.

The proof workload uses a 64×64 BGRA checkerboard with transparent, half-alpha, and opaque pixels,
hotspot `(10,3)`, a 256×256 overlay fallback, resource-0 hide, and a no-cursorq initial state. It
issues 500 relative MOVE callbacks at a requested 500 Hz average while 160 framebuffer presents
are delayed by 30 ms. The latest run completed all 500 moves with zero layout reads and 500
transform writes; the framebuffer scheduler stayed at one pending frame, coalesced delayed frames,
and drained with no errors. The independent PNG reference compared all 16,384 RGBA bytes.

Run the exact proof with:

```text
make verify-E5-T15d
```

The native machine-boundary capture and Chromium evidence are recorded in
[`evidence/e5-t15d/cursor-integration-2026-09-04.json`](https://github.com/BLamy/wasm-vm/blob/2691b24e6c00478f8d69f81180b6827761de246a//Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15d/cursor-integration-2026-09-04.json), with the accompanying screenshot at
[`evidence/e5-t15d/cursor-integration-2026-09-04.png`](https://github.com/BLamy/wasm-vm/blob/2691b24e6c00478f8d69f81180b6827761de246a//Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15d/cursor-integration-2026-09-04.png).

Independent-machine, WebKit, and host-rr runs are outside this proof's scope. The acceptance
evidence is the local native machine-boundary test, the independent PNG decode, and the local
Chromium production route.
