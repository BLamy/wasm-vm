# Buffered proc observer: narrowed verification preflight

Disposition: no full real-player legacy A/B/A injection is required. That technique would add a guest transport/harness boundary not present in F, and “oracle absent from checkpoint” cannot require erasing historical shell RAM or command history. Do not grow acceptance around it.

Parent reference remains `7f15d76646a9f94e9c089b53bb7202fb1278a18c`; its helper SHA-256 is `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`. The old observer/parser is the semantic reference, not code that must be installed or injected into the real guest.

## Minimal equivalence and refusal proof

Use verifier-side, source-extracted old and candidate acquisition/parser functions over the **same controlled proc bytes**. No product mock-path switch is permitted. For each accepted fixture require identical:

- success/refusal result and refusal reason where externally stable;
- parsed PID/start/parent/comm/state, wchan, FIFO/PCM FD counts and numbers, flags, PCM owner/state/pointers, and optional-io availability;
- byte-identical `e5_seen`; and
- byte-identical output from the unchanged three-call `e5_print_observation` path.

Fixtures must represent the actual text grammars and boundaries: stat with enough fields and exact `(aplay)` comm; newline-terminated fdinfo/status/io; no-trailing-newline `pipe_read`; readable and unavailable io; octal flags; and multiple FD entries. Exercise trailing-newline preservation, checked capture failure, sentinel/truncation and finite bounds, malformed/missing/duplicate fields, shifted stat fields, wrong access modes, wrong owner/state/pointers/wchan, FD multiplicity, shell metacharacters/globs, and empty readable io. Mutations must make both the reference expectation and candidate refusal explicit. Native mock proc remains refusal/equivalence evidence only, never real-browser success evidence.

Audit every changed helper hunk against parent. For each old guard, cite either an unchanged line or a controlled fixture that proves equivalent acceptance/refusal. Any intentionally stricter behavior needs a stated reason and a fixture; any weakened or unexercised guard blocks the candidate. Keep the three observation `printf` calls, arming, FIFO feed/close, same-child `wait`, success/failure markers, runtime policies, and browser acceptance predicates unchanged. No C helper or printf batching belongs in this candidate.

There is presently **no concrete old guard** that additionally requires running legacy code against the live player. A new live legacy comparison would become necessary only if the frozen diff changes behavior that controlled bytes plus source audit cannot represent—for example, a new dependency on inter-read mutation or observer side effects—and that demand must cite the exact changed hunk. Ordinary procfs reality is covered by the candidate's real prepared-player run below.

## Actual cold and post-restore proof

Build a fresh helper-bearing image/chunk manifest and create a new authenticated cold checkpoint; never rebind an old seal. Pin the frozen candidate head, helper, image metadata and bytes, manifest, inner runner, collector, wrapper, and produced snapshot/record hashes.

The unchanged F cold path must prepare the actual `/usr/bin/aplay` and prove its real PID/start/parent/exe inode, exact sleeping state and `pipe_read`, FIFO/parent FD counts and flags, one PCM FD, PREPARED owner, zero hw/appl pointers, stable paired pre-save observation, and nonempty-or-unavailable real io. The unchanged reuse path must prove equal post-restore identity, physical `play`, same-child completion, fresh non-silent PCM, original restore T0 and 2000-ms assertion, matching CRC/fresh HELLO/no boot, and all later F criteria only if reached. Record every failure. This is the authority for actual process/files; controlled fixtures are not.

One candidate run cannot promote the native arm64 syscall observation into browser causality or performance. A miss remains a negative result; a pass still requires the existing F adversarial verification before status changes.

## Ready wrapper read-only review

Reviewed `tools/verify/e5-t26f-browser-buffered-proc.mjs` at SHA-256 `536d02b9833ca889c4b22b9df87f1d303d1e71df26b6fa135bdcd0d34effa90e` and its test at `9058fdda19af29d2a460d0e23b33d8054f9fe63109357ccbaf3c84d2495d9ea7`. No preflight blocker found:

- it refuses an existing output, scrubs inherited E5/Cargo/Rust overrides, creates a unique retained profile, uses port 61636, and runs only new cold then default-policy JIT/repack-off reuse;
- its 13 bindings include the helper, image-info and manifest plus the held inner runner/collector/runtime sources, with head and source rechecks before final observation;
- cold failure/signals stop reuse; reuse exit 1 must survive the held collector's non-cap-failure refusal; and output remains `acceptance: false`/`fVerified: false` even when timing passes.

The six explicit-stub tests exercise wrapper control flow only. They do not prove image bytes, a browser launch, real proc files, prepared-player identity, PCM, or F timing. Those remain obligations of the new frozen cold/reuse record. Final helper review waits for Tesla's source to freeze.
