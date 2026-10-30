// E0-T29 on PR 626: screenshots of the real UI against the source tree (dev server, port 8198).
//   node evidence/ui-redesign/workspace-626/capture.mjs
import fs from "node:fs";
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const B = "http://127.0.0.1:8198", O = "evidence/ui-redesign/workspace-626/";
const b = await chromium.launch();
const report = {};
const ctx = (w, h, phone) => b.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
const shot = (p, n) => p.screenshot({ path: O + n });
const ready = async (p) => {
  await p.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector("#ide-explorer .ide-spin") && document.querySelector("#ide-explorer .ide-node, #ide-explorer .ide-explorer-ph"), null, { timeout: 30000 });
};
const errorsOf = (p) => { const e = []; p.on("pageerror", (x) => e.push(x.message)); p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && e.push(m.text())); return e; };
const rows = (p) => p.locator("#term .xterm-rows").evaluate((el) => [...el.children].map((r) => r.textContent.trimEnd()));

{ // desktop: first view, then a real sample open in the Recordings pane, then Self-checks
  const c = await ctx(1440, 900, false); const p = await c.newPage(); const e = errorsOf(p);
  await p.goto(`${B}/index.html?nosw#ide`); await p.waitForFunction(() => document.documentElement.dataset.launcherReady === "true"); await p.waitForTimeout(600);
  await shot(p, "desktop-1440-first-view.png");
  await p.locator('[data-wv="start-linux"]').click(); await ready(p);
  await p.locator("#term").click(); await p.keyboard.type("uname -sm\n", { delay: 10 }); await p.waitForTimeout(800);
  await shot(p, "desktop-1440-terminal.png");
  await p.getByRole("button", { name: "Recordings", exact: true }).click();
  const pane = p.locator('[data-wv="recordings"]');
  await pane.getByRole("button", { name: "Record Linux sample", exact: true }).click();
  await p.waitForFunction(() => document.querySelector('#session-timeline [data-timeline="sessions"]').options.length > 0 && !document.querySelector('#session-timeline [data-timeline="record"]').disabled, null, { timeout: 120000 });
  await pane.getByRole("button", { name: "Open replay", exact: true }).click();
  await p.waitForFunction(() => !/none/.test(document.querySelector('#session-timeline [data-timeline="active"]').textContent), null, { timeout: 60000 });
  await pane.getByRole("button", { name: "Step forward", exact: true }).click(); await p.waitForTimeout(1500);
  await shot(p, "desktop-1440-recordings-replay.png");
  await pane.locator('[data-wv="replay-navigation"]').scrollIntoViewIfNeeded(); await shot(p, "desktop-1440-recordings-navigation.png");
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  await p.getByRole("dialog", { name: "Machine settings" }).getByRole("button", { name: /^Self-checks/ }).click(); await p.waitForTimeout(800);
  await shot(p, "desktop-1440-self-checks.png");
  report.desktop = { position: await p.locator('#session-timeline [data-timeline="position"]').textContent(), errors: e };
  await c.close();
}
{ // 1280 settings sheet (Sound row)
  const c = await ctx(1280, 860, false); const p = await c.newPage(); const e = errorsOf(p);
  await p.goto(`${B}/index.html?nosw#ide`); await p.locator('[data-wv="start-linux"]').click(); await ready(p);
  await p.getByRole("button", { name: "Settings", exact: true }).click(); await p.waitForTimeout(700);
  await p.getByRole("dialog", { name: "Machine settings" }).locator('[data-slot="list-section"]', { hasText: "Sound" }).scrollIntoViewIfNeeded();
  await shot(p, "desktop-1280-settings-sound.png");
  report.settings = { errors: e }; await c.close();
}
for (const [w, h] of [[390, 844], [360, 640]]) { // phone: first view, terminal, tools, recordings, back
  const c = await ctx(w, h, true); const p = await c.newPage(); const e = errorsOf(p);
  await p.goto(`${B}/index.html?nosw#ide`); await p.waitForFunction(() => document.documentElement.dataset.launcherReady === "true"); await p.waitForTimeout(500);
  await shot(p, `phone-${w}-first-view.png`);
  await p.locator('[data-wv="start-linux"]').tap(); await ready(p);
  await p.locator("#term").tap(); await p.keyboard.type("ls /\n", { delay: 10 }); await p.waitForTimeout(800);
  await shot(p, `phone-${w}-terminal.png`);
  await p.getByRole("button", { name: "Tools and settings" }).tap(); await p.waitForTimeout(700);
  await shot(p, `phone-${w}-tools.png`);
  await p.getByRole("dialog", { name: "Machine settings" }).getByRole("button", { name: /^Recordings/ }).tap(); await p.waitForTimeout(800);
  await shot(p, `phone-${w}-recordings.png`);
  await p.locator('[data-wv="pane-back"]').tap(); await p.waitForTimeout(500);
  report[`phone-${w}`] = { termVisibleAfterBack: await p.locator("#ide-term-pane").isVisible(), overflow: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), errors: e };
  await c.close();
}
{ // carried criterion, visually: Case studies by keyboard, return, ordinary tap, trusted keys
  const c = await ctx(390, 844, true); const p = await c.newPage(); const e = errorsOf(p);
  await p.goto(`${B}/index.html?nosw#ide`); await p.locator('[data-wv="start-linux"]').tap(); await ready(p);
  await p.locator("#term").tap(); await p.keyboard.type("echo shot-626 > /tmp/shot.txt\n", { delay: 10 });
  await p.getByRole("button", { name: "Open menu", exact: true }).tap();
  const studies = p.getByRole("dialog", { name: "Site menu" }).getByRole("link", { name: "Case studies", exact: true });
  for (let i = 0; i < 12 && !(await studies.evaluate((el) => el === document.activeElement)); i++) await p.keyboard.press("Tab");
  const [popup] = await Promise.all([c.waitForEvent("page"), p.keyboard.press("Enter")]);
  await popup.waitForLoadState("domcontentloaded"); await popup.screenshot({ path: O + "phone-390-case-studies-popup.png" }); await popup.close();
  await p.bringToFront(); await p.keyboard.press("Escape");
  await p.locator("#term").tap(); await p.keyboard.type("cat /tmp/shot.txt\n", { delay: 10 });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { ok = (await rows(p)).includes("shot-626"); if (!ok) await p.waitForTimeout(250); }
  await shot(p, "phone-390-terminal-after-case-studies.png");
  report.carried = { readBack: ok, focus: await p.evaluate(() => document.activeElement?.className), errors: e };
  await c.close();
}
await b.close();
fs.writeFileSync(O + "capture.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
