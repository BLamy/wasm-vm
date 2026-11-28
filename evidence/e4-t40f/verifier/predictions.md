# E4-T40f verifier predictions (written before running anything or opening worker result files)

Verifier session 2026-11-28. Written after reading the task file and `git diff bc9381144..HEAD -- crates/` only.

P1 (equivalence, turbo): rebuilding the release CLI from `bc9381144` myself and from HEAD, `tools/perf/turbo-equivalence.sh 2000000000`
   gives the same `trace fnv64` and state sha256 for both builds (and turbo == ordinary within each).
P2 (decoded-cache equivalence): `bash tools/perf/decoded-cache-equivalence.sh` at HEAD ends `CACHE-INDEPENDENT`, six identical digests.
P3 (gates): `cargo test -p wasm-vm-core --features trace` 0 failed; both clippy invocations clean.
P4 (every cache-leaving path marks not-live or bumps generation): every write that removes/replaces a `CacheSlot.block`
   or replaces `Machine.block_cache` either sets `live=false` or bumps `generation` (so `block_gen != current`). Any path that
   replaces `self.block_cache` without `retire_all` (restore, set_block_cache, reset, …) is a FAILED finding if a stale
   `prev_block` memo could then match generation 0 at the same phys.
P5 (SMC same page): a store into the successor's page between two entries flushes the page before the next `enter_block`
   (synchronously in the store path, or drained before the memo check); a test writing new code into the successor page
   via a *guest* store (not bus_mut) and via DMA observes the new code. Sabotage: removing `live.set(false)` in flush_page
   makes `successor_memo_…` and/or `successor_rewritten_by_a_store…` fail.
P6 (fence.i / sfence.vma / satp / PMP): each of these either flushes the whole cache (generation bump) or is irrelevant
   because the memo is keyed on the post-translation phys returned by `fetch_phys` (which still runs and checks PMP/X).
   A guest-level test remapping a VA to another physical page between two entries runs the new page's code.
P7 (1-slot cache): capacity 1 runs byte-identical (covered by decoded-cache-equivalence with 4096/16384/262144 only? —
   I predict the 1-slot case is exercised only by existing core tests; I will run one directly).
P8 (cache toggled off then on): `set_block_cache(false)` followed by guest stores to code and `set_block_cache(true)`
   does not let the memo replay stale code (either toggling flushes, or prev_block is cleared, or stores still flush pages).
P9 (JIT path): `enable_browser_jit` sets discovery on before `set_jit(true)`; the native CLI / Machine default keeps discovery
   on, so JIT tests that nominate still pass. No other in-repo reader of discovery stats on the browser without JIT
   would silently report zeros in a user-visible way that a test asserts.
P10 (memory): `successor` holds only `Weak`; `prev_block` is one strong `Rc`; no Rc cycle — a self-successor (block whose
   successor is itself) is Weak, so dropping cache + prev_block frees it (Rc::strong_count reaches 0).
P11 (own attack — duplicate live blocks for one phys): if `insert_rc_evicting` can place a second live block for the same
   phys in a different slot (e.g. after a probe miss on a shadowed slot), the memo might return the older one. I predict
   inserts for a given phys always go to the same slot (direct-mapped/hashed by phys), so the older block is evicted and
   marked not live; no duplicate can be returned.
P12 (browser): interleaved desktop-latency runs on 8125 (HEAD) vs 8133 (bc9381144) show click-result median lower on HEAD,
   key echo and idle not worse beyond noise; E5-T43f online/off/relay-down/sw passes on 8125.
P13 (coverage): every changed hunk in dispatch.rs/lib.rs/wasm lib.rs executes in at least one of: core tests, the turbo
   equivalence run, the browser run. `retire_all` executes via `set_block_cache_capacity` (decoded-cache-equivalence sets
   capacity).
