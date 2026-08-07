# E4-T04 gcc compile-benchmark source — provenance

The in-guest `gcc -O2` macro benchmark compiles a **single, dependency-free, real-size** C
translation unit: the amalgamated **miniz** library (~9.3 kLoC across `miniz.c` + `miniz.h`).
miniz is a self-contained zlib-alike — no external headers beyond libc — which makes it a clean,
reproducible `-O2` compile workload with real optimizer pressure (deflate/inflate, CRC, tables).

## Pinned upstream

- Project: miniz (https://github.com/richgel999/miniz)
- Release: **3.0.2** (amalgamated release archive `miniz-3.0.2.zip`)
- Archive sha256: `ada38db0b703a56d3dd6d57bf84a9c5d664921d870d8fea4db153979fb5332c5`
- License: MIT (see the upstream `LICENSE`; header retained in `miniz.c`/`miniz.h`)

## Vendored files (sha256)

```
0fcdc9888cb3a29ca8f176bac087e5fe6c7258a6ab06b1c271c1e109a11d3740  miniz.c
295d1a0041aea09609598c0f1f35c1977ca05ad662acbadcfdaac44c140af37b  miniz.h
```

These are copied byte-for-byte from the release amalgamation (not the git tree, which is split
into many files). They are the durable committed artifact; `bench/mk-gcc-image.sh` stages them
into the gcc overlay at `/src/miniz.{c,h}` and the harness compiles `miniz.c` with `gcc -O2 -c`.

## Why compile-only (`-c`)

The benchmark measures the compiler front/middle/back-end (cc1 + as), not linking, so no libc
crt objects or shared libraries are needed — only the musl-dev headers miniz's `#include`s pull
(`stdlib.h`, `string.h`, `stdio.h`, `assert.h`, `time.h`). Determinism: compiled with
`SOURCE_DATE_EPOCH` + `-frandom-seed` so the emitted `.o` is byte-stable (the anti-drift record).
