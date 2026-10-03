# Native recorder contract harness

This is **recorder evidence only**. An explicitly fake shared library replaces
virglrenderer behind the interposer. It does not render, decode VirGL, execute a
guest, or establish GPU correctness or arbitrary concurrent-embedding support.
The four real guest recordings remain the graphics evidence.

Run from the repository root with the disposable native ARM64 Linux reference
container running (C compiler, OpenSSL headers and Python 3 required):

```sh
python3 tools/virgl-capture/tests/recorder_harness.py \
  --container wasm-vm-virgl-reference-research \
  --output evidence/virgl-corpus/worker/recorder-harness
```

The output must be new. The runner copies the frozen recorder source and pinned
virglrenderer 1.3.0 public headers to a private `/tmp` directory. It compiles a
fake renderer DSO, recorder DSO and caller with `-Wall -Wextra -Werror`; no guest,
serial device, capture library or source image is touched. Evidence preserves
all input source/header bytes, original header licenses, compiler identity,
exact compiler/run argv and environment, executable hashes, stdout/stderr,
JSONL events, content-addressed blobs and the independent checker report.

The same C file is built as the fake DSO and caller. The caller sets an expected
ABI call; the fake independently checks exact pointer identity, scalar values,
input bytes and callback functions. Distinct nonzero return codes demonstrate
that the recorder preserves failures as well as successful calls. Original
callbacks assert their cookie and full fence IDs. The fake changes transfer
memory at the actual call boundary; Python compares the recorded bytes against
literal values, independently of the fake's return values.

Coverage includes:

- Transfer read and write, each with explicit and attached IOVs; different
  3+5 and 4+4 byte IOV partitions; snapshots before the fake call and after reads.
- Resource descriptors, create/attach, copied IOV descriptors, detach/unref,
  reset, and reuse of a resource ID without stale snapshots.
- Context names containing NUL, quote, backslash and non-ASCII bytes; submission
  bytes, capset outputs, context attach/detach/destroy, cleanup forwarding and
  the cleanup footer. Cleanup is tested after resource release; this does not
  claim resource reuse across cleanup/reinitialization.
- Callback ABI versions 1–4, zeroed unavailable fields, preserved non-fence
  callbacks, legacy and 64-bit context fences, and nested callback framing.
- Rejected unsupported blob API and null/unknown callback descriptors; invalid
  IOV arrays, lengths and bases; negative/null/oversized submissions; resource,
  blob, event-count and event-byte limits; signed/zero/overflow/garbage limits;
  insufficient versus exact footer reserve; process exit with an open call.
- A sabotaged readback byte must fail the literal snapshot checker.

Expected rejection cases intentionally produce `FAILED` and `complete:false`;
the test caller still confirms the real API call was forwarded. These are not
valid corpus captures. OS allocation/disk failures and arbitrary hostile API
pointers are outside this bounded harness; it uses valid host memory except
where the recorder's documented size/null guards reject before reading it.

For a self-contained Linux replay after copying an evidence directory:

```sh
python3 inputs/recorder_harness.py --inside --inputs inputs --output replay
```

The evidence `run/report.json` must have `passed:true`, 27 passing cases and
`oracleSabotageRejected:true`. Every retained event stream and binary is hashed.
