import test from "node:test";
import assert from "node:assert/strict";
import { hasOmarchyDesktopLayers, hasOmarchyShellBar, hasDesktopPixels } from "../omarchy-desktop-readiness.js";

const shellLayers = () => ({ screen: { levels: { 0: [
  { namespace: "omarchy-background", w: 1280, h: 800, pid: 525 },
], 2: [{ namespace: "omarchy-bar", w: 1280, h: 26, pid: 525 }] } } });
test("requires a mapped Omarchy bar and background, not a process or login banner", () => {
  for (const value of [null, {}, [], "Reached target Graphical Interface", { pid: 525 }]) {
    assert.equal(hasOmarchyDesktopLayers(value), false);
  }
  assert.equal(hasOmarchyDesktopLayers(shellLayers()), true);
  const zero = shellLayers(); zero.screen.levels[2][0].h = 0;
  assert.equal(hasOmarchyDesktopLayers(zero), false);
  const missing = shellLayers(); delete missing.screen.levels[2];
  assert.equal(hasOmarchyDesktopLayers(missing), false);
});
test("the demo readiness gate accepts the responsive profile's bar-only shell", () => {
  for (const value of [null, {}, [], "Reached target Graphical Interface", { pid: 525 }]) {
    assert.equal(hasOmarchyShellBar(value), false);
  }
  assert.equal(hasOmarchyShellBar(shellLayers()), true);
  const responsive = shellLayers(); delete responsive.screen.levels[0];
  assert.equal(hasOmarchyShellBar(responsive), true);
  assert.equal(hasOmarchyDesktopLayers(responsive), false, "the strict proof helper keeps requiring both layers");
  const backgroundOnly = shellLayers(); delete backgroundOnly.screen.levels[2];
  assert.equal(hasOmarchyShellBar(backgroundOnly), false);
  const foreignBar = shellLayers(); foreignBar.screen.levels[2][0].namespace = "waybar";
  assert.equal(hasOmarchyShellBar(foreignBar), false);
  const zero = shellLayers(); zero.screen.levels[2][0].w = 0;
  assert.equal(hasOmarchyShellBar(zero), false);
});
test("a black or solid framebuffer is not rendered desktop evidence", () => {
  const pixels = new Uint8Array(128 * 80 * 4);
  assert.equal(hasDesktopPixels(pixels), false);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([25, 25, 30, 255], i);
  assert.equal(hasDesktopPixels(pixels), false);
  for (let i = 0; i < pixels.length; i += 4) pixels[i] = 25 + ((i / 4) % 32);
  assert.equal(hasDesktopPixels(pixels), true);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  assert.equal(hasDesktopPixels(pixels), false);
});
