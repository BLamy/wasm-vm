// Bounded probe for the e3-t05f1 compatibility failure (spec line 19 clicks #ide-act-docker before a
// guest is selected). Same URL against base 05fa92c82 and the frozen source; <=10 s per page.
// Usage: node compat-probe.mjs <label=url>... <out-dir>
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const args = process.argv.slice(2);
const out = args.pop();
const b = await chromium.launch();
const report = {};
for (const pair of args) {
  const [label, base] = pair.split("=");
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${base}/?noAutoBoot=1&testHooks=1&nosw=1&guest=busybox#ide`);
  const attached = await p.waitForFunction(() => document.getElementById("ide-act-docker") && window.wvmDemo, null, { timeout: 10_000 }).then(() => true, () => false);
  report[label] = await p.evaluate((attached) => {
    const button = document.getElementById("ide-act-docker");
    const panel = document.getElementById("panel-ide");
    const root = document.getElementById("ide-root");
    let hiddenBy = null;
    for (let node = button; node; node = node.parentElement) {
      if (getComputedStyle(node).display === "none") { hiddenBy = `${node.tagName.toLowerCase()}#${node.id}.${node.className}`; break; }
    }
    return {
      attached, wvmDemo: Boolean(window.wvmDemo), buttonVisible: Boolean(button?.getClientRects().length),
      hiddenBy, panelOsSelected: panel?.dataset.osSelected ?? null, ideRootDisplay: root ? getComputedStyle(root).display : null,
      e2eShowall: document.documentElement.classList.contains("e2e-showall"),
    };
  }, attached);
  await p.screenshot({ path: `${out}/compat-probe-${label}.png` });
  await p.close();
}
console.log(JSON.stringify(report, null, 1));
await b.close();
