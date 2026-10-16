---
kind: "Technical reference"
source: "renderer/virgl-command/shared-exponent-images-README.md"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
source_sha256: "26dd525c7ae891a9b646d6a479704a7670cffb4010dd1e0e0e9292fca054e5d7"
scope: "Pinned source; publication does not refresh verification"
---

# Selected original RGB9E5 images

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

`createStandardSharedExponentResourceStore`, `computeStandardSharedExponentTransferLayout` and `createStandardSharedExponentTransferBackend` preserve original VirGL format125 sampler-only uploads. Original little-endian R9G9B9E5_FLOAT words enter native RGB9_E5 storage with packed RGB uploads and implicit alpha1. Historical factories retain their admissions.

Private mip ranges retain native textures plus one reusable RGBA8 conversion image and one PBO, charged at eight auxiliary bytes per base pixel before allocation. A fixed GPU texelFetch pass canonically packs actual native colors, reads guaranteed RGBA/UNSIGNED_BYTE into that PBO, and uploads from the same buffer to native RGB9_E5. Product copies never download pixels or reconstruct them from CPU backing. Public reads charge four CPU bytes per pixel and four conversion-image bytes; staged reads also retain a four-byte PBO through completion/cleanup. Equivalent noncanonical original words can canonicalize while preserving exact RGB values.

The primary conversion is [EXT_texture_shared_exponent Appendix A](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_shared_exponent.txt), checked independently with integer/rational original-bit inputs. Full original/native/public captures, physical fences, budgets and failure controls are recorded by `make verify-E6-T11d29`. This boundary adds no sampler/surface command admission, API/capsets or production guest rendering. Native proof targets the recorded M4 Metal host; other hosts require qualification.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
