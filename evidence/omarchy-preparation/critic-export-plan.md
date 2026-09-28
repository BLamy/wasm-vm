# Omarchy image export — critic plan

Date: 2026-09-08
Role: Daybreak Blue critic sidecar
Scope: export consistency and public-image sanitization only. This is not emulator, browser, performance, or deployment proof.

## Verdict

**GO, crash-consistent only.** A QMP pause followed by an APFS copy-on-write clone is the smallest safe export path for this single-layer live qcow2, provided the clone operation fails closed and the VM is resumed in guaranteed cleanup. Without a successful guest `sync` or filesystem freeze, the result must not be called a clean filesystem snapshot.

Do not use `/bin/cp -c` when the contract forbids a long-copy fallback. The local macOS `cp(1)` page says `-c` falls back to `copyfile(2)` when cloning is unsupported or cross-filesystem. Use a minimal `clonefile(2)`/`clonefileat(2)` helper and treat `ENOTSUP`, `EXDEV`, `ENOSPC`, or any partial setup as failure. The local `clonefile(2)` page states that the call is copy-on-write and atomic: the destination is created completely or not created.

QEMU 11.1.1 does pause and flush more strongly than the QMP command description alone suggests. Its exact-version source pauses all vCPUs, drains all block requests, then calls `bdrv_flush_all()` before returning from `vm_stop()` ([`system/cpus.c`, lines 281–305](https://gitlab.com/qemu-project/qemu/-/blob/v11.1.1/system/cpus.c#L281-305)). The block-layer source distinguishes drain from persistence: drain waits for pending requests but does not itself flush data ([`block/io.c`, lines 438–448](https://gitlab.com/qemu-project/qemu/-/blob/v11.1.1/block/io.c#L438-448)); `vm_stop()` performs both.

There are two limits:

1. The STOP event is emitted before drain and flush. The clone may start only after the **QMP command reply**, followed by `query-status == paused`, not merely after observing STOP.
2. QEMU's `qmp_stop()` discards the return value from `vm_stop()` ([`monitor/qmp-cmds.c`, lines 50–63](https://gitlab.com/qemu-project/qemu/-/blob/v11.1.1/monitor/qmp-cmds.c#L50-63)). A successful QMP reply therefore does not prove that host persistence succeeded. It also cannot flush dirty data still resident in the guest kernel. Post-clone qcow2 and filesystem checks are mandatory, and the artifact remains crash-consistent.

`blockdev-backup` is not safer for this paused, backing-free, one-time local capture. It adds a target block node and asynchronous job lifecycle. It is the documented fallback when atomic cloning is unavailable: QEMU defines it as a point-in-time copy, and completion requires `BLOCK_JOB_COMPLETED` plus no remaining block job ([live block operations](https://www.qemu.org/docs/master/interop/live-block-operations.html#live-disk-backup-blockdev-backup-and-the-deprecated-drive-backup)). It does not make the guest filesystem clean.

## Observed pre-state

- Process PID 65248 is `/opt/homebrew/Cellar/qemu/11.1.1/bin/qemu-system-riscv64`; QMP reports 11.1.1 and `running`.
- Source is exactly `/Users/blamy/Virtual Machines/Omarchy-riscv/archriscv.qcow2`, held writable by that process.
- `virtio0` uses qcow2 node `#block128`, 32 GiB virtual size, no backing file, I/O status `ok`, cache `writeback:true`, `direct:false`, `no-flush:false`.
- No block jobs are active. Reported qcow2 state is `dirty-flag:false` and `corrupt:false`.
- The source and `/private/tmp` are on the same local data filesystem at review time, with about 1.2 TiB available. The export still must verify the source and destination-parent filesystem IDs immediately before cloning.
- Strict SSH failed because no host key was enrolled; no credential attempt was made. Do not weaken host-key checking to obtain a cleaner label.

## Required export sequence

1. Create a mode-0700 destination directory under `/private/tmp`. Destination clone path must not exist. Record source realpath, inode, size, QEMU PID/version, and destination-parent device ID.
2. Install unconditional cleanup **before** sending `stop`. Cleanup sends `cont` only if this run stopped the VM, then requires `query-status == running`. Preserve the primary error if resume also fails, but report both.
3. Recheck: VM `running`; source maps only to `virtio0`; I/O status `ok`; backing depth zero; dirty/corrupt false; `query-block-jobs == []`; source and target parent are on the same clone-capable filesystem.
4. Send QMP `stop`. Wait for its command reply, then require `query-status` to report `running:false,status:paused`. STOP-event receipt alone is insufficient.
5. Invoke `clonefile(2)` directly. No fallback byte copy. Require atomic success and a newly created regular file with the expected logical size. Recheck that QEMU remains alive and paused and that no block job appeared.
6. Run cleanup immediately: send `cont`, require command success, then require `query-status` to report `running:true,status:running`. A clone is not an acceptable result if the VM's restored state is unknown.
7. Make the frozen clone read-only and record its SHA-256 twice. Never repair, mount, convert in place, or use it as a sanitizer workspace.
8. With no process holding the clone, run read-only `qemu-img info` and `qemu-img check`. Convert the frozen qcow2 into a new raw file. Confirm logical equivalence with `qemu-img compare` and verify that the raw image is ext4 at byte zero, not a partitioned disk.
9. Preserve the first raw conversion as evidence. Make another copy for journal replay/filesystem repair. Run recovery only on that derived copy; a final read-only `e2fsck` must be clean before sanitization starts.

## Predictions fixed before future output

These predictions were written before inspecting any export or sanitized-image output.

- **E1 — pause boundary:** after the `stop` reply, `query-status` is exactly non-running/paused; the QEMU PID is unchanged; `query-block-jobs` remains empty. Any clone timestamp preceding the reply is a failure.
- **E2 — resume boundary:** every exit path after a successful stop ends with the same QEMU PID reporting running/running. A missing query, disconnected QMP socket, or merely sending `cont` without observing running is a failure.
- **E3 — clone shape:** the frozen image is qcow2, has virtual size 34,359,738,368 bytes, has no backing file, and is not dirty or corrupt. `qemu-img check` reports zero check errors and zero corruptions. The evidence clone's hash remains stable across all later work.
- **E4 — logical export:** qcow2-to-raw conversion produces a 34,359,738,368-byte logical disk; qcow2-vs-raw comparison finds no differing guest sectors. The raw image contains an ext4 superblock at byte zero and no partition-table dependency.
- **E5 — recovery isolation:** hashes prove the frozen qcow2 and first raw conversion do not change during recovery. The post-recovery working copy passes a read-only `e2fsck` with no uncorrected errors. Findings on the pre-recovery copy are permitted only as disclosed crash-recovery effects.
- **S1 — provenance closure:** every path in the publishable filesystem maps to either an exact package name/version with verified package metadata/content or one reviewed overlay-manifest entry. There are zero unexplained paths.
- **S2 — identity boundary:** final `/etc/passwd`, `/etc/group`, and `/etc/shadow` contain only required system identities and the deliberate demo identity; no personal username, UID mapping, imported password hash, or unlocked password exists. Root and demo passwords are locked if autologin is required.
- **S3 — state exclusion:** the fresh image contains no imported home/root history, SSH material, VCS credentials/config, browser profiles, desktop recent-file state, keyrings, cloud credentials, machine ID, random seed, DHCP lease, persistent network secret, host key, journal, core dump, or build/package cache.
- **S4 — byte-remanence boundary:** payload files are assembled into a newly created ext4 filesystem; no free-space block originates from the personal VM. A path-independent raw scan finds zero matches for approved synthetic canaries and known non-secret personal identifiers. Secret scanners emit only path/category/count metadata and never matching contents.
- **S5 — copy confinement:** no symlink, hardlink, special file, archive member, or path traversal writes outside the new filesystem staging root. Ownership, modes, ACLs, capabilities, hardlinks, and required symlinks match the provenance manifest. `/dev`, `/proc`, `/sys`, `/run`, and temporary trees contain only reviewed empty mount-point structure.
- **S6 — release identity:** final image, external kernel, initramfs, module tree, boot profile, and chunk manifest are mutually hash-bound. Passing these preparation predictions does not predict that the browser boots, renders Omarchy, meets restore/FPS targets, or is ready to deploy.

## Public-image sanitization boundary

The personal VM is acceptable as a package/content staging source, not as the publishable filesystem. Deleting files from a clone and zero-filling later is not sufficient: names and content can survive in free blocks, journal records, filesystem slack, caches, databases, and application state that was not recognized as sensitive.

Build a new ext4 filesystem from a zero-origin sparse file. Populate it only from:

- package archive contents or installed files whose content/metadata are verified against package provenance; and
- a small, human-reviewed overlay manifest for boot configuration and a reconstructed generic Omarchy demo profile.

Do not copy `/home`, `/root`, `/etc`, or `/var` wholesale. Package-owned paths are not automatically safe if their installed content is mutable; changed configuration must become an explicit overlay entry. Reconstruct the demo user's Omarchy/Hyprland/Quickshell configuration file-by-file. Omit caches, package build outputs, downloads, logs, histories, thumbnails, recent files, keyrings, SSH/GPG material, tokens, and personal app databases.

The sanitizer should mount source inputs read-only, run without network, refuse path escapes, and produce a provenance manifest before output admission. It may modify only derived recovery/staging images. Scanning the personal source broadly for credentials is outside scope; validate the final allowlisted output and exercise the scanner with synthetic fixtures/canaries.

## Exact red flags

- Calling the result clean, quiesced, or flush-verified without guest `sync`/freeze evidence.
- Treating STOP-event receipt or a successful `stop` reply as proof that `bdrv_flush_all()` returned success.
- Using `cp -c` while claiming clone failure is closed; its documented fallback violates that claim.
- Cloning before the `stop` reply and paused-state query, or resuming before clone completion.
- A cleanup path that does not independently verify running state, or leaves the VM paused after any clone/error path.
- Direct `qemu-img` access to the live source, `qemu-img -U`, hashing/mounting the moving source, or bypassing QEMU's lock.
- Any active block job, nonzero backing depth, I/O error, dirty/corrupt indication, PID/source-node drift, destination reuse, or insufficient clone/COW space.
- Repairing or mounting the frozen evidence clone, or running filesystem recovery on the only raw conversion.
- Sanitizing by denylist/deletion, copying personal home/root state, or accepting all of `/etc` or `/var` because it boots.
- Treating “package-owned” as proof of unchanged/safe content without package verification.
- Preserving machine identity, host keys, random seeds, network secrets, password hashes, authorized keys, histories, logs, keyrings, browser profiles, VCS/cloud credentials, crash dumps, swap, or caches.
- A scanner that prints secret values, scans unrelated host files, or reports green without a killed synthetic-canary fixture.
- Copy tooling that dereferences source symlinks, permits archive/path traversal, imports device nodes, loses file capabilities/ownership, or crosses the staging root.
- Publishing free blocks inherited from the personal source instead of constructing a fresh filesystem.
- Claiming image-preparation evidence proves browser boot, graphics/input/audio behavior, performance, manifest deployment, or production readiness.

## 2026-09-08 — bounded pre-live code review

Reviewed a line snapshot of `tools/image/capture-omarchy-vm.py` while the implementer was updating it concurrently. The source read for this section was the predecessor, but the subsequently measured SHA-256 `b5ee3ec88a2d4cc58d5b27a91ff9a9d9b1497f5869e45886e8307b1094b7de61` belongs to the updated file and therefore does not bind that earlier line snapshot. The findings are superseded by the current-version reassessment below. Static parse and `--help` passed. No QMP stop, clone, or VM mutation was executed by the critic.

**VERDICT: HOLD before live use.** The direct `fclonefileat()` primitive is correct and has no byte-copy fallback, but the current cleanup and identity checks do not yet make “VM state restored on every handled failure” defensible. The planned reconnect fallback is necessary but must cover ambiguous success and signals, not only an explicit `cont` error.

### Findings

- **C1 — restoration can be interrupted or lose the primary error (critical), lines 98–112.** `SIGINT`/`SIGTERM` may raise again while the `finally` block is sending or verifying `cont`, leaving the VM paused. A timeout/disconnect after `stop` can also poison the buffered QMP stream; using that same stream for `cont` is not a recovery path. Finally, any `cont`/status exception replaces the original clone/validation exception. Defer termination signals while restoring; preserve the primary and cleanup errors separately; on any ambiguous stop/cont result, reconnect with an absolute deadline, verify the same QEMU/disk, inspect status, send `cont` only when this run began with a running VM and the current state is paused, then require running/running. If `cont` was applied but its reply was lost, a reconnect observing running is success and must not issue a second command blindly.
- **C2 — initially paused skips the fresh drain/flush (high), lines 93–106.** When the initial state is paused, `resume` is false and `stop` is never sent. QEMU 11.1.1's `vm_stop()` drains and flushes even when already stopped; skipping it loses the exact consistency boundary this helper claims. Always issue `stop` and wait for its reply/status. Use the initial state only to decide whether cleanup must restore running or preserve paused.
- **C3 — disk/version health validation is incomplete (high), lines 21–28 and 49–66.** The QMP version is stored but never checked. Flattening `query-block` to `inserted` discards top-level `io-status`, so a failed/nospace disk can pass. The helper also omits explicit checks for `dirty-flag:false`, `ro:false`, `active:true`, the known 34,359,738,368-byte virtual size, and coherent `status`/`running` booleans. Missing fields must fail closed. Reconnect cleanup should repeat the identity subset before resuming.
- **C4 — source and destination descriptors are opened too late (high), lines 77–87 and 123–131.** QMP identifies a path string, while `fclonefileat()` clones whichever inode that path names when `os.open()` eventually runs after pause. `O_NOFOLLOW` blocks a final symlink but not regular-file replacement or parent-path replacement. Open and `fstat()` the source and destination directory before changing VM state, record device/inode/type/size, keep those descriptors through cloning, and compare the source descriptor with the known live-QEMU inode preflight. Recheck path-to-descriptor identity before the clone. The current observed source is device `16777229`, inode `30611896`, host file size `30311579648`; these are one-run preconditions, not permanent release identity.
- **C5 — another QMP client can resume or alter the block graph during the clone (high), lines 100–106.** One QMP connection is not an exclusive VM lease. Require an operational single-controller lock honored by the export tooling, repeat paused status immediately before and after the atomic clone, and discard the output if either check fails. A post-clone paused check detects some interference but cannot prove there was no transient resume; that remains an explicit operational precondition.
- **C6 — QMP calls have no total deadline (medium), lines 22–42.** The ten-second socket timeout is reset for each received event/unmatched message, so an event stream can extend a call and VM pause indefinitely. Use an absolute per-command deadline and reconnect after any timeout; Python buffered socket readers should not be reused after a timeout.
- **C7 — private-output and durability boundaries are weaker than the contract (medium), lines 88 and 123–145.** Any absolute owner-0700 directory is accepted, not specifically a child of `/private/tmp`. After cloning, the file is mode 0600, not frozen read-only; neither destination file nor directory is fsynced; only one hash is recorded. Enforce the `/private/tmp` containment/device boundary, open the result with `O_NOFOLLOW`, verify regular-file/device/size identity, `fsync` the file and directory, and freeze the evidence clone read-only after hashing. An interrupted metadata write must not make an incomplete directory look admissible.
- **C8 — close/final-report failures can obscure a safe capture (low), lines 44–46, 113–145.** `file.close()` can prevent `socket.close()` and can mask a prior capture failure. The extra post-cleanup `query-status` at line 113 can fail after restoration was already verified, dropping the result. Make close best-effort/non-masking and use the restoration routine's verified final status as the receipt.

### Required bounded tests before live use

The following are attacks on the existing boundary, not new product scope:

1. Running happy path: exact order is validate → status → stop reply → paused query → revalidate → atomic clone → paused query → cont → running query.
2. Clone exception and signal during clone: restoration runs and the original error remains visible.
3. Stop applied but reply lost: the old stream is abandoned; reconnect sees paused, resumes, and proves running.
4. Cont applied but reply lost: reconnect sees running and succeeds without blindly repeating `cont`.
5. Cont fails and reconnect initially sees paused: bounded retry restores running; a second signal cannot interrupt restoration.
6. Initially paused: a fresh `stop` reply still occurs, clone runs paused, and final state remains paused without `cont`.
7. Metadata fail-closed matrix: wrong QEMU version/path/node/virtual size, block job, backing file, `no-flush` missing/true, corrupt missing/true, dirty missing/true, read-only/inactive disk, and top-level I/O status failed/nospace all prevent stop and clone.
8. Source regular-file replacement between validation and clone is rejected by descriptor/inode checks; symlink and destination-exists cases leave no new output.
9. Event flood/unmatched IDs hits the absolute deadline and still restores through a fresh QMP connection.
10. `fclonefileat()` `EXDEV`, `ENOTSUP`, and `ENOSPC` produce no fallback copy, restore the VM, and leave no admissible capture receipt.

### Pre-live acceptance prediction

After the planned tests and reconnect work, the helper is admissible only if all handled failures either (a) prove the original running/running state restored, or (b) fail loudly with a distinct restoration emergency while preserving the original error. A successful run must bind the frozen clone to the pre-opened live source inode, exact QMP disk/version/size, stop reply, two paused observations surrounding the clone, and final running observation. The consistency label remains **crash-consistent**.

## 2026-09-08 — current helper and live-capture reassessment

Current helper SHA-256: `b5ee3ec88a2d4cc58d5b27a91ff9a9d9b1497f5869e45886e8307b1094b7de61`.
Current five-test SHA-256: `21422d7c03f688d5a034c84b27190dbbbaad7a0d1dad823fef431a4d0f894421`.
Command: `python3 -m unittest -v tools/image/test_capture_omarchy_vm.py` — five tests pass.

### Split verdict

- **Captured artifact: ACCEPTED as a private crash-consistent source.** This does not accept it as a publishable image.
- **Helper for another live capture: HOLD.** Successful-path checks improved, but handled failure restoration is still under-proven and the current tests bypass the production reconnect method.
- **Copy-only recovery bridge into ignored `target/`: GO with the conditions below.**

### Independent artifact checks

The critic read only the private copies; the live source was not opened with `qemu-img`, mounted, or hashed.

- Receipt `/private/tmp/omarchy-private-capture.ZkgTBj/capture.json` reports QEMU 11.1.1, source node `#block128`, 34,359,738,368 virtual bytes, before `running`, after `running`, pause duration 0.009428416 seconds, and the explicit consistency label `crash-consistent, guest buffers not captured`.
- The capture directory is owned by the user and mode 0700. Frozen qcow2 and first raw conversion are mode 0400; the separate recovery raw is mode 0600.
- The critic independently recomputed the frozen qcow2 SHA-256 as `6d292ee907d806f8914d6aa92f9797d925e8d5b9ac198ab8b6448edaf0303113`, exactly matching the receipt.
- Independent `qemu-img info --output=json` reports qcow2, 34,359,738,368 virtual bytes, no backing child, `dirty-flag:false`, `corrupt:false`, and lazy refcounts disabled.
- Independent `qemu-img check --output=json -f qcow2` reports `check-errors:0` and image end offset 30,311,579,648.
- Independent `qemu-img compare -f qcow2 -F raw private-source.qcow2 private-original.raw` exits zero with `Images are identical.`

Predictions E1–E4 hold for this captured artifact. E5 and all sanitization predictions remain future work. The successful run did not exercise reconnect, clone failure, signal-during-cleanup, or ambiguous-command paths.

### Current helper delta and remaining risks

The current source now pins QEMU 11.1.1 and checks top-level I/O status, no-flush, dirty, corrupt, block jobs, backing depth, and stable metadata. It performs post-clone paused and disk rechecks, restores the clone to mode 0400 before hashing, and verifies source/output filesystem equality. These close the successful-path portions of C3, C5, and C7.

The following remain before treating the helper as reusable:

- **R1 — the five tests do not test `Qmp.resume()` (high).** `FakeQmp` defines its own `resume()`, so every capture test bypasses lines 49–62 of production code. Add socket/protocol-level tests for stop-reply loss, cont-reply loss, reconnect while paused, reconnect already running, reconnect failure, and final status mismatch.
- **R2 — cleanup can still be interrupted and mask the primary failure (high).** Signal deferral is absent; a second `SIGINT`/`SIGTERM` during `qmp.resume()` can leave restoration unknown. A resume exception raised from `finally` still replaces the clone/validation exception. Preserve both and make restoration non-interruptible within a bounded deadline.
- **R3 — reconnect is not identity-bound or state-first (high).** The recovery connection is not version/disk validated and sends `cont` before querying status. In reviewed QEMU 11.1.1, repeating `cont` after a lost reply is effectively harmless when already running, but the helper's safety claim should not rely on that implicit behavior. Reconnect, verify the exact QEMU/disk, query status, then resume only paused state and require running/running.
- **R4 — initially paused still skips a fresh `stop` drain/flush (medium).** The test asserts only that paused remains paused; it does not assert a new `stop` reply. Always issue the reviewed stop boundary, then restore the original paused state by omitting `cont`.
- **R5 — descriptor/path race remains (medium).** Source and output directory descriptors are still opened after the VM is paused. Pre-open and retain them, record `fstat` device/inode/size/type, and bind the clone receipt to the source inode known to be held by QEMU.
- **R6 — remaining fail-closed fields and deadlines (medium).** Require exact virtual size, `ro:false`, `active:true`, coherent status/running booleans, and an absolute total deadline per QMP call. A stream of unrelated QMP events can currently refresh the socket timeout indefinitely.
- **R7 — durability/reporting (low).** File/directory `fsync`, a non-masking close, and atomic receipt creation remain absent. The actual capture's independent hash/check/compare mitigate artifact risk, but the helper should make them explicit for reuse.

### Copy-only recovery bridge

Docker/Colima cannot bind the private temporary directory in the current configuration. A second APFS clone into the repository is acceptable only as an isolated transport copy:

1. Source the clone from the read-only `/private/tmp/omarchy-private-capture.ZkgTBj/private-original.raw`, not from the writable `private-recovery.raw`.
2. Destination is a newly created owner-only mode-0700 directory under `target/omarchy-private-recovery/`; use direct `fclonefileat()` with no byte-copy fallback and require same device. `.gitignore` excludes `/target`, and `.dockerignore` excludes `target`; `git check-ignore` independently confirms the proposed path is ignored.
3. Keep the source raw and frozen qcow2 at mode 0400. The repository transport clone is the only object journal recovery or filesystem repair may modify. Record source and clone identities before recovery.
4. Bind only the recovery subdirectory into the tooling container, never the repository root or the private temporary directory. Run without network.
5. Run `e2fsck` recovery on the transport clone, then require a separate read-only check to exit clean. Duplicate-block, extent-tree, journal-checksum, unrecoverable inode, or unexpected `lost+found` recovery is a stop-and-review finding.
6. Mount only the recovered transport copy, read-only with journal loading disabled and `nodev,nosuid,noexec`; the sanitizer reads from that mount and writes a new filesystem. Do not publish or chunk any private/recovery input.
7. Recompute the frozen qcow2/first-raw identities after recovery to prove they remained untouched. Passing recovery remains image-preparation evidence only.

## 2026-09-08 — bounded assembler/sanitizer composition review

Reviewed snapshots:

- `tools/image/assemble-omarchy.py` SHA-256 `ea2c515533b795d99d08791e6ba798a2ece6fe0c4a270126194008b0f78cd577`
- `tools/image/sanitize-omarchy.py` SHA-256 `082d38034eb73d62f49beda4bd5008a95d208d29fd08e1af94e1d63a3a82bfef`
- assembler tests SHA-256 `b0cc897d2d3f8e7551207968e4b1c4fd87069c9a7900b5914117d6c3a55557b4`
- sanitizer tests SHA-256 `44ea4ab14adbbdbe62c00aa8bf925e8792e480b33723db328e85036aafd6b753`

The assembler changed during the review; the verdict below is bound only to the final hash above. Command `python3 -m unittest -v tools/image/test_assemble_omarchy.py tools/image/test_sanitize_omarchy.py` passes 20 tests on macOS with one skipped xattr test. No private VM tree or raw image was supplied to either script.

**VERDICT: HOLD — the intended package tree → sanitizer → reviewed overlay → fresh mkfs boundary is not yet consistently enforceable.** The allowlisted package planning is directionally sound and account reconstruction creates locked `root`, `nobody`, and `omarchy` entries, but two findings directly violate the stated trust boundary: the scripts do not authenticate their handoff, and an admitted absolute guest symlink can turn sanitizer post-processing into a host write outside the output tree.

### Fixed predictions and observations

- **A1 — raw-source separation: FAILED.** Predicted that the sanitizer would accept only a completed assembler output. The assembler requires and retains `.wasm-vm-omarchy-staging` and writes `etc/wasm-vm/omarchy-assembly.json` (assembler lines 30–33, 593–600, 706–723), while the sanitizer instead requires only `.wasm-vm-disposable-extracted-root` (sanitizer lines 29–30, 153–158) and never checks the assembler marker or provenance. Therefore an unmodified assembler output is rejected, while any other tree given the generic disposable marker is accepted—including a recovered raw tree if orchestration marks it. A pre-existing staging marker also cannot prove assembly completed, because it exists before the first copied file. Demand a distinct completion marker/receipt written last and atomically, require it plus validated assembly provenance in the sanitizer, consume/remove it in the public output, and never create the sanitizer-admission marker in a raw mount.
- **A2 — copy confinement: FAILED with a deterministic attack.** Predicted that all sanitizer writes would stay inside its sibling temporary output. The preflight interprets an absolute symlink as guest-root-relative (sanitizer lines 161–170), `_copy_tree` preserves the same absolute link (lines 294–333), and later `_remove_sshd_autostart` traverses ordinary host paths through it (lines 408–423). A synthetic marked source with `etc/systemd` pointing to an absolute temporary path passed preflight; sanitization returned success and created `system/sshd.service -> /dev/null` at that external path. Demand fd-relative destination operations that reject symlinks in every traversed component, or defer materializing absolute guest symlinks until all host-side mutations are complete. Add this exact regression attack. The assembler has the related weakness that `_absolute()` rejects only a symlink final component, not symlink ancestors (assembler lines 117–123), and its staging writes are path-based; source and staging roots need component-wise no-follow checks and private, descriptor-relative writes.
- **A3 — declared composition order: FAILED.** Predicted the exact flow package allowlist → sanitizer copy → reviewed overlay → fresh ext4. The only overlay argument belongs to the assembler and is incorporated before sanitization (assembler lines 292–330 and 726–739); the sanitizer has no post-sanitize overlay input, and the reviewed files contain no fresh-`mke2fs` admission step. This is package+overlay → sanitizer, not the stated order, and no code currently binds the final filesystem to the sanitizer output marker. Demand one orchestrated receipt that names the completed assembly digest, sanitizer digest, reviewed post-sanitize overlay digest, exact `mke2fs` input directory, and final image hash. `mke2fs` must consume only the marked public tree, never the recovered raw or assembler source.
- **A4 — ownership and metadata fidelity: NEEDS EVIDENCE.** The assembler applies package mode and numeric ownership, but silently skips ownership when not root (assembler lines 615–623); its parser does not retain mtree timestamps and package-database copies use `shutil.copyfile` only (lines 163–213 and 688–703). A passing macOS run can therefore produce host-owned staging content and does not prove the numeric metadata that `mke2fs -d` will encode. Require the real assembly/sanitize/mkfs path to run as root in the networkless Linux tool container, then compare final ext4 `uid:gid`, modes, symlink targets, and required directory structure against the manifest. Either make timestamps deterministic/preserved or explicitly exclude them from the release contract.
- **A5 — capabilities/xattrs: NEEDS EVIDENCE, fail-closed behavior otherwise HELD.** The assembler admits only `security.capability`, requires it in the reviewed overlay, and reapplies it; the sanitizer copies xattrs without dereferencing links. That is preferable to silently discarding capabilities. However the only xattr test was skipped on this macOS run, and no test proves a capability survives assembler → sanitizer → `mke2fs` → final ext4. Require a Linux-root synthetic capability fixture and inspect the freshly built ext4. Any source capability absent from the reviewed overlay should continue to fail closed.
- **A6 — account label consistency: FAILED narrowly.** `/etc/passwd`, `/etc/group`, and `/etc/shadow` are reconstructed with locked `root`, `nobody`, and `omarchy` entries (sanitizer lines 336–369), but `omarchy-sanitized.json` reports only `root` and `omarchy` (lines 443–456), and the test currently asserts this incomplete label. Correct the marker to describe all three reconstructed identities. The marker is provenance metadata only; acceptance still requires inspecting account files in the final ext4 and, after package `systemd-sysusers` runs, proving that newly created identities come only from package-owned sysusers definitions.

### Narrow acceptance conditions before fresh mkfs

1. Sanitizer refuses the recovered/raw root even if it has the generic disposable marker, and accepts only a completed, digest-bound assembler output.
2. The absolute-symlink regression produces no external path change and fails before public output admission.
3. The post-sanitize reviewed overlay is applied through the same no-follow, digest-bound writer; it cannot replace account, marker, or provenance files unless explicitly permitted by its schema.
4. A Linux-root run proves numeric ownership, modes, symlinks, and `security.capability` through the final fresh ext4. The macOS skipped xattr result is not evidence.
5. Fresh mkfs consumes only the final marked public tree; the receipt and command line contain no recovered-raw source path as a population input. The fresh filesystem contains no assembler authorization marker or disposable-root marker.
6. Final identity inspection shows locked `root`, `nobody`, and `omarchy`; all other identities are attributable to package-owned `systemd-sysusers` definitions. The sanitizer JSON is treated as a label, not whole-image privacy proof.

These findings do not change the earlier acceptance of the private crash-consistent export. They block only the public-tree composition claim; they do not assess emulator/browser readiness or deployment.

## 2026-09-08 — final sanitizer re-review after generated-parent fix

Current reviewed snapshots:

- assembler SHA-256 `c35c38889079a048a7b99a9c078e27846cc12b725f8b9ba5dd62e3d91b5d77f0`
- sanitizer SHA-256 `988a0fc77d64a175cbf8dffd77062704a8beb6ae0c7d9a3b05e6abcd9f76234b`
- assembler tests SHA-256 `d6e75cc9890c2c6fba0ce180210b24bfa773d206051ad7fcba21728f35f79baa`
- sanitizer tests SHA-256 `3f1c79ccc2201c222967a8bca6b279e9a7c305fa4465bd7f771d249603a95a6e`

**SANITIZER VERDICT: the concrete generated-parent escape is fixed for a static, privately owned assembler tree.** This supersedes A2's sanitizer-specific failure at the current hash; it does not clear A1/A3 or make a raw tree an admissible sanitizer input.

- **Generated-parent confinement — HELD.** Before output creation, `_preflight_source()` now requires all parents later traversed by generated account, systemd, marker, and runtime writes to be real directories (sanitizer lines 183–218). An independent synthetic matrix replaced each of the 11 listed parents with an absolute symlink. All 11 calls were refused, no public destination was created, and an external sentinel directory remained byte/name-identical. The original `etc/systemd` escape no longer creates an external `sshd.service`.
- **Generated-file symlinks — HELD.** Existing account files, the sanitizer metadata file, and the output marker are explicitly required to be regular files before copy (lines 212–218); the committed dangling-`etc/passwd` attack is refused without creating its host target.
- **Metadata order — HELD on Linux root.** `_preserve_metadata()` now performs `lchown`, then `copystat`, then xattrs (lines 285–303), so ownership restoration cannot permanently clear setuid/setgid or capabilities. A direct network-disabled Linux-root fixture retained mode `04755`. A valid synthetic `security.capability` xattr also survived the complete sanitizer copy byte-for-byte.
- **Sanitizer suite — HELD.** Every sanitizer test passes as root in the existing `wasm-vm-omarchy-image:local` container with `--network none`, including setuid and Linux xattr tests. The macOS combined suite passes 28 tests with three expected Linux/xattr skips.
- **Assembler parent conflict — HELD statically.** Before writing, `_write_plan()` rejects any plan entry whose admitted ancestor is a symlink (assembler lines 674–681), and `_ensure_parent()` rejects a symlink encountered while constructing a destination parent (lines 620–630). Source/staging root ancestor and concurrent-swap concerns from A2 remain separate operational/path-API concerns.

Two combined Linux-suite failures are harness defects, not surviving runtime refutations:

1. `test_linux_root_preserves_setuid_after_package_owner_restore` modifies the gzip-compressed mtree with a raw byte replacement, so the mtree remains `0755`; the observed `0755` output is correct for that unchanged manifest. The direct `_apply_metadata(..., 04755, 0, 0)` check passes. Rewrite the gzip text through `gzip.open()` before counting this test as evidence.
2. `test_assembles_only_verified_package_content_and_metadata` requires `usr/bin/demo` to appear in `metadata_mismatches`; that happens for a non-root macOS fixture but not when the same fixture is created as root. Make the mismatch deliberate and platform-independent, or assert only the actual reviewed metadata behavior.

Residual boundary: the no-external-write result assumes the assembler output is static during sanitization. Checks and writes remain pathname-based, so a same-UID concurrent process could swap a checked directory after preflight. Until descriptor-relative writes exist, require a mode-0700 staging parent, no concurrent writers, and immediate sanitize-after-assembly. This is not permission to pass the recovered raw tree directly.

Overall composition remains **HOLD** for A1/A3: the sanitizer still authenticates a generic disposable-root marker rather than a completed assembler receipt, and the reviewed scripts still place the overlay before sanitization with no digest-bound fresh-mkfs handoff. Those are composition defects, not regressions in the generated-parent fix.

## 2026-09-08 — frozen capture-helper final review

Reviewed frozen snapshots:

- `tools/image/capture-omarchy-vm.py` SHA-256 `479b11ea97cd3c8ecb06bf8960546ea33712f1a9d2fee5474f37d2676f2dc548`
- `tools/image/test_capture_omarchy_vm.py` SHA-256 `4800fd2a2635f07431207fda7cd27c50195a07a2e1bcafb4dfe3d950ff10b294`

No live QMP command, live-disk access, recapture, 30 GB hash, `qemu-img` check, conversion, or comparison was repeated. The prior independently checked private artifact remains **ACCEPTED as the same private crash-consistent source** with frozen qcow2 SHA-256 `6d292ee907d806f8914d6aa92f9797d925e8d5b9ac198ab8b6448edaf0303113`. This section judges only whether the new helper is safe and proven for a future capture.

**HELPER VERDICT: REFUTED / HOLD for reuse.** The 14 tests pass and materially improve R1–R7, but their QMP greeting is not protocol-realistic. The frozen helper would reject a real QEMU 11.1.1 greeting before it can validate or stop the VM. A second failure leaves a successfully created clone behind without freezing it when restoration fails.

### Predictions and observations

- **H1 — real QEMU 11.1.1 greeting is accepted: FAILED (critical).** `Qmp.__init__` stores `greeting["QMP"]["version"]` (lines 53–55), then `_require_version()` compares that whole object directly to `{major, minor, micro}` (lines 152–154). Real QMP wraps those numbers under `version.qemu` and includes `version.package`. An independent realistic socketpair greeting produced stored keys `package,qemu`; `_require_version()` rejected it. The test server instead emits the simplified non-QMP shape `{"version":{"major":11,"minor":1,"micro":1}}` (test line 83), so all 14 tests miss the failure. Parse and validate `version["qemu"]`, explicitly tolerate/record the package string, and add the realistic greeting as a constructor test. This fails before `stop`, so it cannot damage VM state, but the helper is not usable as claimed.
- **H2 — restoration failure leaves no admissible clone: FAILED (high).** A successful clone followed by `qmp.resume()` failure sets `restoration` but skips `_freeze_and_hash()` (lines 343–365). Cleanup unlinks only when `primary is not None` (lines 371–379); with restoration-only failure it raises at lines 380–381 and leaves the clone present, writable/unhashed and without a receipt. An independent synthetic run observed `clone_left_after_restoration_failure=True`. Unlink every created clone on any restoration failure or deferred interruption before returning; preserve both errors. If forensic retention is intentionally required, move it to a distinctly named mode-0400 quarantine artifact and never leave it at the success destination.
- **H3 — post-clone identity leaves the retained directory descriptor: NEEDS HARDENING (medium).** `fclonefileat` correctly writes relative to the pre-opened `directory_fd`, but post-clone `os.stat(destination)` (line 332), `_freeze_and_hash(destination, ...)` (lines 259–277, 358), and receipt temporary creation through `output / temp_name` (lines 392–407) return to pathname lookup. A same-UID rename/swap of the mode-0700 output directory can make the helper hash or write outside the directory that received the clone. Open/stat the clone by `destination.name` with `dir_fd=directory_fd`, require a distinct inode from the source, and use dirfd-relative receipt creation throughout. The private single-controller/mode-0700 precondition reduces likelihood but does not prove the descriptor-binding claim.
- **H4 — production APFS clone primitive: HELD by an independent safe fixture.** A `/private/tmp` tempfile invocation of the actual `clone_apfs()` produced equal initial bytes, a distinct inode, and copy-on-write independence after modifying the clone. No VM or real image was involved. Promote this bounded macOS test. The current capture tests substitute `os.link()` (test lines 141–143), which shares the source inode and cannot prove clonefile behavior; the helper should reject same-inode output so a hardlink implementation mistake can never make `_freeze_and_hash()` chmod/fsync/hash the live source.
- **H5 — reconnect restoration: HELD for the tested protocol paths.** Real `Qmp.resume()` is now exercised through socketpairs for paused recovery, already-running recovery, lost `stop` reply, lost `cont` reply, identity mismatch, and absolute event-flood deadline. State is queried before `cont`; already-running state does not receive a blind second `cont`; disk/version/source identity is rechecked; attempts share one bounded deadline. This closes the substance of prior R1, R3, and the deadline portion of R6 once H1's version parser is corrected.
- **H6 — successful-path safety: HELD with one operational precondition.** The helper pre-opens source/destination descriptors before stop, verifies source identity around the clone, issues a fresh stop even when initially paused, observes paused state on both sides of the clone, preserves primary plus restoration errors, defers termination signals while restoring, fsyncs/freeze-hashes twice, and atomically renames the receipt. The explicitly documented single-QMP-controller assumption remains necessary because QMP offers no exclusive lease.

### Test result and exact repair gate

`python3 -m unittest -v tools/image/test_capture_omarchy_vm.py` passes all 14 tests in 0.075 seconds. Passing the suite is insufficient until:

1. a realistic wrapped QMP greeting test passes and an incorrect wrapped version fails before stop;
2. restoration-only failure removes/quarantines the clone and leaves no success-path filename or receipt;
3. clone post-validation, freeze/hash, and receipt writes remain relative to retained directory descriptors and reject source/copy inode equality; and
4. the independent APFS tempfile clone test is promoted so the native primitive, distinct inode, and COW behavior remain covered.

Only these narrow helper/harness defects are raised. The unfinished assembler was not reviewed in this section, and the sanitizer's separately reported 16-test Linux result is carried as supplied rather than re-litigated here.

## 2026-09-09 — r3 assembly and sanitized-r1 composition review

Current code snapshots:

- assembler SHA-256 `1c7864ac9577f314f9ae408cf23db8c4ca7ee54c3e282b02447576a09892bab9`
- sanitizer SHA-256 `ca36e2537a968ca37185796fe656d9976748fdc7e5fa9c82f40a892bb1230aed`
- assembler tests SHA-256 `e2b371f15751cad7ecfa514359341366df415c10dab8e578dde298b1036360a9`
- sanitizer tests SHA-256 `3f1c79ccc2201c222967a8bca6b279e9a7c305fa4465bd7f771d249603a95a6e`
- reviewed source-overlay manifest SHA-256 `4d8ea0a83a70ccd3246724a3b246b3a137922c2110a92b3bf62a6424d2761314`

Inspection was read-only through Docker volume `wasm-vm-omarchy-prep-20260909` with `--network none`. No source VM, recovered raw filesystem, frozen qcow2, or original raw file was opened or hashed. No bulk public-tree content hash or secret scan was performed.

### Split verdict

- **Private captured artifact: ACCEPTED by carry-forward only.** Its earlier checked identity is unchanged by claim; the 30 GB checks were not rerun.
- **Capture helper reuse: still HOLD.** Its files remain byte-identical to the hashes in the prior section, so H1–H3 remain open; no helper work was re-litigated.
- **assembled-r2: REJECTED permanently for publication.** Its `excluded_paths` array disclosed omitted source path names. It was not used downstream: the sanitizer preserves assembly provenance byte-for-byte, and sanitized-r1 contains the redacted r3 provenance hash below, not r2's path-bearing document.
- **assembled-r3: ACCEPTED as the package-bound sanitizer input.** It is not itself public or boot proof.
- **sanitized-r1: NEEDS THREE NARROW FIXES before fresh mkfs.** Privacy-sensitive source path names are absent and the main copy boundary holds, but `/root` permissions, stale staging-marker removal, and account-label accuracy should be corrected before population of the final ext4.

### Held composition predictions

- **R3 provenance redaction — HELD.** `etc/wasm-vm/omarchy-assembly.json` has SHA-256 `85171469dc4302680f6a0df454c92e43dc64240b1c82443764cda901b81f32cb`, contains `excluded_path_count:228014`, and has no `excluded_paths` key. It records 56,633 admitted entries, 389 packages, installed size 2,619,608,941 bytes, zero metadata mismatches, the six reviewed overlay paths, and no source path. sanitized-r1 carries the identical assembly-document hash.
- **Completed handoff marker — HELD.** The assembler writes `.wasm-vm-disposable-extracted-root` only after plan copy, validated ALPM metadata, package database, and public provenance succeed (assembler lines 765–780). A synthetic late failure using `ALPM_DB_VERSION=8` returned refusal after partial staging, emitted no completion marker, and the sanitizer rejected that partial tree. assembled-r3 has the exact completion marker; sanitizer admission and full preflight pass. sanitized-r1 removes the input marker and emits the exact public marker.
- **Mtree escape decoding — HELD for the bounded attacks.** `lexer.escape=""` preserves mtree octal text until single-pass direct decode (assembler lines 171–234). The space-name fixture passes; an encoded-slash traversal was refused; `\\134040` decodes once to the literal filename text `\\040`, not a space or placeholder collision.
- **Package DB and mutable configuration boundary — HELD.** assembled-r3 contains exact `var/lib/pacman/local/ALPM_DB_VERSION` bytes `9\\n`. `locale.gen`, `pacman.conf`, `pacman.d/mirrorlist`, and `shells` are absent from r3 and present only in sanitized-r1 after fresh configuration generation. The source assembler therefore did not import those VM policy files.
- **Reviewed source overlays — HELD.** All six r3 payload SHA-256 values exactly match `omarchy-reviewed-source-overlays.json`; sanitized-r1 preserves the same six hashes. `gst-ptp-helper` retains `security.capability` base64 `AQAAAgAUAAAAAAAAAAAAAAAAAAA=`. This proves only those six reviewed installed-source deviations, not execution of the provisioning scripts.
- **Filesystem-object boundary — HELD.** r3 and sanitized-r1 contain zero block devices, character devices, FIFOs, or sockets. The count of setuid/setgid regular files remains 18 across sanitization. r3 has real generated-write parents and passes sanitizer preflight. sanitized-r1 contains real empty/runtime directories for `/dev`, `/proc`, `/sys`, `/run`, `/tmp`, `/var/tmp`, `/var/log`, and `/var/cache`; `/tmp` and `/var/tmp` are mode 01777.
- **Fresh identities — HELD in files.** sanitized-r1 contains exactly `root`, `nobody`, and `omarchy` in passwd/group; all three shadow values are locked; `/home/omarchy` is uid/gid 1000:1000. Package `systemd-sysusers` reconstruction remains a future boot observation, not part of this result.
- **Synthetic suite — HELD.** An independent rootful, network-disabled run passes all 45 capture, assembler, sanitizer, and package-selection tests. The repaired gzip setuid fixture now truly changes the decompressed mtree and passes on Linux.

### Required narrow fixes before mkfs

1. **`/root` mode is 0755.** The sanitizer recreates it through the generic directory loop without a restrictive chmod. Make `/root` mode 0700 and assert uid/gid 0:0. Although currently empty and root is locked, publishing a world-traversable root home weakens the identity boundary for later runtime files.
2. **The assembler authorization marker survives into public output.** sanitized-r1 still contains `.wasm-vm-omarchy-staging`. Drop it during sanitization; the public tree should contain only its public marker and retained non-authorization provenance.
3. **The sanitizer label omits an actual identity.** `omarchy-sanitized.json` reports accounts `["root","omarchy"]`, while passwd/group correctly contain `root`, `nobody`, and `omarchy`. Report all three or rename the field to state its narrower meaning. The JSON remains a label, not privacy proof.

### Receipt binding needed for the final image

The redacted assembly provenance intentionally contains overlay paths but not manifest or package-selection digests. Before mkfs, an external preparation receipt must bind at least:

- package selection SHA-256 `661f8f550e0cf223cae8602ccd46033a6195bc0816645182dc1ff4b0410f8e32` (389 packages);
- source-overlay manifest SHA-256 `4d8ea0a83a70ccd3246724a3b246b3a137922c2110a92b3bf62a6424d2761314`;
- r3/public assembly provenance SHA-256 `85171469dc4302680f6a0df454c92e43dc64240b1c82443764cda901b81f32cb`;
- package TSV SHA-256 `d5ffded6a15515582a5450b54d4bd6366615b628f6f054ac7b48bb3cf36260a5`;
- exact sanitizer/configuration script hashes and the final fresh-ext4 hash.

The four freshly generated configuration files were observed in sanitized-r1, but the in-progress generic configurator and image boot were deliberately not reviewed here. Nothing in this section marks the final ext4, emulator, desktop, browser, or production deployment as proven.

## 2026-09-09 — final capture-helper and candidate-r1 ext4 review

Reviewed snapshots and artifacts:

- capture helper SHA-256 `a2dba07f8163f0fe7571cb19deafefd258de3fcda13fe17b7c72163ee47ffdbf`
- capture tests SHA-256 `fdf75c98e9c354c957b407b4476a5c72c3dcbb1e26ceef85efd3dc8f2dbead50`
- candidate/release ext4 SHA-256 `99df926c5ae1f199d52b2ab13344839b45e8e848b4f28ba0e4c17e4f62071f2a`, size 4,294,967,296 bytes
- copied build receipt SHA-256 `e795848d4f0a6375658a3d50074cb1a26e9551a364506369177714b86b3290a8`
- copied command log SHA-256 `01ce2b5766624b724af81c9d8d2461f0aefb23d44294a604de9e600a5434367c`

The critic did not access the live VM, issue QMP commands, recapture, or rehash the 30 GiB private artifacts. The prior private capture remains accepted by carry-forward. Docker inspections used the existing network-disabled builder image and mounted the preparation volume read-only.

### Capture-helper superseding verdict

**ACCEPTED for future crash-consistent captures under the documented exact-QEMU and single-controller preconditions.** This supersedes the earlier H1-H3 hold at the two hashes above; it does not require or authorize recapturing the existing VM.

- **H1 wrapped QMP version — HELD.** `_require_version()` now validates `version.qemu` as exactly 11.1.1 while retaining the package string. A realistic wrapped greeting succeeds, and wrong/incomplete wrapped versions fail before commands.
- **H2 restoration-only cleanup — HELD.** Any exception after a clone enters dirfd-relative unlink/fsync cleanup; the restoration-only regression leaves neither clone nor receipt.
- **H3 retained-directory confinement — HELD.** Clone open/stat/freeze/double-hash and atomic receipt creation remain relative to the pre-opened directory descriptor. Directory-swap attacks preserve/hash only the retained clone and do not alter a replacement path. Same-inode hardlink output is rejected before chmod or hashing.
- **H4 native APFS primitive — HELD.** The promoted macOS fixture calls the real `fclonefileat` path in a private tempfile directory and proves equal initial bytes, distinct inodes, and independent copy-on-write bytes. It does not touch VM state.
- **Suite — HELD.** `python3 -m unittest -v tools/image/test_capture_omarchy_vm.py` passed all 25 tests in 0.086 seconds, including ambiguous stop/cont replies, absolute deadline, source replacement, signals, receipt failure, and initially paused state.

### Candidate-r1 split verdict

**PRIVACY AND FRESH-FILESYSTEM BOUNDARY: HELD. IDENTITY METADATA AND EXACT-BUILD RECEIPT: REFUTED; rebuild required.** Candidate-r1 must not be frozen as the final release image, but its two failures do not indicate personal-data leakage and do not invalidate the accepted r3 package assembly.

Held results:

- **Fresh ext4 and byte identity — HELD.** Independent hashes of `/work/candidate-r1/omarchy.ext4` and `releases/rootfs/omarchy.ext4` both equal the receipt's `99df926c...71f2a`; both are 4 GiB. The receipt and command-log copies exactly match their Docker-volume originals. `e2fsck -fn` exits zero with no filesystem errors, and `debugfs lsdel` reports zero deleted inodes. The ext4 label is `omarchy-demo`, block size is 4096, and the filesystem was populated by `mke2fs -d` from the fresh public tree rather than copied from the personal raw filesystem.
- **Private-state exclusions — HELD for the inspected boundary.** Machine ID is empty; `/var/lib/dbus/machine-id` is a symlink to `/etc/machine-id`; no SSH host keys, histories, demo-user `.ssh`, package keyring, Tailscale state, random seed, or persistent log entries were present. `/root/.ssh` and `/var/cache/private` are empty mode-0700 root-owned directories. Runtime directories are empty, `/tmp` and `/var/tmp` are 01777, `/root` is 0700, and the staging authorization marker is absent. The final public marker is a root-owned mode-0644 regular file with the exact v1 marker bytes.
- **Users, passwords, ownership, and capability — HELD except for the gshadow coherence failure below.** Passwd and shadow names match; all 26 user password fields are locked and UIDs are unique. Fixed identities are `root` 0:0, `nobody` 65534:65534, and `omarchy` 1000:1000; the sanitizer label lists all three. `/home/omarchy` is 0755 and 1000:1000. All existing gshadow entries are locked. `gst-ptp-helper` is root-owned mode 0755 and the final ext4 retains its 20-byte `security.capability` value.
- **GDK warning — NOT A FAILURE for this candidate.** The selected package tree contains zero `gdk-pixbuf` loader modules, so no loader cache is required. Conditional execution based on actual `*.so` module presence is the correct behavior; a future build with modules must run the command and treat cache-generation failure as fatal.

Blocking findings:

1. **I1 — group/gshadow coherence: FAILED.** Prediction: every final `/etc/group` name has a matching locked `/etc/gshadow` entry. Observation from the final ext4: group count 59, gshadow count 56, with exactly `root`, `nobody`, and `omarchy` missing. The candidate's own `grpck -r` reports all three missing and exits 2. The sanitizer writes these entries only when `gshadow` already exists; later `systemd-sysusers` creates entries only for newly generated package groups. Create the three fresh gshadow entries unconditionally before sysusers, then require a read-only `grpck` consistency check to pass on the final image. The unrelated `pwck -r` warnings about package service home directories are not privacy findings.
2. **B1 — receipt does not bind the code that executed: FAILED.** Prediction: the builder hash in the receipt identifies the builder behavior recorded in `commands`. Observation: candidate-r1's command log includes the old unconditional `gdk-pixbuf-query-loaders` invocation, but its `inputDigests.builder` equals the current conditionalized builder SHA-256 `854e81258be72adc6fbcfb496b900a32ce3a54aac84d2b1488ee628a9731d368`. The running Python process had already loaded the old code while the receipt hashed the edited file at the end. Compute/freeze all input digests before mutation, reject any end-of-run digest drift, and rebuild from the frozen version. This is an evidence-binding defect, not evidence that the candidate contains a GDK or privacy defect.

Non-blocking builder hardening: the selection and reviewed-overlay files are currently only hashed, not semantically compared with assembly provenance; the accepted r3 review supplies that external link for this run, but a reusable builder should validate it itself. Cleanup should also attempt every mounted pseudo-filesystem even if one unmount fails and explicitly prove no mount remains before `mke2fs`; candidate-r1's successful command log does show both `/proc` and `/dev` unmounted before population.

The supplied chunk round-trip and QEMU login observations are useful downstream evidence but were not rerun by this critic. The independently observed native JIT page-end load-access fault is a runtime/emulator issue, not an image privacy refutation. No result here proves DRM, desktop rendering, browser boot, performance, or production readiness.

## 2026-09-09 — pre-r3 review of I1/B1 repairs

Reviewed current snapshots only:

- sanitizer SHA-256 `a4f8c6d2cffa9214ef4153e2909965713b70b3deb6f30097dbeef7d42cb640dd`
- builder SHA-256 `8540e9035186c050e17a2715a8c808772be07a1e86957ff260c448a347ccd0bc`
- sanitizer tests SHA-256 `5e9d07bd9dac70ae71d92322129703db8a94cfca0d0dfef0a7bade1e36e58837`
- builder tests as inspected in `tools/image/test_build_omarchy_image.py`

All earlier held export, r3 assembly, sanitizer-confinement, privacy, fresh-filesystem, ownership, capability, and candidate-r1 byte-integrity results are carried forward without rerunning large work. Invalid image r2 was not opened or hashed. No r3 image existed for this review.

**PRE-R3 VERDICT: HOLD.** The direct sanitizer repair for I1 is correct, but the builder harness is stale and B1's exact-executed-code binding is not yet closed by the current ordering. Do not start the release r3 build from these hashes.

- **I1 sanitizer generation — HELD at source and synthetic regression.** `_sanitize_accounts()` now creates mode-0640 locked gshadow entries for `root`, `nobody`, and `omarchy` unconditionally, including when the assembled source lacks gshadow. `test_missing_source_gshadow_still_creates_all_fresh_groups` passes. The builder places `grpck -r` immediately after `systemd-sysusers`, so a future r3 will fail before mkfs if package-generated group/gshadow state is inconsistent. Final-image I1 remains `NEEDS EVIDENCE` until r3's own `grpck` command succeeds and the final ext4 independently shows equal group/gshadow names.
- **Semantic selection/overlay admission — HELD statically for the intended schema.** The builder compares the exact selected package-name/version map to assembly provenance and compares reviewed overlay entry paths to assembly overlay paths before output creation. This closes the earlier non-blocking semantic-link gap for a correctly shaped resolved selection document. The seed manifest `omarchy-browser-packages.json` is not that resolved document and has no `versions` field; r3 must pass the same resolved selection artifact used by the accepted assembly.
- **B1 drift checks — FAILED ordering (blocking).** The builder parses assembly, selection, and overlays at lines 49–56 and imports/executes the sanitizer module at line 60 before computing `frozen_digests` at line 70. A concurrent edit in either interval can leave a stable post-edit hash in the receipt while pre-edit parsed/imported behavior executes, reproducing r1's evidence mismatch. Read and hash immutable bytes first, parse those exact byte buffers, and import executable modules only from the frozen/read-only tooling snapshot. The builder's own already-imported code requires an operational immutable/read-only launcher or a pre-import wrapper if the receipt is to claim exact executed source. Preparation and post-mkfs drift comparisons are useful only after that initial ordering is sound.
- **Builder regression suite — FAILED (blocking harness gap).** `python3 -m unittest -v tools/image/test_build_omarchy_image.py tools/image/test_sanitize_omarchy.py` ran 25 tests: sanitizer tests passed with two expected platform skips, but builder tests produced one failure and four errors. `BuildGuardTests.setUp()` writes `{"files": []}` while the builder reads `reviewed["entries"]`; tests therefore fail with `KeyError: 'entries'` before exercising size, marker, setup cleanup, and valid-admission assertions. Update the fixture to the production schema and add direct mismatched package-version and overlay-path rejection cases.
- **Unmount cleanup — IMPROVED but not fully proven.** The builder now catches each unmount failure, continues through the retained `mounted` list, and refuses population if any listed path remains mounted. The existing test exercises cleanup after the second mount fails, but not two successful mounts followed by a first-unmount failure. Add that bounded case and assert both unmounts are attempted and no mkfs/receipt occurs. A signal between successful `mount` return and `mounted.append()` can still omit the mount from both cleanup and `ismount` checks; cleanup should inspect the fixed `/dev` and `/proc` mountpoints regardless of list bookkeeping. These are failure-path safety gaps, not evidence against candidate-r1 privacy.

The supplied QEMU-modern observation—Hyprland running with `/dev/dri/card0` and `renderD128` and zero failed units—belongs to downstream native transport/runtime evidence. It does not clear browser capture, production, or the separate native JIT cross-page fault, and neither runtime result changes this image-preparation verdict.

## 2026-09-09 — candidate-r3 final image-preparation verdict

Frozen artifact and evidence:

- `/work/candidate-r3/omarchy.ext4` and `releases/rootfs/omarchy.ext4`: 4,294,967,296 bytes, SHA-256 `bfcde69e5eeb2b5baba96a451f0671092b5973e8cc3a7f581722adf513651200`
- Docker and copied build receipt: SHA-256 `7c8e0de691c37961d2a2b5bb81977ca31f02e27fea713b2b028065b18e21e048`
- Docker and copied command log: SHA-256 `389966684e91342615525578944f94787e08357431657912a96962e2fb8a9e6f`
- sanitizer SHA-256 `a4f8c6d2cffa9214ef4153e2909965713b70b3deb6f30097dbeef7d42cb640dd`
- builder SHA-256 `8540e9035186c050e17a2715a8c808772be07a1e86957ff260c448a347ccd0bc`
- configurator SHA-256 `c2957d479f16154b2700ef4b8744b1ffca751d5706fd672629b9436215e424f2`
- builder tests SHA-256 `22fb2801f506f04856bc143b94de3f4c9a912af15e19bfce8581e49a85f893b8`

**VERDICT: VERIFIED for the candidate-r3 image-preparation claim.** All large, unchanged HELD results from the private export, accepted r3 package assembly, sanitizer confinement/privacy, fresh-zero-origin ext4 population, ownership/modes, capability preservation, empty runtime/state trees, locked identities, and public provenance are carried forward. Rejected r1/r2 images and chunks were not opened or rehashed. This verdict is ready to be applied to the worker's exact commit when that commit exists and verification-log/status writes are authorized; it does not itself change task or git state.

### I1 and final ext4 — HELD

- The missing-source-gshadow regression passes and the sanitizer unconditionally writes locked `root`, `nobody`, and `omarchy` gshadow entries before package sysusers reconstruction.
- Candidate-r3's logged `chroot ... /usr/bin/grpck -r` succeeded. An independent read-only rerun against the frozen population tree exits zero with no output.
- Files extracted independently from the final ext4 contain 59 group and 59 gshadow names with identical sets, no missing or extra names, and every gshadow password field locked. Passwd and shadow sets are also identical and every shadow password field is locked.
- `e2fsck -fn` independently exits zero; `debugfs lsdel` reports zero deleted inodes. The final image therefore closes candidate-r1's I1 failure without weakening its carried privacy results.

### B1 and receipt identity — HELD for this frozen run

- The receipt binds the accepted assembly `85171469...32cb`, package TSV `d5ffded...60a5`, resolved selection `661f8f...8e32`, reviewed overlays `4d8ea0...1314`, sanitizer `a4f8c6...40dd`, configurator `c2957d...24f2`, builder `8540e9...d0bc`, and generated demo overlay `8f714f...96e9`.
- Both internal input-drift gates completed before receipt admission. Current sanitizer, configurator, builder, and reviewed-overlay hashes match the receipt. Their source modification times precede candidate completion; the builder/sanitizer were last modified at 03:45:54/03:45:21 UTC-equivalent and the frozen image/receipt completed at 03:46:56/03:46:58 UTC. The worker additionally froze edits for the run.
- The 18-command receipt and copied log agree with current behavior: `grpck -r` is present immediately after sysusers, both `/proc` and `/dev` unmounts complete before mkfs, the inapplicable GDK loader command is absent, and e2fsck is the final external command. Unlike r1, there is no command/source-hash contradiction.
- Docker originals and local copies are byte-identical for image, receipt, and log. The first local stat overlapped the copy and observed a partial size, but the subsequent stable stat is exactly 4 GiB and two completed hashes—Docker and local—match; the partial observation is not an admitted artifact.

The builder still parses/imports some inputs before its initial digest calculation, so it is not generally race-proof against a deliberately timed same-UID writer. Preserve the operational frozen/read-only tooling precondition or move parse/import behind immutable byte snapshots in a future hardening change. This residual reusable-tool concern did not occur in r3 and is not an artifact refutation.

### Test verifier — HELD

- Focused macOS run: `python3 -m unittest -v tools/image/test_build_omarchy_image.py tools/image/test_sanitize_omarchy.py` passes 27 tests with two expected Linux-metadata skips.
- Independent network-disabled Linux-root run from a read-only checkout: `python3 -m unittest discover -v -s tools/image -p 'test_*.py'` passes all 88 tests with only the expected macOS APFS fixture skipped. This exercises Linux setuid and capability preservation, I1, both B1 drift gates, semantic package/overlay admission, two-mount cleanup, assembler/sanitizer confinement, capture-helper protocol attacks, selection closure, and image-verifier sabotage cases.

QEMU-modern reaching Hyprland with DRM nodes and zero failed units is downstream runtime evidence, not part of this image-preparation verdict. Browser desktop capture, chunk publication/deployment, production integrity, and the native JIT cross-page fault remain separate claims.

## 2026-09-09 — exact-commit task application

**VERDICT: VERIFIED for E5.5-T01a at frozen worker commit `ae16b4a3da07baa3a00a23f5a33930d4695365a4`.** The implementation commit is `7f453b8dfed8c49598cf6e6a89f9cf1d91aaf476`; `58eadc97fbbadcb3a00a3d1180feaa08345a986c` adds only builder guard tests, whose committed SHA-256 is `95c84cca17e500d3e5f31eff5a944d6f31937c5e0921c9d01ff4c40726f8145f`. Builder, sanitizer, configurator, accepted artifact and receipt hashes remain identical to the candidate-r3 verdict above.

The final pristine-clone portability prediction held. From `target/omarchy-cold.Mdavmf/repo` at exact commit `ae16b4a3`, a scrubbed macOS environment (`env -i` with only the required `PATH`/`TMPDIR`) passed all 88 image-tool tests with nine platform skips. A fresh `docker --rm --network none` Linux-root run with only the clone's `tools/image` mounted read-only passed all 88 tests with the expected single APFS skip. These are incremental exact-head proofs; no large image, capture or accepted privacy result was re-litigated.

The later metadata-only commit `6f3031b54725501fe38e86f1287f7bedf0affc84` adds the pending next ticket and queue metadata without changing this task's implementation boundary. E5.5-T01a may therefore transition from `implemented` to `verified`. This remains image-preparation verification only: the core boot repair, browser capture, publication and production claims stay in their own tasks.
