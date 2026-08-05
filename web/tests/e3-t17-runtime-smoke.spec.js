import { test, expect } from "@playwright/test";

test("E3-T17 exit-node selection is deterministic and respects an explicit stable ID", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { lookupPublicA, selectExitNode } = await import("./tailscale-runtime.js");
    const netMap = {
      peers: [
        { id: "20", exitNodeOption: true, online: true },
        { id: "3", exitNodeOption: true, online: true },
        { id: "1", exitNodeOption: true, online: false },
        { id: "2", exitNodeOption: false, online: true },
      ],
    };
    const publicLookup = await lookupPublicA("example.com", async (url, options) => ({
      ok: options.headers.accept === "application/dns-json" &&
        new URL(url).searchParams.get("name") === "example.com",
      status: 200,
      json: async () => ({
        Answer: [
          { type: 28, data: "2001:db8::1" },
          { type: 1, data: "192.0.2.44" },
        ],
      }),
    }));
    return {
      automatic: selectExitNode(netMap),
      explicit: selectExitNode(netMap, " node-fixed "),
      unavailable: selectExitNode({ peers: [{ id: "1", exitNodeOption: true, online: false }] }),
      publicLookup,
    };
  });
  expect(result).toEqual({
    automatic: "3",
    explicit: "node-fixed",
    unavailable: null,
    publicLookup: { addresses: [{ family: 4, address: "192.0.2.44" }] },
  });
});

test("E3-T17 defers only public exit dials until the first guest write", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { deferPublicExitDial } = await import("./tailscale-runtime.js");
    const events = [];
    const dial = async (name) => {
      events.push(`dial:${name}`);
      return {
        read: async () => null,
        write: async (bytes) => { events.push(`write:${name}:${bytes.byteLength}`); return bytes.byteLength; },
        shutdownWrite: async () => {},
        close: async () => {},
      };
    };
    const publicConn = await deferPublicExitDial("1.1.1.1", true, () => dial("public"));
    const beforeWrite = [...events];
    const pendingRead = publicConn.read(10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const whileReadWaits = [...events];
    await publicConn.write(Uint8Array.of(1, 2, 3));
    await pendingRead;
    await deferPublicExitDial("100.64.0.7", true, () => dial("tailnet"));
    await deferPublicExitDial("1.1.1.1", false, () => dial("no-exit"));
    return { beforeWrite, whileReadWaits, events };
  });
  expect(result.beforeWrite).toEqual([]);
  expect(result.whileReadWaits).toEqual([]);
  expect(result.events).toEqual([
    "dial:public", "write:public:3", "dial:tailnet", "dial:no-exit",
  ]);
});

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
