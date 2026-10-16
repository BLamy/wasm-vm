# Fresh adversarial verification of original packed UN24 storage

**VERDICT: verified.** The full [prediction-by-prediction report](VERDICT.md)
covers only E6-T11d42's opt-in original20/21 native storage, ranges and transfers.
No implementation was edited. Frozen worker source is
`c9d745dca15c170d0dfc080d20d39e8696d436fc`; submitted worker is
`9c98ac25764b53756bd9a0878b8012848f9ed4eb`; promoted critic harness is
`d3583d1f4574dfd9fc7a3b0bef0e3e544342cee1`. All three runtime bodies are unchanged
from the frozen worker at the critic's final harness head.

The critic independently authenticated all37,947 D42 worker members and all
41,650 D41 worker/critic members, whole pinned Mesa/virglrenderer/GLES/original
wire sources and actual compiler MJS/Wasm binaries. Its own Python/NumPy audits
use independent literal original field inverses and raw native bodies; worker
values/events/coverage/receipt/predecessor/cold/seal aids are not their authority.
Both full original24-bit domains,32 matrix cases, native completion, budgets,
retained paths and all finest nested coverage partitions hold. Per positive
hot/cold run:516 executed/10 precise unchanged D41 operands/0 unproven;
1584 owned/1575 consumed/9 disposal-only syncs;1128 fenced CPU collections and
384 synchronous driver returns. The latter are not invented fence completions.

Fresh recorded commands (all on actual headed Chrome/Apple M4 Max Metal):

```sh
node tools/verify-virgl-standard-packed-depth-images.mjs --output target/evidence/d42-critic-schedule-0x73c19be5 --mode boundaries --seed 0x73c19be5
node tools/verify-virgl-standard-packed-depth-images.mjs --output target/evidence/d42-critic-schedule-0xd0846f21 --mode boundaries --seed 0xd0846f21
node tools/verify-virgl-standard-packed-depth-images.mjs --output target/evidence/d42-critic-schedule-0x5e9a7c33 --mode boundaries --seed 0x5e9a7c33
VIRGL_PACKED_DEPTH_CRITIC_EVIDENCE_DIR=target/evidence/d42-critic-novel-sealed make verify-E6-T11d42-critic
node tools/verify-virgl-standard-packed-depth-images.mjs --output target/evidence/d42-critic-sabotage-completed-stencil --fault completed-stencil --smoke true --seed 0xa9b48d62
node tools/verify-virgl-standard-packed-depth-critic.mjs --output target/evidence/d42-critic-promoted-sabotage --fault completed-stencil --seed 0x6d2a91c7
```

The first three each pass46 varied lifetime/fault cases. The promoted correlated
UN24/S8/X8, segmented nonzero-mip/private-range/source-reuse/clear attack passes
two formats and34,170 predictions. Both sabotage commands intentionally exit1.
The promoted inverse rejects actual S8 199→97 after native mutation sequence131,
between first consumed sync4/sequence122 and distinct second consumed
sync6/sequence144. Both actual statuses are37146; raw native blob SHA256
`cf2ddc1876d99a1c0619d9368f7bdbbd1b45c5e506d07a6aab21735a6270c2f7`.
All original-input depth assertions, constants and exact S8 assertions remain
active. No product contradiction survives.

The initial failed critic run `runs/d42-critic-novel/` at8d1a2f55 and intermediate
corrected pass `runs/d42-critic-novel-final/` at3a08a913 are retained in full,
including sources, V8 bodies, original/native/public fields, events and screenshot.
The initial test incorrectly demanded original-upload≤1 ULP for a GPU FLOAT
clear's discrete canonical inverse. Its actual low clear bits0x358c0001 choose
UN24 18 within[17,18]; the invented inverse bits0x35900001 differ262144 ULP.
`audits/initial-clear-audit.json` authenticates the complete failed prefix. The
prediction refinement preceded the completing run. The whole primary
`tools/virgl-floating-depth/primary/es-3.0.6.pdf`, SHA256
`7e831831595d3e44c267cc0a0d754f8c244cf3c8f5056f49a674f25fb9d5adeb`,
supports the correction in §2.1.6.1/2 (physical PDF23–24), §2.13.1 (PDF95–96),
§4.2.3 (PDF201–202), and §3.8.15.1 (PDF176). The journal's informal original
page references were imprecise; these physical PDF coordinates and the report's
printed-page coordinates are authoritative. Original upload normalization and
its independent≤1 ULP bound are unchanged.

The seal contains **5,097 full logical members**,950 real bodies and4,147
hardlinks that name earlier real bodies. Logical bytes228,666,681; uncompressed
tar113,960,960 bytes. `manifest.json` orders the one gzip byte stream, here one
7,561,056-byte part. All parts were read, joined and memory-decompressed once;
every full logical body was reopened and hashed.

| Body | SHA256 |
| --- | --- |
| manifest.json | `41d6374be74e6119bfc85cd35e4e9d97345c0904f7ddd512f4a988cac5560400` |
| records.json | `98df45b4000a79235b6407b5c7beaa59c718ffb60c49016607d750dcfe310991` |
| joined recording | `c36fb7f77a4088c0c61b283cd4997512079b10ae8d7e6024932d5a27d42334ba` |

Archive paths: `runs/` has all eight fresh captures; `audits/` has initial and
refined predictions, independent custody/value/event/wire/regression/coverage/
novel/source/initial-clear audit scripts and complete results/logs; `git/` has
the runtime/harness diffs, recorded head identities and final promoted sources.
The full worker seal remains `../worker/`; its authenticated pins and the full
D41 seal identities are in `audits/custody.json`. The index is a complete member
map, not an abbreviated artifact inventory. `reopen.json` records the full seal
reopen result.

To independently reopen the critic seal without reverse gzip seeks:

```sh
python3 - <<'PY'
import gzip, hashlib, io, json, tarfile
from pathlib import Path
p = Path('evidence/virgl-packed-depth-images/verifier')
sha = lambda b: hashlib.sha256(b).hexdigest()
mb = (p / 'manifest.json').read_bytes()
assert sha(mb) == '41d6374be74e6119bfc85cd35e4e9d97345c0904f7ddd512f4a988cac5560400'
m = json.loads(mb)
joined = bytearray()
for part in m['archiveParts']:
    b = (p / part['path']).read_bytes()
    assert len(b) == part['bytes'] and sha(b) == part['sha256']
    joined.extend(b)
assert len(joined) == m['archiveBytes'] and sha(joined) == m['archiveSha256']
ib = (p / 'records.json').read_bytes()
assert sha(ib) == m['recordIndexSha256']
rows = json.loads(ib)['records']
expected = {r['path']: r for r in rows}
assert len(expected) == len(rows)
real, seen = {}, set()
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(joined)), mode='r:') as tf:
    for e in tf:
        assert e.name in expected and e.name not in seen
        if e.islnk():
            assert e.linkname in real
            b = real[e.linkname]
        else:
            assert e.isfile()
            b = tf.extractfile(e).read()
            real[e.name] = b
        r = expected[e.name]
        assert len(b) == r['bytes'] and sha(b) == r['sha256']
        seen.add(e.name)
assert seen == set(expected) and len(seen) == m['members']
print('Reopened every full critic body:', len(seen))
PY
```

The task status/log commit also records scoped syntax/diff, task-policy and queue
checks. The pristine frozen worker cold clone is authenticated and was not
repeated: runtime semantics and the isolation boundary are unchanged. This is
not evidence of production/API/caps, actual guest/compositor/scanout, deployment
or300MIPS; those boundaries remain independently ordered work.
