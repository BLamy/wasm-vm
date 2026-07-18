---
id: E3-T10
epic: 3
title: Storage quota management and reset-disk escape hatch
priority: 310
status: in_progress
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
- [ ] With quota overridden to ~50 MB, `dd if=/dev/zero of=/root/fill bs=1M oflag=direct`
      triggers the dialog before any backend write is silently dropped; choosing "continue"
      completes the next virtio-blk request with IOERR, makes `dd` exit with an I/O error, and
      leaves the guest usable. Direct I/O is load-bearing evidence here: buffered `dd` may finish
      into Linux's page cache before a later writeback error becomes observable at `fsync`.
- [ ] After freeing space in the guest (`rm /root/fill; sync`... note: freed ext4 blocks
      don't shrink the overlay — the dialog copy must not promise that they do; discard/
      TRIM is out of scope and documented as such).
- [ ] Reset disk wipes only the current image's overlay (a second image's overlay survives),
      and the next boot shows a pristine filesystem.
- [ ] `persist()` result and usage/quota are visible in the UI and logged at boot.
- [ ] Post-quota-hit, T08's fsck check still passes: quota exhaustion never yields a
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
