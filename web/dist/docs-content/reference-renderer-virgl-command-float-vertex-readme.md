---
kind: "Technical reference"
source: "renderer/virgl-command/float-vertex-README.md"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
source_sha256: "ee79a8a3d1a008b66544b9c2fa4c02baf51e99dc967803de5a82b1f18c6de620"
scope: "Pinned source; publication does not refresh verification"
---

# Float vertex fetch boundary

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

This is the historical float32 boundary. The selected standard factory's
additional native compact formats are described in [compact-vertex-README.md](./docs.html?page=reference-renderer-virgl-command-compact-vertex-readme).

Pinned VirGL formats 28/29/30/31 are R32/RG32/RGB32/RGBA32_FLOAT. The decoder
owns their one through four lanes, divisor zero, float-aligned source offsets
and u32 end bounds. The same lane count determines the native attribute size,
first-element check and largest actual indexed or array fetch. Strides remain
nonzero for draws, float-aligned and at most 255 bytes (252 after alignment).

Missing lanes use WebGL's zero/zero/zero/one defaults; a supplied fourth color
lane and homogeneous position W remain intact. Overlapping nonzero strides
are valid when the actual fetches fit. Index hints do not bound actual accesses.
Retained buffer generations survive public unref/ID reuse and restore through
the existing complete state/program cache and asynchronous fence ownership.

`make verify-E6-T11d3` records original-form packets, shader/dump/reflection,
actual retained GPU buffer bytes and native attributes at every physical draw.
A separate Python oracle decodes packet state and binary32 GPU contents to
derive lane defaults, alpha, projected quad coverage and reciprocal clip W;
raw RGBA8 pixels allow one stored component unit. Scalar, RGBA and position-W
native-size mutations must each fail their named physical prediction.

This isolated module has no production-demo imports. It does not advertise a
complete API, production capset or guest acceleration. Instancing, zero-stride
constant attributes and other vertex format families remain explicitly gated.
The WebGL API follows [OpenGL ES 3.0 vertex attributes](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf);
its additional [WebGL restrictions](https://registry.khronos.org/webgl/specs/latest/2.0/)
continue to apply.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
