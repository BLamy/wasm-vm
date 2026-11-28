# E4-T40g verifier predictions (written before running anything or opening worker results)

Scope: diff 8b754ab38..a2087a72a in crates/ (dispatch.rs bit move, lib.rs memo touch, promoted tests).

- P1 turbo-equivalence: release CLI at HEAD, `tools/perf/turbo-equivalence.sh` prints EQUIVALENT with
  fnv64=eea93e63da8eb29b (E4-T40f's digest). Eviction order never affects architecture.
- P2 decoded-cache-equivalence: CACHE-INDEPENDENT, every run the same fnv64 as P1; block builds at
  4096 within 0.1 % of 25.73 M and at 16384 within 0.1 % of 5.80 M (E4-T40e level), 262144 ~271 k.
- P3 core tests: `cargo test -p wasm-vm-core --features trace` all pass, 0 ignored newly added by the diff;
  the promoted file contains the E4-T40f verifier's three integration tests unchanged in substance.
- P4 clippy core (--all-targets --features trace) and wasm32 lib clean; fmt clean.
- P5 bit on a block that left the cache: an evicted/flushed block is retired (live=false), so
  `successor_for` never returns it and no touch reaches it; a stale `referenced=true` on a retired block is
  unobservable because a retired block is never re-inserted into a slot (new blocks start false).
  Falsifier: any path that inserts an existing Rc (capacity change rehash, re-insert after flush) without
  resetting the bit.
- P6 two slots sharing one Rc: predicted impossible (each insert is a freshly decoded block); if it can
  happen, the shared bit changes victim choice vs per-slot bit, but cannot change architecture.
- P7 1-slot cache: `--decoded-cache-entries 1` digest equals the default (part of P2's runs); the scan
  with MAX_PROBE windows over mask 0 always returns slot 0 regardless of bit.
- P8 sabotage (scratch worktree): (a) removing the memo touch in enter_block raises 4096-slot builds back
  to ~36 M (acceptance discriminates the fix); (b) making the scan ignore the bit (always victim = start)
  keeps the digest but changes builds; (c) never clearing the bit in the scan keeps digest. Digest is
  insensitive to (a)-(c) — predicted, since only victim choice changes.
- P9 coverage: get_rc_touch touch, memo touch, scan's is_some_and with a resident block all execute in
  the native equivalence runs (cache full at 4096); the scan's None arm (empty slot in a full window) is
  predicted unreachable when the window is full of blocks -- or reached only for stale-generation slots.
- P10 browser: new (8125) click and node -e not slower than old (8134) beyond run-to-run noise (~5 %).
