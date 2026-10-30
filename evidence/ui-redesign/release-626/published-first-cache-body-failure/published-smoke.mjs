import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [baseArg, outArg, rootArg = process.cwd()] = process.argv.slice(2);
const base = new URL(baseArg).origin;
const root = path.resolve(rootArg), out = path.resolve(outArg);
if (!/^https:\/\/[^/]+\.wasm-vm\.pages\.dev$/.test(base)) throw Error('Expected an isolated Pages preview origin');
fs.mkdirSync(out, { recursive: true });
const require = createRequire(path.join(root, 'web/package.json'));
const { chromium, expect } = require('@playwright/test');
const result = { origin: base, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), errors: [], checks: [], assetDigests: {} };
const manifestNames = ['artifacts.json', 'artifacts-alpine.json', 'artifacts-node-alpine.json', 'artifacts-omarchy.json', 'artifacts-omarchy-virgl.json'];
const allowedDeploymentChanges = new Set(manifestNames.map(name => `web/dist/${name}`));
result.stagedDeploymentChanges = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
if (result.stagedDeploymentChanges.some(name => !allowedDeploymentChanges.has(name))) throw Error('Unexpected tracked change after freezing the deployment');
fs.mkdirSync(path.join(out, 'deployed-manifests'), { recursive: true });
for (const name of manifestNames) fs.copyFileSync(path.join(root, 'web/dist', name), path.join(out, 'deployed-manifests', name));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const requestedAssetChecks = [];
result.requestedAssetDigests = {};
result.cancelledAssetRequests = [];
const watch = page => {
  page.on('pageerror', e => result.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) result.errors.push(`console: ${m.text()}`); });
  page.on('response', r => {
    const url = new URL(r.url());
    if (r.status() === 200 && url.origin === base) {
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      const local = path.resolve(root, 'web/dist', relative);
      const distRoot = path.resolve(root, 'web/dist') + path.sep;
      if (local.startsWith(distRoot) && fs.existsSync(local) && fs.statSync(local).isFile()) {
        requestedAssetChecks.push((async () => {
          const actual = createHash('sha256').update(await r.body()).digest('hex');
          const expected = createHash('sha256').update(fs.readFileSync(local)).digest('hex');
          expect(actual, relative).toBe(expected);
          result.requestedAssetDigests[relative] = actual;
        })().catch(error => {
          const failure = r.request().failure();
          if (failure && /ERR_ABORTED/.test(failure.errorText || '')) {
            result.cancelledAssetRequests.push({ relative, failure: failure.errorText });
          } else result.errors.push(`asset binding: ${relative}: ${error.message}`);
        }));
      }
    }
    if (r.status() < 400 || url.pathname === '/favicon.ico') return;
    if (r.request().resourceType() === 'document' && new URL(r.url()).pathname === '/old/docs/missing-topic' && r.status() === 404) return;
    result.errors.push(`HTTP${r.status()}: ${r.url()}`);
  });
};
const check = name => { result.checks.push(name); console.log('PASS', name); };
let phone;
try {
  for (const rel of ['index.html', 'app.html', '404.html', 'docs.html', 'roadmap.html', 'ui.js', 'ui.css', 'site.css', 'main.js', 'case-studies.html', 'case-study-riscv-os.html', 'case-study-ai-sandboxing.html', 'case-study-deterministic-simulation.html', 'docs-bundle/reader.js', 'docs-bundle/reader.css', 'docs-content/catalog.json', 'docs-content/search-corpus.json', 'artifacts.json', 'artifacts-alpine.json', 'artifacts-node-alpine.json', 'artifacts-omarchy.json', 'artifacts-omarchy-virgl.json', 'pkg/wasm_vm_wasm_bg.wasm', 'session-pkg/wasm_vm_session_bg.wasm', 'gpu-checkpoint-build.js']) {
    const response = await context.request.get(`${base}/${rel}`);
    expect(response.status(), rel).toBe(200);
    const bytes = await response.body();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const expected = createHash('sha256').update(fs.readFileSync(path.join(root, 'web/dist', rel))).digest('hex');
    expect(hash, rel).toBe(expected);
    result.assetDigests[rel] = hash;
  }
  check(`${Object.keys(result.assetDigests).length} published interface, documentation, manifest and runtime files match the staged deployment byte for byte`);
  const catalog = await (await context.request.get(`${base}/docs-content/catalog.json`)).json();
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'web/package.json'), 'utf8')).dependencies['@brett_lamy/docstream'];
  expect(catalog.docstreamVersion).toBe(packageVersion);
  result.docstreamVersion = packageVersion;
  check('Published docs catalog identifies the pinned current Docstream release');
  const currentReferences = catalog.pages.filter(entry => entry.disposition === 'current');
  expect(currentReferences.map(entry => entry.source).sort()).toEqual(['docs/design/session-format.md', 'docs/design/session-gpu-history-reader.md', 'docs/design/session-replay.md', 'docs/design/session-store.md']);
  for (const entry of currentReferences) {
    expect(entry.sourceRevision).toBe(catalog.currentRevision);
    expect(entry.sourceUrl).toContain(`/blob/${catalog.currentRevision}/`);
  }
  result.currentReferenceRevision = catalog.currentRevision;
  check('Published catalog retains the four immutable current session contracts beside its historical inventory');

  const page = await context.newPage(); watch(page);
  await page.goto(`${base}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Linux in a browser tab.');
  await expect(page.getByRole('link', { name: 'Start Linux', exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, 'published-home-desktop.png') });
  check('Published homepage renders with its main starting action');
  await page.goto(`${base}/docs.html?page=overview`);
  await expect(page.locator('.reader-document').first()).toBeVisible();
  await expect(page.locator('.reader-header nav[aria-label="Primary navigation"]')).toBeVisible();
  await page.screenshot({ path: path.join(out, 'published-docs-desktop.png') });
  check('Published docs load the reader and shared navigation');
  const search = page.getByRole('searchbox', { name: 'Search documentation' });
  await search.fill('continue from here');
  const firstResult = page.locator('[data-wv="docs-result"]').first();
  await expect(firstResult).toHaveAttribute('href', './docs.html?page=time-travel#continue-from-the-past');
  await firstResult.click();
  await expect(page).toHaveURL(/page=time-travel#continue-from-the-past$/);
  await expect(page.locator('[id="continue-from-the-past"]')).toBeFocused();
  const diagram = page.locator('.docs-mermaid-preview');
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram.locator('.docs-mermaid svg')).toBeVisible({ timeout: 20_000 });
  await expect(diagram.locator('.docs-split-source')).toContainText('flowchart LR');
  const thumbnail = page.locator('.docs-thumb').first();
  await thumbnail.scrollIntoViewIfNeeded();
  await expect.poll(() => thumbnail.locator('.docs-thumb-frame img').evaluate(img => img.naturalWidth)).toBe(1440);
  expect(new URL(await thumbnail.locator('.docs-thumb-frame img').getAttribute('src'), base).pathname).toBe('/docs-content/images/recordings.png');
  await thumbnail.hover();
  await expect(thumbnail.locator('.docs-thumb-card img')).toBeVisible();
  await page.screenshot({ path: path.join(out, 'published-docs-recordings.png') });
  check('Published ranked search focuses the right section, renders the real Mermaid SVG and resolves the recording image');
  await page.goto(`${base}/docs.html?page=current-docs-design-session-replay`);
  const currentReplay = currentReferences.find(entry => entry.source === 'docs/design/session-replay.md');
  await expect(page.locator('.reader-provenance span')).toHaveText('Current reference');
  await expect(page.locator('.reader-provenance a')).toHaveAttribute('href', currentReplay.sourceUrl);
  await expect(page.getByRole('link', { name: 'Download Markdown' })).toHaveAttribute('download', 'current-docs-design-session-replay.md');
  await expect(page.locator('.reader-document h1')).toBeVisible();
  await page.screenshot({ path: path.join(out, 'published-current-session-reference.png') });
  check('Published current session reference shows immutable source provenance and Markdown download');
  const response = await page.goto(`${base}/old/docs/missing-topic`);
  expect(response.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page does not exist.');
  const recovery = page.getByRole('link', { name: 'Go to the homepage', exact: true });
  await expect(recovery).toBeVisible();
  expect(new URL(await recovery.getAttribute('href'), await page.evaluate(() => document.baseURI)).pathname).toBe('/');
  await recovery.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Linux in a browser tab.');
  check('Nested Pages404 mounts library recovery controls and returns to the homepage');
  phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const mobile = await phone.newPage(); watch(mobile);
  await mobile.goto(`${base}/`);
  await expect(mobile.getByRole('link', { name: 'Start Linux', exact: true }).first()).toBeVisible();
  expect(await mobile.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - 390)).toBe(0);
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.screenshot({ path: path.join(out, 'published-home-phone.png') });
  await mobile.getByRole('button', { name: 'Open menu', exact: true }).tap();
  await expect(mobile.getByRole('dialog')).toBeVisible();
  await mobile.getByRole('dialog').getByRole('link', { name: 'Docs', exact: true }).tap();
  await expect(mobile.locator('.reader-document').first()).toBeVisible();
  check('Published390px phone homepage fits and the menu opens the docs');
  const browseDocs = mobile.locator('[data-wv="docs-menu"]');
  await browseDocs.tap();
  await expect(mobile.locator('[data-wv="docs-menu-close"]')).toBeFocused();
  await mobile.getByRole('searchbox', { name: 'Search documentation' }).fill('storage limits');
  const phoneResult = mobile.locator('[data-wv="docs-result"]').first();
  const phoneTarget = (await phoneResult.getAttribute('href')).split('#')[1];
  await expect(phoneResult).toBeVisible();
  await phoneResult.tap();
  await expect(browseDocs).toHaveAttribute('aria-expanded', 'false');
  await expect(mobile.locator(`[id="${decodeURIComponent(phoneTarget)}"]`)).toBeFocused();
  expect(await mobile.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - 390)).toBe(0);
  await mobile.screenshot({ path: path.join(out, 'published-docs-phone.png') });
  check('Published phone library search opens the matched section, closes its overlay and keeps focus on the heading');
  for (const rel of ['case-studies.html', 'case-study-riscv-os.html', 'case-study-ai-sandboxing.html', 'case-study-deterministic-simulation.html']) {
    await mobile.goto(`${base}/${rel}`);
    await expect(mobile.locator('[data-wv-ui="site-nav"][data-wv-mounted="true"]')).toBeAttached();
    await expect(mobile.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await mobile.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - 390), rel).toBe(0);
    if (rel === 'case-studies.html') await mobile.screenshot({ path: path.join(out, 'published-cases-phone.png'), fullPage: true });
  }
  check('All four published case-study routes load their shared navigation and fit390px');
  await page.getByRole('link', { name: 'Start Linux', exact: true }).first().click();
  await expect(page).toHaveURL(/app(?:\.html)?\?guest=busybox#ide$/);
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 120_000 });
  // Wait for the real initial explorer listing before trusted serial typing, as in the
  // retained navigation proof. This is readiness observation, not injected guest input.
  await page.waitForFunction(() => !document.querySelector('#ide-explorer .ide-spin')
    && Boolean(document.querySelector('#ide-explorer .ide-node, #ide-explorer .ide-explorer-ph')), null, { timeout: 30_000 });
  await page.locator('#term').click();
  await page.keyboard.type("printf 'preview-%s\\n' $((40+2))\n");
  await expect.poll(() => page.locator('#term .xterm-rows').evaluate(el => [...el.children].map(r => r.textContent.trimEnd())), { timeout: 30_000 }).toContain('preview-42');
  await page.screenshot({ path: path.join(out, 'published-workspace.png') });
  check('Published main action starts the real BusyBox guest and evaluates an arithmetic shell command');
  await Promise.all(requestedAssetChecks);
  check(`${Object.keys(result.requestedAssetDigests).length} completed same-origin browser responses also match the staged deployment`);
  expect(result.errors).toEqual([]);
  check('Zero unexpected HTTP, console, page or requested-asset binding errors throughout the published smoke test');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  await context.tracing.stop({ path: path.join(out, 'published-smoke.zip') });
  if (phone) {
    await phone.tracing.stop({ path: path.join(out, 'published-phone.zip') });
    await phone.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'published-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
