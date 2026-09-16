// Independent bounded attack against the running-kernel identity boundary.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { INPUT_BUFFER_NOTES_SHA256, assertInputKernelNotes } from "../../../tools/verify/omarchy-input-kernel-state.mjs";

const original = "a3f7f2a76799a72bbba6af0b4ad7fa6eee9313fa64f3e53f85105f399dfe5e0e";
const good = `${INPUT_BUFFER_NOTES_SHA256}  /sys/kernel/notes\n`;
const candidateFileMetadata = { size: 24208896,
  sha256: "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d" };
assert.equal(assertInputKernelNotes({ exit: 0, stdout: good, kernel: candidateFileMetadata }), INPUT_BUFFER_NOTES_SHA256);
const cases = [
  ["original executing kernel behind candidate metadata", { exit: 0, stdout: `${original}  /sys/kernel/notes\n`, kernel: candidateFileMetadata }],
  ["candidate and original lines", { exit: 0, stdout: `${good}${original}  /sys/kernel/notes\n` }],
  ["duplicate candidate lines", { exit: 0, stdout: good + good }],
  ["wrong sysfs path", { exit: 0, stdout: good.replace("/sys/kernel/notes", "/tmp/kernel-notes") }],
  ["failed shell command with candidate output", { exit: 1, stdout: good }],
  ["missing exit", { stdout: good }],
  ["empty output", { exit: 0, stdout: "" }],
  ["digest-only output", { exit: 0, stdout: INPUT_BUFFER_NOTES_SHA256 }],
  ["hash prefix", { exit: 0, stdout: "0" + good }],
  ["suffix payload", { exit: 0, stdout: good.trim() + " ignored\n" }],
  ["wrong single digest byte", { exit: 0, stdout: "0" + good.slice(1) }],
];
const attacks = cases.map(([name, response]) => {
  let error;
  try { assertInputKernelNotes(response); } catch (caught) { error = String(caught); }
  assert.ok(error, `identity mismatch accepted: ${name}`);
  return { name, rejected: true, error };
});
const source = await fs.readFile(new URL("../../../tools/verify/omarchy-input-kernel-state.mjs", import.meta.url));
console.log(JSON.stringify({ purpose: "running-kernel-identity-mismatch", positiveAccepted: true,
  sourceSha256: createHash("sha256").update(source).digest("hex"), attacks }, null, 2));
