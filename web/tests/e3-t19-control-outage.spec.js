import { test, expect } from "@playwright/test";

const CONTROL_URL = process.env.E3_T19_CONTROL_URL ?? "";
const AUTH_KEY = process.env.E3_T19_AUTH_KEY ?? "";

test("E3-T19 control outage fails the selected identity without relay fallback", async ({ page }) => {
  test.skip(!CONTROL_URL || !AUTH_KEY, "set the stopped compose control URL and a one-time key");
  test.setTimeout(90_000);
  await page.goto("/");
  const result = await page.evaluate(async ({ controlUrl, authKey }) => {
    const worker = new Worker("./tailscale-worker.js", { type: "module" });
    const messages = [];
    worker.onmessage = (event) => messages.push(event.data);
    worker.postMessage({
      type: "configure",
      config: {
        wasmUrl: "./tailscale-connect/main.wasm",
        controlUrl,
        hostname: "wasm-vm-control-outage",
        authKey,
        state: {},
        acceptDns: true,
      },
    });
    const started = performance.now();
    while (performance.now() - started < 60_000) {
      if (messages.some((message) => message?.type === "failed")) break;
      if (messages.some((message) => message?.type === "status" &&
        ["NeedsLogin", "Stopped", "error"].includes(message.status?.state))) break;
      if (messages.some((message) => message?.type === "status" && message.status?.state === "Running")) {
        throw new Error("stopped control server unexpectedly reached Running");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    worker.terminate();
    return {
      terminal: messages.some((message) => message?.type === "failed" ||
        (message?.type === "status" &&
          ["NeedsLogin", "Stopped", "error"].includes(message.status?.state))),
      states: messages.filter((message) => message?.type === "status")
        .map((message) => message.status?.state),
      frames: messages.filter((message) => message?.type === "frame").length,
      serialized: JSON.stringify(messages),
    };
  }, { controlUrl: CONTROL_URL, authKey: AUTH_KEY });

  expect(result.terminal, `states before timeout: ${result.states.join(",")}`).toBe(true);
  expect(result.frames).toBe(0);
  expect(result.serialized).not.toContain(AUTH_KEY);
});
