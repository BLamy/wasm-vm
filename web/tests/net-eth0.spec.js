// E3-T13 acceptance (browser leg): the browser-hosted VM boots Alpine with the loopback
// virtio-net device attached (wasm attaches it on every boot shape), the stock virtio_net
// driver binds eth0 with our config-space MAC, and frames flow both directions through the
// loopback (rx_packets > 0 — the only possible rx source is the guest's own MAC-swapped tx
// echoes).
//
// Echo-proof discipline (the E3-T13 F1 lesson): the terminal shows typed commands too, so
// every asserted marker is SPLIT in the typed text (`echo NET_RX_"OK"`) and grep-style
// checks assert on output-only strings (the driver symlink target, the MAC).
//
// Local/nightly only — needs releases/chunked-alpine + web/artifacts-alpine.json
// (gitignored), so it SKIPS in CI. One full ~12-min chunked boot.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T13: browser Alpine detects eth0; loopback frames flow", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("eth0 bound to virtio_net with our MAC; rx>0 after arping", async ({ page }) => {
    test.setTimeout(1_500_000); // one full chunked boot + command battery

    const errs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource.*404/.test(t)) errs.push(t);
    });

    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    const text = () => page.locator(rows).textContent().catch(() => "");

    await page.goto("/");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");
    let sawOpenRC = false;
    let loggedIn = false;
    for (let i = 0; i < 900; i++) {
      const t = await text();
      if (/Kernel panic|Unable to mount root/.test(t)) throw new Error("kernel panic");
      if (t.includes("OpenRC")) sawOpenRC = true;
      if (sawOpenRC && t.includes("login:")) { loggedIn = true; break; }
      await page.waitForTimeout(1500);
    }
    expect(loggedIn, "reached login:").toBe(true);
    await type("root\r");
    await page.waitForTimeout(3000);
    await type("\r"); // dismiss an optional Password:
    await page.waitForTimeout(2000);

    // 1. Driver bound (output-only string: the typed command has no "drivers/virtio").
    await type("readlink /sys/class/net/eth0/device/driver\r");
    await expect(page.locator(rows)).toContainText("drivers/virtio_net", { timeout: 60_000 });

    // 2. Our config-space MAC (output-only).
    await type("ip link show eth0\r");
    await expect(page.locator(rows)).toContainText("52:54:00:12:34:56", { timeout: 60_000 });

    // 3. Both directions through the loopback: up + arping, then the rx counter — the
    //    marker is split in the typed text, so only guest output can join it.
    await type("ip addr add 10.0.2.15/24 dev eth0\r");
    await page.waitForTimeout(1500);
    await type("ip link set eth0 up\r");
    await page.waitForTimeout(2500);
    await type("arping -c 2 -I eth0 10.0.2.99\r");
    await page.waitForTimeout(6000);
    await type('[ "$(cat /sys/class/net/eth0/statistics/rx_packets)" -gt 0 ] && echo NET_RX_"OK" || echo NET_RX_"ZERO"\r');
    await expect(page.locator(rows)).toContainText("NET_RX_OK", { timeout: 60_000 });
    expect((await text()).includes("NET_RX_ZERO"), "rx_packets was zero").toBe(false);
    await type('[ "$(cat /sys/class/net/eth0/statistics/tx_packets)" -gt 0 ] && echo NET_TX_"OK" || echo NET_TX_"ZERO"\r');
    await expect(page.locator(rows)).toContainText("NET_TX_OK", { timeout: 60_000 });

    expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
  });
});
