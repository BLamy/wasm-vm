import assert from "node:assert/strict";
import test from "node:test";
import { expectedBlock, planThreadPatch } from "./omarchy-thread-candidate.mjs";

const data = Buffer.from("export GALLIUM_DRIVER=llvmpipe\nexport LP_NUM_THREADS=1\n");
const input = { pathname: "/home/omarchy/.config/uwsm/env", data,
  metadata: { size: data.length, blockCount: 8, physicalBlock: 2 } };

test("LP0 plan changes exactly the last digit and preserves its source buffer", () => {
  const patch = planThreadPatch(input);
  assert.equal(patch.absoluteOffset, 8192 + data.indexOf("LP_NUM_THREADS=1") + "LP_NUM_THREADS=1".length - 1);
  const result = expectedBlock(data, 8192, [patch]);
  assert.equal(result.changed, 1);
  assert.equal(result.bytes.toString(), data.toString().replace("LP_NUM_THREADS=1", "LP_NUM_THREADS=0"));
  assert.match(data.toString(), /LP_NUM_THREADS=1/u);
  assert.deepEqual(expectedBlock(data, 0, [patch]), { bytes: data, changed: 0 });
});

test("LP0 plan rejects duplicate values, undeclared files, allocation changes and wrong old bytes", () => {
  const doubled = Buffer.concat([data, data]);
  assert.throws(() => planThreadPatch({ ...input, data: doubled, metadata: { ...input.metadata, size: doubled.length } }), /exactly one/u);
  assert.throws(() => planThreadPatch({ ...input, pathname: "/etc/passwd" }), /undeclared/u);
  assert.throws(() => planThreadPatch({ ...input, metadata: { ...input.metadata, blockCount: 16 } }), /one ext4/u);
  const patch = planThreadPatch(input);
  const changed = Buffer.from(data); changed[patch.absoluteOffset - 8192] = 0x32;
  assert.throws(() => expectedBlock(changed, 8192, [patch]), /source byte/u);
});
