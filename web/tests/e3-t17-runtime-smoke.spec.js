import { test, expect } from "@playwright/test";

test("E3-T17 offline and relay UI do not preload the Tailscale Worker or artifact", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await page.selectOption("#network-provider", "offline");
  await page.selectOption("#network-provider", "relay");
  await page.waitForTimeout(100);
  expect(requests.filter((url) => /tailscale-(worker|runtime)|tailscale-connect/.test(url))).toEqual([]);
  await expect(page.locator("#tailscale-status")).toContainText("no Worker or runtime artifact loaded");
});

test("E3-T17 pinned runtime lazily instantiates in its dedicated Worker", async ({ page }) => {
  test.setTimeout(120_000);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const status = await page.evaluate(async () => {
    const secret = "tskey-auth-must-not-enter-a-url";
    const worker = new Worker("./tailscale-worker.js", { type: "module", name: "e3-t17-smoke" });
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Tailscale Worker startup timed out")), 90_000);
        worker.onerror = (event) => {
          clearTimeout(timeout);
          reject(new Error(event.message));
        };
        worker.onmessage = (event) => {
          if (event.data?.type === "failed") {
            clearTimeout(timeout);
            reject(new Error(JSON.stringify(event.data.error)));
          }
          if (event.data?.type === "status" && event.data.status?.state === "starting") {
            clearTimeout(timeout);
            resolve(event.data.status);
          }
        };
        worker.postMessage({
          type: "configure",
          config: {
            wasmUrl: "./tailscale-connect/main.wasm",
            controlUrl: "http://127.0.0.1:9",
            hostname: "e3-t17-smoke",
            authKey: secret,
            state: {},
            acceptDns: true,
          },
        });
      });
    } finally {
      worker.terminate();
    }
  });

  expect(status.state).toBe("starting");
  expect(requests.filter((url) => url.endsWith("/tailscale-connect/main.wasm"))).toHaveLength(1);
  expect(requests.some((url) => url.includes("tskey-auth-must-not-enter-a-url"))).toBe(false);
});
