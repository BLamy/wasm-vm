// Promoted by the fresh E0-T28 verifier on the PR626 integration. Document tokens alone
// cannot prove that separate-context help navigation preserves a running real machine.
import { test, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 5_000 });

test("phone keyboard Case studies navigation preserves the real guest and its file", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(6_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto("/index.html?nosw&testHooks&noAutoBoot#ide");
    await expect(page.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
    // E0-T29 harness repair: main.js binds the native [data-os] buttons only after probing the image
    // manifests and then marks data-launcher-ready; a tap before that reaches no handler.
    await expect(page.locator("html")).toHaveAttribute("data-launcher-ready", "true", { timeout: 30_000 });
    await page.locator('.os-option[data-os="busybox"]').tap();
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 75_000 });
    // On the first guest-ready ide.js lists /root through a quiet fenced RPC on the same serial
    // path; type after that startup listing has rendered (or reported its error).
    await page.waitForFunction(() => !document.querySelector("#ide-explorer .ide-spin")
      && Boolean(document.querySelector("#ide-explorer .ide-node, #ide-explorer .ide-explorer-ph")), null, { timeout: 30_000 });
    const rows = () => page.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((row) => row.textContent.trimEnd()));
    await page.locator("#term").tap();
    await page.keyboard.type("printf 'nav-%s-%s\\n' setup 626\n", { delay: 12 });
    await expect.poll(rows, { timeout: 10_000 }).toContain("nav-setup-626");
    await page.keyboard.type("printf 'nav-%s-%s\\n' survived 626 > /tmp/ui-nav-626.txt; printf 'prepared-%s\\n' 626\n", { delay: 12 });
    await expect.poll(rows, { timeout: 10_000 }).toContain("prepared-626");

    const before = await page.evaluate(() => {
      window.__foundationGuestBefore = { controller: window.__linuxCtl, ide: document.getElementById("ide-root") };
      return { url: location.href, session: window.wvmDemo.guestSession() };
    });
    await page.getByRole("button", { name: "Open menu", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "Site menu" });
    const studies = sheet.getByRole("link", { name: "Case studies", exact: true });
    await studies.focus();
    await expect(studies).toBeFocused();
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 6_000 }), page.keyboard.press("Enter")]);
    await popup.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await expect(popup).toHaveURL(/\/case-studies\.html$/);
    // E0-T30 moved the index onto the shared site with a plain heading.
    await expect(popup.getByRole("heading", { level: 1 })).toHaveText("Case studies");
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await page.bringToFront();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Isolate guest survival from PR626's existing native terminal touch-focus behavior.
    // This calls its focus-only API; all input below still uses actual keyboard events.
    await page.evaluate(() => window.wvmDemo.focusTerminal());
    await expect(page.locator("#term textarea.xterm-helper-textarea")).toBeFocused();
    await page.keyboard.type("cat /tmp/ui-nav-626.txt\n", { delay: 12 });
    await expect.poll(rows, { timeout: 10_000 }).toContain("nav-survived-626");
    const after = await page.evaluate(() => ({
      url: location.href,
      session: window.wvmDemo.guestSession(),
      sameController: window.__foundationGuestBefore.controller === window.__linuxCtl,
      sameIde: window.__foundationGuestBefore.ide === document.getElementById("ide-root"),
      ready: window.wvmDemo.isGuestReady(),
    }));
    expect(after).toEqual({ ...before, sameController: true, sameIde: true, ready: true });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
