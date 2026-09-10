import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.join(here, "omarchy-desktop-live.mjs"), "utf8");

test("prewarm sync proof rejects cross-TTY marker evidence", () => {
  assert.ok(source.includes("history -c && clear && sync && printf"));
  assert.ok(source.includes("readGuestFileEventually(targetPage, markerFile, marker"));
  assert.ok(source.includes("rm -f -- '${markerFile}' && sync"));
  assert.ok(source.includes("clearAndHistoryProvenByMarker: false"));
  assert.doesNotMatch(source, /__omarchyLiveEvidence\?\.serial\.includes\(marker\)/u);
});

test("prewarm clear proof requires a new real frame and focused Foot", () => {
  assert.ok(source.includes("const afterMarkerPresentation = await presentationProof(targetPage)"));
  assert.ok(source.includes("waitForFreshPresentation("));
  assert.ok(source.includes("markerBaseline"));
  assert.ok(source.includes("framesReceived"));
  assert.ok(source.includes("x: 301, y: 201"));
  assert.ok(source.includes("clear frame is not focused Foot"));
  assert.ok(source.includes("assertCanvasFocus(targetPage, `${label}:frame`, keyboardUrl)"));
});

test("post-marker presentation helper rejects typing frames", () => {
  const result = spawnSync(process.execPath, [path.join(here, "omarchy-desktop-live.mjs"), "--selftest-presentation"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
