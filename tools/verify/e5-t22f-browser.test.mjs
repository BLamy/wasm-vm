import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { freezeEngineProof, proofEnvironment } from "./e5-t22f-browser.mjs";

test("engine acceptance owns profiler, image, output and demo controls", () => {
  const env = proofEnvironment({ PATH: "/trusted", E5_T22C_ITERATION: "0", E5_T22C_PROFILE: "1",
    E5_T22C_CPU_PROFILE: "1", E5_T22C_INTERACTIVE: "1", E5_T22C_CHUNKS: "/elsewhere", E5_T18E_DEMO_URL: "https://elsewhere" }, "/repo");
  assert.equal(env.E5_T22C_ITERATION, "1");
  for (const key of ["PROFILE", "CPU_PROFILE", "INTERACTIVE"]) assert.equal(env[`E5_T22C_${key}`], "0");
  assert.equal(env.E5_T22C_CHUNKS, "/repo/target/e5-t22f/chunks");
  assert.equal(env.E5_T18E_DEMO_URL, undefined);
  assert.equal(env.PATH, "/trusted");
});

test("frozen engine proof rejects dirty or staged imported runtime and fixture inputs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e5-t22f-freeze-"));
  const git = args => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  try {
    for (const file of ["tools/verify/e5-t22f-browser.mjs", "tools/verify/fixtures/e5-t22f-desktop.json",
      "web/dist/pkg/wasm_vm_wasm_bg.wasm", "web/dist/loader.js", "tests/shared/e5_t22f_pmp.rs", "tasks/epic-6/other.md"] ) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), "baseline\n");
    }
    git(["init", "-q"]); git(["add", "."]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "-qm", "fixture"]);
    const frozen = freezeEngineProof(dir);
    await writeFile(path.join(dir, "tasks/epic-6/other.md"), "unrelated\n");
    assert.deepEqual(freezeEngineProof(dir), frozen);
    for (const file of ["web/dist/loader.js", "tools/verify/fixtures/e5-t22f-desktop.json", "tests/shared/e5_t22f_pmp.rs"]) {
      await writeFile(path.join(dir, file), "changed\n");
      assert.throws(() => freezeEngineProof(dir), /differ from frozen HEAD/);
      git(["add", file]);
      assert.throws(() => freezeEngineProof(dir), /differ from frozen HEAD/);
      await writeFile(path.join(dir, file), "baseline\n"); git(["add", file]);
    }
    assert.deepEqual(freezeEngineProof(dir), frozen);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
