import { chromium } from "/Users/blamy/.codex/worktrees/ui-redesign/wasm-vm/web/node_modules/@playwright/test/index.mjs";
const b = await chromium.launch();
const out = {};
for (const [name, url, vp] of [["app-desktop", "/app.html?nosw", [1280, 900]], ["app-phone", "/app.html?nosw", [390, 844]], ["kit-phone", "/ui-kit.html", [390, 844]]]) {
  const p = await b.newPage({ viewport: { width: vp[0], height: vp[1] } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errs.push(m.text()));
  p.on("response", (r) => r.status() >= 400 && !r.url().endsWith("favicon.ico") && errs.push(`${r.status()} ${r.url()}`));
  await p.goto("http://127.0.0.1:8232" + url);
  await p.waitForFunction(() => document.documentElement.dataset.wvUi && document.documentElement.dataset.wvUi !== "none");
  await p.waitForTimeout(1200);
  const links = await p.$$eval('[data-wv-mounted] nav a', (as) => as.map((a) => `${a.textContent.trim()}=${a.getAttribute("href")}`));
  out[name] = { wvUi: await p.evaluate(() => document.documentElement.dataset.wvUi), overflowX: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), links, errors: errs };
  await p.screenshot({ path: `evidence/ui-redesign/foundation/dist-${name}.png` });
  await p.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
