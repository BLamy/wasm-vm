#!/usr/bin/env node
// Omarchy desktop UI regression only.
//
// This intentionally does NOT boot a VM and is NOT desktop-rendering proof. The page is loaded
// with noAutoBoot=1, the Omarchy manifest is blocked, and lifecycle events are synthetic DOM
// events used only to exercise the loading/error/readiness UI contract.

import assert from "node:assert/strict";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const BASE_URL = "http://127.0.0.1:8000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function desktopUrl() {
  return `${BASE_URL}/?guest=omarchy&desktop=1&noAutoBoot=1&testHooks=1#ide`;
}

function normalUrl(guest) {
  return `${BASE_URL}/?guest=${guest}&noAutoBoot=1&testHooks=1#ide`;
}

async function dispatch(page, type, detail = {}) {
  await page.evaluate(({ type, detail }) => {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }, { type, detail });
}

async function visible(page, selector) {
  return page.locator(selector).isVisible();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/artifacts-omarchy.json", (route) => route.fulfill({
    status: 503,
    contentType: "text/plain",
    body: "blocked by omarchy-desktop-ui.mjs; no guest boot allowed",
  }));

  try {
    console.log("OMARCHY DESKTOP UI REGRESSION — synthetic events, no guest boot, not desktop-rendering proof");

    await page.goto(desktopUrl(), { waitUntil: "domcontentloaded" });
    await page.locator("#omarchy-boot-overlay").waitFor({ state: "attached" });
    // Mock the launcher selection only so the no-guest DOM component is visible. This does not
    // invoke a launcher action or claim a VM; normal routes below use the same mock selection.
    await page.locator("#panel-ide").evaluate((el) => { el.dataset.osSelected = "true"; });
    console.log("NOTE: panel selection is mocked for DOM visibility; no desktop guest is started");

    const vmArtifactRequests = () => requests.filter((url) => /\/releases\/|\/chunks\//.test(url));
    assert.equal(vmArtifactRequests().length, 0, "desktop UI regression must not request VM artifacts");
    assert.equal(await page.locator("html").getAttribute("data-wvm-desktop"), "omarchy");
    assert.equal(await visible(page, "#omarchy-boot-overlay"), true, "cold desktop shows loading overlay");
    assert.equal(await page.locator("#ide-display-pane").evaluate((el) => getComputedStyle(el).display), "flex");

    for (const selector of [
      "header", ".os-launcher", ".ide-activity", ".ide-side", ".ide-tabstrip",
      ".ide-editor-toolbar", ".ide-editor-body", ".ide-hsplit", ".ide-term-pane", ".ide-statusbar",
    ]) {
      assert.equal(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).display), "none",
        `desktop route hides editor UI: ${selector}`);
    }

    await dispatch(page, "wvm:guest-ready");
    assert.equal(await visible(page, "#omarchy-boot-overlay"), true, "guest-ready does not dismiss desktop overlay");
    assert.match(await page.locator("#omarchy-desktop-status").textContent(), /guest ready.*waiting for desktop/);

    await dispatch(page, "wvm:guest-progress", { phase: "fetching", loaded: 64, total: 128 });
    await dispatch(page, "wvm:guest-output", { text: "serial-before-error\n" });
    assert.equal(await visible(page, "#omarchy-boot-overlay"), true, "progress/output do not dismiss overlay");
    assert.match(await page.locator("#omarchy-boot-log").textContent(), /serial-before-error/);

    await dispatch(page, "wvm:guest-error", { message: "synthetic boot failure" });
    assert.match(await page.locator("#omarchy-boot-status").textContent(), /synthetic boot failure/);
    await dispatch(page, "wvm:guest-state", { state: "done" });
    await dispatch(page, "wvm:guest-progress", { phase: "late progress", loaded: 128, total: 128 });
    await dispatch(page, "wvm:guest-output", { text: "late serial must not overwrite error\n" });
    await dispatch(page, "wvm:guest-ready");
    await dispatch(page, "wvm:desktop-ready");
    assert.equal(await visible(page, "#omarchy-boot-overlay"), true, "latched error survives late readiness events");
    assert.match(await page.locator("#omarchy-boot-status").textContent(), /synthetic boot failure/);
    assert.doesNotMatch(await page.locator("#omarchy-boot-status").textContent(), /late progress|Serial output received/);
    assert.doesNotMatch(await page.locator("#omarchy-desktop-status").textContent(), /ready · drag to resize/);

    await dispatch(page, "wvm:guest-booting");
    assert.equal(await visible(page, "#omarchy-boot-overlay"), true, "new boot restores overlay");
    assert.equal(await page.locator("#omarchy-boot-log").textContent(), "No serial output yet.");
    assert.equal(await page.locator("#omarchy-boot-progress").isHidden(), true, "new boot resets progress");
    assert.match(await page.locator("#omarchy-boot-status").textContent(), /Booting Omarchy/);

    await dispatch(page, "wvm:guest-output", { text: "serial-after-new-boot\n" });
    await dispatch(page, "wvm:desktop-ready");
    assert.equal(await page.locator("#omarchy-boot-overlay").isHidden(), true, "real desktop-ready hides normal overlay");
    await page.locator("#ide-display-canvas").click({ position: { x: 300, y: 200 } });
    assert.equal(await page.locator(".ide-display-head").evaluate((el) => getComputedStyle(el).display), "none",
      "Omarchy hides the host display debug header after canvas focus");
    const focusUrl = page.url();
    const focusScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    for (const key of ["/", "r", "1", "2", "0"]) {
      // Browser-level keyboard input is intentional here; no guest or serial input is involved.
      await page.keyboard.press(key);
      const focus = await page.evaluate(() => ({
        activeId: document.activeElement?.id || null,
        url: location.href,
        scroll: { x: window.scrollX, y: window.scrollY },
      }));
      assert.equal(focus.activeId, "ide-display-canvas", `desktop canvas lost focus after ${key}`);
      assert.equal(focus.url, focusUrl, `desktop URL changed after ${key}`);
      assert.deepEqual(focus.scroll, focusScroll, `desktop page scrolled after ${key}`);
      assert.equal(await page.locator("#rm-search").evaluate((el) => document.activeElement === el), false,
        `roadmap search stole focus after ${key}`);
    }
    assert.equal(await page.locator("#omarchy-desktop-status").textContent(), "desktop · ready · drag to resize");
    await dispatch(page, "wvm:guest-output", { text: "late serial after desktop ready\n" });
    assert.equal(await page.locator("#omarchy-desktop-status").textContent(), "desktop · ready · drag to resize",
      "serial output does not change desktop-ready label");

    await page.locator("#omarchy-exit").click();
    await page.waitForURL((url) => !url.searchParams.has("desktop") && !url.searchParams.has("guest") && url.hash === "#ide");
    await page.locator("#os-launcher").waitFor({ state: "visible" });
    assert.equal(await page.locator("#ide-root").isVisible(), false, "Exit desktop returns to OS selector");

    for (const guest of ["alpine", "busybox"]) {
      await page.goto(normalUrl(guest), { waitUntil: "domcontentloaded" });
      await page.locator("#panel-ide").waitFor();
      assert.equal(await page.locator("html").getAttribute("data-wvm-desktop"), null,
        `${guest} route does not enter desktop mode`);
      // Mock only the user's OS selection so the normal editor DOM is visible; no boot is invoked.
      await page.locator("#panel-ide").evaluate((el) => { el.dataset.osSelected = "true"; });
      assert.equal(await page.locator(".ide-editor-body").evaluate((el) => getComputedStyle(el).display), "flex",
        `${guest} route retains editor UI`);
      assert.equal(await page.locator(".ide-term-pane").evaluate((el) => getComputedStyle(el).display), "flex",
        `${guest} route retains terminal UI`);
      assert.equal(await page.locator(".ide-display-head").evaluate((el) => getComputedStyle(el).display), "flex",
        `${guest} route retains the editor display header`);
    }

    assert.equal(vmArtifactRequests().length, 0, "normal noAutoBoot routes must not request VM artifacts");
    console.log("PASS: desktop surface, lifecycle latch/reset, readiness hide, exit route, and normal editor routes");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
