---
kind: "Technical reference"
source: "renderer/virgl-command/integer-image-consumer-README.md"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
source_sha256: "efa4462b8529d831766518be8638d4619c29e957d1c23e9cd1c4cf17033248e2"
scope: "Pinned source; publication does not refresh verification"
---

# Selected original integer image consumer

{% hint style="info" %}
Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification.
{% endhint %}

`createVirglStandardIntegerImageAsyncRenderer` composes the verified integer
resource owner and integer image compiler. Its private profile consumes original
2D views and one COLOR0 attachment, selects native sampler/output signedness from
owned metadata and retained target storage, and preserves raw integer clear words.
It uses native texture operations, typed view swizzles, iv/uiv clears and the
existing asynchronous physical fence/retirement protocol.

The selected metadata/result/pair/interface exports in `constant-domain.mjs`
accept only owned records with explicit disjoint COLOR0 host masks. Old exports
and factories remain closed to this profile. Broadcast and multiple color outputs
are outside this boundary; incomplete native integer filtering refuses explicitly.
The demo, guest negotiation and production caps do not select this consumer yet.

`make verify-E6-T11d33` authenticates the actual independently sealed compiler,
replays every original response in Node and the headed browser, and captures the
complete hardware matrix, varied schedules and physical corruption controls.
The independent Python inverse derives full native words and transfer bytes from
original packet/TGSI/source bytes. Full nested V8 ranges, scoped unchanged older
operands, dependency digests, a pristine clone and a fresh critic determine proof.

## Related field guide

{% content-ref url="./docs.html?page=graphics" %}
Guest graphics: the admitted boundary
{% endcontent-ref %}
