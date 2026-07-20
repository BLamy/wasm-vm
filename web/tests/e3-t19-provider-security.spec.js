import { test, expect } from "@playwright/test";

test("E3-T19 relay credentials stay out of URLs and cross-provider configuration", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { resolveSlirpProvider } = await import("./loader.js");
    const relay = resolveSlirpProvider({
      slirpProvider: "relay",
      slirpRelay: "wss://relay.example/ws",
      slirpRelayToken: "v1-sensitive-token",
      slirpTailscale: { workerUrl: "./tailscale-worker.js", config: { authKey: "ts-secret" } },
    });
    const tailscale = resolveSlirpProvider({
      slirpProvider: "tailscale",
      slirpRelay: "wss://relay.example/ws",
      slirpRelayToken: "must-not-cross",
      slirpTailscale: { workerUrl: "./tailscale-worker.js", config: {} },
    });
    const offline = resolveSlirpProvider({
      slirpProvider: "offline",
      slirpRelay: "wss://relay.example/ws",
      slirpRelayToken: "must-not-cross",
    });
    return {
      relay,
      tailscale,
      offline,
      href: location.href,
      local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    };
  });

  expect(result.relay.relayToken).toBe("v1-sensitive-token");
  expect(result.relay.workerUrl).toBe("");
  expect(result.tailscale.relayToken).toBe("");
  expect(result.tailscale.relayUrl).toBe("");
  expect(result.offline.relayToken).toBe("");
  expect(result.href).not.toContain("sensitive-token");
  expect(JSON.stringify(result.local)).not.toContain("sensitive-token");
  expect(JSON.stringify(result.session)).not.toContain("sensitive-token");
});

test("E3-T19 provider choice never silently retries with another identity", async ({ page }) => {
  await page.goto("/");
  const failures = await page.evaluate(async () => {
    const { resolveSlirpProvider } = await import("./loader.js");
    const capture = (options) => {
      try {
        return { selected: resolveSlirpProvider(options) };
      } catch (error) {
        return { error: error.message };
      }
    };
    return {
      tailscaleMissing: capture({
        slirpProvider: "tailscale",
        slirpRelay: "wss://available-relay.example/ws",
        slirpRelayToken: "valid-relay-token",
      }),
      relayMissing: capture({
        slirpProvider: "relay",
        slirpTailscale: { workerUrl: "./tailscale-worker.js" },
      }),
    };
  });

  expect(failures.tailscaleMissing.error).toBe("tailscale provider requires slirpTailscale.workerUrl");
  expect(failures.relayMissing.error).toBe("relay provider requires slirpRelay");
});
