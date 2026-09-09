# F JIT control: one unprofiled pair, both timing failures

Exact run head: `f9f017f5115b9425bf66457e8aeae016107b245d`.
Diagnostic only (`acceptance: false`), **not F acceptance**. Runs were sequential:
JIT-on began 2026-09-08 03:51:47.134 UTC; JIT-off began 03:51:56.247 UTC.
One pair does not establish significance, root cause, or a new default.

## Observations

| Recorded measure | jit=1 | jit=0 |
| --- | ---: | ---: |
| Actual executor, before / after | true / true | false / false |
| Original end minus restore T0 (ms) | 5231.120 | 4842.675 |
| Later interaction-observer elapsed (ms; not the cap value) | 5231.515 | 4843.080 |
| Rendered cursor from original T0 (ms) | 838.140 | 792.755 |
| Immediate PCM observation from original T0 (ms) | 5224.770 | 4833.035 |
| Fresh written / non-silent PCM frames | 1440 / 960 | 1440 / 960 |
| PCM maxAbs | 0.082000732421875 | 0.082000732421875 |
| Guest output attached at completion | true | true |
| Rendered-frame delta (includes silence) | 210688 | 194176 |
| Guest-visible command changed pixels | 3736 | 3555 |

Both physically typed the same `sh /tmp/a` with 5 ms key pacing, 20 keyboard
frames, matched input sequences and the conditional completion marker. Both
record guest-visible focus, a cursor at (684,392) with 94 matched pixels, released
buttons, and unlocked/running audio. Non-silent producer PCM—not the render
counter or shell exit alone—is the audio evidence.

Both fail `post-restore interaction exceeded 2 seconds` (`ERR_ASSERTION`,
runner line 1401). Neither original restore timestamp nor the 2000 ms cap was
reset. The before-JIT RPC cost 11.505 / 0.600 ms inside that budget; the after-JIT
RPC cost 46.910 / 35.790 ms after PCM capture and frozen `postRestoreEnd`.
Guest-clock reads likewise report actual `icount` in both arms.
JIT-off's observed 388.445 ms lower elapsed is only this pair's result.

| Within-arm counter delta (`jitAfter - jitBefore`) | jit=1 | jit=0 |
| --- | ---: | ---: |
| Guest retired | 61972377 | 57973104 |
| Retired via JIT | 22286932 | 0 |
| Host JIT entries | 1652644 | 0 |
| Direct-chain entries | 4145377 | 0 |
| JIT cache installs / retranslations / evictions | 656 / 307 / 112 | 0 / 0 / 0 |
| Block-entry hits / block builds | 6928058 / 881211 | 10211163 / 834473 |
| State-copy bytes | 275884928 | 0 |
| Entry-cost timer reads | 0 | 0 |

JIT-on's **delta-derived** retired share is 35.962687%, with 13.485622 retired
JIT instructions per host entry. No ratio compares cumulative totals across
arms. These counters span the two actual worker reads, not exactly the shell
command or frozen interaction window; the after-read includes later guest work.
`compiledBlocks` is retained as a gauge (94→133 / 0→0), not a compilation counter.
Entry timing is disabled in both records; CPU and latency probes were absent.

First-present CRC `0a17c914` matches the same saved snapshot in both runs.
Both record whole-machine resume, fresh generation-2 HELLO, and no `booting`
state. The recorded agent disconnect requests that fresh HELLO. Browser and
non-favicon HTTP error arrays are empty; each canonical server log retains two
favicon 404s. The full coherence audit remains deferred (`checksPassed: false`);
drag saves and second reload were not reached. These runs do not prove those gates.

## Common binding and provenance

The two canonical records and the creator checkpoint agree on all runtime/image/
origin binding fields (creator/current HEAD deliberately differ):

- Creator HEAD: `faddd274c934e09aec18161758c690a3b87bde8e`; sealed at
  `2026-09-08T03:32:56.897Z`.
- Sealed profile SHA-256:
  `778bc49dcdc7551de0b2f6a23e4b32a30ce72dea2c00e425bfdc302820d8fc65`.
- Runtime tree SHA-256:
  `84ef07f7f4ec173dc921a1d91a764f538953600fdccfb3af0eed4aaca57617f9`.
- Image SHA-256:
  `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`.
- Snapshot SHA-256:
  `4ebdd9f6edb253d940a93082118068c089c844f985b13e0a7593956d6ccf88fb`
  (2626972 bytes; saved overlay generation 651).
- Chromium `Chrome/152.0.7977.76`, headed, authenticated by the sealed
  checkpoint browser identity check. Each run uses a separate copied profile,
  not the baseline profile itself.

[comparison.json](comparison.json) retains exact unrounded fields, kernel/
manifest/checkpoint digests, iteration paths, actual clock observations, errors,
and SHA-256 for each canonical JSON, PNG, server log and run log. PNGs were hashed,
not visually re-reviewed for this packaging sidecar.

Canonical failure JSON SHA-256:

- [jit-1](jit-1/failure-post-restore-interaction-checks.json):
  `8019eb6495611139ef6a2e71e91431e312e892ce9591d67f7aa7393f8dbbf782`.
- [jit-0](jit-0/failure-post-restore-interaction-checks.json):
  `afee1c19cb82b59f6a4e7384dddc6c5902bca68d6402d6eb87a80ddbf707d13f`.

## Reproduction

The logs do **not** preserve the original shell command or complete environment.
This effective invocation is reconstructed from canonical metadata/URLs, the
sealed checkpoint, the frozen runner, and local image/manifest bytes whose
hashes were checked against the binding. It is not a verbatim shell transcript.
Run at the exact head above with the unchanged built runtime and retained
profile available; the runner refuses mismatched bindings. Use fresh output
directories so the canonical failure records are never overwritten.

```sh
cd /Users/blamy/Documents/Codex/wasm-vm
F_JIT_REPLAY_OUT="$(mktemp -d /private/tmp/e5-t26f-jit-control.XXXXXX)"
for jit in 1 0; do
  env -u E5_T26F_DIAGNOSTIC_CPU \
      -u E5_T26F_DIAGNOSTIC_LATENCY \
      -u E5_T26F_DIAGNOSTIC_COMMAND \
    E5_T26F_REQUIRE_HEAD=f9f017f5115b9425bf66457e8aeae016107b245d \
    E5_T26F_HEADED=1 \
    E5_T26F_DIAGNOSTIC=reuse \
    E5_T26F_DIAGNOSTIC_PROFILE=/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26i-clock-ni2iS7 \
    E5_T26F_DIAGNOSTIC_PORT=61628 \
    E5_T26F_DIAGNOSTIC_GUEST_CLOCK=icount \
    E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
    E5_T26F_DIAGNOSTIC_JIT="$jit" \
    E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
    E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
    E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
    E5_T26F_OUT="$F_JIT_REPLAY_OUT/jit-$jit" \
    node tools/verify/e5-t26f-browser-roundtrip.mjs \
    >"$F_JIT_REPLAY_OUT/jit-$jit.log" 2>&1
  printf 'jit=%s exit=%s\n' "$jit" "$?"
done
```

The retained runs terminate at an uncaught timing assertion; replay must retain
that failure, not treat real playback as a timing pass. No browser was launched,
runtime changed, task status changed, or critic findings consulted while
producing this sidecar.
