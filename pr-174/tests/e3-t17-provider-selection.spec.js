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
      autoTailscale: resolveSlirpProvider({
        slirpRelay: "ws://relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js" },
      }),
    };
  });

  expect(selected.offline).toEqual({
    provider: "offline", relayUrl: "", workerUrl: "", workerConfig: {},
  });
  expect(selected.relay.workerUrl).toBe("");
  expect(selected.relay.workerConfig).toEqual({});
  expect(selected.relay.relayUrl).toBe("ws://relay");
  expect(selected.tailscale.relayUrl).toBe("");
  expect(selected.tailscale.workerUrl).toBe("./tailscale-worker.js");
  expect(selected.tailscale.workerConfig.authKey).toBe("secret");
  expect(selected.autoRelay.provider).toBe("relay");
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
      message({ slirpProvider: "relay" }),
      message({ slirpProvider: "magic" }),
    ];
  });

  expect(failures).toEqual([
    "tailscale provider requires slirpTailscale.workerUrl",
    "relay provider requires slirpRelay",
    "unknown slirp provider: magic",
  ]);
});
