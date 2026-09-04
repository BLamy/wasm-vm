// E5-T21c — Chromium proof that the real AudioWorklet producer writes its reversed SAB ring.
import { test, expect } from "@playwright/test";

test("Chromium runs the capture worklet into an isolated shared ring", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/?noAutoBoot=1&nosw");
  const result = await page.evaluate(async () => {
    const { AudioCaptureRingBuffer } = await import("./src/audio/capture-ring.js");
    const { AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME } = await import("./src/audio/capture-worklet.js");
    if (!globalThis.crossOriginIsolated) throw new Error("capture proof requires cross-origin isolation");

    const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 16_384 });
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.audioWorklet.addModule("./src/audio/capture-worklet.js");
    const node = new AudioWorkletNode(context, AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        captureBuffer: ring.sharedBuffer,
        sampleRateHz: context.sampleRate,
      },
    });
    const source = context.createConstantSource();
    source.offset.value = 0.25;
    source.connect(node);
    node.connect(context.destination);
    source.start();
    await context.resume();
    await new Promise((resolve) => setTimeout(resolve, 75));
    source.stop();
    await context.close();

    const frameCount = ring.fillFrames;
    const samples = new Float32Array(frameCount * 2);
    const read = ring.consumer().readInto(samples, frameCount);
    let constant = true;
    for (let frame = 0; frame < read; frame += 1) {
      if (samples[frame * 2] !== 0.25 || samples[frame * 2 + 1] !== 0.25) {
        constant = false;
        break;
      }
    }
    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sampleRateHz: context.sampleRate,
      read,
      droppedFrames: ring.droppedFrames,
      constant,
      firstFrame: [samples[0], samples[1]],
    };
  });

  await page.screenshot({
    path: "../evidence/e5-t21c/capture-worklet-2026-09-04.png",
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
  expect(result).toMatchObject({
    crossOriginIsolated: true,
    sampleRateHz: 48_000,
    constant: true,
    firstFrame: [0.25, 0.25],
  });
  expect(result.read).toBeGreaterThan(0);
  expect(result.droppedFrames).toBe(0);
});
