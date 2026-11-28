// E5-T43e probe: screenshot the resumed Replay desktop (argv: base url, png path).
const { chromium } = await import(new URL("../../../web/node_modules/playwright/index.mjs", import.meta.url));
const [url, png] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(`${url}/app.html?guest=replay-desktop&desktop=1#ide`);
await p.waitForTimeout(25000);
await p.screenshot({ path: png });
await b.close();
