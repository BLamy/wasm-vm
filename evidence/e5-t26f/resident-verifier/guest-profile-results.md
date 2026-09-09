# Guest hot-PC attribution — bounded independent critic

Scope: diagnostic guest profile at 2934524b and closed map lookup at 3174e1c5.
No F verdict, gate, implementation, status or commit work.

Before raw evidence inspection, predictions from source review:

1. Before/after observations must bind one unchanged actual profiled Linux worker,
   the same sealed profile/runtime, monotonic timestamps and advancing cumulative
   counters. Percentages must use the recorded cumulative denominator, not be
   presented as elapsed-host-time shares or complete interval profiles.
2. The retained map PNG may place the hot virtual ranges inside PID962's musl
   executable mapping. Because samples have no PID/ASID/SATP tag, this alone
   cannot identify the sampled process or exclude overlapping virtual mappings.
3. A command can genuinely complete yet fail the existing marker oracle if
   scrolling leaves its final green-pixel count no greater than the pre-command
   baseline. Check actual raw counts and source; do not assume this mechanism
   merely from the timeout or manufacture a successful harness result.

No raw profile/map evidence had been opened when those predictions were written;
the coordinator's reported counts/map were known.

## Results

**Useful musl-mapping lead; no proven function, sampled process, dominant cost,
optimization benefit or F acceptance.**

### Counter identity and limits — HELD

The profile's `guestProfileBefore`/`guestProfileAfter` (canonical JSON lines
257/555) both record one unchanged same-origin Linux worker, with the sole URL
change `/linux-worker.js` → `/linux-worker.js?profile=1`, API available, no RPC
error, and validated endpoint state. The before request/response is
1473.1800000667572..1492.0650000572205 ms; after is
6236.325000047684..6284.955000042915 ms. The former is after original T0;
the latter is after frozen interaction end, not an exact frozen-window sample.
Read costs are 18.885 and 48.630 ms. Independently recalculated deltas:

| Counter | Before | After | Delta |
| --- | ---: | ---: | ---: |
| sampleCount | 3814 | 36323 | 32509 |
| collisions | 2 | 1687 | 1685 |
| walkCount | 118796 | 811912 | 693116 |
| totalNs | 566734999 | 5349799999 | 4783065000 |

All region percentages equal samples / the **cumulative** sampleCount. The core
hook (`crates/core/src/lib.rs:4842`) samples only interpreted retirements and
explicitly supplies the virtual PC, despite historical `phys_pc` field names.
The histogram has no PID/ASID/SATP dimension. It drops strong-slot collisions;
weak-slot replacement can lose earlier counts and is not itself counted by
`collisions` (`crates/core/src/prof/histogram.rs:90`). Do not treat collisions as
JIT evictions/retranslations, missing top-ten PCs as zero, or top-ten percentages
as complete interval/host-time shares. These four userspace regions were absent
from the before top ten; exact per-region interval deltas are unavailable.

The four after counts total 3084 / 36323 = **8.490488% of cumulative interpreted
samples**, not 8.49% of total CPU or elapsed latency. JIT-executed PCs are not
sampled. Arming this profiler also enables existing executor entry timing
(`crates/core/src/lib.rs:2184`); unchanged served bytes do not make this an
uninstrumented performance run. Residual subsystem labels such as `cpu_interp`
are not independent proof that all attributed time was interpretation.

### Checkpoint and map attribution — HELD with explicit limits

Independently rehashed the immutable 812-file seed profile and 149-file served
runtime tree, decoded/rehashed the saved desktop bytes, and compared both runs'
bindings with the cold record. Profile, runtime, image/manifest, kernel, fixture,
snapshot and creator agree; only harness heads and explicit diagnostic commands
differ. Both start from the same saved RAM, not fresh independently randomized
ASLR boots. That supports comparing the saved address spaces. It does not make
later process creation, exec, mapping changes or different process address spaces
impossible.

Directly viewed `resident-map-3174e1c5/command-e5t26f-post-aplay.png`. It reads:

```text
/proc/962/maps:7fff9b1bc000-7fff9b250000 r-xp 00000000 fe:00 486 /lib/ld-musl-riscv64.so.1
```

The same PID's visible map entries also contain libwayland, libweston and
libexec_weston. This is consistent with a compositor-related address space;
the capture does not print PID962's executable identity. All four sampled
64-byte regions fall wholly inside its musl executable mapping:

| Sample region | After samples | Cumulative % | Candidate mapped-file offset |
| --- | ---: | ---: | --- |
| `0x7fff9b209cc0` | 1671 | 4.600391 | `0x4dcc0` |
| `0x7fff9b209c80` | 610 | 1.679377 | `0x4dc80` |
| `0x7fff9b203a00` | 407 | 1.120502 | `0x47a00` |
| `0x7fff9b2061c0` | 396 | 1.090218 | `0x4a1c0` |

Offsets are PC minus mapping start plus the observed file offset zero. Match
the exact extracted ELF and its load-segment layout before symbolizing them;
the filename alone identifies neither a function nor its caller. No extraction
or function attribution is claimed by this review. Because the profiler lacks
process tags and the map PNG is only the visible tail of a later diagnostic
lookup, it does not prove uniqueness across all processes, temporal mapping
identity throughout the sampled run, or that these samples belong to aplay,
the shell, Weston, or its rendering loop. It is a concrete binary/offset lead,
not a causal driver or libc optimization result.

### Lookup completion versus marker timeout — distinguished

The map PNG shows actual post PID999/start27744 observations, green aplay,
the original job's `Done` notification and prompt. The raw audio state has
writeIndex/readIndex 1440, 1440 non-silent frames and maxAbs0.999969482421875;
the restored baseline was zero. Its generic `writtenFrames:4096` is the
unbased ring-inspection window, **not** a 4096-frame production claim.

The command nevertheless failed the existing wait predicate after 120000 ms;
retain that negative harness result. At capture the raw active command has
`terminalMarkerSeen:false`, baseline green369 (map JSON line819), while the
surface has green348 (line732). Source requires both the green threshold and
strict growth over the saved baseline (`web/desktop-terminal.js:390`, also
`:898`). Thus this captured completed terminal state cannot satisfy the
predicate. The screenshot visibly shows that long map output displaced the
earlier preparation text/green marker. This supports a scrolling-sensitive
marker false negative rather than an audio hang. No frame-by-frame maximum,
exact completion timestamp or predicate fix is established here.

## Artifact authentication

All below SHA-256 values were computed from actual files; no record was edited.

| Artifact (relative to `evidence/e5-t26f/`) | SHA-256 |
| --- | --- |
| `resident-guest-profile-2934524b/failure-post-restore-interaction-checks.json` | `2a6b016ba535eea9ce2d7860266d32aabc44904e6689e5e0a250650c63d86229` |
| `resident-guest-profile-2934524b/failure-post-restore-interaction-checks.png` | `d4537508f5cb7f9be48b0819bf90eea066d5bf4a699d670fcdf004554cec8bd6` |
| `resident-guest-profile-2934524b.log` | `c6cd197e97cd944cb25ccdf82ba1047e4a9521bdb298e88eac98d5208133c9a7` |
| `resident-map-3174e1c5/command-e5t26f-post-aplay.json` | `d896392275361bcf4a7d8fca2637ad053793de592d50432b1d08a3d9be5dc3ee` |
| `resident-map-3174e1c5/command-e5t26f-post-aplay.png` | `b0d7173c9d6cd8331529b2ff6df09ba4a79945c96d843dc212221e6c3b9919c6` |
| `resident-map-3174e1c5/failure-command-e5t26f-post-aplay-completion.json` | `3c4f7a6244675cf0c92e0a97232f0f6cc397f95c3cd4d2b7b7a2b154edbed7ae` |
| `resident-map-3174e1c5.log` | `e12ee9227ebcff66c3f14a9ca890a98c447b94e778a7c99f7b86c79b548b4c7c` |

Only this critic note was written. No gates, browser launches, runtime/helper
edits, status/queue changes or commits. Prior F and dependency HELD evidence is
not relitigated; the existing timing failure remains unchanged.
