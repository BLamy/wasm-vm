import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireSingleWriterLock,
  atomicReplaceJson,
  ensureJsonArtifact,
  readJson,
  writeJsonExclusiveAtomic,
} from "./helpers/e4-t32-node-ledger-store.mjs";

async function withTempDir(run) {
  const directory = await mkdtemp(join(tmpdir(), "e4-t32-ledger-store-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const injectedCrash = (wantedPhase) => async (phase) => {
  if (phase === wantedPhase) throw new Error(`simulated crash at ${phase}`);
};

async function killWriterAtPhase({ operation, targetPath, phase }) {
  const moduleUrl = new URL("./helpers/e4-t32-node-ledger-store.mjs", import.meta.url).href;
  const source = `
    import { ${operation} } from ${JSON.stringify(moduleUrl)};
    const value = { generation: 2, payload: "x".repeat(1024 * 1024) };
    await ${operation}(${JSON.stringify(targetPath)}, value, {
      onPhase: async (seen) => {
        if (seen !== ${JSON.stringify(phase)}) return;
        process.stdout.write("READY\\n");
        await new Promise(() => { setInterval(() => {}, 1_000); });
      },
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child did not reach ${phase}: ${stderr}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (!chunk.includes("READY")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`child exited before kill point: code=${code} signal=${signal}: ${stderr}`));
    });
  });
  const exit = once(child, "exit");
  assert.equal(child.kill("SIGKILL"), true);
  const [code, signal] = await exit;
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
}

test("kill-point seams never expose staged or truncated JSON", async () => {
  await withTempDir(async (directory) => {
    const indexPath = join(directory, "index.json");
    const oldIndex = { generation: 1, sessions: [{ id: "accepted-old" }] };
    const newIndex = {
      generation: 2,
      sessions: Array.from({ length: 2_000 }, (_, index) => ({
        id: `new-${index}`,
        payload: "x".repeat(128),
      })),
    };
    await atomicReplaceJson(indexPath, oldIndex);

    await assert.rejects(
      atomicReplaceJson(indexPath, newIndex, { onPhase: injectedCrash("temp-synced") }),
      /simulated crash/,
    );
    assert.deepEqual(await readJson(indexPath), oldIndex, "pre-publish crash must retain old index");

    const artifactPath = join(directory, "attempt.json");
    await assert.rejects(
      writeJsonExclusiveAtomic(artifactPath, newIndex, { onPhase: injectedCrash("temp-synced") }),
      /simulated crash/,
    );
    await assert.rejects(readJson(artifactPath), (error) => error.code === "ENOENT");

    await assert.rejects(
      writeJsonExclusiveAtomic(artifactPath, newIndex, { onPhase: injectedCrash("target-published") }),
      /simulated crash/,
    );
    assert.deepEqual(
      await readJson(artifactPath),
      newIndex,
      "post-publish crash may report uncertainty but cannot expose partial JSON",
    );
  });
});

test("real process kills leave the public name absent, old, or complete", async () => {
  await withTempDir(async (directory) => {
    const expected = { generation: 2, payload: "x".repeat(1024 * 1024) };
    const indexPath = join(directory, "index.json");
    await atomicReplaceJson(indexPath, { generation: 1, payload: "old" });
    await killWriterAtPhase({
      operation: "atomicReplaceJson",
      targetPath: indexPath,
      phase: "temp-synced",
    });
    assert.deepEqual(await readJson(indexPath), { generation: 1, payload: "old" });

    const artifactPath = join(directory, "attempt.json");
    await killWriterAtPhase({
      operation: "writeJsonExclusiveAtomic",
      targetPath: artifactPath,
      phase: "target-published",
    });
    assert.deepEqual(await readJson(artifactPath), expected);
    const healed = await ensureJsonArtifact(artifactPath, expected);
    assert.equal(healed.created, false);
  });
});

test("a preexisting valid artifact heals an uncertain publish idempotently", async () => {
  await withTempDir(async (directory) => {
    const artifactPath = join(directory, "attempt-0.json");
    const artifact = { attemptId: "a0", event: { ordinal: 0, outcome: "accepted" } };

    await assert.rejects(
      writeJsonExclusiveAtomic(artifactPath, artifact, {
        onPhase: injectedCrash("target-published"),
      }),
      /simulated crash/,
    );
    const healed = await ensureJsonArtifact(artifactPath, {
      event: { outcome: "accepted", ordinal: 0 },
      attemptId: "a0",
    });
    assert.equal(healed.created, false);
    assert.deepEqual(healed.value, artifact);
    assert.deepEqual(await readJson(artifactPath), artifact);
  });
});

test("artifact verification fails closed on mismatch and supports an explicit comparator", async () => {
  await withTempDir(async (directory) => {
    const artifactPath = join(directory, "attempt.json");
    const existing = { attemptId: "a0", recordedAt: 10, result: { exitCode: 0 } };
    await writeJsonExclusiveAtomic(artifactPath, existing);

    await assert.rejects(
      ensureJsonArtifact(artifactPath, { ...existing, result: { exitCode: 9 } }),
      (error) => error.code === "EARTIFACTMISMATCH" && error.actual.result.exitCode === 0,
    );
    assert.deepEqual(await readJson(artifactPath), existing, "mismatch must not replace evidence");

    const compared = await ensureJsonArtifact(
      artifactPath,
      { ...existing, recordedAt: 99 },
      (actual, expected) => actual.attemptId === expected.attemptId &&
        actual.result.exitCode === expected.result.exitCode,
    );
    assert.equal(compared.created, false);
    assert.deepEqual(compared.value, existing);
  });
});

test("exclusive publication admits exactly one writer and never overwrites it", async () => {
  await withTempDir(async (directory) => {
    const artifactPath = join(directory, "race.json");
    const candidates = [
      { writer: "left", payload: "l".repeat(32_768) },
      { writer: "right", payload: "r".repeat(32_768) },
    ];
    const outcomes = await Promise.allSettled(
      candidates.map((candidate) => writeJsonExclusiveAtomic(artifactPath, candidate)),
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.equal(rejected.reason.code, "EEXIST");
    const winner = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    const published = await readJson(artifactPath);
    assert.deepEqual(published, candidates[winner]);
  });
});

test("two live lock owners fail closed without disturbing the first writer", async () => {
  await withTempDir(async (directory) => {
    const lockPath = join(directory, "matrix.lock.json");
    const first = await acquireSingleWriterLock(lockPath, { pid: 101, runId: "first" });

    await assert.rejects(
      acquireSingleWriterLock(
        lockPath,
        { pid: 202, runId: "second" },
        { isProcessAlive: async (pid) => pid === 101 },
      ),
      (error) => error.code === "ELOCKED" && error.existingOwner.runId === "first",
    );
    assert.deepEqual(await readJson(lockPath), first.record);
    assert.equal(await first.release(), true);
    assert.equal(await first.release(), false, "successful release is idempotent on its handle");
  });
});

test("a stale owner is preserved and an old handle cannot release its replacement", async () => {
  await withTempDir(async (directory) => {
    const lockPath = join(directory, "matrix.lock.json");
    const first = await acquireSingleWriterLock(lockPath, { pid: 303, runId: "dead" });
    const second = await acquireSingleWriterLock(
      lockPath,
      { pid: 404, runId: "replacement" },
      { isProcessAlive: async (pid) => pid !== 303 },
    );

    assert.ok(second.recoveredLockPath?.startsWith(`${lockPath}.stale-`));
    assert.deepEqual(await readJson(second.recoveredLockPath), first.record);
    assert.deepEqual(await readJson(lockPath), second.record);
    await assert.rejects(
      first.release(),
      (error) => error.code === "ELOCKOWNERSHIP" && error.existingOwner.runId === "replacement",
    );
    assert.deepEqual(await readJson(lockPath), second.record, "old owner must not unlink replacement");
    assert.equal(await second.release(), true);
    await assert.rejects(readJson(lockPath), (error) => error.code === "ENOENT");

    const names = await readdir(directory);
    assert.ok(names.includes(second.recoveredLockPath.split("/").at(-1)));
    assert.ok(!names.some((name) => name.endsWith(".recovery")));
  });
});

test("an atomically replaced index remains parseable during concurrent updates", async () => {
  await withTempDir(async (directory) => {
    const indexPath = join(directory, "index.json");
    const candidates = Array.from({ length: 12 }, (_, generation) => ({
      generation,
      acceptedAttemptIds: Array.from({ length: generation + 1 }, (__, index) => `a-${index}`),
      padding: String(generation).repeat(16_384),
    }));
    await atomicReplaceJson(indexPath, candidates[0]);

    let writing = true;
    let reads = 0;
    const reader = (async () => {
      while (writing) {
        const index = await readJson(indexPath);
        assert.deepEqual(index, candidates[index.generation]);
        reads += 1;
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    await Promise.all(candidates.slice(1).map((candidate) => atomicReplaceJson(indexPath, candidate)));
    writing = false;
    await reader;
    assert.ok(reads > 0);
    const finalIndex = await readJson(indexPath);
    assert.deepEqual(finalIndex, candidates[finalIndex.generation]);

    const leftovers = (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

test("canonical artifact verification accepts noncanonical source formatting", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "pretty.json");
    await writeFile(path, '{\n  "z": 2,\n  "a": 1\n}\n', "utf8");
    const result = await ensureJsonArtifact(path, { a: 1, z: 2 });
    assert.equal(result.created, false);
    assert.deepEqual(result.value, { a: 1, z: 2 });
  });
});
