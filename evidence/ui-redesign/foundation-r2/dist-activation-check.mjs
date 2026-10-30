// E0-T28 r2 published-layout check: serve web/dist as deployed, then ACTIVATE links (not only
// read hrefs): phone current-machine by tap and by keyboard, a diagnostic row by mouse, and the
// primary link's foreground against Button. Usage: node dist-r2.mjs <base-url> <out-dir>
import { chromium } from "/Users/blamy/.codex/worktrees/ui-redesign/wasm-vm/web/node_modules/@playwright/test/index.mjs";
const [, , base, out] = process.argv;
const b = await chromium.launch();
const report = {};
const watch = (p, errs) => {
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errs.push(m.text()));
  p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && errs.push(`${r.status()} ${r.url()}`));
};
for (const mode of ["tap", "keyboard"]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const p = await ctx.newPage(); const errs = []; watch(p, errs);
  await p.goto(`${base}/app.html?nosw#ide`);
  await p.waitForFunction(() => document.documentElement.dataset.wvUi === "site-nav");
  await p.evaluate(() => { window.__token = "same-document"; document.getElementById("ide-root").dataset.token = "same-ide"; });
  const before = p.url();
  const menu = p.getByRole("button", { name: "Open menu" });
  await menu.tap();
  const sheet = p.getByRole("dialog", { name: "Site menu" });
  const link = sheet.getByRole("link", { name: "Open the machine" });
  await link.waitFor();
  const href = await link.getAttribute("href");
  if (mode === "tap") { await p.waitForTimeout(500); await link.tap(); } else { await link.focus(); await p.keyboard.press("Enter"); }
  await sheet.waitFor({ state: "detached" });
  report[`phone-current-machine-${mode}`] = {
    href, urlBefore: before, urlAfter: p.url(),
    sentinels: await p.evaluate(() => ({ document: window.__token ?? null, ide: document.getElementById("ide-root")?.dataset.token ?? null })),
    sheetOpen: await sheet.count(), menuFocused: await menu.evaluate((el) => el === document.activeElement), errors: errs,
  };
  await ctx.tracing.stop({ path: `${out}/dist-phone-current-machine-${mode}.zip` });
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const p = await ctx.newPage(); const errs = []; watch(p, errs);
  await p.goto(`${base}/app.html?nosw#ide`);
  await p.waitForFunction(() => document.documentElement.dataset.wvUi === "site-nav");
  await p.getByRole("button", { name: "Diagnostics" }).click();
  const dialog = p.getByRole("dialog", { name: "Diagnostic pages" });
  const kit = dialog.getByRole("link", { name: "Interface kit", exact: true });
  await kit.waitFor();
  await p.waitForTimeout(500);
  await kit.click();
  await p.waitForURL(/ui-kit\.html$/);
  await p.waitForFunction(() => document.documentElement.dataset.wvUi === "kit");
  const nav = p.getByRole("navigation", { name: "Primary navigation" });
  const fg = async (loc) => loc.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  report["desktop-diagnostic-row-click"] = { landedOn: new URL(p.url()).pathname, errors: errs };
  report["primary-foreground"] = {
    button: await fg(p.getByRole("button", { name: "Start machine", exact: true })),
    link: await fg(nav.getByRole("link", { name: "Open the machine", exact: true })),
    linkHref: await nav.getByRole("link", { name: "Open the machine", exact: true }).getAttribute("href"),
  };
  await ctx.tracing.stop({ path: `${out}/dist-desktop-diagnostic-and-foreground.zip` });
  await ctx.close();
}
console.log(JSON.stringify(report, null, 1));
await b.close();
