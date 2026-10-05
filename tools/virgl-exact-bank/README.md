# Exact raw bank consumer — E6-T12g6m3a

Private consumer boundary only. A named trusted host test wrapper adds v42 exact
u32 bank assumptions to an unchanged actual compiler result. No new compiler
admission, public negotiation, guest execution or measured acceleration follows.

`make verify-E6-T12g6m3a` records strict affected gates, original ASan/UBSan native
binary/profiles, complete native/Wasm singles and pairs, owned schema/bank tests,
full legacy replay, three headed Chrome/Metal schedules, actual equality-guard
sabotage, independent byte/packet capture checks and V8 source coverage.

Run after freezing the implementation and harness at one committed head:

```
VIRGL_EXACT_BANK_EVIDENCE_DIR=target/evidence/virgl-exact-bank-final make verify-E6-T12g6m3a
python3 tools/virgl-exact-bank/cold.py --output target/evidence/virgl-exact-bank-cold
python3 tools/virgl-exact-bank/seal.py --hot target/evidence/virgl-exact-bank-final --cold target/evidence/virgl-exact-bank-cold --output evidence/virgl-exact-bank/worker
```

The new profile wraps raw v1–v41 or the original straight-line v5 bank format.
`exactBaseProfile` is descending; `constantExactDomains` contains one strict
`constant-bank-exact-u32-v1` stage/slot/name/count record. Its `components` are
1..184 sorted unique register/component/word tuples. Declare1..47, address0..45;
C46 padding is never guest-uploaded. Exact zero and raw negative zero differ.
The approved base and every inherited obligation remain copied/frozen.

`checkExactBank` takes the parsed exact domain and parsed `exactBase`, approves
one full declared prefix through inherited guards, then compares its exact words.
The shared renderer uses that same immutable approval for draw restoration.
Finite mismatches retain honest CPU SET prefixes and skip unsafe restore upload;
DRAW rejects before index/staging/dispatch. Ordinary nonfinite wire rejection is
unchanged. Valid earlier CREATE/BIND may compile/link before a bank exists.

The literal fixtures cover both stages at C0/C45, genuine completely pruned
banks, the actual legacy declaration47 format, inherited F2I/raster hardware
paths and all finite/count/radial/raster/F2I unit compositions. Whole-frame
oracles are independent literal colors over a complete indexed quad. Guard-only
sabotage uploads raw2 and produces green instead of the expected unchanged
blue-gray frame. Captures include actual getUniform, packets, source, fences,
objects, budgets and pixels; the recording is never synthesized from summaries.

`coverage.py` retains original unfiltered V8 profiles and inventories changed
runtime lines. Fresh verification must inspect nested conditional child regions
as well; a containing-line hit is not blanket coverage. Actual original native
and cold binaries are retained with their profiles. Previous sealed recordings
are immutable; the legacy replay is a newly recorded successor compatibility
check using the unchanged predecessor harness.
