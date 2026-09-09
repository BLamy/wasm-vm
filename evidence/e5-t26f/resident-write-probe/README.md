# BusyBox ash write syscall precheck — non-acceptance

Bounded native probe using the cached Alpine 3.20 image and the already installed
strace/libraries copied from `e5-t26f-resident-aplay-native-t61mn7`. No packages,
network access, new images, guest image changes, or browser runs are involved.
This measures actual write syscall counts and exact PCM bytes, not RISC-V or F
latency. The current browser's coarse shell CPU delta does not establish that
the finite feed dominates its roughly 2.947-second post-typing interval.

## Result: per-byte write hypothesis refuted in the native build

All three final runs exited zero. BusyBox **1.36.1**, strace **6.9**, aarch64
Linux; exact executable/version hashes are in `versions.txt`. This is the same
BusyBox version reported for the rootfs builder, not a claim of identical
RISC-V binary bytes. The unchanged helper SHA-256 is
`2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`.

| Feed | Target | Actual target syscalls | Bytes / exact output |
| --- | --- | --- | --- |
| Actual helper `printf '%b' "$e5_pcm" >&3` | regular file | 4 writev: 1025 + 1025 + 1025 + 765 | 3840, exact |
| Same actual escaped expression | FIFO with ready real cat reader | 4 writev: 1025 + 1025 + 1025 + 765 | 3840, exact |
| Predecoded NUL-free variable, `printf '%s'` | FIFO with ready real cat reader | 1 writev of 3840 | 3840, exact alternative pattern |

The baseline uses the actual 15360-character escaped expression, not a fabricated
printf substitute. The parser authenticates both the expression and feed command
against the frozen helper. Target calls are anchored at `escaped-file.strace:143`
through line 146 and `escaped-fifo.strace:159` through line 166; only the actual
main ash PID's writes to the specified target count. Generator and reader writes
are excluded. Both received baseline files have SHA-256
`e3179ebc66c47bef5c1bbcabce0718c5170c3995f2ff5a450db079a6e2a8d8ac`.

The optional alternative replaces the NUL byte with 1 (S16 sample 257 instead
of 1), decoding it into the shell variable **before** feeding. Thus it is not
the same sample pattern and is not promoted. Its one write is at
`decoded-fifo.strace:297`. Saving only three writes is not evidence of a material
browser speedup. No helper, runtime, image, deadline, or default change follows.
The browser's independently reported ~0.060 guest-second shell CPU delta also
does not attribute its host interval to this expression. This result neither
proves terminal/compositor dominance nor meets F acceptance.

## Reproduction and retained failures

The owned container `e5-t26f-ash-write-probe-native` was created with cached
`alpine:3.20`, `--network none`, command `/bin/sh /work/run.sh`. The existing
`/usr/bin/strace` was copied from the stopped prior precheck container together
with its existing libdw/libelf/libzstd/zlib/libfts/liblzma/libbz2 files and
symlink aliases. No `apk`, apt, compiler, network operation or image commit was
run. The initial file-copy setup lacked `/work`, then two tool checks discovered
missing copied dependency aliases/libraries; their diagnostics are retained in
`initial-tool-check.txt` and `second-tool-check.txt`.

The first measurement's cat reader had not opened its FIFO before the parent
closed; it was stopped and retained under `setup-reader-race/`. The corrected
probe waits, with a bounded loop, for the actual child's `pipe_read` before feed.
It closes the inherited child FD3 before exec of real BusyBox cat, feeds only
after readiness, closes the parent writer, and waits for the reader's zero exit.
The failed measurement is not accepted as a FIFO output result. The final run
completed exit zero; FIFO special files were not retained as repository artifacts.

After preparing the offline container's existing dependencies:

```sh
docker cp tools/verify/e5-t26f-ash-write-probe.sh e5-t26f-ash-write-probe-native:/work/run.sh
docker start -a e5-t26f-ash-write-probe-native
sh -n tools/verify/e5-t26f-ash-write-probe.sh
node tools/verify/e5-t26f-ash-write-probe.mjs evidence/e5-t26f/resident-write-probe
```

The shell syntax check and actual-trace parser both pass. `summary.json` retains
the parsed counts/hashes; `versions.txt` contains exact native tool provenance.
The final script SHA-256 is
`80760a2e145e84afed31c9e8b9d908da06912d1a84d9d13ae218bade76a855cf`;
the parser SHA-256 is
`32b61aec8b9baf2473a1962e3d6adf1759b4e9c1aaffae82488d86aa6ed8a020`.

`run.sh` is the exact copied probe source. `tools/verify/e5-t26f-ash-write-probe.mjs`
parses the actual traces, authenticates the baseline expression against the real
resident helper, and checks all 3840 output bytes. Native stdout/file/FIFO timing
is not extrapolated to browser acceptance.
