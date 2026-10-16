import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, "../../..");
const runner = "/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen-test-runner";
const artifacts = path.join(root, "target/wasm32-unknown-unknown/debug/deps");
const { chromium } = await import(pathToFileURL(path.join(root, "web/node_modules/playwright/index.mjs")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const summary = [];
for (const fixture of ["jit_sparse_handoff", "jit_browser_parity"]) {
  const matches = (await fs.readdir(artifacts)).filter(f => f.startsWith(fixture + "-") && f.endsWith(".wasm"));
  if (matches.length !== 1) throw Error(`Ambiguous compiled fixture ${fixture}: ${matches}`);
  const artifact = path.join(artifacts, matches[0]);
  const record = { fixture, artifact, artifactSha256: sha(await fs.readFile(artifact)),
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    command: [runner, artifact, "--nocapture"],
    env: { WASM_BINDGEN_USE_BROWSER: "1", NO_HEADLESS: "1" }, errors: [], console: [], passed: false };
  const child = spawn(runner, [artifact, "--nocapture"], { cwd: root,
    env: { ...process.env, WASM_BINDGEN_USE_BROWSER: "1", NO_HEADLESS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  record.runnerPid = child.pid;
  let text = "", browser;
  child.stdout.on("data", chunk => { text += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on("data", chunk => { text += chunk.toString(); process.stdout.write(chunk); });
  try {
    const start = Date.now();
    let match;
    while (!(match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+\/?/))) {
      if (child.exitCode !== null) throw Error(`Runner exited ${child.exitCode}: ${text}`);
      if (Date.now() - start > 60_000) throw Error(`Runner URL timeout: ${text}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    record.url = match[0].replace("0.0.0.0", "127.0.0.1");
    browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
    record.browser = browser.version();
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    page.on("pageerror", error => record.errors.push(String(error)));
    page.on("console", msg => record.console.push({ type: msg.type(), text: msg.text() }));
    await page.goto(record.url);
    await page.waitForFunction(() => /test result: (?:ok|FAILED)/.test(document.body.innerText), null, { timeout: 180_000 });
    record.body = await page.locator("body").innerText();
    record.result = record.body.match(/test result: [^\n]+/)?.[0];
    record.crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    await fs.writeFile(path.join(out, `chrome-${fixture}.txt`), record.body + "\n");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: path.join(out, `chrome-${fixture}.png`) });
    if (!/^test result: ok/.test(record.result) || record.errors.length) throw Error(JSON.stringify({ result: record.result, errors: record.errors }));
    record.passed = true;
    console.log(JSON.stringify({ fixture, result: record.result, browser: record.browser, passed: true }));
  } finally {
    await browser?.close();
    child.kill("SIGTERM");
    await fs.writeFile(path.join(out, `chrome-${fixture}-runner.log`), text);
    await fs.writeFile(path.join(out, `chrome-${fixture}.json`), JSON.stringify(record, null, 2) + "\n");
    summary.push({ fixture, artifactSha256: record.artifactSha256, result: record.result, passed: record.passed });
    await fs.writeFile(path.join(out, "chrome-fixtures.json"), JSON.stringify(summary, null, 2) + "\n");
  }
}
