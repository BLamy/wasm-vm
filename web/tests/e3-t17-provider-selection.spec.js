import { test, expect } from "@playwright/test";

test("E3-T17 provider selection is explicit, lazy, and fail-closed", async ({ page }) => {
  await page.goto("/");
  const selected = await page.evaluate(async () => {
    const { resolveSlirpProvider } = await import("./loader.js");
    return {
      offline: resolveSlirpProvider({ slirpProvider: "offline", slirpRelay: "ws://relay" }),
      relay: resolveSlirpProvider({
        slirpProvider: "relay",
        slirpRelay: "ws://relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { authKey: "secret" } },
      }),
      tailscale: resolveSlirpProvider({
        slirpProvider: "tailscale",
        slirpRelay: "ws://relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { authKey: "secret" } },
      }),
      autoRelay: resolveSlirpProvider({ slirpRelay: "ws://relay" }),
      websocket: resolveSlirpProvider({
        slirpProvider: "websocket",
        slirpRelay: "wss://socket.example/ws",
      }),
      privateAlias: resolveSlirpProvider({
        slirpProvider: "private-relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { controlUrl: "https://headscale.example" } },
      }),
      headscale: resolveSlirpProvider({
        slirpProvider: "headscale",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { controlUrl: "https://headscale.example" } },
      }),
      headscaleAlias: resolveSlirpProvider({
        slirpProvider: "private-tailscale",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { controlUrl: "https://headscale.example" } },
      }),
      tailscaleAlias: resolveSlirpProvider({
        slirpProvider: "tailscale-public",
        slirpTailscale: { workerUrl: "./tailscale-worker.js" },
      }),
      publicRelayAlias: resolveSlirpProvider({
        slirpProvider: "public-relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js" },
      }),
      autoTailscale: resolveSlirpProvider({
        slirpRelay: "ws://relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js" },
      }),
    };
  });

  expect(selected.offline).toEqual({
    provider: "offline", relayUrl: "", relayToken: "", workerUrl: "", workerConfig: {},
  });
  expect(selected.relay.workerUrl).toBe("");
  expect(selected.relay.workerConfig).toEqual({});
  expect(selected.relay.relayUrl).toBe("ws://relay");
  expect(selected.tailscale.relayUrl).toBe("");
  expect(selected.tailscale.workerUrl).toBe("./tailscale-worker.js");
  expect(selected.tailscale.workerConfig.authKey).toBe("secret");
  expect(selected.autoRelay.provider).toBe("relay");
  expect(selected.websocket).toMatchObject({
    provider: "websocket",
    relayUrl: "wss://socket.example/ws",
  });
  expect(selected.privateAlias.provider).toBe("headscale");
  expect(selected.headscale.provider).toBe("headscale");
  expect(selected.headscale.workerConfig.controlUrl).toBe("https://headscale.example");
  expect(selected.headscaleAlias.provider).toBe("headscale");
  expect(selected.tailscaleAlias.provider).toBe("tailscale");
  expect(selected.publicRelayAlias.provider).toBe("tailscale");
  expect(selected.autoTailscale.provider).toBe("tailscale");
});

test("E3-T17 refuses invalid or incomplete explicit provider configuration", async ({ page }) => {
  await page.goto("/");
  const failures = await page.evaluate(async () => {
    const { resolveSlirpProvider } = await import("./loader.js");
    const message = (options) => {
      try {
        resolveSlirpProvider(options);
        return null;
      } catch (error) {
        return error.message;
      }
    };
    return [
      message({ slirpProvider: "tailscale" }),
      message({ slirpProvider: "headscale", slirpTailscale: { workerUrl: "./tailscale-worker.js" } }),
      message({
        slirpProvider: "tailscale",
        slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { controlUrl: "https://headscale.example" } },
      }),
      message({ slirpProvider: "relay" }),
      message({ slirpProvider: "magic" }),
    ];
  });

  expect(failures).toEqual([
    "tailscale provider requires slirpTailscale.workerUrl",
    "headscale provider requires slirpTailscale.config.controlUrl",
    "tailscale public provider requires a blank controlUrl; choose headscale for a private control plane",
    "relay provider requires slirpRelay",
    "unknown slirp provider: magic",
  ]);
});

test("E3-T17 network UI names the supported transport families", async ({ page }) => {
  await page.goto("/");
  const options = await page.locator("#network-provider option").allTextContents();
  expect(options).toEqual([
    "Offline",
    "WebSocket (default when configured)",
    "Public relay (Tailscale DERP)",
    "Private Headscale (self-hosted Tailscale)",
    "Private wvrelay (legacy advanced)",
  ]);
  await page.evaluate(() => {
    const select = document.querySelector("#network-provider");
    select.value = "tailscale";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#network-help")).toHaveText(/public DERP map/i);
  await page.evaluate(() => {
    const select = document.querySelector("#network-provider");
    select.value = "headscale";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#network-help")).toHaveText(/Private Headscale/i);
});
