import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256 } from "./e5-t18e-publication.mjs";
import { DISPLAY_IMAGE_INPUTS, assertDisplayBindings, verifyFrozenRuntime } from "./e5-t22c-publication.mjs";

function fixture() {
  const sources = Object.fromEntries(DISPLAY_IMAGE_INPUTS.map(file => [file, sha256(file)]));
  const moduleSha256 = sha256("adapter ELF"), querySha256 = sha256("observer ELF"), westonConfigSha256 = sha256("configuration");
  const packages = Buffer.from("one-1.0-r0\ntwo-2.0-r0\n");
  const custom = Buffer.from([
    `${moduleSha256} 0755 /usr/lib/weston/wv-display-resize.so`,
    `${querySha256} 0755 /usr/local/bin/wv-display-query`,
    `${sources["tools/rootfs/desktop-test-console"]} 0755 /usr/local/sbin/desktop-test-console`,
    `${westonConfigSha256} 0644 /etc/xdg/weston/weston.ini`,
  ].join("\n") + "\n");
  const lock = { schema: "wasm-vm.e5-t22c.image-lock.v1", imageSha256: sha256("image"), chunkManifestSha256: sha256("chunks"),
    packageManifestSha256: sha256(packages), fileManifestSha256: sha256(custom), moduleSha256, querySha256, westonConfigSha256, sources };
  const info = { architecture: "riscv64", image: { sha256: lock.imageSha256, size: 1_073_741_824 },
    packageManifest: { sha256: lock.packageManifestSha256 }, fileManifest: { sha256: lock.fileManifestSha256 },
    startup: { boundedRecovery: true, inPlaceDisplayResize: true, backend: "drm", renderer: "pixman", autologinTty: "tty1", desktopUser: "desktop", seatdRunlevel: "default" } };
  return { lock, info, packages, custom, sourceDigests: { ...sources }, moduleSha256, querySha256 };
}

test("source, rebuilt ELF, installed custom files and image metadata all bind", () => assertDisplayBindings(fixture()));
test("an unchanged image cannot claim changed adapter source or compiled ELF", () => {
  for (const field of ["moduleSha256", "querySha256"]) {
    const input = fixture(); input[field] = sha256("stale build");
    assert.throws(() => assertDisplayBindings(input), /rebuilt .* ELF drift/);
  }
  const input = fixture(); input.sourceDigests[DISPLAY_IMAGE_INPUTS[0]] = sha256("new source");
  assert.throws(() => assertDisplayBindings(input), /image build source drift/);
  delete input.lock.sources[DISPLAY_IMAGE_INPUTS[0]];
  assert.throws(() => assertDisplayBindings(input), /complete source lock/);
});
test("wrong renderer, identity or architecture cannot pass a correct image hash", () => {
  for (const [key, value] of [["renderer", "gl"], ["backend", "headless"], ["desktopUser", "root"], ["inPlaceDisplayResize", false], ["boundedRecovery", false]]) {
    const input = fixture(); input.info.startup[key] = value;
    assert.throws(() => assertDisplayBindings(input), /startup .* drift/);
  }
  const input = fixture(); input.info.architecture = "x86_64";
  assert.throws(() => assertDisplayBindings(input));
});
test("self-consistent manifest hashes cannot omit or duplicate installed adapter", () => {
  for (const mutate of [text => text.slice(text.indexOf("\n") + 1), text => text + text.split("\n")[0] + "\n", text => text.replace("0755 /usr/lib/weston", "0644 /usr/lib/weston")]) {
    const input = fixture(); input.custom = Buffer.from(mutate(input.custom.toString()));
    input.lock.fileManifestSha256 = input.info.fileManifest.sha256 = sha256(input.custom);
    assert.throws(() => assertDisplayBindings(input), /installed .* binding/);
  }
});
test("modified package or custom bytes and mismatched image metadata are rejected", () => {
  for (const field of ["packages", "custom"]) {
    const input = fixture(); input[field] = Buffer.concat([input[field], Buffer.from("extra\n")]);
    assert.throws(() => assertDisplayBindings(input), /bytes drift/);
  }
  const input = fixture(); input.info.image.sha256 = sha256("different image");
  assert.throws(() => assertDisplayBindings(input), /image metadata drift/);
});

test("freeze detects stable dirty imported runtime and staged bytes, not unrelated task files", async () => {
  const repo=await mkdtemp(path.join(tmpdir(),"e5-t22c-freeze-"));
  const git=args=>execFileSync("git",args,{cwd:repo,stdio:"pipe"});
  try {
    git(["init","-q"]);
    for(const file of ["web/dist/src/sink/presentation.js","web/loader.js","web/artifacts-alpine.json","crates/core/src/lib.rs","tasks/unrelated.md"]){
      await mkdir(path.dirname(path.join(repo,file)),{recursive:true});await writeFile(path.join(repo,file),"original\n");
    }
    git(["add","."]);git(["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","fixture"]);
    const frozen=verifyFrozenRuntime(repo);
    await writeFile(path.join(repo,"tasks/unrelated.md"),"unrelated user change\n");assert.deepEqual(verifyFrozenRuntime(repo),frozen);
    for(const file of ["web/dist/src/sink/presentation.js","web/loader.js","web/artifacts-alpine.json","crates/core/src/lib.rs"]){
      await writeFile(path.join(repo,file),"dirty before recording\n");
      assert.throws(()=>verifyFrozenRuntime(repo),/differs from frozen HEAD/);
      git(["add",file]);assert.throws(()=>verifyFrozenRuntime(repo),/differs from frozen HEAD/);
      await writeFile(path.join(repo,file),"original\n");git(["add",file]);assert.deepEqual(verifyFrozenRuntime(repo),frozen);
    }
  } finally { await rm(repo,{recursive:true,force:true}); }
});
test("Make acceptance explicitly overrides inherited working-loop controls", async () => {
  const make=await readFile(new URL("../../Makefile",import.meta.url),"utf8");
  const target=make.split("\nverify-E5-T22c:\n")[1].split("\nverify-E5-T22e:")[0];
  const guest=target.split("\n").find(line=>line.endsWith(" node tools/verify/e5-t22c-guest-mode.mjs"));
  assert.ok(guest);
  for(const assignment of ["E5_T22C_ITERATION=0","E5_T22C_IMAGE_DIR=target/e5-t22c/acceptance-image","E5_T22C_CHUNKS=target/e5-t22c/chunks/acceptance","E5_T22C_TOOLS_OUT=target/e5-t22c/display-tools","E5_T22C_OUT=evidence/e5-t22c/acceptance"])
    assert.ok(guest.includes(assignment),`strict acceptance needs ${assignment}`);
});
