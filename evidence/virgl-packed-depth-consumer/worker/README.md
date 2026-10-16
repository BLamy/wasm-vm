# Original packed UN24 depth consumer worker recording

Frozen source: `bb12868a5fceea81acec5a8ff42496e13007ddd8`. The isolated selected
factory consumes original formats 20/21 in sampler views and mip depth surfaces.
The fresh critic owns the verdict; production guest graphics is still incomplete.

Commands at that exact source:

```sh
VIRGL_PACKED_DEPTH_CONSUMER_EVIDENCE_DIR=target/evidence/virgl-standard-packed-depth-consumer-frozen-bb make verify-E6-T11d43
python3 tools/virgl-packed-depth-consumer/cold.py --output target/evidence/virgl-standard-packed-depth-consumer-cold-bb
python3 tools/virgl-packed-depth-consumer/seal.py target/evidence/virgl-standard-packed-depth-consumer-frozen-bb target/evidence/virgl-standard-packed-depth-consumer-cold-bb evidence/virgl-packed-depth-consumer/worker
```

The complete hot and cold gates pass. Each covers 22 original sampler runs,
120 surface runs, two original-word planes, ten actual native failures, three
distinct eight-run lifetime schedules, all 22 wire cases and retained UN16,
floating depth and the complete 32-case packed storage matrix. The independent
inverse reconstructs original TGSI/wire/input geometry without product imports
or emitted GLSL as an oracle. Successful hot records include 1,632,516 output
words, 575,488 native depth pixels, 32,147,936 public bytes, 131,072 stratified
original packed words and every S8 value. Uploaded normalized FLOAT lanes have
maximum one ULP; other fields and public bytes are exact. GPU clears follow the
original conversion interval, then public serialization is exact for the actual
validated native choice. All five physical corruption controls are refuted.

The lifetime audit distinguishes 5,413 owned, 5,399 consumed and 14 disposal-only
syncs, with 5,607 fenced CPU collections and no synchronous collections in the
selected consumer records. Old-generation capture, cross-context state,
GPU-only refresh, cancellation and both disposal orders drain ownership once.
Full nested V8 coverage has 194 executed partitions, eight exact source-pinned
unchanged predecessor operands and no unproven new partition in both gates.
All 43,044 held D42 worker/critic bodies are separately authenticated at unchanged
storage/compiler boundaries; the retained matrix does not repeat its full domain.

`manifest.json` indexes one complete 43,886,017-byte gzip stream, SHA256
`cee5f6525922a02a14885affebcf763df18468b6434267a251f1a1f5b3e313a4`.
All 61,957 logical members were reopened in full, including every original/native/
public body, event, full coverage region, screenshot, whole frozen source and
generated compiler binary. Tar hardlinks name earlier real physical bodies only.
The record-index SHA256 is
`012d2a73e5d3d61db1b98a399ebda30d2d0f8592ec54df06e15a0f9cc6be11cf`;
manifest SHA256 is
`50d98b1a99ec9ffc0dce2567126a59fa7785536140275c2c62951d47378dfbdb`.
Hot receipt SHA256:
`1425537b3c0b6962359919acfce4d0d9c3add9f916141b3cb7e5a06c3629ef97`.
Cold receipt SHA256:
`bc98b4397a2066e4d7a73c346cc0e483598047a2b075b47d37da3883edcf111e`.
Cold report SHA256:
`fa66e169a366b8eccc2c5549712cae1fb5426760061e92023af6ba5b9d204042`.
The pristine clone recorded empty status before/after, exit zero and the same head.

The generated compiler MJS and Wasm retain SHA256
`6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa`
and `acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc`.
No API/capset, production control bridge, actual guest Mesa/compositor, live
deployment or 300 MIPS authority follows from this submission.
