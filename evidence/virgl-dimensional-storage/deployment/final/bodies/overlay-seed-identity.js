/** Lowercase SHA-256 of the exact shipped RAM-snapshot + disk-delta identity pair. */
export async function deriveOverlaySeedIdentity(
  bootSnapshotSha256,
  overlayDeltaSha256,
  cryptoImpl = globalThis.crypto,
) {
  if (!/^[0-9a-f]{64}$/.test(bootSnapshotSha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(overlayDeltaSha256 ?? "")) {
    throw new Error("warm snapshot identity requires lowercase SHA-256 digests");
  }
  const bytes = new TextEncoder().encode(`${bootSnapshotSha256}:${overlayDeltaSha256}`);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
