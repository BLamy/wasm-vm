import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const evidence = path.join(repo, "evidence/e5-t18e/verifier");
const scratch = await mkdtemp(path.join(tmpdir(), "e5-t18e-cache-critic-"));
const source = await readFile(path.join(evidence, "e5-t18e-cache.mjs.review-snapshot.txt"), "utf8");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(source), "056054b90fe110a99d8847c0e3c0f944835d7a83ae6ca877a3216584a46ef845");
const subjectPath = path.join(scratch, "cache.mjs");
await writeFile(subjectPath, source);
const subject = await import(pathToFileURL(subjectPath));
const routeLine = 'if (disabled) await context.route("**/*", (route) => route.continue());';
assert.equal(source.split(routeLine).length, 2);
const noRoutePath = path.join(scratch, "cache-without-routing.mjs");
await writeFile(noRoutePath, source.replace(routeLine, "if (disabled) void context; // verifier routing sabotage"));
const noRoute = await import(pathToFileURL(noRoutePath));
const guardLine = 'if (disabled) assert.equal(record.cachedChunkRequests, 0, "cold worker reused HTTP cache");';
assert.equal(source.split(guardLine).length, 2);
const noGuardPath = path.join(scratch, "cache-without-cold-guard.mjs");
await writeFile(noGuardPath, source.replace(guardLine, "if (disabled) void record; // verifier guard sabotage"));
const bytes = Buffer.alloc(131072, 61);
const asset = `/e5t18b-desktop/chunks/${digest(bytes)}.bin`;
const requests = [];
const server = createServer((request, response) => {
  requests.push({ url: request.url, at: new Date().toISOString() });
  if (request.url === asset) {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length,
      "Cache-Control": "public, max-age=31536000, immutable" });
    response.end(bytes);
  } else {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end("{}");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { candidate: "5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b", at: new Date().toISOString(),
  purpose: "Cheap real dedicated-worker cache and guard sabotage; no emulator", sourceSha256: digest(source), scratch, asset };
let browser;
try {
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  report.browserVersion = browser.version();
  report.calibration = await subject.calibrateWorkerCache(browser, base, asset);
  report.routingSabotage = { rejected: false };
  try { await noRoute.calibrateWorkerCache(browser, base, asset); }
  catch (error) { report.routingSabotage = { rejected: true, error: String(error) }; }
  assert.match(report.routingSabotage.error || "", /cold worker reused HTTP cache/);

  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await subject.configureContextCache(context, true);
    const page = await context.newPage();
    await page.goto(`${base}/artifacts-alpine.json`);
    await page.evaluate(async url => {
      const source = `onmessage=async e=>{try{for(let i=0;i<2;i++)await(await fetch(e.data)).arrayBuffer();postMessage('done')}catch(e){postMessage({error:String(e)})}}`;
      const worker = window.verifierWorker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      await new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(); worker.onerror = reject; worker.postMessage(url); });
    }, `${base}${asset}`);
    report.directReadWorkerCache = await subject.readWorkerCache(page);
    subject.assertWorkerCache(report.directReadWorkerCache, { disabled: true, minimumRequests: 2 });
    assert.equal(report.directReadWorkerCache.workers.length, 1);
    assert.equal(report.directReadWorkerCache.networkChunkRequests, 2);
  } finally { await context.close(); }

  const testFile = path.join(repo, "tools/verify/e5-t18e-cache-verifier.test.mjs");
  report.regressions = {};
  for (const [label, module] of [["intact", subjectPath], ["coldGuardRemoved", noGuardPath]]) {
    const result = spawnSync(process.execPath, ["--test", testFile], { cwd: repo,
      env: { ...process.env, E5_T18E_CACHE_SUBJECT: module }, encoding: "utf8", timeout: 15000 });
    report.regressions[label] = { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }
  assert.equal(report.regressions.intact.status, 0);
  assert.equal(report.regressions.coldGuardRemoved.status, 1);
  assert.match(report.regressions.coldGuardRemoved.stdout, /Missing expected exception/);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  report.requests = requests;
  await writeFile(path.join(evidence, "cache-guard-attack.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
