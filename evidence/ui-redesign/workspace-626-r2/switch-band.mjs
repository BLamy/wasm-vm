// E0-T29 r2: phone Settings switch hit band at the repaired head (screenshot + measurements).
//   node evidence/ui-redesign/workspace-626-r2/switch-band.mjs
import fs from "node:fs";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const O = "evidence/ui-redesign/workspace-626-r2/";
const b = await chromium.launch(); const out = {};
for (const [w, h] of [[390, 844], [360, 640]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true }); const p = await c.newPage();
  await p.goto("http://127.0.0.1:8198/index.html?nosw#ide"); await p.locator('[data-wv="start-linux"]').tap();
  await p.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90000 });
  await p.getByRole("button", { name: "Tools and settings" }).tap(); await p.waitForTimeout(900);
  const label = p.getByRole("dialog", { name: "Machine settings" }).locator('[data-slot="list-row"]', { hasText: "Send keys to the guest" }).locator('label[data-slot="switch"]');
  await label.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const box = await label.boundingBox(); const x = box.x + box.width / 2;
  const cap = () => p.evaluate(() => document.documentElement.dataset.keyboardCapture);
  const samples = [];
  for (const [name, y] of [["above+6", box.y - 6], ["centre", box.y + box.height / 2], ["below+6", box.y + box.height + 6], ["above+12", box.y - 12]]) {
    const hit = await p.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('label[data-slot="switch"]')), { x, y });
    const before = await cap(); await p.touchscreen.tap(x, y); await p.waitForTimeout(400);
    samples.push({ name, y, hit, before, after: await cap() });
  }
  const after = await label.evaluate((el) => { const a = getComputedStyle(el, "::after"); return { content: a.content, position: a.position, top: a.top, bottom: a.bottom }; });
  await p.screenshot({ path: `${O}phone-${w}-settings-switch.png` });
  out[w] = { label: box, after, samples };
  await c.close();
}
await b.close();
fs.writeFileSync(O + "switch-band.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
