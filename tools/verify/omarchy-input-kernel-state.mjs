import assert from "node:assert/strict";

// AQ's independently verified kernel; uname/config alone cannot distinguish it.
export const INPUT_BUFFER_KERNEL = Object.freeze({ size: 24208896,
  sha256: "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d" });
export const INPUT_BUFFER_NOTES_SHA256 = "7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f";
export const INPUT_BUFFER_NOTES_COMMAND = "sha256sum /sys/kernel/notes";

export function assertInputKernelNotes(response) {
  assert.equal(response?.exit, 0, "running kernel notes were not readable");
  assert.match(response.stdout, new RegExp(`^${INPUT_BUFFER_NOTES_SHA256} +/sys/kernel/notes\\s*$`, "u"),
    "running kernel is not the verified input-buffer kernel");
  return INPUT_BUFFER_NOTES_SHA256;
}
