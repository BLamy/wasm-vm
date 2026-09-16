import assert from "node:assert/strict";
import test from "node:test";
import { INPUT_BUFFER_PREPARED_IDENTITIES, INPUT_BUFFER_PREPARED_FOOT,
  assertInputKernelPreparedSource } from "./omarchy-input-kernel-response-state.mjs";
import { PREPARED_DIRECT_IDENTITIES, assertPreparedDirectSource,
  assertPreparedDirectProperties, requestPreparedDirectProperties } from "./omarchy-prepared-direct-state.mjs";

test("AS admits only verified AR bytes and leaves old AJ source guards intact", () => {
  const source = { ...structuredClone(INPUT_BUFFER_PREPARED_IDENTITIES),
    image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } };
  assertInputKernelPreparedSource(source);
  assert.throws(() => assertPreparedDirectSource(source));
  const aj = { ...structuredClone(PREPARED_DIRECT_IDENTITIES), image: source.image };
  assertPreparedDirectSource(aj); assert.throws(() => assertInputKernelPreparedSource(aj));
  for (const role of Object.keys(INPUT_BUFFER_PREPARED_IDENTITIES)) for (const field of ["size", "sha256"]) {
    const bad = structuredClone(source); bad[role][field] = field === "size" ? 0 : "0".repeat(64);
    assert.throws(() => assertInputKernelPreparedSource(bad));
  }
  const bad = structuredClone(source); bad.image.chunkSize *= 2;
  assert.throws(() => assertInputKernelPreparedSource(bad));
});

test("AR properties must name its exact restored Foot; the AJ default stays unchanged", async () => {
  const foot = { ...INPUT_BUFFER_PREPARED_FOOT, class: "foot", mapped: true, hidden: false,
    visible: true, acceptsInput: true, at: [12,38], size: [1256,750] };
  const response = changed => ({ exit: 0, stdout: ["true","true","1","1","1","true","true","true",
    JSON.stringify({ ...foot, ...changed })].join("\n") });
  assert.deepEqual(assertPreparedDirectProperties(response(), INPUT_BUFFER_PREPARED_FOOT), foot);
  assert.throws(() => assertPreparedDirectProperties(response()));
  for (const changed of [{ pid: 503 }, { address: "0x55555eb73630" }, { visible: false }, { size: [640,400] }])
    assert.throws(() => assertPreparedDirectProperties(response(changed), INPUT_BUFFER_PREPARED_FOOT));
  const report = {};
  await requestPreparedDirectProperties(async () => response(), Date.now()+1000, report, INPUT_BUFFER_PREPARED_FOOT);
  assert.equal(report.preparedDirect.status, "properties-confirmed");
  assert.deepEqual(report.preparedDirect.foot, foot);
});
