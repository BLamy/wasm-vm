import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoExactLlvmPipeWorker,
  exactEnvironment,
  parseExpectedLpNumThreads,
  validateExpectedLpEnvironment,
} from "./omarchy-thread-setting.mjs";

test("T03g LP setting accepts only 0 or 1 and preserves unset behavior", () => {
  assert.equal(parseExpectedLpNumThreads(undefined), null);
  assert.equal(parseExpectedLpNumThreads(""), null);
  assert.equal(parseExpectedLpNumThreads("0"), "0");
  assert.equal(parseExpectedLpNumThreads("1"), "1");
  for (const value of ["2", "-1", "00", "llvmpipe", "0;touch /tmp/pwned"]) {
    assert.throws(() => parseExpectedLpNumThreads(value), /must be 0 or 1/u);
  }
});

test("T03g LP0 requires exact same-PID environment values and no exact worker", () => {
  const environment = "GALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=0\n";
  assert.deepEqual(validateExpectedLpEnvironment({ environment, threads: "Hyprland\ngmain\n", lpNumThreads: "0" }), {
    GALLIUM_DRIVER: "llvmpipe", LIBGL_ALWAYS_SOFTWARE: "1", LP_NUM_THREADS: "0",
    activeRendererValidated: false, configurationObserved: "lp0-configuration-observed",
  });
  for (const bad of [
    "GALLIUM_DRIVER=softpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=0\n",
    "GALLIUM_DRIVER=llvmpipe\nGALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=0\n",
    "GALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=0\nLP_NUM_THREADS=0\n",
  ]) assert.throws(() => validateExpectedLpEnvironment({ environment: bad, threads: "Hyprland\n", lpNumThreads: "0" }));
  assert.throws(() => validateExpectedLpEnvironment({ environment, threads: "Hyprland\nllvmpipe-0\n", lpNumThreads: "0" }), /exact llvmpipe-N/u);
});

test("T03g LP1 validates the setting but does not claim an active renderer", () => {
  assert.deepEqual(validateExpectedLpEnvironment({
    environment: "GALLIUM_DRIVER=llvmpipe\nLIBGL_ALWAYS_SOFTWARE=1\nLP_NUM_THREADS=1\n",
    threads: "Hyprland\nllvmpipe-1\n", lpNumThreads: "1",
  }).activeRendererValidated, false);
  assert.doesNotThrow(() => assertNoExactLlvmPipeWorker("Hyprland\nnot-llvmpipe-0-extra\n"));
});
