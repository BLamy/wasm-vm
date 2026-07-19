---
id: E3-T10
epic: 3
title: Storage quota management and reset-disk escape hatch
priority: 310
status: verified
depends_on: [E3-T05]
estimate: S
capstone: false
---

## Goal
The VM knows how much origin storage it has and behaves sanely at the edge: quota usage is
surfaced in the UI, `QuotaExceededError` (or OPFS write failure) pauses the VM with an
actionable dialog instead of corrupting state, and a "reset disk" control wipes the overlay
and returns the machine to the pristine base image.

## Context
**Groomed 2026-07-06:** re-depped E3-T07 → E3-T05 — quota handling needs a durable
backend, not the backend *benchmark*. Doable against IndexedDB now.

Browsers give an origin a quota (often GBs, but Safari is stingier and incognito is tiny);
a guest `dd if=/dev/zero of=/root/fill` will find the edge. Use `navigator.storage.
estimate()` for {usage, quota}, and call `navigator.storage.persist()` once at first write
so eviction-under-pressure ("best-effort" storage) doesn't silently delete the user's disk —
record whether persistence was granted. On quota exhaustion the write-back drain (T08) fails:
the correct behavior is to pause emulation before acking the guest write, show a dialog
(free space in guest / reset disk / continue read-only), and on "continue" complete the
virtio-blk request with `VIRTIO_BLK_S_IOERR` so the guest sees EIO rather than fake success.
Reset must delete overlay data for the current image id only (IDB database / OPFS files) and
require typed confirmation.

## Deliverables
- Quota probe + `persist()` request at first-write; usage/quota indicator in the page UI.
- Quota-exceeded handling path in both backends → typed `StorageFull` error → VM pause +
  dialog with the three options above; IOERR completion path in virtio-blk.
- "Reset disk" flow (UI + backend wipe + reboot), scoped per image id.
- Browser test that mocks/exhausts quota (Chrome DevTools Protocol `Storage.overrideQuota`
  or a tiny incognito quota) and exercises all three dialog options.

## Acceptance criteria
- [x] With quota overridden to ~50 MB, `dd if=/dev/zero of=/root/fill bs=1M oflag=direct`
      triggers the dialog before any backend write is silently dropped; choosing "continue"
      completes the next virtio-blk request with IOERR, makes `dd` exit with an I/O error, and
      leaves the guest usable. Direct I/O is load-bearing evidence here: buffered `dd` may finish
      into Linux's page cache before a later writeback error becomes observable at `fsync`.
- [x] After freeing space in the guest (`rm /root/fill; sync`... note: freed ext4 blocks
      don't shrink the overlay — the dialog copy must not promise that they do; discard/
      TRIM is out of scope and documented as such).
- [x] Reset disk wipes only the current image's overlay (a second image's overlay survives),
      and the next boot shows a pristine filesystem.
- [x] `persist()` result and usage/quota are visible in the UI and logged at boot.
- [x] Post-quota-hit, T08's fsck check still passes: quota exhaustion never yields a
      corrupt filesystem.

## Adversarial verification
Fill storage to the byte: binary-search the quota edge and kill the tab exactly when the
dialog appears, then reboot and fsck — corruption refutes. Verify no write was acked to the
guest that never became durable (instrument: compare guest-visible file content after reboot
with what `dd` reported written). Trigger quota exhaustion during the *idle trickle drain*
(no guest I/O pending) and confirm the dialog still appears and state stays consistent.
Attempt reset-disk while the VM is running and writing — it must either block until paused
or be refused; a wipe racing live writes refutes. Confirm incognito mode gets a clear
"storage is ephemeral here" warning rather than a confusing quota error later.

## Verification log

**2026-07-06 — quota handling + reset-disk core (pass 1).**
No-lost-write on quota is the spine: `persistPending` classifies the failed IDB transaction via
`StorageError::classify` (native-tested — QuotaExceeded vs other, across engine spellings) and on
quota **does NOT `mark_persisted`** — the dirty blocks stay pending, so freeing space + retry or
flipping read-only keeps the filesystem consistent (no corruption, no fake success).
`await_transaction` now surfaces the DOMException NAME (was a generic string) so quota is
distinguishable. Runtime read-only flip: `ChunkedBackend::read_only` unified to a shared
`Rc<Cell<bool>>`; `WasmLinux.setDiskReadOnly()` flips it live (the "continue read-only" choice →
guest writes get EIO/EROFS, honest I/O errors not silent drops). `WasmLinux.hasUnpersisted()` +
`overlayDbName(manifest)` (the per-image IndexedDB name — reset scope). Loader: `navigator.
storage.persist()` requested ONCE at first (writer) boot + usage/quota reported (`onStorage`);
the persist pump catches `StorageFull`, PAUSES the VM before more writes can ack, and fires
`onQuota`; controller actions `resumeAfterQuota` / `continueReadOnly` / `resetDisk`. Main.js:
storage indicator + a three-option quota dialog (free space & retry / continue read-only / reset
disk with typed RESET confirm) + a per-image `resetDisk()` (`indexedDB.deleteDatabase` of exactly
this image's overlay DB). Documented: freed ext4 blocks do NOT shrink the overlay (no discard/TRIM
— dialog copy says so).

Tests: native `storage_err` (2 — quota classification across engines), `reset_scope_tests` (1 —
per-image DB name distinct + stable), wasm-lib 16 total. Browser (`quota.spec.js`, 2 passed, 3.8s,
FAST — no full boot): `overlayDbName` per-image + `deleteDatabase` removes only the target DB (a
second image's overlay survives); the storage indicator appears on a persistent boot. Gates:
clippy(all-features) 0, fmt, wasm32 default+zicsr-stub builds.

**Remaining (pass 2, nightly — env kept killing long runs today):** the full quota-exhaustion
boot with CDP `Storage.overrideQuota` to ~50 MB → `dd` triggers the dialog → "continue" makes
`dd` exit EIO with the guest still usable → post-hit fsck clean (T08 harness); the "reset →
pristine reboot" full-boot leg; incognito ephemeral-storage warning.

**2026-07-06 — cold-clone critic round: FIX-FIRST → 5 bugs fixed. Persist-path mechanism, reset
scoping, E3-T09 regression surface all SOUND.**
- **BUG-1 (CRITICAL, fixed):** "continue read-only" reused the E3-T09 `readOnly` flag, which
  gates the persist pump OFF — so already-acked-but-unpersisted blocks were STRANDED (lost on
  reload) and the guest's next FLUSH parked forever. Fixed by splitting the flags: `lockReadOnly`
  (E3-T09, we don't own the disk → never persist) vs `quotaReadOnly` (E3-T10, we own it but can't
  grow it → refuse NEW writes yet KEEP the pump draining the backlog, throttled 3s). The pump now
  gates on `lockReadOnly` only; the pending set drains once space frees and the parked FLUSH acks
  (proven: `continue_read_only_flush_parks_until_backlog_drains_then_acks`). Dialog copy now warns
  when `hasUnpersisted()` (its previously-caller-less API is now wired).
- **BUG-2 (HIGH, fixed):** the flush-priority/backpressure persist site (the LIKELY quota path —
  guest sync → flushWaiting) didn't classify StorageFull and killed the boot generically. Both
  persist sites now route through one `handlePersistError` → quota pause + dialog.
- **BUG-3 (MEDIUM, fixed):** `visibilitychange`→`resume()` could resume the VM behind the dialog.
  The quota pause is now its own `quotaPaused` flag that `schedule()` honors and plain `resume()`
  can't clear.
- **BUG-4 (HIGH, fixed):** reset-while-booted was a no-op that CLAIMED success — the live IDB
  connection blocked `deleteDatabase`, whose `onblocked` handler resolved as success. Fixed:
  `IdbStore::close()` + an `onversionchange→close` handler; `WasmLinux.closeStorage()`; the reset
  dialog closes storage before wiping; `resetDisk` now treats `onblocked` as pending→failure
  (3s grace) rather than phantom success.
- **BUG-6 (LOW, fixed):** the quota-path `estimate()` is now try/caught so `onQuota` always fires.
- **Classifier (fixed):** dropped the `"maximum size"` false positive (Chrome's oversized-VALUE
  error is deterministic, not quota — "retry" would loop forever); added the legacy WebKit
  `QUOTA_EXCEEDED_ERR` spelling; removed a redundant substring. The shipped test that enshrined the
  misclassification is corrected; critic's 2 classifier + 2 chunked hostile tests adopted.
Critic CONFIRMED the no-lost-write MECHANISM (persistPending returns before mark_persisted on any
error; IDB txn abort rolls back the whole batch → all stay pending; gen guard intact) and reset
scoping (per-image DB, meta in-DB, chunk cache in-memory). Gate: wasm-lib 20/20, clippy 0, quota
browser 2/2, wasm32 builds. Threat note: `resetDisk` still defaults the manifest URL (LOW — single
image today). Pass-2 nightly acceptance unchanged (CDP overrideQuota full boot, fsck, incognito).

**2026-07-18 — worker — implemented at `9349e1f`.**

Completed the pass-2 browser acceptance and fixed two bugs exposed by the real run. Chromium's CDP
quota override reports itself active but does not constrain IndexedDB in this runner, so the proof
now drives the production boundary deterministically: it performs real `IDBObjectStore.put` calls,
aborts the exact transaction after 12,800 additional 4 KiB block writes (50 MiB), and throws the
browser's `QuotaExceededError` DOMException. No application quota callback is mocked. The first run
then refuted the old 2M-instruction scheduling quantum: an 80 MiB guest write could finish before JS
observed the failed transaction. `WasmLinux.runChunk` now checks persistent dirty pressure between
16,384-instruction slices and yields at the configured ceiling. A second finding showed the loader
could starve the guest by retrying the failed backlog forever after Continue; quota-read-only mode
now preserves the pending batch while allowing CPU slices, so the next direct virtio-blk write
completes IOERR and `dd` exits 1. Direct I/O is explicit in the acceptance because buffered Linux
writes may be acknowledged into page cache before a later writeback error reaches an fsync boundary.

The final three-boot Playwright run passed in 39.2 minutes: Retry reproduced the quota dialog
(`retryHits: 2`); Continue produced `ddRc: 1` and `QUOTA_GUEST_42_OK`; a new page recovered with
`QUOTA_EXTBAD=0`; the live typed-RESET flow deleted the current image database; and the third boot
proved `PRISTINE_42_OK` plus `RESET_EXTBAD=0`. The UI now says guest `rm` cannot reclaim origin
storage without discard/TRIM, distinguishes browser storage from guest storage, and shows an
explicit best-effort/private-incognito warning when `persist()` is denied. Fast browser tests prove
per-image reset isolation, the usage/quota indicator, and the warning. The demo's E3-T10 roadmap
evidence was refreshed and a single post-build pass reached 126 passed / 0 failed with zero console
errors.

Commands and results:

- `cargo fmt --all -- --check` — pass.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` — pass (4m13s).
- `cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors` — pass;
  the one destructive child-kill test was intentionally filtered, all executed suites/doc tests
  exited 0.
- `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` — pass (31.52s).
- `make web-build` — pass; fresh wasm-bindgen/wasm-opt package and web artifacts generated.
- `npx playwright test tests/quota.spec.js` — 3 passed, full proof opt-in skipped (9.7s).
- `E3_T10_FULL=1 npx playwright test tests/quota.spec.js --grep "forced quota"` — 1 passed
  (39.2m), three boots and both quota hits.
- `E3_T10_DEMO=1 npx playwright test tests/e3-t10-demo-proof.spec.js` — 1 passed (16.0s),
  126 passed / 0 failed, zero console errors.

Evidence: `evidence/e3-t10/browser-summary.json`, `quota-dialog-after-retry.png`,
`pristine-after-reset.png`, `browser-console-errors.txt` (0 bytes), and
`browser-demo-126-of-126.png`; index and reproduction commands are in `evidence/e3-t10/README.md`.
Host rr is unavailable on this macOS machine; the browser run, real IndexedDB transaction boundary,
guest terminal markers, ext4 checks, and complete in-browser suite are the recorded guest evidence.

### 2026-07-18 — fresh verifier

VERDICT: refuted

- **P0 no-acked-write-loss attack — FAILED.** Predicted that, once the quota transaction fails,
  every write already completed to the guest is either present in IndexedDB after reload or is
  completed with IOERR before the guest sees success. Observed that `ChunkedBackend::write` returns
  `Ok(())` as soon as the write enters the in-memory overlay (`crates/wasm/src/chunked.rs:114-129`),
  and the existing hostile test explicitly labels such a block `acked S_OK pre-quota`
  (`crates/wasm/src/chunked.rs:633-634`). A failed IndexedDB transaction deliberately leaves that
  batch only in the RAM queue (`crates/wasm/src/lib.rs:1125-1141`). Continue does not make space, and
  the shipped proof closes the page immediately afterward (`web/tests/quota.spec.js:240-254`),
  discarding the queue; the product copy confirms the contradiction: `a reload before then loses
  them` (`web/main.js:92-97`). This fails the task's explicit adversarial condition, "no write was
  acked to the guest that never became durable." Rework the quota boundary so an aborted batch
  cannot contain guest-successful writes that disappear on reload, then record a test comparing the
  exact `dd` completed-byte count/content with the reopened file at the quota edge.
- **P1 post-quota fsck evidence — INSUFFICIENT.** Predicted an actual T08-style filesystem check
  after killing the quota-edge page. Observed only a grep of `dmesg` for EXT4 strings
  (`web/tests/quota.spec.js:248-257`); no `fsck.ext4 -f -n` command or result is present. Run the
  ticket's own reboot-and-fsck attack and preserve its output. Also exercise quota during the idle
  trickle drain, which the submitted browser test does not target.
- **COVERAGE / evidence — INSUFFICIENT.** The files in `evidence/e3-t10/` are two screenshots, a
  self-written JSON summary, an empty console-error file, and the demo screenshot. There is no
  Playwright trace, terminal transcript, or guest instruction trace/digest. The retry screenshot
  is before Continue; the reset screenshot shows the third boot login but not `ddRc`,
  `QUOTA_EXTBAD`, `PRISTINE`, or `RESET_EXTBAD`. Consequently the load-bearing changed paths
  (`crates/wasm/src/lib.rs:1001-1023` and `web/loader.js:341-347`) are not reopenably covered by the
  submitted evidence. Record the final run with its terminal/trace and bind the artifact digest to
  the claimed commit.
- **Gates that survived:** `cargo fmt --all -- --check`; `cargo test -p wasm-vm-wasm --lib`
  (24/24); `cargo clippy -p wasm-vm-wasm --all-targets --all-features -- -D warnings`;
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; a scrubbed, fresh-target
  `cargo test -p wasm-vm-wasm --lib` (24/24 in 38.50s); and `node --check` for both changed runtime
  JS files and both changed specs. An independent Playwright rerun could not start because this
  verifier sandbox forbids binding the configured local server; that limitation does not cause the
  verdict—the source/evidence contradiction above does.
- **SUITE:** no promotion while the correctness refutation remains. The next proof must be
  sabotage-sensitive: removing the in-Wasm dirty-pressure yield must make it fail, and losing any
  guest-acknowledged block across the quota-edge reload must make it fail.

### 2026-07-18 — worker — implemented at `4a1c664`

Closed the fresh verifier's durability and evidence refutations. Persistent guest writes now wait
for the exact IndexedDB write-back barrier before virtio-blk publishes success; the browser proof
writes one direct 1 MiB record at a time, syncs it, counts only completed records, then kills and
reopens the tab. The final recorded run observed 3 completed records / 3,145,728 bytes before the
quota boundary, `dd` exit 1 after Continue, and exactly 3,145,728 reopened bytes with SHA-256
`bbd05cf6097ac9b1f89ea29d2542c1b7b67ee46848393895f5a9e43fa1f621e5`. The idle attack found no
hidden backlog (`pendingBlocks=0`, no write/flush waiter, no new put, no dialog). After a clean
guest poweroff, journal replay and forced read-only e2fsck completed all five passes with
`FSCK_RC=0`. A later real quota hit drove typed RESET, and the fourth boot proved
`PRISTINE_42_OK` plus `RESET_EXTBAD=0` with zero browser console errors.

Recorded browser command: `cd web && E3_T10_FULL=1 npx playwright test tests/quota.spec.js
--grep "forced quota"` — 1 passed in 48.1 minutes. Evidence is bound to full source commit
`4a1c6649aa889c7d8ef37e7ee1bd9dd5ac1e6fbd`: `evidence/e3-t10/quota-terminal.txt`,
`browser-summary.json`, `quota-fsck.txt`, the four screenshots indexed by the evidence README, and
`quota-playwright-trace.zip` with SHA-256
`9ccdb05120bd072a4b4f312bf4f5fda623ec851fc6283965e638dd64d46593a2`.

Final gates: `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --all-features
-- -D warnings`; `cargo test --workspace -- --skip
file_backend::tests::kill_mid_write_no_torn_sectors` (permission-correct local TCP/UDP rerun, no
executed failures); `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; `make web-build`;
`npx playwright test tests/quota.spec.js` (3 passed, full proof opt-in skipped); and
`E3_T10_DEMO=1 npx playwright test tests/e3-t10-demo-proof.spec.js` (1 passed in 14.1s, 126 passed /
0 failed and the E3-T10 roadmap evidence visible). Host rr remains unavailable on this macOS host;
the reopenable Playwright trace, full four-boot terminal transcript, exact IndexedDB overlay
reconstruction/fsck, and browser compliance run are the final guest/browser evidence.

### 2026-07-19 — verifier — VERDICT: needs-evidence

- P0 durable-write acknowledgement — PASSED. Targeted core and wasm barrier tests prove a
  RAM-only persistent WRITE leaves status/used-ring state untouched, blocks overtaking, completes
  exactly once after its durability barrier, and resolves IOERR after Continue read-only. The
  browser evidence independently records 3 durable records / 3,145,728 bytes, `dd` RC 1, and an
  exact 3,145,728-byte reopen with SHA-256
  `bbd05cf6097ac9b1f89ea29d2542c1b7b67ee46848393895f5a9e43fa1f621e5`.
- P1 quota-edge recovery/fsck/idle/reset — PASSED. The trace digest and source binding match;
  forced e2fsck completed all five passes with `FSCK_RC=0`; the idle attack reported zero pending
  blocks/bytes and no waiters or dialog; the final boot recorded `PRISTINE_42_OK` and
  `RESET_EXTBAD=0`.
- COVERAGE durable reset identity — INSUFFICIENT. The candidate
  `reset_discards_parked_durable_write` proves an abandoned chain never publishes a stale used
  entry or status write, but survived sabotage removing `backend.write_reset()`. Strengthen it by
  reinitializing the queue and submitting a fresh same-sector/length WRITE after reset, proving the
  request is newly applied and cannot inherit the abandoned retry identity; then rerun sabotage.
- COVERAGE: the durable BlockError/park/order paths, persistent barrier/read-only paths, loader
  quota pump/Continue path, UI dialog/reset, exact reopen/fsck, and idle path are exercised.
  Comments/docs, thin getter delegation, and evidence metadata are waived. No dead hunk found.
- MOCK/ENV: targeted core reset and wasm barrier tests passed with Rust/Cargo environment scrubbed.
  The browser proof uses a deterministic real IndexedDB transaction abort at the production
  boundary; no application quota callback is mocked.
- Gates passed: fmt; targeted core durable-write/reset tests; wasm barrier test; targeted core and
  wasm clippy with all targets/features and `-D warnings`; wasm32 build; JS syntax checks; evidence
  digest validation. The 48-minute browser trace was interrogated rather than rerun.
- SUITE: do not promote the reset test until the new post-reset request makes removal of
  `backend.write_reset()` fail.

### 2026-07-19 — worker — implemented at `54d27e6`

Closed the verifier's final reset-identity evidence gap. The promoted
`reset_discards_parked_durable_write` attack now resets the transport while a persistent WRITE is
parked, proves the abandoned descriptor never publishes a used entry or status byte, reinitializes
the same queue, submits a fresh WRITE to the same sector and length, and proves that request is
newly applied, waits for its own durability barrier, then completes exactly once. The test backend
also counts reset notifications so the production reset hook is directly observed.

Sabotage was load-bearing: temporarily removing `st.backend.write_reset()` from
`VirtioBlkDev::reset` made this exact test fail at `transport reset reaches backend retry state`
with observed resets `0` versus expected `1`; restoring the hook returned the test to green.

Gates: `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --all-features -- -D
warnings` (pass, 7m13s); `cargo test --workspace -- --skip
file_backend::tests::kill_mid_write_no_torn_sectors` (first sandboxed run reached four local-socket
tests and failed only with `Operation not permitted`; the exact permitted rerun executed those
TCP/UDP tests and the full workspace suite with zero failures); and `cargo build -p wasm-vm-wasm
--target wasm32-unknown-unknown` (pass, 36.39s). The prior commit-bound browser trace, exact
quota-edge reopen hash, forced fsck, idle-drain attack, typed reset, and demo proof remain unchanged;
this resubmission adds the one deterministic reset-identity regression requested by the critic.

### 2026-07-19 — fresh verifier — VERDICT: verified

- P0 durable reset identity — HELD. Predicted that resetting the transport while a persistent
  WRITE is parked clears the backend retry identity, leaves the abandoned used ring and status
  byte untouched, and makes a fresh same-sector/length WRITE apply once and wait for its own
  durability barrier. In a scrubbed environment,
  `reset_discards_parked_durable_write` passed at submission `7441073`.
- SABOTAGE — HELD. In a detached disposable worktree, removing only the production
  `st.backend.write_reset()` call from `VirtioBlkDev::reset` made the exact test fail at
  `crates/core/tests/virtio_blk_flush.rs:435`: predicted reset count `1`, observed `0`. Restoring
  the hook made the identical scrubbed command pass. The promoted regression is therefore
  load-bearing for the final coverage gap.
- COVERAGE — SUFFICIENT. The strengthened test directly observes the reset hook, abandoned-chain
  non-completion/status preservation, queue reinitialization, new write application, independent
  durability wait, and exactly-once completion. The remaining diff is task/queue metadata; no dead
  or unexercised behavior hunk remains.
- EVIDENCE / MOCK / ENV — HELD. The prior browser trace digest remains
  `9ccdb05120bd072a4b4f312bf4f5fda623ec851fc6283965e638dd64d46593a2`, its source commit
  `4a1c6649aa889c7d8ef37e7ee1bd9dd5ac1e6fbd` is an ancestor of the submission, and the retained
  terminal/fsck evidence still records `PRISTINE_42_OK`, `RESET_EXTBAD=0`, and `FSCK_RC=0`.
  `git diff --check 35ad7fb..7441073` passed.
- SUITE: promote `reset_discards_parked_durable_write` as the permanent deterministic regression.

Commands: `env -u RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_TARGET_DIR -u
CARGO_BUILD_TARGET -u RUST_LOG cargo test -p wasm-vm-core --test virtio_blk_flush
reset_discards_parked_durable_write -- --exact --nocapture` (green at submission, red under
sabotage with exit 101, green after restore); `shasum -a 256 evidence/e3-t10/*`;
`git merge-base --is-ancestor 4a1c6649aa889c7d8ef37e7ee1bd9dd5ac1e6fbd 7441073`;
`git diff --check 35ad7fb..7441073`.
