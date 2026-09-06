import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "./e5-t18e-publication.mjs";
import { DISPLAY_IMAGE_INPUTS, assertDisplayBindings } from "./e5-t22c-publication.mjs";

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
