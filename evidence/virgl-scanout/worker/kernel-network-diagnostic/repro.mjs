#!/usr/bin/env node
// Bounded network diagnostic only: no VM, no guest execution and no desktop boot.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const kernelFile = path.join(repo, 'releases/kernel/6.6.63/Image');
const kernel = await fs.readFile(kernelFile);
assert.equal(kernel.length, 24208896);
assert.equal(hash(kernel), 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce');
const loader = await fs.readFile(path.join(repo, 'web/dist/loader.js'), 'utf8');
const start = loader.indexOf('async function fetchWithProgress(');
const end = loader.indexOf('\n/** Fetch a text resource', start);
assert.ok(start >= 0 && end > start);
const exactFetch = loader.slice(start, end).trim();
const fetchCode = `${exactFetch}
async function consume(url, progress) {
  const bytes = await fetchWithProgress(url, progress);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { bytes: bytes.length, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), reachedEof: true };
}`;
const workerCode = `${fetchCode}\nself.onmessage = async ({ data }) => {
  try { self.postMessage({ result: await consume(data, (loaded, total) => self.postMessage({ progress: { loaded, total } })) }); }
  catch (error) { self.postMessage({ error: { message: error.message, stack: error.stack } }); }
};`;
const report = { schema: 1, task: 'E6-T11c', boundary: 'fetch-only; no VM or desktop execution',
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  command: [process.execPath, ...process.argv.slice(1)], startedAt: new Date().toISOString(), status: 'running',
  inputs: { kernel: { path: kernelFile, bytes: kernel.length, sha256: hash(kernel) },
    loader: { path: 'web/dist/loader.js', sha256: hash(loader) }, fetchFunctionSha256: hash(exactFetch),
    harnessSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) },
  cases: [], events: [] };
const record = (kind, data) => report.events.push({ at: new Date().toISOString(), kind, ...data });
let server, browser, nextRequest = 1;
try {
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const requestId = `server-${nextRequest++}`;
    const headers = { 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    let bytes;
    if (url.pathname === '/kernel') {
      assert.ok(['no-store', 'no-cache'].includes(url.searchParams.get('policy')));
      headers['Cache-Control'] = url.searchParams.get('policy');
      headers['Content-Type'] = 'application/octet-stream'; bytes = kernel;
    } else if (url.pathname === '/worker.js') {
      headers['Content-Type'] = 'text/javascript'; bytes = Buffer.from(workerCode);
    } else {
      assert.equal(url.pathname, '/'); headers['Content-Type'] = 'text/html'; bytes = Buffer.from('<!doctype html><title>Kernel network diagnostic</title>');
    }
    headers['Content-Length'] = bytes.length;
    headers['X-Diagnostic-Request-Id'] = requestId;
    record('server-request', { requestId, url: request.url, method: request.method, requestHeaders: request.headers,
      responseHeaders: headers, bytes: bytes.length, sha256: hash(bytes) });
    response.on('finish', () => record('server-finish', { requestId, writableFinished: response.writableFinished }));
    response.on('close', () => record('server-close', { requestId, writableFinished: response.writableFinished }));
    response.writeHead(200, headers).end(bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ executablePath, headless: false, args: [] });
  report.browser = { version: browser.version(), executablePath, headed: true,
    playwrightVersion: JSON.parse(await fs.readFile(path.join(repo, 'web/node_modules/playwright/package.json'))).version };
  for (const location of ['page', 'worker']) {
    for (let repetition = 0; repetition < 3; repetition += 1) {
      for (const policy of ['no-store', 'no-cache']) {
        const label = `${location}-${policy}-${repetition}`;
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 800, height: 600 } });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        const current = { label, location, policy, repetition, cacheDisabled: true, freshContext: true,
          terminal: null, response: null, errors: [], cdpSetup: [], progressMessages: 0 };
        report.cases.push(current);
        const track = (event, data, session = 'page') => {
          if (data.request?.url?.includes('/kernel') || data.response?.url?.includes('/kernel')
              || ['Network.loadingFinished', 'Network.loadingFailed'].includes(event)) record('cdp', { label, session, event, data });
        };
        for (const event of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed']) {
          cdp.on(event, (data) => track(event, data));
        }
        const pending = new Map(); let nextCdp = 1;
        const sendWorker = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
          const id = nextCdp++; pending.set(id, { resolve, reject });
          cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
        });
        cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
          const data = JSON.parse(message);
          if (data.id) {
            const waiter = pending.get(data.id); pending.delete(data.id);
            if (waiter) data.error ? waiter.reject(new Error(JSON.stringify(data.error))) : waiter.resolve(data.result);
          } else if (data.method?.startsWith('Network.')) track(data.method, data.params, sessionId);
        });
        cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
          if (targetInfo.type !== 'worker') return;
          current.cdpSetup.push({ sessionId, targetId: targetInfo.targetId, type: targetInfo.type });
          void (async () => {
            await sendWorker(sessionId, 'Network.enable');
            await sendWorker(sessionId, 'Network.setCacheDisabled', { cacheDisabled: true });
            await sendWorker(sessionId, 'Runtime.runIfWaitingForDebugger');
          })().catch((error) => current.errors.push(`worker CDP: ${error.message}`));
        });
        await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (location === 'worker') await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
        const matches = (request) => new URL(request.url()).pathname === '/kernel';
        let resolveTerminal;
        const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
        page.on('request', (request) => {
          if (matches(request)) record('playwright-request', { label, requestId: request._guid, url: request.url(), method: request.method(), headers: request.headers() });
        });
        page.on('response', (response) => {
          if (!matches(response.request())) return;
          current.response = { requestId: response.request()._guid, status: response.status(), headers: response.headers() };
          record('playwright-response', { label, ...current.response });
        });
        for (const event of ['requestfinished', 'requestfailed']) page.on(event, (request) => {
          if (!matches(request)) return;
          current.terminal = { event, requestId: request._guid, failure: request.failure(), timing: request.timing() };
          record('playwright-terminal', { label, ...current.terminal }); resolveTerminal();
        });
        page.on('console', (message) => { if (message.type() === 'error') current.errors.push(message.text()); });
        page.on('pageerror', (error) => current.errors.push(error.message));
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const url = `${origin}/kernel?policy=${policy}&case=${label}`;
        const application = location === 'page'
          ? page.evaluate(`(async () => { ${fetchCode}\nreturn { result: await consume(${JSON.stringify(url)}, () => {}) }; })()`)
          : page.evaluate((url) => new Promise((resolve, reject) => {
            const worker = new Worker('/worker.js'); globalThis.__diagnosticWorker = worker;
            let progressMessages = 0;
            worker.onerror = (event) => reject(new Error(event.message));
            worker.onmessage = ({ data }) => {
              if (data.progress) { progressMessages += 1; return; }
              resolve({ ...data, progressMessages });
            };
            worker.postMessage(url);
          }), url);
        let timer;
        try {
          const result = await Promise.race([application, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fetch diagnostic timed out')), 20000); })]);
          clearTimeout(timer); current.application = result;
          assert.ok(!result.error, result.error?.message);
          assert.equal(result.result.bytes, kernel.length); assert.equal(result.result.sha256, hash(kernel)); assert.equal(result.result.reachedEof, true);
          await Promise.race([terminal, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('terminal event timed out')), 5000); })]);
          clearTimeout(timer);
          assert.deepEqual(current.errors, []);
          assert.equal(current.response?.status, 200);
          assert.equal(current.response?.headers['cache-control'], policy);
          console.log(`${label}: full bytes/hash/EOF; ${current.terminal.event} ${current.terminal.failure?.errorText ?? ''}`);
        } finally { clearTimeout(timer); await context.close(); }
      }
    }
  }
  assert.equal(hash(await fs.readFile(kernelFile)), report.inputs.kernel.sha256, 'kernel unchanged');
  const failures = report.cases.filter((item) => item.terminal?.event === 'requestfailed');
  report.summary = { total: report.cases.length, fullBytesAndHash: report.cases.filter((item) => item.application?.result?.sha256 === report.inputs.kernel.sha256).length,
    noStoreFailures: failures.filter((item) => item.policy === 'no-store').length,
    noCacheFailures: failures.filter((item) => item.policy === 'no-cache').length,
    workerNoStoreFailures: failures.filter((item) => item.policy === 'no-store' && item.location === 'worker').length };
  assert.equal(report.summary.fullBytesAndHash, 12); assert.equal(report.summary.noCacheFailures, 0);
  assert.ok(report.summary.workerNoStoreFailures > 0, 'must reproduce on the actual worker path before proposing workaround');
  report.status = 'reproduced';
} catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
