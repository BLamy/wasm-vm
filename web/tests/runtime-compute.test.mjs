import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(repositoryRoot, "web/bench-runtime-compute.mjs");

test("steady-state compute benchmark verifies fixed checksums and raw samples", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-runtime-compute-test-"));
  const outputPath = path.join(temporaryDirectory, "result.json");
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--environment=test-node",
        "--samples=2",
        "--warmups=1",
        `--output=${outputPath}`,
      ],
      { cwd: repositoryRoot, maxBuffer: 2 * 1024 * 1024 },
    );
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    assert.match(stdout, /COMPUTE_BENCHMARK_RESULT=/);
    assert.equal(result.schema, 1);
    assert.equal(result.kind, "node-steady-state-compute-benchmark-v1");
    assert.equal(result.status, "measured");
    assert.equal(result.environment.id, "test-node");
    assert.deepEqual(
      result.workloads.map((workload) => workload.id),
      ["integer-mix", "branch-mix", "memory-mix"],
    );
    assert.equal(result.fixture.iterations, 1_000_000);
    assert.equal(result.fixture.memoryWords, 16_384);
    assert.equal(result.fixture.memoryPasses, 32);
    assert.deepEqual(result.fixture.expectedChecksums, {
      "integer-mix": 1_986_867_034,
      "branch-mix": 2_619_934_272,
      "memory-mix": 2_070_041_300,
    });
    const expectedUnitLabels = {
      "integer-mix": "loop iterations",
      "branch-mix": "loop iterations",
      "memory-mix": "typed-array updates",
    };
    for (const workload of result.workloads) {
      assert.equal(workload.status, "measured", workload.id);
      assert.equal(workload.unitLabel, expectedUnitLabels[workload.id], workload.id);
      assert.equal(workload.workloadClass, "steady-state-compute", workload.id);
      assert.equal(
        workload.expectedChecksum,
        result.fixture.expectedChecksums[workload.id],
        workload.id,
      );
      assert.equal(workload.samples.length, 2, workload.id);
      assert.equal(workload.verification.passed, true, workload.id);
      assert.ok(workload.summary.medianMs >= 0, workload.id);
      assert.ok(workload.summary.p95Ms >= workload.summary.medianMs, workload.id);
      assert.ok(workload.summary.workUnitsPerSec > 0, workload.id);
      for (const sample of workload.samples) {
        assert.equal(sample.verification, "passed", workload.id);
        assert.equal(sample.checksum, workload.expectedChecksum, workload.id);
        assert.ok(sample.elapsedMs >= 0, workload.id);
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
