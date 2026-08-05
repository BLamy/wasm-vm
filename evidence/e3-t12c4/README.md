# E3-T12c4 — boot-level snapshot disk coherence (recorded on `ssh dev`)

Native Alpine ext4 boot: sync → `save_resume` snapshot → `--resume-from` restore into a fresh
process → fresh guest-computed command → clean `poweroff`, then external `fsck.ext4 -f -n`.

- **`alpine-transcript-run1-dev.log`** — full guest transcript. Process A boots Alpine, logs in,
  writes `/root/marker.txt` (`persist_42`), `sync`s, and prints the trigger → the CLI snapshots a
  60,075,407-byte blob and exits 0. Process B `--resume-from`s it against the SAME image:
  `resumed 60075407 bytes … continuing guest`, the resumed shell runs a fresh command (`RESUMED_9`),
  `cat /root/marker.txt` → `persist_42` (present exactly once — neither replayed nor lost), then
  `poweroff` → OpenRC unmounts + remounts read-only → `reboot: Power down` → `guest exited 0`.
  (This run's harness asserted a 300 s poweroff timeout that dev's loaded 2-core box exceeded; the
  cycle itself completed cleanly — the timeout was raised to 900 s and re-run below.)
- **`alpine-fsck-clean-run2-dev.log`** — the fixed harness, fully green:
  `fsck.ext4 -f -n` passes 1–5 clean (`root: 3561/32768 files … 49679/131072 blocks`) and
  `test alpine_sync_snapshot_restore_fsck_clean ... ok`.

Manual confirmation of run 1's image (before the harness re-run):
`fsck.ext4 -f -n /tmp/wvsnap-alpine.ext4` → all passes clean, exit 0.
