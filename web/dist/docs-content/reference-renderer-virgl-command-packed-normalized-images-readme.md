# Packed normalized images readme

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

The selected packed UNORM resource/transfer factories preserve the 13 original
565, 4444, 5551 and 1010102 aliases pinned in the task. Original words remain
little endian in public backing. Native uploads permute component fields in the
already charged dense scratch into actual RGB565, RGBA4, RGB5_A1 or RGB10_A2
storage. The native precision survives; there is no RGBA8 storage shadow.

Readback uses native packed 2_10_10_10_REV words for ten-bit components. For
16-bit layouts, complete native normalized byte components have enough precision
to recover every defined original field exactly. Only ignored X fields become
all ones. Scratch and native PBO staging each cost four bytes per read pixel.
Opaque stored alpha initializes to one at every mip, restoring the caller's
global/indexed masks and scissor state. RGB565 supplies implicit alpha itself.

This profile retains the qualified resource owner, generations, GPU mip range
copies and asynchronous completion machinery. Historical factories remain
closed, including the independently held legacy format233 path. Decoder,
compiler, command consumers, device capsets and the public demo are unchanged.
`make verify-E6-T11d35` records physical browser GPU evidence and an independent
original-field/native-word/full-backing inverse. It grants storage authority;
production guest graphics requires the later command and guest qualification.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
