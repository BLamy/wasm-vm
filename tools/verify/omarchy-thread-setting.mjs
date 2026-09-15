#!/usr/bin/env node
// T03g harness-only validation for the explicit Mesa LP thread setting.
// This module never infers an active renderer from environment variables.

import assert from "node:assert/strict";

const LP_VALUE = /^(?:0|1)$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/u;

export function parseExpectedLpNumThreads(value) {
  if (value === undefined || value === null || value === "") return null;
  assert.match(value, LP_VALUE, "OMARCHY_EXPECT_LP_NUM_THREADS must be 0 or 1");
  return value;
}

export function exactEnvironment(output, expected) {
  assert.equal(typeof output, "string", "environment probe output must be text");
  const values = new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/u);
    if (!match) continue;
    assert.match(match[1], ENV_NAME);
    const list = values.get(match[1]) || [];
    list.push(match[2]); values.set(match[1], list);
  }
  const result = {};
  for (const [name, value] of Object.entries(expected)) {
    const list = values.get(name) || [];
    assert.equal(list.length, 1, `${name} is absent or duplicated`);
    assert.equal(list[0], value, `${name} does not match the requested value`);
    result[name] = list[0];
  }
  return result;
}

export function assertNoExactLlvmPipeWorker(threads) {
  assert.equal(typeof threads, "string", "thread probe output must be text");
  assert.equal(threads.split("\n").some((line) => /^\s*llvmpipe-[0-9]+\s*$/u.test(line)), false,
    "exact llvmpipe-N worker present");
}

export function validateExpectedLpEnvironment({ environment, threads, lpNumThreads }) {
  assert.match(lpNumThreads, LP_VALUE, "LP_NUM_THREADS expectation must be 0 or 1");
  const values = exactEnvironment(environment, {
    GALLIUM_DRIVER: "llvmpipe",
    LIBGL_ALWAYS_SOFTWARE: "1",
    LP_NUM_THREADS: lpNumThreads,
  });
  if (lpNumThreads === "0") assertNoExactLlvmPipeWorker(threads);
  return { ...values, activeRendererValidated: false, configurationObserved: `lp${lpNumThreads}-configuration-observed` };
}
