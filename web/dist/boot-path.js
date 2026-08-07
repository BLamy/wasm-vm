// E4 restore-on-first-load: the pure boot-path decision + the base-image identity derivation.
//
// Kept dependency-free (no DOM, no wasm) so it is unit-testable under `node --test` and reusable by
// loader.js. The decision itself is deliberately tiny and total — every reload lands in exactly one
// of three outcomes and the browser never ends up in a broken half-restored state:
//
//   "user_snapshot"          the user has their OWN durable snapshot (E3-T12d) → prefer it
//   "boot_snapshot_restore"  no user snapshot, but a shipped build-time boot snapshot is COHERENT
//                            with this build → restore it instead of booting Linux
//   "cold_boot"              nothing coherent to restore → do the normal full boot
//
// The coherence verdict (`bootSnapshotDecision`) comes from the wasm guard
// (`restoreDecisionCode`): only "resume" is coherent. Any other code — "missing", "corrupt",
// "foreign_build" (a snapshot from an older build), "foreign_image" (a different kernel/initramfs),
// "stale" — must fall back to a real boot, so a stale shipped artifact is never blindly trusted.

/**
 * @param {object} s
 * @param {boolean} s.hasUserSnapshot        a valid, user-owned snapshot exists (persistent path)
 * @param {boolean} s.bootSnapshotAvailable  the manifest advertises a shipped boot snapshot
 * @param {string=} s.bootSnapshotDecision   the wasm coherence verdict for that boot snapshot
 * @returns {"user_snapshot"|"boot_snapshot_restore"|"cold_boot"}
 */
export function decideBootPath({ hasUserSnapshot, bootSnapshotAvailable, bootSnapshotDecision }) {
  if (hasUserSnapshot) return "user_snapshot";
  if (bootSnapshotAvailable && bootSnapshotDecision === "resume") return "boot_snapshot_restore";
  return "cold_boot";
}

/**
 * Derive the 32-byte coherence `base_image_hash` that binds a boot snapshot to a specific
 * kernel+initramfs pair. Both the browser (here) and the build-time producer
 * (tools/build-boot-snapshot.sh) compute it identically: SHA-256 of the UTF-8 bytes of
 * `"<kernelSha256>\n<initramfsSha256>"`, taken over the manifest's recorded artifact hashes. A
 * kernel or initramfs swap changes an input hash → a different base id → the guard's
 * `foreign_image` rejection.
 *
 * @param {string} kernelSha256      lowercase hex sha256 of the kernel Image
 * @param {string} initramfsSha256   lowercase hex sha256 of the initramfs
 * @param {Crypto=} subtleHost       optional { subtle } override for tests
 * @returns {Promise<Uint8Array>} 32 bytes
 */
export async function deriveBootSnapshotBaseId(kernelSha256, initramfsSha256, subtleHost) {
  const subtle = (subtleHost ?? globalThis.crypto).subtle;
  const material = new TextEncoder().encode(`${kernelSha256}\n${initramfsSha256}`);
  const digest = await subtle.digest("SHA-256", material);
  return new Uint8Array(digest);
}
