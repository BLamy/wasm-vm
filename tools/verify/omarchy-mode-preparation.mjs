// Offline candidate preparation only; no physical-input acceptance or release claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inputTrialOptions, assertInputTrialRuntime, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { requestSmallerScanout, assertGuestMode } from "./omarchy-render-mode.mjs";
import { requestCompositorMode } from "./omarchy-compositor-command.mjs";

export const MODE_PREPARATION_MS = 900000;
export const MODE_EXPORT_MS = 180000;
export function modePreparationOptions() {
  return { ...inputTrialOptions({ urlArg: "local", pair: "pinned", chunks: "pinned", arm: "candidate",
    renderer: null, lp: null, experiment: "residency" }),
    startupMs: MODE_PREPARATION_MS, captureMs: MODE_EXPORT_MS, purpose: "offline-mode-preparation-no-input" };
}

export function validatePreparedPair(snapshot, delta, manifestBytes, receipt) {
  const manifest = JSON.parse(manifestBytes), core = Buffer.alloc(32); core.write("0.0.1");
  assert.equal(manifest.image_len, 4294967296); assert.equal(manifest.chunk_size, 262144);
  assert.equal(manifest.chunks.length, 16384);
  const canonical = Object.fromEntries(["version", "image_len", "chunk_size", "layout", "chunks"].map(k => [k, manifest[k]]));
  const base = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  assert.equal(snapshot.length, receipt.snapshotBytes); assert.ok(snapshot.length > 1048576);
  assert.equal(snapshot.subarray(0,8).toString(), "WVMRESU1"); assert.equal(snapshot.readUInt32LE(8), 1);
  assert.deepEqual(snapshot.subarray(12,44), core); assert.equal(receipt.coreId, core.toString("hex"));
  assert.equal(receipt.base, base); assert.equal(snapshot.subarray(44,76).toString("hex"), base);
  assert.ok(Number.isSafeInteger(receipt.generation) && receipt.generation >= 0);
  assert.equal(snapshot.readBigUInt64LE(76), BigInt(receipt.generation));
  assert.equal(delta.subarray(0,5).toString(), "WVOD1"); assert.equal(delta.readUInt32LE(5), 4096);
  assert.equal(delta.readBigUInt64LE(9), 4294967296n); assert.equal(delta.subarray(17,49).toString("hex"), base);
  assert.equal(delta.readBigUInt64LE(49), BigInt(receipt.generation));
  const count = delta.readUInt32LE(57); assert.equal(count, receipt.blocks);
  assert.equal(delta.length, 61+count*4104);
  let previous = -1n;
  for (let i=0; i<count; i++) {
    const index = delta.readBigUInt64LE(61+i*4104);
    assert.ok(index > previous && index < 1048576n, "duplicate, unordered or out-of-range delta"); previous=index;
  }
  return { base, coreId: core.toString("hex"), generation: receipt.generation, blocks: count,
    rawSnapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
    rawDeltaSha256: createHash("sha256").update(delta).digest("hex") };
}

// This rejects black/bar-only images automatically; genuine prompt content is
// additionally checked by personal inspection of the saved real screenshot.
export function terminalInterior(pixels, canvasWidth, canvasHeight, foot) {
  assert.ok(pixels.length === canvasWidth * canvasHeight * 4);
  assert.ok(foot?.mapped && !foot.hidden && foot.class === "foot");
  const [x,y] = foot.at, [width,height] = foot.size;
  assert.ok([x,y,width,height].every(Number.isFinite));
  assert.ok(x >= 0 && y >= 0 && width >= 200 && height >= 100 && x+width <= 640 && y+height <= 400);
  assert.ok(canvasWidth >= 640 && canvasHeight >= 400);
  let bright = 0; const colors = new Set();
  // Exclude the bar, borders and terminal margins; inspect the first text rows.
  // fitFrameToViewport copies native pixels into the top-left, without scaling.
  for (let py = Math.ceil(y+10); py < Math.floor(y+55); py++) {
    for (let px = Math.ceil(x+12); px < Math.floor(x+Math.min(width-12,300)); px++) {
      const i = (py*canvasWidth+px)*4, r=pixels[i], g=pixels[i+1], b=pixels[i+2];
      if (pixels[i+3] && Math.max(r,g,b)>140) { bright++; colors.add((r<<16)|(g<<8)|b); }
    }
  }
  return { brightPixels: bright, brightColors: colors.size, nonblank: bright >= 80 && colors.size >= 8 };
}

export async function prepareSmallerDesktop(page, deadline, report, { exec, observeRuntime, screenshot, capturePair }) {
  const call = (fn, label) => withinTrialDeadline(fn, deadline, `mode preparation: ${label}`);
  const receipt = report.modePreparation = { purpose: "offline-only-no-input", startedAt: new Date().toISOString(),
    deadlineAt: new Date(deadline).toISOString(), status: "preparing", keyboardTested: false };
  try {
    assert.equal(report.restored, true);
    receipt.runtimeBefore = await call(() => observeRuntime("mode-preparation-before"), "runtime");
    assertInputTrialRuntime(receipt.runtimeBefore, modePreparationOptions());
    report.compositorModeRequested = true;
    await requestSmallerScanout(page, deadline, report, { configureCompositor: () =>
      requestCompositorMode((command, ms) => exec(command, "mode-preparation:configure", ms), deadline, report) });
    const clients = await call(() => exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients",
      "mode-preparation:clients", deadline-Date.now()), "clients");
    assert.equal(clients.exit, 0);
    const foot = JSON.parse(clients.stdout).find(c => c.class === "foot" && c.mapped && !c.hidden);
    assert.ok(foot, "no mapped Foot in smaller mode"); receipt.foot = foot;
    const active = await call(() => exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow",
      "mode-preparation:active", deadline-Date.now()), "focus");
    assert.equal(active.exit, 0); receipt.active = JSON.parse(active.stdout);
    assert.equal(receipt.active.address, foot.address, "prepared Foot is not focused");
    const pixelCheck = terminalInterior.toString();
    while (true) {
      const observed = await call(() => page.evaluate(({ foot, pixelCheck }) => {
        const state = window.__presentation.state(), pixels = window.__presentation.readPixels();
        if (state.backend !== "canvas2d") throw Error("mode preparation requires top-down Canvas2D pixels");
        // Local read-only function; assertions below are plain errors in the browser.
        const assert = { ok: (value) => { if (!value) throw Error("invalid terminal pixel geometry"); } };
        const inspect = eval(`(${pixelCheck})`);
        return { state, pixels: inspect(pixels, state.width, state.height, foot) };
      }, { foot, pixelCheck }), "terminal pixels");
      receipt.lastPixels = observed;
      if (observed.pixels.nonblank && observed.state.framesReceived > report.renderBudget.before.presentation.framesReceived &&
        observed.state.successfulPresents > report.renderBudget.before.presentation.successfulPresents &&
        observed.state.latest?.resourceWidth === 640 && observed.state.latest.resourceHeight >= 400 &&
        observed.state.latest.resourceHeight <= 448) break;
      console.log(`OMARCHY_MODE_PREPARATION ${JSON.stringify({ at: new Date().toISOString(), ...observed.pixels,
        frames: observed.state.framesReceived })}`);
      await call(() => new Promise(resolve => setTimeout(resolve, 5000)), "wait for visible Foot");
    }
    receipt.runtimeAfter = await call(() => observeRuntime("mode-preparation-ready"), "ready runtime");
    assertInputTrialRuntime(receipt.runtimeAfter, modePreparationOptions());
    const current = await call(() => page.evaluate(async () => {
      const { edid, ...gpu } = await window.wvmDemo.displayStats();
      return { gpu, presentation: window.__presentation.state() };
    }), "ready scanout");
    assertGuestMode(current, report.renderBudget.before.presentation); receipt.readyMode = current;
    await call(() => screenshot("prepared-desktop.png"), "ready image");
    receipt.visibleAt = new Date().toISOString();
    const exportDeadline = Date.now()+MODE_EXPORT_MS;
    receipt.exportStartedAt = new Date(exportDeadline-MODE_EXPORT_MS).toISOString();
    receipt.exportDeadlineAt = new Date(exportDeadline).toISOString();
    await withinTrialDeadline(capturePair, exportDeadline, "prepared mode coherent export");
    receipt.exportFinishedAt = new Date().toISOString(); receipt.status = "pair-captured-input-untested";
  } catch (error) { receipt.status = "preparation-failed-input-untested"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); }
}
