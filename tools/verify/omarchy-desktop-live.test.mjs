import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseHyprlandRendererLog } from "./omarchy-renderer-log.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.join(here, "omarchy-desktop-live.mjs"), "utf8");

test("prewarm sync proof rejects cross-TTY marker evidence", () => {
  assert.ok(source.includes("history -c && clear && sync && printf"));
  assert.ok(source.includes("readGuestFileEventually(targetPage, markerFile, marker"));
  assert.ok(source.includes("rm -f -- '${markerFile}' && sync"));
  assert.ok(source.includes("clearAndHistoryProvenByMarker: false"));
  assert.doesNotMatch(source, /__omarchyLiveEvidence\?\.serial\.includes\(marker\)/u);
});

test("prewarm clear proof requires a new real frame and focused Foot", () => {
  assert.ok(source.includes("const afterMarkerPresentation = await presentationProof(targetPage)"));
  assert.ok(source.includes("waitForFreshPresentation("));
  assert.ok(source.includes("markerBaseline"));
  assert.ok(source.includes("framesReceived"));
  assert.ok(source.includes("x: 301, y: 201"));
  assert.ok(source.includes("clear frame is not focused Foot"));
  assert.ok(source.includes("assertCanvasFocus(targetPage, `${label}:frame`, keyboardUrl)"));
});

test("post-marker presentation helper rejects typing frames", () => {
  const result = spawnSync(process.execPath, [path.join(here, "omarchy-desktop-live.mjs"), "--selftest-presentation"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("candidate mode is explicitly local-only and hash-bound", () => {
  assert.ok(source.includes("OMARCHY_CANDIDATE_PAIR_DIR"));
  assert.ok(source.includes("OMARCHY_CANDIDATE_CHUNKS"));
  assert.ok(source.includes("must be supplied together"));
  assert.ok(source.includes("local-only candidate inputs require URL argument local or selftest"));
  assert.ok(source.includes("/candidate/kernel"));
  assert.ok(source.includes("/candidate/boot-snapshot"));
  assert.ok(source.includes("/candidate/overlay-delta"));
  assert.ok(source.includes("chunked-omarchy/manifest-${manifestSha256}.json"));
  assert.ok(source.includes("candidate chunk ${name}"));
  assert.ok(source.includes("omarchyAssetBase"));
  assert.ok(source.includes("source: candidate.source"));
  assert.match(source, /candidate content-addressed chunk must be served/u);
});

test("renderer proof binds current Hyprland PID and instance before physical input", () => {
  assert.ok(source.includes("OMARCHY_EXPECT_RENDERER"));
  assert.ok(source.includes("Number.isSafeInteger(instance.pid)"));
  assert.ok(source.includes("/proc/${pid}/environ"));
  assert.ok(source.includes("ps -T -p ${pid} -o comm="));
  assert.ok(source.includes("DEBUG ]: Renderer:"));
  assert.ok(source.includes("parseHyprlandRendererLog(log.stdout, expectedRenderer)"));
  assert.ok(source.includes("llvmpipe worker present for softpipe"));
  assert.ok(source.indexOf("proveHyprlandRenderer(page, \"initial desktop\")")
    < source.indexOf("physical-keyboard-before"));
});

test("renderer log parser accepts the real DEBUG suffix labels", () => {
  assert.deepEqual(parseHyprlandRendererLog(
    "[ 125.755907] omarchy-demo uwsm_hyprland.desktop[478]: DEBUG ]: Renderer: llvmpipe (LLVM 19.1.7, 256 bits)\nDEBUG ]: Vendor: Mesa/X.org",
    "llvmpipe",
  ), {
    renderer: "llvmpipe (LLVM 19.1.7, 256 bits)", vendor: "Mesa/X.org", positivelyMatched: true,
  });
});

test("renderer log parser rejects wrong, missing, ambiguous, and misleading records", () => {
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: zink (llvmpipe)\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /positively match requested driver/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)\nDEBUG ]: Vendor: Mesa", "softpipe",
  ), /positively match requested driver/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)", "llvmpipe",
  ), /Vendor log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Renderer: llvmpipe (LLVM)\nDEBUG ]: Renderer: llvmpipe (LLVM 2)\nDEBUG ]: Vendor: Mesa",
    "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Requested Renderer: \"llvmpipe\"\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
  assert.throws(() => parseHyprlandRendererLog(
    "DEBUG ]: Error: Requested Renderer: \"llvmpipe\"\nDEBUG ]: Vendor: Mesa", "llvmpipe",
  ), /Renderer log line is absent or ambiguous/u);
});

test("nonce readback caps every guest RPC by the remaining 120-second deadline", () => {
  assert.ok(source.includes("Math.min(300000, remaining)"));
  assert.ok(source.includes("nonce readback completed after deadline"));
  assert.ok(source.includes("Math.min(1000, Math.max(1, deadline - Date.now()))"));
});
