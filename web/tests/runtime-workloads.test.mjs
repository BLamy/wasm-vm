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
const scriptPath = path.join(repositoryRoot, "web/bench-runtime-workloads.mjs");

test("runtime workload benchmark produces verified raw samples", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-runtime-test-"));
  const outputPath = path.join(temporaryDirectory, "result.json");
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--environment=test-node",
        "--samples=2",
        "--warmups=1",
        "--payload-kib=64",
        "--stream-chunk-kib=8",
        "--http-requests=2",
        `--output=${outputPath}`,
      ],
      { cwd: repositoryRoot, maxBuffer: 2 * 1024 * 1024 },
    );
    const result = JSON.parse(await readFile(outputPath, "utf8"));
    assert.match(stdout, /RUNTIME_WORKLOAD_RESULT=/);
    assert.equal(result.schema, 1);
    assert.equal(result.kind, "node-system-workload-benchmark-v1");
    assert.equal(result.status, "measured");
    assert.equal(result.environment.id, "test-node");
    assert.equal(result.fixture.payloadBytes, 64 * 1024);
    assert.equal(result.fixture.httpBodyBytes, 64 * 1024);
    assert.deepEqual(
      result.workloads.map((workload) => workload.id),
      ["file-read", "file-write", "stream-read", "stream-copy", "server-lifecycle", "http-roundtrip"],
    );
    for (const workload of result.workloads) {
      assert.equal(workload.status, "measured", workload.id);
      assert.equal(workload.samples.length, 2, workload.id);
      assert.equal(workload.verification.passed, true, workload.id);
      assert.ok(workload.summary.medianMs >= 0, workload.id);
      assert.ok(workload.summary.p95Ms >= workload.summary.medianMs, workload.id);
      for (const sample of workload.samples) {
        assert.equal(sample.verification, "passed", workload.id);
        assert.ok(sample.elapsedMs >= 0, workload.id);
      }
    }
    const http = result.workloads.find((workload) => workload.id === "http-roundtrip");
    assert.equal(http.samples[0].requests, 2);
    assert.equal(http.samples[0].responseBytes, 2 * 64 * 1024);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
