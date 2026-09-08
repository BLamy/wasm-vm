# Buffered `e5_observe` preflight

Disposition: safe as one bounded **hypothesis test**, not a cause, speedup, or F-acceptance claim. Keep the three observation `printf` calls unchanged; batching them is a separate candidate.

## Minimal first candidate

Use pure POSIX shell plus explicit `/bin/busybox cat`. Add one capture primitive that reads one proc file once into a shell variable, appends a non-newline sentinel inside the command substitution, rejects `cat` failure or a missing sentinel, strips only that sentinel, and enforces a small per-file byte bound. The sentinel must preserve trailing newlines that ordinary command substitution would discard. Parse the captured bytes in memory with parameter expansion and literal newline splitting—no `eval`, no pipeline whose loop state lives in a subshell, and no unquoted expansion or pathname expansion.

Keep the existing FD glob scans and inode comparisons. Buffer only the current text reads: child `stat`, `wchan`, child/parent `fdinfo`, PCM `status`, and optional child `io`. This preserves the current executable/inode and descriptor proof while testing the byte-read hypothesis. A new C helper is not minimal: it adds a compiled executable, architecture/ABI and image provenance, parser memory-safety, and deployment boundaries. Consider it only as a separately measured follow-up if shell `cat` fork cost remains material or ambiguous.

## Equivalence obligations

Before browser use, run old and candidate observers against the same real prepared player and require identical success/refusal plus byte-identical `e5_seen` and `e5_print_observation` output. Preserve all current facts from `tools/guest/e5-t26f-resident-aplay.sh:17-107`:

- PID is numeric/nonzero; parent is the physical shell; `/proc/$pid/exe` inode-matches `/usr/bin/aplay`.
- `stat` supplies the same PID, exact `(aplay)` comm, sleeping state, parent PID, numeric field-22 start time, and sufficient fields. Disable glob expansion while tokenizing; reject malformed or surplus shifting rather than guessing.
- `wchan` is exactly `pipe_read`, including its valid no-trailing-newline form.
- Exactly one child FIFO FD exists, with exactly one octal `flags:` value and access mode read-only; exactly one parent FIFO FD exists, is FD 3, and has read/write flags.
- Exactly one child PCM FD inode-matches `/dev/snd/pcmC0D0p`.
- PCM status contains each required field exactly once: `state=PREPARED`, `owner_pid=$pid`, `hw_ptr=0`, `appl_ptr=0`; missing, duplicate, malformed, or extra-token forms refuse.
- Optional `/proc/$pid/io` remains `unavailable` only when unreadable. When readable, capture must succeed and be nonempty, and reconstruction must preserve the existing `|line` serialization exactly.
- Recheck PID/start/parent/exe identity after all buffered captures so one observation cannot combine files across process exit or PID reuse. The existing two equal pre-observations and post-restore equality remain mandatory.

Finite refusal tests must cover unreadable/disappearing files, failed `cat`, missing sentinel/truncation, over-limit input, missing/duplicate/malformed stat/fdinfo/PCM/io fields, wrong access modes, wrong owner/pointers/state/wchan, FD multiplicity, PID/start change between first and final identity reads, shell metacharacters/globs, and embedded sentinel bytes. Sabotage one required guard and show the test fails. The candidate must not source alternate paths, accept mocks in the browser path, or change `e5_reason`, arming, FIFO feed, wait, or printed success/failure markers.

## New cold-browser evidence

Any helper-byte change requires a new image/chunk manifest and a new authenticated cold checkpoint; never rebind or reuse an earlier seal. Pin runtime base, helper SHA-256, image, manifest, snapshot, browser, and harness hashes. Keep default clock/JIT/cache policies, physical `play`, key pacing, delayed gesture, restore T0, and the original 2000-ms assertion unchanged.

The candidate recording must still prove the same actual PID/start/exe inode/parent, FIFO FD counts and flags, `pipe_read`, one PCM FD, PREPARED/owner/zero pointers, two equal pre-save observations, equal post-restore observation, matching first-present CRC, fresh HELLO/no boot, real typed interaction, successful wait of that same child, and 1440 fresh non-silent PCM frames. Record all failures. If it misses 2000 ms, retain the negative result without later-phase or causality claims; if it passes, complete the existing coherence/drag/second-restore criteria and obtain fresh adversarial verification before any F status change.

No browser syscall-count claim follows from the native arm64 trace. The browser run tests only whether this exact proof-preserving candidate meets the unchanged outcome boundary; attributing any difference to read buffering requires a later matched experiment that accounts for `cat` process-launch cost.
