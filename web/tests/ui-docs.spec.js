// E0-T32: the docs reader on Docstream 1.33 and the current field guide, driven like a reader.
// Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-docs.sh): the pinned Playwright 1.49.1 deadlocks
// in its TS ESM loader under Node 24; this spec is plain JS.
import { expect as baseExpect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test.setTimeout(90_000);
const expect = baseExpect.configure({ timeout: 10_000 });
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(WEB, "docs-content/catalog.json"), "utf8"));
const page_ = (id) => catalog.pages.find((p) => p.id === id);
const ctrlK = process.platform === "darwin" ? "Meta+K" : "Control+K";

test.beforeEach(({ context }) => context.setDefaultTimeout(10_000));

function watch(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url()}`); });
  return errors;
}
// Measured against the configured viewport: in a mobile context, content wider than the screen
// widens the layout viewport (innerWidth) itself, which a scrollWidth - innerWidth check misses.
const overflowX = (page) => page.evaluate((width) => Math.max(document.documentElement.scrollWidth, innerWidth) - width, page.viewportSize().width);
// The element the URL hash names: present, focused, and on screen below the sticky header.
async function landedOn(page, id) {
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1)))).toBe(id);
  const heading = page.locator(`[id="${id}"]`);
  // Focus moved to the heading (checked on the document: a test page has no window focus until it
  // receives input, which toBeFocused() also requires).
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(id);
  // Late-loading diagrams and images can move it; the reader keeps it pinned while they settle.
  const header = await page.locator(".reader-header").boundingBox();
  await expect.poll(async () => {
    const box = await heading.boundingBox();
    return box.y >= header.y + header.height - 1 && box.y < (page.viewportSize().height * 2) / 3;
  }, { timeout: 8_000 }).toBe(true);
}

test("search: ranked section results; keyboard opens the exact heading; Back and Forward", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/docs.html?page=overview");
  await expect(page.locator(".reader-document h1")).toHaveText("A field guide to wasm-vm");
  // The catalog every page loads no longer carries the full text; search loads its corpus lazily.
  const corpusRequests = [];
  page.on("request", (r) => { if (r.url().includes("search-corpus.json")) corpusRequests.push(r.url()); });
  expect(corpusRequests).toEqual([]);
  await page.keyboard.press(ctrlK);
  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await expect(search).toBeFocused();
  await page.keyboard.type("continue from here");
  const results = page.getByRole("navigation", { name: "Search results" }).getByRole("link");
  await expect(page.locator(".search-count")).toHaveText(/^\d+ results?$/);
  expect(corpusRequests.length).toBe(1);
  // The best match is the time-travel guide's section, with an excerpt and the matched words marked.
  const first = results.first();
  await expect(first).toHaveAttribute("href", "./docs.html?page=time-travel#continue-from-the-past");
  await expect(first.locator("em")).toHaveText("Continue from the past");
  await expect(first.locator("mark").first()).toHaveText(/continue/i);
  // Keyboard: Tab to that result and press Enter.
  for (let i = 0; i < 12 && !(await first.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/docs\.html\?page=time-travel#continue-from-the-past$/);
  await expect(page.locator(".reader-document h1")).toHaveText("Record, rewind, and branch");
  await landedOn(page, "continue-from-the-past");
  // Diagram sources are not searched as text: excerpts stay readable prose.
  await search.focus();
  await search.fill("seek transition");
  const seek = results.first();
  await expect(seek).toHaveAttribute("href", "./docs.html?page=time-travel#move-through-history");
  await expect(seek.locator(".reader-result-snippet")).not.toContainText("-->");
  await search.fill("");
  await page.goBack();
  await expect(page).toHaveURL(/page=overview$/);
  await expect(page.locator(".reader-document h1")).toHaveText("A field guide to wasm-vm");
  await page.goForward();
  await expect(page.locator(".reader-document h1")).toHaveText("Record, rewind, and branch");
  await landedOn(page, "continue-from-the-past");
  expect(errors).toEqual([]);
});

test("search lands on the heading the reader renders, not the library's raw slug", async ({ page }) => {
  // Docstream's search slugs `div_by_zero.S` as "divbyzero-s"; the rendered heading is
  // "div-by-zero-s". The reader aligns search sections with its rendered headings.
  await page.goto("/docs.html?page=overview");
  await page.getByRole("searchbox", { name: "Search documentation" }).fill("div_by_zero");
  const result = page.getByRole("navigation", { name: "Search results" }).getByRole("link").first();
  await expect(result).toHaveAttribute("href", "./docs.html?page=reference-tools-fuzz-sensitivity-readme#div-by-zero-s");
  await result.click();
  await landedOn(page, "div-by-zero-s");
  await expect(page.locator('[id="div-by-zero-s"]')).toHaveText("div_by_zero.S");
  // Every rendered heading id on the page is unique, and the outline links to those ids.
  const ids = await page.locator(".reader-document :is(h1,h2,h3,h4,h5,h6)[id]").evaluateAll((els) => els.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const href of await page.locator(".reader-outline nav a").evaluateAll((els) => els.map((a) => a.getAttribute("href").slice(1)))) expect(ids).toContain(href);
});

test("direct URL with a hash, every alias entry page, and a superseded load", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/docs.html?page=time-travel#transfer-a-recording");
  await landedOn(page, "transfer-a-recording");
  for (const [alias, id] of [["docs.html", "overview"], ["docs-embedding.html", "embedding"], ["docs-guest.html", "storage"], ["docs-containers.html", "containers"], ["docs-verification.html", "verification"], ["docs-explainers.html", "explainers"]]) {
    await page.goto(`/${alias}`);
    await expect(page.locator(`.reader-sidebar a[aria-current="page"][href="./docs.html?page=${id}"]`)).toHaveCount(1);
    await expect(page.locator(".reader-document h1")).toBeVisible();
  }
  // A slow page answer must not overwrite a newer navigation.
  await page.goto("/docs.html?page=overview");
  await page.route("**/docs-content/quickstart.md*", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.locator('.reader-sidebar nav a[href="./docs.html?page=quickstart"]').click();
  await page.locator('.reader-sidebar nav a[href="./docs.html?page=networking"]').click();
  await expect(page.locator(".reader-document h1")).toHaveText("Connect the guest deliberately");
  await page.waitForTimeout(2000);
  await expect(page.locator(".reader-document h1")).toHaveText("Connect the guest deliberately");
  await expect(page).toHaveURL(/page=networking$/);
  expect(errors).toEqual([]);
});

test("current references: separate revision, provenance, Markdown and source actions", async ({ page, request }) => {
  const errors = watch(page);
  const ref = page_("current-docs-design-session-replay");
  expect(ref.sourceRevision).toBe(catalog.currentRevision);
  expect(ref.sourceRevision).not.toBe(catalog.sourceRevision);
  await page.goto("/docs.html?page=time-travel#current-references");
  await page.locator(".reader-document").getByRole("link", { name: "Session replay" }).click();
  await expect(page).toHaveURL(/page=current-docs-design-session-replay$/);
  await expect(page.locator(".reader-provenance span")).toHaveText("Current reference");
  const source = page.locator(".reader-provenance a");
  await expect(source).toHaveText(`Source: docs/design/session-replay.md @ ${ref.sourceRevision.slice(0, 9)} ↗`);
  await expect(source).toHaveAttribute("href", `https://github.com/BLamy/wasm-vm/blob/${ref.sourceRevision}/docs/design/session-replay.md`);
  await expect(page.locator(".reader-sidebar a[aria-current=page]")).toHaveText(/Session replay/);
  await expect(page.locator(".reader-sidebar section", { has: page.locator('a[aria-current="page"]') }).locator("h2")).toHaveText("Current references");
  // That in-article link navigated in place (Docstream marks article links target=_blank), so Back
  // returns to the guide section, and no extra tab opened.
  expect(page.context().pages().length).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/page=time-travel#current-references$/);
  await expect(page.locator(".reader-document h1")).toHaveText("Record, rewind, and branch");
  // An in-page anchor link moves to its section on the same page.
  await page.goto("/docs.html?page=storage");
  await page.locator('.reader-document a[href="#local-recording-files"]').click();
  await landedOn(page, "local-recording-files");
  await page.goto("/docs.html?page=current-docs-design-session-replay");
  // Download Markdown names the exact published bytes.
  const download = page.getByRole("link", { name: "Download Markdown" });
  await expect(download).toHaveAttribute("download", "current-docs-design-session-replay.md");
  const body = await (await request.get(`/docs-content/current-docs-design-session-replay.md`)).text();
  expect(body).toContain(`source_revision: "${ref.sourceRevision}"`);
  await expect(page.getByRole("button", { name: "Copy page" })).toBeVisible();
  // The coverage page states the boundary.
  await page.goto("/docs.html?page=coverage#current-references");
  await landedOn(page, "current-references");
  await expect(page.locator(".reader-document")).toContainText("do not change the migration ledger");
  expect(errors).toEqual([]);
});

test("guides: real diagram, per-document image, architecture demo and quickstart routes", async ({ page, request }) => {
  const errors = watch(page);
  // A Mermaid diagram drawn by Pele beside its source.
  await page.goto("/docs.html?page=time-travel");
  const diagram = page.locator(".docs-mermaid-preview");
  await expect(diagram.locator(".docs-split-source")).toContainText("flowchart LR");
  await expect(diagram.locator(".docs-mermaid svg")).toBeVisible({ timeout: 15_000 });
  await expect(diagram.locator(".docs-mermaid svg")).toContainText("Open replay");
  // A real capture, resolved next to this page's Markdown, with the full image on focus.
  const thumb = page.locator(".docs-thumb").first();
  const src = await thumb.locator(".docs-thumb-frame img").getAttribute("src");
  expect(new URL(src).pathname).toBe("/docs-content/images/recordings.png");
  await expect.poll(() => thumb.locator(".docs-thumb-frame img").evaluate((img) => img.naturalWidth)).toBe(1440);
  await thumb.hover();
  await expect(thumb.locator(".docs-thumb-card img")).toBeVisible();
  await expect(thumb).toHaveAttribute("aria-label", /Recordings pane/);
  // The architecture demo runs and shows its real source.
  await page.goto("/docs.html?page=architecture");
  await page.getByRole("button", { name: "Bare-metal ELF" }).click();
  await expect(page.locator(".architecture-demo ol")).toContainText("WasmMachine");
  await page.getByRole("button", { name: "View Code" }).click();
  await expect(page.locator(".reader-document")).toContainText("export default function ArchitectureDemo");
  // Quickstart: the machine link and the recommended start exist in this tree.
  await page.goto("/docs.html?page=quickstart");
  await expect(page.locator(".reader-document h1")).toHaveText("Boot your first guest");
  const machine = page.locator('.reader-document a[href="./index.html#ide"]').first();
  expect((await request.get(new URL(await machine.getAttribute("href"), page.url()).href)).status()).toBe(200);
  await expect(page.locator(".reader-document")).toContainText("Start Linux");
  await expect(page.locator('.reader-document img[src$="/docs-content/images/launcher.png"]').first()).toBeAttached();
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
  test(`phone ${viewport.width}: search from the library overlay, focus stays inside it, tables scroll`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    const errors = watch(page);
    await page.goto("/docs.html?page=overview");
    const browse = page.locator('[data-wv="docs-menu"]');
    await browse.tap();
    const close = page.locator('[data-wv="docs-menu-close"]');
    await expect(close).toBeFocused();
    // Tab and Shift+Tab stay inside the open library.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#docs-sidebar")))).toBe(true);
    }
    await page.getByRole("searchbox", { name: "Search documentation" }).fill("storage limits");
    const result = page.locator('[data-wv="docs-result"]').first();
    await expect(result).toBeVisible();
    const box = await result.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    const href = await result.getAttribute("href");
    await result.tap();
    await expect(browse).toHaveAttribute("aria-expanded", "false");
    const anchor = decodeURIComponent(href.split("#")[1]);
    await landedOn(page, anchor);
    expect(await overflowX(page)).toBe(0);
    // Close returns focus to Browse docs.
    await browse.tap();
    await page.locator('[data-wv="docs-menu-close"]').tap();
    await expect(browse).toBeFocused();
    // The quickstart's capture thumbnail opens its full-size card inside the screen.
    await page.goto("/docs.html?page=quickstart");
    await expect(page.locator(".reader-document h1")).toHaveText("Boot your first guest");
    const thumb = page.locator(".docs-thumb").first();
    await expect(thumb).toBeAttached();
    expect(await overflowX(page)).toBe(0);
    await thumb.scrollIntoViewIfNeeded();
    await thumb.tap();
    const card = thumb.locator(".docs-thumb-card");
    await expect(card).toBeVisible();
    expect((await card.boundingBox()).x + (await card.boundingBox()).width).toBeLessThanOrEqual(viewport.width);
    // A wide reference table keeps its columns and scrolls inside its own box.
    await page.goto("/docs.html?page=reference-docs-container-matrix");
    const table = page.locator(".reader-document .docs-table").first();
    await table.scrollIntoViewIfNeeded();
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(page.locator(".reader-scroll-hint").first()).toBeVisible();
    expect(await overflowX(page)).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
