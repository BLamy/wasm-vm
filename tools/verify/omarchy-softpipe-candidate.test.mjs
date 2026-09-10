import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_SHA256,
  BASE_SIZE,
  DECLARED_FILES,
  NEW_VALUE,
  OLD_VALUE,
  assertPatchRangesWithinImage,
  compareBuffers,
  makePatchPlan,
  parsePhysicalBlock,
  planFilePatch,
  validateBase,
} from "./omarchy-softpipe-candidate.mjs";

const blockSize = 512;
const config = pathname => ({
  pathname,
  data: Buffer.from(`prefix ${OLD_VALUE.toString("ascii")} suffix\n`, "ascii"),
  metadata: { inode: pathname.includes("environment") ? 11 : 22, mode: "0100644", uid: 1000, gid: 1000,
    size: 0, blockCount: 1, physicalBlock: pathname.includes("environment") ? 2 : 4 },
});

function inspections() {
  return DECLARED_FILES.map(pathname => {
    const item = config(pathname);
    item.metadata.size = item.data.length;
    return item;
  });
}

test("plans exactly two bounded equal-length renderer substitutions", () => {
  const plan = makePatchPlan(inspections(), blockSize);
  assert.equal(plan.length, 2);
  assert.equal(OLD_VALUE.length, NEW_VALUE.length);
  assert.deepEqual(plan.map(item => item.length), [4, 4]);
  assert.deepEqual(plan.map(item => item.absoluteOffset), [2 * blockSize + 22, 4 * blockSize + 22]);
  assert.deepEqual(plan.map(item => item.writeAbsoluteOffset), [2 * blockSize + 7, 4 * blockSize + 7]);
  assert.equal(plan[0].writeOldHex, OLD_VALUE.toString("hex"));
  assert.equal(plan[0].writeNewHex, NEW_VALUE.toString("hex"));
  assert.equal(plan[0].oldHex, "6c6c766d");
  assert.equal(plan[0].newHex, "736f6674");
  assert.doesNotThrow(() => assertPatchRangesWithinImage(plan, 6 * blockSize));
  assert.throws(() => assertPatchRangesWithinImage(plan, 2 * blockSize), /outside the image/u);
});

test("parses the actual debugfs bmap bare-integer stdout strictly", () => {
  assert.equal(parsePhysicalBlock("9155\n"), 9155);
  assert.throws(() => parsePhysicalBlock("0: 9155\n"), /bare physical block number/u);
  assert.throws(() => parsePhysicalBlock("9155\n9156\n"), /bare physical block number/u);
});

test("stream-independent diff oracle accepts only the planned ranges", () => {
  const plan = makePatchPlan(inspections(), blockSize);
  const base = Buffer.alloc(6 * blockSize, 0x5a);
  const candidate = Buffer.from(base);
  for (const item of inspections()) {
    const patch = plan.find(value => value.path === item.pathname);
    const dataOffset = patch.writeAbsoluteOffset - patch.logicalOffset;
    base.set(item.data, dataOffset);
    candidate.set(item.data, dataOffset);
    candidate.set(NEW_VALUE, patch.writeAbsoluteOffset);
  }
  compareBuffers(base, candidate, plan);
  candidate[19] ^= 0xff;
  assert.throws(() => compareBuffers(base, candidate, plan), /outside the two declared byte ranges/u);
});

test("rejects an ambiguous renderer string", () => {
  const item = config(DECLARED_FILES[0]);
  item.data = Buffer.from(`${OLD_VALUE.toString("ascii")} ${OLD_VALUE.toString("ascii")}`, "ascii");
  item.metadata.size = item.data.length;
  assert.throws(() => planFilePatch({ ...item, blockSize }), /expected exactly one/u);
});

test("rejects multi-block or out-of-bounds allocation", () => {
  const item = config(DECLARED_FILES[0]);
  item.metadata.size = item.data.length;
  item.metadata.blockCount = 2;
  assert.throws(() => planFilePatch({ ...item, blockSize }), /multi-block/u);

  const oversized = config(DECLARED_FILES[0]);
  oversized.data = Buffer.concat([oversized.data, Buffer.alloc(blockSize)]);
  oversized.metadata.size = oversized.data.length;
  oversized.metadata.blockCount = 1;
  assert.throws(() => planFilePatch({ ...oversized, blockSize }), /one bounded data block/u);
});

test("rejects undeclared files, incomplete inspection sets, and a wrong base", () => {
  const item = config(DECLARED_FILES[0]);
  item.metadata.size = item.data.length;
  assert.throws(() => planFilePatch({ ...item, pathname: "/etc/passwd", blockSize }), /undeclared/u);
  assert.throws(() => makePatchPlan([item], blockSize), /exactly two/u);
  assert.throws(() => validateBase({ size: BASE_SIZE, sha256: "0".repeat(64) }), /verified SDR base/u);
  assert.doesNotThrow(() => validateBase({ size: BASE_SIZE, sha256: BASE_SHA256 }));
});
