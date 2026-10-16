---
kind: "Technical reference"
source: "renderer/virgl-command/integer-images-README.md"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
source_sha256: "d323bf05dbd37492261323430a9469d8754fe864d73c8109b20f69998eaba603"
scope: "Pinned source; publication does not refresh verification"
---

# Original integer image storage

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

The selected integer owner/backend/layout alone admit original formats177..200.
R/RG use native integer storage; RGB expands within charged scratch to matching RGBA
with integer alpha1. Sync and PBO reads use RGBA_INTEGER/INT or UNSIGNED_INT and
compact original little-endian words in the same charged scratch.
NEAREST framebuffer blits copy matching integer ranges entirely on the GPU.

The metadata marker integerBits is owned, never an accepted guest field.
All earlier constructors remain closed to integer images. Limits are unchanged:
4MiB/resource,32MiB aggregate and8MiB scratch. The guaranteed16-byte integer read
limits each read to524288 texels; this change does not lift that bound.

This storage facet grants no typed shader, packet consumer, production capset,
guest rendering, scanout or performance authority.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
