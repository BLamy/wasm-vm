// E0-T28: shared interface foundation. The bundle is built from web/ui/src by tools/build-ui.mjs
// (make web-build). These checks run against the served source tree.
//
// Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-foundation.sh sets it): under Node 24 the pinned
// Playwright 1.49.1's TypeScript ESM loader hook deadlocks before test discovery, even for
// `--list`. This spec is plain JS, so it does not need that loader.
import { expect as baseExpect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// UI-only deadlines. The config's 240 s / 180 s defaults exist for guest boots; nothing here boots
// a guest, so a broken control should fail in seconds rather than minutes.
test.setTimeout(45_000);
const expect = baseExpect.configure({ timeout: 5_000 });

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCENT_RGB = "rgb(228, 168, 83)";

// Console errors and failed requests, minus the browser's favicon probe. Chrome also logs every
// failed request as a generic "Failed to load resource" console error; those are tracked by URL
// through the response listener instead, where the favicon can be told apart.
function watchErrors(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return errors;
}

test("interface kit renders library controls and they operate", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/ui-kit.html");
  await expect(page.locator("html")).toHaveAttribute("data-wv-ui", "kit");

  // Real library output, not lookalikes: the library's own data-slot markers.
  for (const slot of ["bl-provider", "button", "list", "list-row", "switch", "segmented", "select", "text-field", "badge"]) {
    await expect(page.locator(`[data-slot="${slot}"]`).first(), slot).toBeAttached();
  }

  // Type: self-hosted IBM Plex, actually loaded.
  const h1 = page.getByRole("heading", { level: 1, name: "Interface kit" });
  await expect(h1).toHaveCSS("font-family", /IBM Plex Sans/);
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 16px "IBM Plex Sans"'); })).toBe(true);

  // Accent: the primary button uses the one accent.
  await expect(page.getByRole("button", { name: "Start machine" })).toHaveCSS("background-color", ACCENT_RGB);

  const values = page.locator('[data-wv="kit-values"]');
  await expect(values).toHaveText(/speed=auto machine=busybox network=true persist=false name=-/);

  // react-aria keeps the switch's <input> visually hidden under its row; a person presses the row.
  const persist = page.getByRole("switch", { name: "Keep disk changes" });
  await expect(persist).not.toBeChecked();
  await page.locator('[data-slot="list-row-content"]', { hasText: "Keep disk changes" }).click();
  await expect(persist).toBeChecked();
  await expect(values).toContainText("persist=true");

  await page.getByRole("radio", { name: "Automatic" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(values).toContainText("speed=jit");

  await page.getByRole("button", { name: /BusyBox shell/ }).click();
  await page.getByRole("option", { name: "Alpine Linux" }).click();
  await expect(values).toContainText("machine=alpine");

  await page.getByRole("textbox", { name: "Machine name" }).fill("lab-1");
  await expect(values).toContainText("name=lab-1");

  await page.getByRole("button", { name: "Open dialog" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Reset" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator('[data-wv="kit-status"]')).toHaveText("Reset confirmed");

  expect(errors).toEqual([]);
});

test("kit fits a narrow desktop window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-kit.html");
  await expect(page.locator("html")).toHaveAttribute("data-wv-ui", "kit");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("shared nav collapses to a sheet on a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto("/ui-kit.html");
  await expect(page.locator("html")).toHaveAttribute("data-wv-ui", "kit");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Docs" })).toBeHidden();
  const menu = nav.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(32);

  await menu.tap();
  const sheet = page.getByRole("dialog", { name: "Site menu" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "./docs.html");
  await expect(sheet.getByRole("link", { name: "Case studies" })).toHaveAttribute("href", "./case-studies.html");
  await expect(sheet.getByRole("link", { name: "Open the machine" })).toHaveAttribute("href", "./index.html#ide");
  await expect(sheet.getByRole("link", { name: "Display and serial" })).toHaveAttribute("href", "./console-capture.html");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});

test("app shell mounts the shared nav without disturbing runtime-owned DOM", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/index.html?nosw#ide");
  await expect(page.locator("html")).toHaveAttribute("data-wv-ui", "site-nav");

  const header = page.locator("body > header");
  const island = header.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]');
  await expect(island.locator('[data-slot="bl-provider"]')).toBeAttached();
  // The island fills its mount point, so the nav's trailing actions reach the header's edge.
  const [mountWidth, rootWidth] = await island.evaluate((el) => [el.clientWidth, el.querySelector('[data-slot="bl-provider"]').getBoundingClientRect().width]);
  expect(Math.abs(mountWidth - rootWidth)).toBeLessThanOrEqual(1);

  // The app entry keeps the address the existing suite and bookmarks use.
  const demo = island.locator('.tab[data-tab="ide"]');
  await expect(demo).toHaveCount(1);
  await expect(demo).toHaveAttribute("aria-current", "page");
  await expect(demo).toHaveAttribute("href", "#ide");

  // main.js owns these header nodes; they stay outside the React root.
  for (const id of ["version", "audio-autoplay-badge"]) {
    await expect(header.locator(`#${id}`)).toHaveCount(1);
    await expect(island.locator(`#${id}`)).toHaveCount(0);
  }

  // Every id written in the source page still exists after mounting.
  const source = fs.readFileSync(path.join(WEB_ROOT, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, "");
  const ids = [...new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  expect(ids.length).toBeGreaterThan(50);
  const missing = await page.evaluate((list) => list.filter((id) => !document.getElementById(id)), ids);
  expect(missing).toEqual([]);

  // Cascade isolation: the app page styles bare `button` elements with unlayered CSS (border,
  // radius, background, 13px type, 32px min-height). The same library Button must compute exactly as
  // it does on the kit page, which has no legacy CSS at all.
  const trigger = island.getByRole("button", { name: "Diagnostics" });
  const PROPS = ["font-family", "font-size", "font-weight", "border-top-width", "border-top-style", "border-radius", "background-color", "color", "min-height", "height", "padding-left", "padding-right"];
  const read = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)]));
  const legacy = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((el) => !el.closest(".wv-ui"));
    return { fontSize: getComputedStyle(b).fontSize, minHeight: getComputedStyle(b).minHeight };
  });
  expect(legacy).toEqual({ fontSize: "13px", minHeight: "32px" }); // the rule being isolated is live
  const inApp = await trigger.evaluate(read, PROPS);
  const kit = await page.context().newPage();
  await kit.goto("/ui-kit.html");
  await expect(kit.locator("html")).toHaveAttribute("data-wv-ui", "kit");
  const inKit = await kit.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Diagnostics" }).evaluate(read, PROPS);
  await kit.close();
  expect(inApp).toEqual(inKit);
  expect(inApp["font-family"]).toMatch(/IBM Plex Sans/);

  // Dialogs portal into a viewport layer, not the header strip.
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Diagnostic pages" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(box.height).toBeGreaterThan(300);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  await expect(dialog.getByRole("link", { name: "Desktop cold boot" })).toHaveAttribute("href", "./desktop.html");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // The empty layer never intercepts the page.
  const layerHit = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-slot="wv-layer"]'));
  expect(layerHit).toBeNull();

  expect(errors).toEqual([]);
});

// Promoted by the fresh E0-T28 verifier. Href/visibility assertions alone missed that links
// nested in a List.Row title inherited pointer-events:none from the library label wrapper.
test("diagnostic routes accept a normal pointer click", async ({ page }) => {
  await page.goto("/index.html?nosw#ide");
  await page.getByRole("button", { name: "Diagnostics" }).click({ timeout: 5_000 });
  const dialog = page.getByRole("dialog", { name: "Diagnostic pages" });
  await dialog.getByRole("link", { name: "Interface kit", exact: true }).click({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/ui-kit\.html$/);
  await expect(page.getByRole("heading", { level: 1, name: "Interface kit" })).toBeVisible();
});

for (const activation of ["pointer", "keyboard"]) {
  test(`phone current-machine link preserves the document and dismisses the menu (${activation})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto("/index.html?nosw#ide");
      await page.getByRole("button", { name: "Open menu" }).click({ timeout: 5_000 });
      const sheet = page.getByRole("dialog", { name: "Site menu" });
      const currentMachine = sheet.getByRole("link", { name: "Open the machine" });
      const originalUrl = page.url();
      await page.evaluate(() => {
        window.__wvUiVerifierDocumentToken = "same-document";
        document.getElementById("ide-root").dataset.verifierToken = "same-ide";
      });
      if (activation === "pointer") {
        await currentMachine.click({ timeout: 5_000 });
      } else {
        await currentMachine.focus({ timeout: 5_000 });
        await page.keyboard.press("Enter");
      }
      await expect.poll(() => page.evaluate(() => ({
        document: window.__wvUiVerifierDocumentToken ?? null,
        ide: document.getElementById("ide-root")?.dataset.verifierToken ?? null,
      })).catch(() => ({ document: null, ide: null }))).toEqual({ document: "same-document", ide: "same-ide" });
      await expect(page).toHaveURL(originalUrl);
      await expect(sheet).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

// A shared link using buttonVariants must retain the same primary foreground as Button.
// A blanket anchor color rule previously made this text pale on the amber surface.
test("primary navigation action retains the library button foreground", async ({ page }) => {
  await page.goto("/ui-kit.html");
  const primaryButton = page.getByRole("button", { name: "Start machine", exact: true });
  const primaryLink = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Open the machine", exact: true });
  await expect(primaryButton).toHaveCSS("background-color", ACCENT_RGB);
  await expect(primaryLink).toHaveCSS("background-color", ACCENT_RGB);
  const foreground = await primaryButton.evaluate((el) => getComputedStyle(el).color);
  await expect(primaryLink).toHaveCSS("color", foreground);
});

// Worker additions for the E0-T28 r2 fixes (alongside the promoted cases above).
test("phone menu returns focus to the Menu button after in-document navigation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto("/index.html?nosw#ide");
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Site menu" });
    await sheet.getByRole("link", { name: "Open the machine" }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect(page).toHaveURL(/\/index\.html\?nosw#ide$/);
  } finally {
    await context.close();
  }
});

test("phone menu rows navigate on an ordinary tap", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto("/ui-kit.html");
    await page.getByRole("button", { name: "Open menu" }).tap();
    const sheet = page.getByRole("dialog", { name: "Site menu" });
    const docs = sheet.getByRole("link", { name: "Docs", exact: true });
    // A real link, hit-testable where it is drawn once the sheet has settled.
    await expect.poll(async () => {
      const box = await docs.boundingBox();
      return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
    }).toBe("./docs.html");
    await expect(docs).toHaveAccessibleName("Docs");
    await docs.tap();
    await expect(page).toHaveURL(/\/docs\.html/);
  } finally {
    await context.close();
  }
});

test("a link row is pressable across the row, including its chevron", async ({ page }) => {
  await page.goto("/ui-kit.html");
  const row = page.locator('[data-slot="list-row"]', { has: page.getByRole("link", { name: /Desktop cold boot/ }) }).last();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.click(box.x + box.width - 24, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/desktop\.html$/);
});

test("prose links keep link styling while nav and button links do not", async ({ page }) => {
  await page.goto("/ui-kit.html");
  const prose = page.locator(".wv-prose").getByRole("link", { name: "documentation" });
  await expect(prose).toHaveCSS("color", ACCENT_RGB);
  await expect(prose).toHaveCSS("text-decoration-line", "underline");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Docs", exact: true })).toHaveCSS("text-decoration-line", "none");
  await expect(nav.getByRole("link", { name: "Open the machine", exact: true })).toHaveCSS("text-decoration-line", "none");
});

// Case studies are a primary destination on every surface that carries the shared nav. The four
// existing pages stay where they are; the nav only makes the index reachable.
test("Case studies are reachable from the shared nav on desktop and phone", async ({ browser }) => {
  for (const phone of [false, true]) {
    const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
    try {
      const page = await context.newPage();
      await page.goto("/ui-kit.html");
      await expect(page.locator("html")).toHaveAttribute("data-wv-ui", "kit");
      const nav = page.getByRole("navigation", { name: "Primary navigation" });
      let link;
      if (phone) {
        await expect(nav.getByRole("link", { name: "Case studies" })).toBeHidden();
        await nav.getByRole("button", { name: "Open menu" }).tap();
        link = page.getByRole("dialog", { name: "Site menu" }).getByRole("link", { name: "Case studies", exact: true });
      } else {
        link = nav.getByRole("link", { name: "Case studies", exact: true });
      }
      await expect(link).toHaveAttribute("href", "./case-studies.html");
      await expect(link).not.toHaveAttribute("target", /.+/);
      phone ? await link.tap() : await link.click();
      await expect(page).toHaveURL(/\/case-studies\.html$/);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // The index still leads to the three existing studies.
      for (const study of ["case-study-ai-sandboxing.html", "case-study-deterministic-simulation.html", "case-study-riscv-os.html"]) {
        expect(await page.locator(`a[href="./${study}"]`).count(), study).toBeGreaterThan(0);
        expect((await page.request.get(`/${study}`)).status(), study).toBe(200);
      }
    } finally {
      await context.close();
    }
  }
});

// From the running app, reading pages open in a new tab; the app document (and so a running
// guest) is never navigated away. The current-machine entry stays in-document (tests above).
test("from the app, Docs, Case studies and Roadmap open in a new tab and leave the app document intact", async ({ browser }) => {
  for (const phone of [false, true]) {
    const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
    try {
      const page = await context.newPage();
      await page.goto("/index.html?nosw#ide");
      await expect(page.locator('body > header [data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
      const originalUrl = page.url();
      await page.evaluate(() => { window.__wvAppDocument = "kept"; });
      let scope = page.getByRole("navigation", { name: "Primary navigation" });
      if (phone) {
        await scope.getByRole("button", { name: "Open menu" }).tap();
        scope = page.getByRole("dialog", { name: "Site menu" });
      }
      for (const [name, href] of [["Docs", "./docs.html"], ["Case studies", "./case-studies.html"], ["Roadmap", "./roadmap.html"]]) {
        const link = phone ? scope.getByRole("link", { name, exact: true }) : scope.getByRole("link", { name: `${name} (opens in a new tab)` });
        await expect(link).toHaveAttribute("href", href);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
      const study = phone ? scope.getByRole("link", { name: "Case studies", exact: true }) : scope.getByRole("link", { name: "Case studies (opens in a new tab)" });
      const [popup] = await Promise.all([context.waitForEvent("page"), phone ? study.tap() : study.click()]);
      await popup.waitForLoadState();
      await expect(popup).toHaveURL(/\/case-studies\.html$/);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      expect(await page.evaluate(() => window.__wvAppDocument)).toBe("kept");
      await expect(page).toHaveURL(originalUrl);
      await popup.close();
    } finally {
      await context.close();
    }
  }
});

// The app header is the shared warm bar, and main.js's autoplay notice never occupies it: the
// controller still writes its state to #audio-autoplay-badge, but no write can show it there.
test("app header is the warm bar and the audio autoplay notice never shows in it", async ({ browser }) => {
  for (const viewport of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 760, hasTouch: viewport.width < 760 });
    try {
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto("/index.html?nosw#ide");
      const header = page.locator("body > header");
      await expect(header.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
      await expect(header).toHaveCSS("background-color", "rgba(21, 20, 16, 0.94)");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 13, 11)");
      const badge = page.locator("#audio-autoplay-badge");
      await expect.poll(() => badge.evaluate((el) => el.dataset.audioState ?? null)).toMatch(/^(locked|unlocking|unlocked|unavailable)$/);
      await expect(badge).toBeHidden();
      // A controller write that un-hides the node cannot bring it back into the header.
      await badge.evaluate((el) => { el.hidden = false; el.dataset.audioState = "unavailable"; });
      await expect(badge).toHaveCSS("display", "none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
