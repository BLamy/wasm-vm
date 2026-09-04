// E5-T21b — browser construction proof for the explicit virtio-snd input gate.
// The machine is assembled paused, so this verifies the WASM/loader path without running Linux or
// requesting microphone permission. Native config fixtures own the guest PCM_INFO byte contract.
import { test, expect } from "@playwright/test";

test("enableMic is carried into WASM construction without opening a microphone", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/?noAutoBoot=1&nosw");
  const result = await page.evaluate(async () => {
    const { WasmLinux } = await import("./pkg/wasm_vm_wasm.js");
    const loader = await import("./loader.js");
    let getUserMediaCalls = 0;
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices?.getUserMedia;
    if (mediaDevices && typeof originalGetUserMedia === "function") {
      mediaDevices.getUserMedia = async (...args) => {
        getUserMediaCalls += 1;
        return originalGetUserMedia.apply(mediaDevices, args);
      };
    }

    let controller;
    try {
      controller = await loader.startLinuxBoot({
        startPaused: true,
        bootSnapshot: false,
        jit: false,
        enableMic: true,
      });
      return {
        constructors: {
          initramfs: WasmLinux.length,
          disk: WasmLinux.newDisk.length,
          chunked: WasmLinux.newChunkedDisk.length,
          persistent: WasmLinux.newChunkedDiskPersistent.length,
          extra: WasmLinux.newChunkedDiskWithExtra.length,
        },
        config: globalThis.__machine.virtioSndConfig(),
        getUserMediaCalls,
      };
    } finally {
      await controller?.stop();
      if (mediaDevices && typeof originalGetUserMedia === "function") {
        mediaDevices.getUserMedia = originalGetUserMedia;
      }
    }
  });
  await page.screenshot({
    path: "../evidence/e5-t21b/virtio-snd-capture-config-2026-09-04.png",
    fullPage: true,
  });

  expect(result.constructors).toEqual({
    initramfs: 6,
    disk: 6,
    chunked: 9,
    persistent: 11,
    extra: 10,
  });
  expect(result.config).toEqual({
    slot: 6,
    captureEnabled: true,
    streamCount: 2,
    input: {
      direction: 1,
      formats: 32,
      rates: 128,
      channelsMin: 1,
      channelsMax: 2,
    },
  });
  expect(result.getUserMediaCalls).toBe(0);
  expect(consoleErrors).toEqual([]);
});
