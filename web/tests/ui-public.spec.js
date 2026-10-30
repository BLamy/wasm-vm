// E0-T30: homepage and public pages on the shared interface, driven through the real UI.
// Run with PW_DISABLE_TS_ESM=1 (tools/verify-ui-public.sh): the pinned Playwright 1.49.1
// deadlocks in its TS ESM loader under Node 24; this spec is plain JS.
import { expect as baseExpect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 10_000 });
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCENT = "rgb(228, 168, 83)";
const ROUTES = [
  ["/landing.html", "Linux in a browser tab."],
  ["/docs.html?page=overview", null],
  ["/roadmap.html", "Roadmap"],
  ["/products.html", null],
  ["/work-market.html", null],
  ["/security.html", null],
  ["/404.html", "This page does not exist."],
  ["/case-studies.html", "Case studies"],
  ["/case-study-riscv-os.html", "Prompting a RISC-V phone OS"],
  ["/case-study-ai-sandboxing.html", null],
  ["/case-study-deterministic-simulation.html", null],
];

function watch(page) {
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
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// Visible library controls under 44 px (react-aria's clipped screen-reader buttons excluded).
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll(".wv-ui :is(button, a[href], [role=radio])")]
  .filter((el) => {
    if (!el.getClientRects().length || el.closest("[hidden]")) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).clipPath === "inset(50%)") return false;
    return true;
  })
  .map((el) => {
    // A row link's hit area is its ::after, stretched over the positioned list row.
    const t = el.matches("[role=radio]") ? el.closest("label") ?? el : el.matches(".wv-row-link") ? el.offsetParent ?? el : el;
    const r = t.getBoundingClientRect();
    return { name: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
  })
  .filter((t) => t.h < 44 || t.w < 44));

for (const viewport of [{ width: 1280, height: 860 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`every public route at ${viewport.width}px: shared nav, no errors, no overflow`, async ({ browser }) => {
    const phone = viewport.width < 760;
    const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const errors = watch(page);
    for (const [route, heading] of ROUTES) {
      await page.goto(route);
      const nav = page.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"] nav[aria-label="Primary navigation"], .reader-header nav[aria-label="Primary navigation"]');
      await expect(nav.first(), route).toBeVisible();
      if (heading) await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(heading);
      else await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(await overflowX(page), route).toBe(0);
      if (phone) {
        await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
        expect(await smallTargets(page), route).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("homepage: one primary action, and it starts the real BusyBox guest", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/landing.html");
  const primaries = await page.locator("main .wv-ui :is(a, button)").evaluateAll((els, accent) =>
    els.filter((el) => el.getClientRects().length && getComputedStyle(el).backgroundColor === accent).map((el) => el.textContent.trim()), ACCENT);
  expect(primaries).toEqual(["Start Linux"]);
  // The header's machine link is secondary on the homepage.
  const headerCta = page.locator("header").getByRole("link", { name: "Open the machine" });
  expect(await headerCta.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(ACCENT);
  // No decorative full-screen shader; the model is the visual.
  await expect(page.locator("#hero-canvas")).toHaveCount(0);

  await page.getByRole("link", { name: "Start Linux" }).click();
  await expect(page).toHaveURL(/index\.html\?guest=busybox#ide$/);
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90_000 });
  await page.locator("#term").click();
  await page.keyboard.type("printf 'home-%s\\n' $((40+2))\n");
  await expect.poll(() => page.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd())), { timeout: 30_000 })
    .toContain("home-42");
  expect(errors).toEqual([]);
});

test("architecture model: library layer and motion controls drive the real scene", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/landing.html");
  const canvas = page.locator("#machine-canvas");
  await expect(canvas).toHaveAttribute("data-model-ready", "true");
  const layers = page.getByRole("radiogroup", { name: "Inspect a layer of the machine" });
  await layers.getByText("Devices", { exact: true }).click();
  await expect(canvas).toHaveAttribute("data-selected-layer", "devices");
  await expect(page.locator("#model-caption")).toContainText("Virtual devices.");
  await expect(page.locator("[data-model-label]")).toHaveText("03 / Virtual devices");
  await expect(page.locator('.model-controls [data-layer="devices"]')).toHaveAttribute("aria-pressed", "true");
  // Keyboard: arrows move the selection and the scene follows.
  await layers.getByRole("radio", { name: "Devices" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-selected-layer", "linux");
  await expect(page.locator("#model-caption")).toContainText("Unmodified Linux.");
  // Motion.
  const motion = page.locator('[data-wv="model-motion"]');
  const before = await canvas.getAttribute("data-motion");
  await motion.click();
  await expect(canvas).not.toHaveAttribute("data-motion", before);
  await expect(motion).toHaveText(before === "animated" ? "Resume motion" : "Pause motion");
  expect(errors).toEqual([]);
});

test("architecture model: reduced motion starts paused", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/landing.html");
  await expect(page.locator("#machine-canvas")).toHaveAttribute("data-motion", "paused");
  await expect(page.locator('[data-wv="model-motion"]')).toHaveText("Resume motion");
  await context.close();
});

test("architecture model: without WebGL the text fallback still follows the library control", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/i.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await page.goto("/landing.html");
  await expect(page.locator(".model-fallback")).toBeVisible();
  await expect(page.locator('[data-wv="model-motion"]')).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "Inspect a layer of the machine" }).getByText("Memory", { exact: true }).click();
  await expect(page.locator("#model-caption")).toContainText("Guest memory.");
});

test("homepage: embedded session and measurement tables (every figure from its JSON)", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/landing.html");
  // Embedded session loads the app's embed mode on request.
  await page.getByRole("button", { name: "Start it here" }).click();
  const frame = page.locator('iframe[title="wasm-vm guest console"]');
  await expect(frame).toHaveAttribute("src", /index\.html\?embed=1&noAutoBoot#ide$/);
  await expect(page.locator('[data-wv="live-state"]')).toHaveText("Session open", { timeout: 30_000 });

  // Measurements: collapsed behind a library button, populated either way.
  const toggle = page.getByRole("button", { name: "Show the measurement tables" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#bench-detail")).toBeHidden();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Hide the measurement tables" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#bench-detail")).toBeVisible();
  const workloads = JSON.parse(fs.readFileSync(path.join(WEB, "runtime-benchmarks.json"), "utf8"));
  const compute = JSON.parse(fs.readFileSync(path.join(WEB, "runtime-compute-benchmarks.json"), "utf8"));
  await expect(page.locator("#workload-rows tr")).toHaveCount(workloads.environments.length + workloads.notRun.length);
  const workloadRows = await page.locator("#workload-rows tr").allTextContents();
  workloads.environments.forEach((env, i) => {
    for (const w of env.workloads) {
      if (w.status === "measured") expect(workloadRows[i], `${env.id} ${w.id}`).toContain(`${w.summary.medianMs.toFixed(1)} ms`);
      else expect(workloadRows[i], `${env.id} ${w.id}`).toContain("not measured");
    }
  });
  const computeRows = await page.locator("#compute-rows tr").allTextContents();
  compute.environments.forEach((env, i) => {
    for (const w of env.workloads ?? []) {
      if (w.status === "measured") expect(computeRows[i], `${env.id} ${w.id}`).toContain(`${w.summary.medianMs.toFixed(2)} ms`);
    }
  });
  for (const href of ["./runtime-benchmarks.json", "./runtime-compute-benchmarks.json", "./bench-runtime-workloads.mjs", "./bench-runtime-compute.mjs"]) {
    await expect(page.locator(`#bench-detail a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator(".home-facts a[href='./docs.html?page=reference-docs-level1-report']")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("docs: search, subject filter, archive, source link, history and outline", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/docs.html?page=overview");
  await expect(page.locator(".reader-document h1")).toBeVisible();
  // The Docstream article is never inside a .wv-ui root.
  expect(await page.locator(".reader-document").evaluate((el) => Boolean(el.closest(".wv-ui")))).toBe(false);
  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(search).toBeFocused();
  await search.fill("dimensional");
  await expect(page.locator(".search-count")).toContainText("matching pages");
  const links = page.locator(".reader-sidebar nav a");
  expect(await links.count()).toBeGreaterThan(0);
  await search.fill("");
  // Subject filter through the library Select.
  await page.getByRole("button", { name: /Reference subject/ }).click();
  const option = page.getByRole("option").nth(1);
  const subject = (await option.textContent()).trim();
  await option.click();
  const smalls = await page.locator(".reader-sidebar nav a small").allTextContents();
  expect(smalls.length).toBeGreaterThan(0);
  expect(smalls.every((s) => s === subject)).toBe(true);
  // Archive ledger.
  const archive = page.locator('[data-wv="docs-archive"]');
  await archive.click();
  await expect(archive).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".archive-list")).toBeVisible();
  await archive.click();
  // Navigate, check source and outline, then go back.
  await page.goto("/docs.html?page=overview");
  await page.locator('.reader-sidebar nav a[href="./docs.html?page=quickstart"]').click();
  await expect(page).toHaveURL(/page=quickstart/);
  await expect(page.locator(".reader-provenance a")).toHaveAttribute("href", /docs-source|github|\.md/);
  expect(await page.locator(".reader-outline nav a").count()).toBeGreaterThan(0);
  const title = await page.locator(".reader-document h1").textContent();
  await page.goBack();
  await expect(page).toHaveURL(/page=overview/);
  await expect(page.locator(".reader-document h1")).not.toHaveText(title);
  // Legacy alias.
  await page.goto("/docs-embedding.html");
  await expect(page.locator('.reader-sidebar a[aria-current="page"][href="./docs.html?page=embedding"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("docs on a phone: Browse docs opens the library; its own Close or a choice closes it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/docs.html?page=overview");
  const browse = page.locator('[data-wv="docs-menu"]');
  await browse.tap();
  await expect(browse).toHaveAttribute("aria-expanded", "true");
  // The open library covers the page; its own Close is visible, focused and returns focus.
  const close = page.locator('[data-wv="docs-menu-close"]');
  await expect(close).toBeFocused();
  await close.tap();
  await expect(browse).toHaveAttribute("aria-expanded", "false");
  await expect(browse).toBeFocused();
  await browse.tap();
  await page.getByRole("searchbox", { name: "Search documentation" }).fill("storage");
  await page.locator(".reader-sidebar nav a").first().tap();
  await expect(browse).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".reader-document h1")).toBeVisible();
  expect(await overflowX(page)).toBe(0);
  // Where the library is always beside the page, there is no toggle.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(browse).toBeHidden();
  await expect(page.locator(".reader-sidebar")).toBeVisible();
  await context.close();
});

test("roadmap: library search, view, filters and task detail operate roadmap.js", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/roadmap.html");
  await expect(page.locator("#rm-headline")).toContainText("tasks verified");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("one obvious start");
  await expect(page.locator("#rm-search")).toHaveValue("one obvious start");
  await expect(page.locator("#rm-count")).toHaveText(/^1 of /);
  const view = page.getByRole("radiogroup", { name: "Roadmap view" });
  await view.getByText("Kanban", { exact: true }).click();
  await expect(page.locator("#rm-view-board")).toHaveAttribute("aria-selected", "true");
  const card = page.locator(".rm-card").first();
  await card.click();
  await expect(page.locator("#rm-detail")).toBeVisible();
  await expect(page.locator(".rm-detail-id")).toHaveText("E0-T29");
  const close = page.locator('[data-wv="rm-close"]');
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator("#rm-detail")).toBeHidden();
  await expect(card).toBeFocused();
  await card.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#rm-detail")).toBeHidden();
  // Filters through the library Selects.
  await search.fill("");
  await page.getByRole("button", { name: / Status$/ }).click();
  await page.getByRole("option", { name: "verified", exact: true }).click();
  await expect(page.locator("#rm-status")).toHaveValue("verified");
  expect(await page.locator(".rm-card").count()).toBeGreaterThan(0);
  await expect(page.locator(".rm-card:not(.st-verified)")).toHaveCount(0);
  await page.getByRole("button", { name: / Epic$/ }).click();
  await page.getByRole("option").nth(1).click();
  expect(await page.locator("#rm-epic").inputValue()).not.toBe("");
  // "/" focuses the library search.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  expect(errors).toEqual([]);
});

test("app: Docs opens in a new tab and the running guest is untouched", async ({ page, context }) => {
  await page.goto("/index.html?nosw&guest=busybox#ide");
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90_000 });
  const session = await page.evaluate(() => window.wvmDemo.guestSession());
  const docs = page.locator("header").getByRole("link", { name: "Docs (opens in a new tab)" });
  await expect(docs).toHaveAttribute("target", "_blank");
  const [popup] = await Promise.all([context.waitForEvent("page"), docs.click()]);
  await popup.waitForLoadState();
  await expect(popup).toHaveURL(/docs\.html$/);
  await expect(page).toHaveURL(/index\.html\?nosw&guest=busybox#ide$/);
  expect(await page.evaluate(() => window.wvmDemo.guestSession())).toEqual(session);
  expect(await page.evaluate(() => window.wvmDemo.isGuestReady())).toBe(true);
  // The docs tab does not start a guest of its own.
  expect(await popup.evaluate(() => typeof window.wvmDemo)).toBe("undefined");
  await popup.close();
});

// PR 626's four case-study routes on the shared interface: reachable from the homepage and the
// shared nav, every story, status, anchor and source link kept, proposals labelled as such.
test("case studies: home list, index and three articles keep their stories, statuses and anchors", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/landing.html");
  const cases = page.locator("#cases");
  const studies = [
    ["Prompting a RISC-V phone OS", "./case-study-riscv-os.html", "In progress · Phase 0"],
    ["AI Sandboxing", "./case-study-ai-sandboxing.html", "Architecture study · proposed hosted deployment"],
    ["Deterministic simulation + time travel debugging", "./case-study-deterministic-simulation.html", "Workflow study · integration proposed"],
  ];
  for (const [title, href, status] of studies) {
    const item = cases.locator(".case-item", { has: page.getByRole("link", { name: title, exact: true }) });
    await expect(item.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", href);
    await expect(item.locator(".case-status")).toHaveText(status);
  }
  await cases.getByRole("link", { name: "All case studies →" }).click();
  await expect(page).toHaveURL(/\/case-studies\.html$/);
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Case studies", exact: true })).toHaveAttribute("aria-current", "page");
  for (const [title, href, status] of studies) {
    const item = page.locator(".case-item", { has: page.getByRole("link", { name: title, exact: true }) });
    await expect(item.locator(".case-status")).toHaveText(status);
    await expect(item.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("link", { name: "What are you building? ↗" })).toHaveAttribute("href", "https://github.com/BLamy/wasm-vm/issues");

  // Each article: its proposal label, the anchors other pages link to, its status section and
  // its source links.
  const articles = [
    ["/case-study-riscv-os.html", "RV-Phone / Phase 0 in progress / phone image not yet booted", ["#loop", "#status"], "No completed in-browser phone boot is claimed yet.", []],
    ["/case-study-ai-sandboxing.html", "AI Sandboxing / architecture study / hosted deployment proposed", ["#layers", "#status"], "Proposed deployment",
      ["https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md", "https://v8.dev/blog/sandbox", "https://webassembly.org/docs/security/"]],
    ["/case-study-deterministic-simulation.html", "Deterministic simulation / workflow study / integration proposed", ["#workflow", "#status"], "they do not establish that this simulation workload runs",
      ["https://celld.dev/docs/engineering/deterministic-simulation-testing/"]],
  ];
  for (const [route, label, anchors, statusText, sources] of articles) {
    await page.goto(route);
    await expect(page.locator(".proposal-label")).toHaveText(label);
    for (const anchor of anchors) await expect(page.locator(anchor)).toHaveCount(1);
    await expect(page.locator("#status")).toContainText(statusText);
    for (const href of sources) expect(await page.locator(`a[href="${href}"]`).count(), href).toBeGreaterThan(0);
    // Shared interface, not the retired stylesheet.
    await expect(page.locator('link[href*="marketing.css"]')).toHaveCount(0);
    await expect(page.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(21, 20, 16)");
  }
  // Deep link into an article lands on its anchor.
  await page.goto("/case-study-deterministic-simulation.html#workflow");
  await expect(page.locator("#workflow")).toBeInViewport();
  // The security page keeps 626's pointer to the sandboxing study.
  await page.goto("/security.html");
  await expect(page.getByRole("link", { name: "Read the AI Sandboxing architecture study →" })).toHaveAttribute("href", "./case-study-ai-sandboxing.html");
  expect(errors).toEqual([]);
});

test("case studies on a phone: the comparison table stacks, nothing overflows, nav reaches them", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/landing.html");
  await page.getByRole("button", { name: "Open menu" }).tap();
  await page.getByRole("dialog", { name: "Site menu" }).getByRole("link", { name: "Case studies", exact: true }).tap();
  await expect(page).toHaveURL(/\/case-studies\.html$/);
  await page.getByRole("link", { name: "Prompting a RISC-V phone OS", exact: true }).tap();
  await expect(page).toHaveURL(/\/case-study-riscv-os\.html$/);
  const table = page.locator(".case-table");
  await table.scrollIntoViewIfNeeded();
  await expect(table.locator("thead")).toBeHidden();
  expect(await table.locator("tbody td").first().evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"Typical dev-board path"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await context.close();
});

// Standalone text actions are ordinary phone targets too, even outside a library island.
// Inline references inside prose are deliberately outside this acceptance check.
for (const width of [390, 360]) {
  test(`standalone public actions have 44 px phone targets at ${width}px`, async ({ browser }) => {
    test.setTimeout(45_000);
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const actions = [
      ["/case-study-riscv-os.html", "See the current status →", /case-study-riscv-os\.html#status$/],
      ["/landing.html", "All case studies →", /\/case-studies\.html$/],
      ["/case-studies.html", "Open the live machine →", /\/index\.html#ide$/],
    ];
    try {
      for (const [route, name, target] of actions) {
        await page.goto(route);
        const action = page.getByRole("link", { name, exact: true });
        await action.scrollIntoViewIfNeeded();
        const box = await action.boundingBox();
        expect(box, name).not.toBeNull();
        // Check owned hit geometry, including a valid expanded pseudo-element. A mobile
        // browser may redirect nearby touches, so touch adjustment alone cannot prove size.
        const band = await action.evaluate((el) => {
          const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = (dx, dy) => document.elementFromPoint(x + dx, y + dy)?.closest("a") === el;
          return { top: hit(0, -21.5), bottom: hit(0, 21.5), left: hit(-21.5, 0), right: hit(21.5, 0) };
        });
        expect(band, `${name}: owned 44 px phone hit band`).toEqual({ top: true, bottom: true, left: true, right: true });
        // A real tap at the bottom of that band must reach the named action.
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 + 21.5);
        await expect(page).toHaveURL(target);
      }
    } finally {
      await context.close();
    }
  });
}
