import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../../tools/verify/e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");

function ordered(section, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const next = section.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `${label}: missing/out-of-order ${needle}`);
    cursor = next;
  }
}

const dragStart = source.indexOf('phaseProgress("drag:prepare")');
const dragEnd = source.indexOf('phaseProgress("evidence:write")', dragStart);
assert.ok(dragStart >= 0 && dragEnd > dragStart, "drag orchestration boundaries missing");
const drag = source.slice(dragStart, dragEnd);
ordered(drag, [
  'phaseProgress("snapshot:drag-before")',
  'saveDesktopSnapshot({ persist: false })',
  'phaseProgress("snapshot:drag-held")',
  "await page.mouse.down()",
  'saveDesktopSnapshot({ persist: false })',
  'phaseProgress("snapshot:drag-moving")',
  "await page.mouse.move(dragEnd.x, dragEnd.y)",
  'saveDesktopSnapshot({ persist: true })',
  'phaseProgress("snapshot:drag-released")',
  "await page.mouse.up()",
  'saveDesktopSnapshot({ persist: false })',
  'reloadWithAutoRestore(restoreUrl, "drag")',
  'assert.equal(secondRestore.snapshotSha256, dragSnapshot.sha256',
  'assert.equal(secondRestore.observation.firstPresent.crc32, dragSnapshot.preFrontBufferCrc',
  'assert.deepEqual(afterDragState.pointer.heldButtons, []',
  'await auditRestoreCoherence(secondRestore, dragSnapshot, "drag")',
], "drag phases");

const normalStart = source.indexOf('const firstRestore = await reloadWithAutoRestore');
const normalEnd = source.indexOf('phaseProgress("drag:prepare")', normalStart);
assert.ok(normalStart >= 0 && normalEnd > normalStart, "normal restore boundaries missing");
const normal = source.slice(normalStart, normalEnd);
ordered(normal, [
  'assert.equal(firstRestore.observation.firstPresent.crc32, normalSnapshot.preFrontBufferCrc',
  'assert.equal(firstRestore.resume.restored, true',
  'firstRestore.bootStates.some(({ state }) => state === "booting")',
  "const postRestoreStart = firstRestore.completedAt",
  "await page.waitForTimeout(350)",
  "const postRestoreCursor = await waitForRestoredCursor(topPoint, postRestoreStart)",
  '"sh /tmp/a"',
  "postPcmAtCompletion.pcm?.nonSilentFrames > 0",
  "postAudioAfter.renderedFrames > postAudioBefore.renderedFrames",
  "postRestoreEnd - postRestoreStart <= 2_000",
  'await auditRestoreCoherence(firstRestore, normalSnapshot, "normal")',
], "normal restore and timed interaction");

const resultStart = source.indexOf("const result = {", dragEnd);
assert.ok(resultStart >= 0, "final evidence result missing");
const result = source.slice(resultStart);
for (const field of [
  "dragPhases:", "before:", "held:", "moving:", "released:",
  "postAudioCommand", "postRestoreAudioAfter", "postRestoreCursor",
  "postRestoreAudioRenderedFrameDelta", "postRestoreElapsedMeasuredMs",
]) {
  assert.ok(result.includes(field), `final evidence omits ${field}`);
}

console.log("harness-static-audit: OK");
