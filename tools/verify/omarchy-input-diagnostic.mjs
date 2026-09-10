// Interactive real-guest diagnostics; not an acceptance substitute.
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { physicalStroke } from "./omarchy-browser-session.mjs";

const repo = process.cwd();
const output = path.resolve(process.argv[2]);
const divider = process.argv[3] || "64";
if (!/^(1|2|4|8|16|32|64)$/u.test(divider)) throw Error("invalid diagnostic divider");
const jit = process.argv[4] || "1";
if (!/^[01]$/u.test(jit)) throw Error("invalid diagnostic JIT selector");
await fs.mkdir(output, { recursive: false });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const root = pathname.startsWith("/releases/") ? repo : path.join(repo, "web/dist");
  const filename = path.resolve(root, `.${pathname}`);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { "Content-Type": filename.endsWith(".js") ? "text/javascript"
      : filename.endsWith(".wasm") ? "application/wasm" : filename.endsWith(".html") ? "text/html" : "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
const history = [];
const lines = createInterface({ input: process.stdin });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html?guest=omarchy&desktop=1&omarchyDivider=${divider}&jit=${jit}#ide`);
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 120000 });
  console.log("INPUT_DIAGNOSTIC_READY");
  for await (const line of lines) {
    try {
      const request = JSON.parse(line);
      let result;
      if (request.op === "quit") break;
      if (request.op === "exec") result = await page.evaluate((cmd) => window.wvmDemo.exec(cmd, 300000, { quiet: true }), request.command);
      if (request.op === "click") await page.locator("#ide-display-canvas").click({ position: { x: request.x, y: request.y }, timeout: 300000 });
      if (request.op === "type") {
        for (const character of request.text) {
          const { code, shift } = physicalStroke(character);
          if (shift) await page.keyboard.down("ShiftLeft");
          await page.keyboard.press(code, { delay: request.delay || 100 });
          if (shift) await page.keyboard.up("ShiftLeft");
        }
        if (request.enter) await page.keyboard.press("Enter");
      }
      if (request.op === "stats") result = await page.evaluate(async () => ({
        focus: document.activeElement?.id, keyboard: window.__keyboardCapture?.stats(),
        keyboardFrames: window.__keyboardCapture?.frames(), keyboardDiagnostics: window.__keyboardCapture?.diagnostics(),
        pointerFrames: window.__pointer?.frames(), pointerDiagnostics: window.__pointer?.diagnostics(),
        cursor: window.__cursor?.state(), rpc: await window.__workerRpcStats?.(),
        display: window.__presentation?.state(),
        clock: await window.__linuxCtl?.guestClockState?.(), scheduler: await window.__schedulerStats?.(), jit: await window.__jitStats?.(),
      }));
      if (request.op === "screenshot") {
        if (!/^[a-z0-9-]+\.png$/u.test(request.name)) throw Error("invalid screenshot name");
        await page.screenshot({ path: path.join(output, request.name) });
        result = path.join(output, request.name);
      }
      const entry = { time: new Date().toISOString(), request, result: result ?? "sent" };
      history.push(entry);
      await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
      console.log(JSON.stringify(entry));
    } catch (error) { console.error(String(error)); }
  }
} finally {
  lines.close(); await browser.close(); server.close();
}
