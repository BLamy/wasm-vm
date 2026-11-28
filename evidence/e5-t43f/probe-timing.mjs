// E5-T43f probe: where does a guest `node` fetch spend its time online? Runs timed commands over the
// serial root shell (window.wvmDemo.exec) on the online desktop (argv: base url, out file).
import fs from "node:fs";
const [base, outFile] = process.argv.slice(2);
const { chromium } = await import(new URL("../../web/node_modules/playwright/index.mjs", import.meta.url));
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
await p.addInitScript(() => window.addEventListener("wvm:desktop-ready", () => { window.__ready = 1; }));
await p.goto(`${base}/app.html?guest=replay-desktop&desktop=1#ide`);
await p.waitForFunction(() => window.__ready && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 600000 });
await p.waitForTimeout(3000);
const cmds = [
  "cat /etc/resolv.conf",
  "time nslookup example.com 2>&1 | tail -4",
  "time node -e 'require(\"dns\").lookup(\"example.com\",(e,a)=>console.log(e||a))'",
  "time node -e 'fetch(\"http://example.com\").then(r=>console.log(r.status))'",
  "time node -e 'fetch(\"https://example.com\").then(r=>console.log(r.status))'",
  "time node -e 'fetch(\"https://example.com\").then(r=>console.log(r.status))'",
  "time node -e 'require(\"https\").get(\"https://example.com\",r=>console.log(r.statusCode))'",
];
const out = [];
for (const c of cmds) {
  const t = Date.now();
  const r = await p.evaluate((cmd) => window.wvmDemo.exec(cmd, 600000, { quiet: true }), c);
  out.push({ cmd: c, hostMs: Date.now() - t, stdout: r?.stdout, stderr: r?.stderr });
  console.log(JSON.stringify(out.at(-1)));
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await b.close();
