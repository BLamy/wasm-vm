// E5-T34e: admission for a warm RAM/device snapshot of a guest whose root disk is mounted
// read-only (the shared Replay desktop). Such a snapshot needs no overlay delta: the capture proved
// the image bytes unchanged (tools/build-replay-desktop-snapshot.sh), so the RAM image is coherent
// with the published base image alone.
//
// This is the JavaScript half of the binding. The wasm half is the snapshot's coherence header:
// `restoreSnapshotBuffer` refuses a blob whose core id (wasm build) or base id (chunk-manifest
// base hash) differs from the constructed machine, and `load_resume` refuses a device set that
// does not match the assembled topology. Here we refuse, before downloading anything, a snapshot
// declared for a different image, kernel, RAM size, command line, clock or device layout.
// A refusal is never an error: the caller cold-boots.
const HEX64 = /^[0-9a-f]{64}$/u;

export function readOnlyRootSnapshotMismatch(entry, expected) {
  if (!entry || typeof entry !== "object") return "missing";
  if (typeof entry.url !== "string" || entry.url === "") return "no_url";
  if (!HEX64.test(entry.sha256 ?? "") || !HEX64.test(entry.uncompressedSha256 ?? "")) return "no_digest";
  if (!Number.isSafeInteger(entry.size) || entry.size < 1
    || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1) return "no_size";
  const id = entry.identity;
  if (!id || typeof id !== "object") return "no_identity";
  if (id.readOnlyRoot !== true) return "not_read_only_root";
  if (id.deviceLayout !== "browser-topology") return "device_layout";
  const fields = [
    ["imageSha256", "image"],
    ["kernelSha256", "kernel"],
    ["ramMib", "ram"],
    ["bootargs", "bootargs"],
    ["guestClock", "clock"],
    ["icountDivider", "clock_divider"],
  ];
  for (const [key, reason] of fields) {
    if (id[key] !== expected?.[key]) return reason;
  }
  return null;
}
