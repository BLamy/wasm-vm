import assert from "node:assert/strict";
import test from "node:test";
import { INPUT_BUFFER_NOTES_SHA256, assertInputKernelNotes } from "./omarchy-input-kernel-state.mjs";

test("running kernel fingerprint rejects old kernel, command echo and failed reads", () => {
  const valid = { exit: 0, stdout: `${INPUT_BUFFER_NOTES_SHA256}  /sys/kernel/notes\n` };
  assert.equal(assertInputKernelNotes(valid), INPUT_BUFFER_NOTES_SHA256);
  for (const response of [
    { ...valid, exit: 1 },
    { ...valid, stdout: "a3f7f2a76799a72bbba6af0b4ad7fa6eee9313fa64f3e53f85105f399dfe5e0e  /sys/kernel/notes\n" },
    { ...valid, stdout: `echo ${valid.stdout}` },
    { ...valid, stdout: valid.stdout.replace("/sys/kernel/notes", "/tmp/notes") },
  ]) assert.throws(() => assertInputKernelNotes(response));
});
