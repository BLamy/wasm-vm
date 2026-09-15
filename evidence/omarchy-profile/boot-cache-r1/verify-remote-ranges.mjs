// Read-only exact-byte check after a large public R2 response stalled.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const manifest = JSON.parse(await fs.readFile("web/artifacts-omarchy.json", "utf8"));
const artifact = manifest.artifacts.bootSnapshot;
assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
const url = `https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/${artifact.sha256}/${artifact.url}`;
const report = { url, expected: artifact, ranges: [], status: "running" };
const deadline = Date.now() + 300_000;
const digest = createHash("sha256");
let etag;
try {
  for (let start = 0; start < artifact.size; start += 8 * 1024 * 1024) {
    const end = Math.min(start + 8 * 1024 * 1024, artifact.size) - 1;
    let bytes, failure;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        assert.ok(Date.now() < deadline, "overall range verification deadline");
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}`, ...(etag ? { "If-Match": etag } : {}) },
          signal: AbortSignal.timeout(Math.min(20_000, deadline - Date.now())),
        });
        if (response.status !== 206) {
          await response.body?.cancel();
          throw new Error(`range returned HTTP ${response.status}`);
        }
        assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${artifact.size}`);
        if (etag) assert.equal(response.headers.get("etag"), etag);
        else etag = response.headers.get("etag");
        assert.ok(etag, "strong object identity missing");
        bytes = new Uint8Array(await response.arrayBuffer());
        assert.equal(bytes.length, end - start + 1);
        report.ranges.push({ start, end, attempt, etag, bytes: bytes.length });
        break;
      } catch (error) { failure = error; }
    }
    if (!bytes) throw failure;
    digest.update(bytes);
    console.log(JSON.stringify({ verifiedBytes: end + 1, total: artifact.size }));
  }
  report.sha256 = digest.digest("hex");
  assert.equal(report.sha256, artifact.sha256);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error); process.exitCode = 1;
} finally {
  await fs.writeFile("evidence/omarchy-profile/boot-cache-r1/remote-range-verification.json", JSON.stringify(report, null, 2) + "\n");
}
