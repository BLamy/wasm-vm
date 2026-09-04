// E5-T15d — shipped integration route identity and proof-contract guardrails.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("cursor integration route is copied byte-for-byte into the deployable dist", async () => {
  for (const relative of ["cursor-integration.html", "cursor-integration.js"]) {
    const source = await readFile(path.join(web, relative));
    const dist = await readFile(path.join(web, "dist", relative));
    assert.deepEqual(dist, source, `${relative} has stale deployable output`);
  }
});

test("integration route keeps an independent delayed-frame and 500 Hz workload contract", async () => {
  const source = await readFile(path.join(web, "cursor-integration.js"), "utf8");
  assert.match(source, /const MOVE_COUNT = 500;/);
  assert.match(source, /const MOVE_BATCH_SIZE = 3;/);
  assert.match(source, /const MOVE_PERIOD_MS = 6;/);
  assert.match(source, /const FRAME_DELAY_MS = 30;/);
  assert.match(source, /new PresentationController\(displayCanvas/);
  assert.match(source, /new CursorController\(/);
  assert.match(source, /layoutReads === 0/);
  assert.match(source, /transformWrites === MOVE_COUNT/);
});
