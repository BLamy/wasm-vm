E6-T12f2 recorded evidence

The complete recordings are losslessly archived because the physical full-frame
GPU JSON is larger than GitHub's per-file limit. Receipts retain the original
logical paths, byte lengths and SHA-256 digests. No pixel, shader, predecessor
trace, counter or call has been removed. `manifest.json` binds each archive and
the original native sanitizer artifacts. The PNG and worker receipt are also
available here for direct inspection.

Extract into a fresh ignored directory with standard tar:

```sh
mkdir -p target/evidence/selected-lanes-review/worker
tar -xzf evidence/virgl-selected-lanes/worker.tar.gz -C target/evidence/selected-lanes-review/worker
mkdir -p target/evidence/selected-lanes-review/cold
tar -xzf evidence/virgl-selected-lanes/cold.tar.gz -C target/evidence/selected-lanes-review/cold
```

Check archive hashes against `manifest.json`, then every materialized file against
its receipt or cold inventory. `worker-native` and `cold-native` match their
respective native report's binarySha256 and contain the LLVM coverage mapping.
Native coverage filenames preserve their actual worker/cold source roots; the
cold clone path and clean before/after state are recorded in the cold report.
Runtime/compiler source digests remain authoritative across the evidence/status
commit. Production guest GPU remains disabled; this does not prove300MIPS.
