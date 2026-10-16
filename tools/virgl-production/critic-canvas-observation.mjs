// Read-only observations through the original controller's existing page.
// Retain both sides of a normal screenshot: no pause, paint, backend replacement
// or assumption that the canvas bitmap and browser compositor agree in time.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {analyzeBarContent} from './critic-fast-boots-bar-content.mjs';
const {PNG} = createRequire(import.meta.url)('../../web/node_modules/playwright-core/lib/utilsBundle.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function observePublicCanvas(page, output, {name, crop}) {
  assert.match(name, /^[a-z0-9-]+$/);
  assert.deepEqual(Object.keys(crop).sort(), ['height', 'width', 'x', 'y']);
  for (const key of Object.keys(crop)) assert.ok(Number.isSafeInteger(crop[key]) && crop[key] >= 0);
  assert.ok(crop.width >= 32 && crop.width <= 4095 && crop.height >= 8 && crop.height <= 256);
  assert.ok(crop.width * crop.height <= 262144, 'bounded read-only pixel crop');
  const report = {scope: 'Read-only original canvas bitmap before/after normal browser element screenshot; temporal observations, not a readiness override',
    status: 'running', crop, started: Date.now()};
  const file = path.join(output, name + '.json');
  async function bitmap(label) {
    const observed = await page.evaluate(crop => {
      const canvases = [...document.querySelectorAll('canvas')];
      const matches = canvases.filter(canvas => canvas.id === 'ide-display-canvas');
      if (matches.length !== 1) throw Error('one original display canvas is required');
      const canvas = matches[0], state = window.__presentation?.state?.();
      if (state?.backend !== 'canvas2d') throw Error('existing Canvas2D presenter required; no context change');
      if (canvas.width * canvas.height > 16777216 || crop.x + crop.width > canvas.width || crop.y + crop.height > canvas.height)
        throw Error('crop exceeds original bounded canvas');
      const geometry = element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return {id: element.id, tag: element.tagName, width: element.width, height: element.height,
          rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
          display: style.display, visibility: style.visibility, opacity: style.opacity,
          transform: style.transform, objectFit: style.objectFit, objectPosition: style.objectPosition,
          border: [style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth]};
      };
      const data = canvas.getContext('2d').getImageData(crop.x, crop.y, crop.width, crop.height);
      return {time: performance.now(), hidden: document.hidden, devicePixelRatio, state,
        viewport: window.__presentation?.viewport?.(), canvases: canvases.map(geometry),
        ancestors: [canvas.parentElement, canvas.parentElement?.parentElement].filter(Boolean).map(geometry),
        rgba: Array.from(data.data)};
    }, crop);
    const rgba = Buffer.from(observed.rgba); delete observed.rgba;
    assert.equal(rgba.length, crop.width * crop.height * 4);
    const filename = name + '-' + label + '.rgba'; await fs.writeFile(path.join(output, filename), rgba);
    return {...observed, bytes: rgba.length, path: filename, sha256: sha(rgba),
      content: analyzeBarContent(rgba, crop.width, crop.height)};
  }
  try {
    report.before = await bitmap('before');
    const png = await page.locator('#ide-display-canvas').screenshot({timeout: 120000});
    const pngPath = name + '-presented.png'; await fs.writeFile(path.join(output, pngPath), png);
    report.screenshot = {path: pngPath, bytes: png.length, sha256: sha(png), time: Date.now()};
    report.after = await bitmap('after');
    const image = PNG.sync.read(png), canvas = report.before.canvases.find(value => value.id === 'ide-display-canvas');
    const afterCanvas = report.after.canvases.find(value => value.id === 'ide-display-canvas');
    report.stableGeometry = JSON.stringify(canvas) === JSON.stringify(afterCanvas);
    if (!report.stableGeometry || canvas.transform !== 'none' || canvas.border.some(value => parseFloat(value) !== 0)) {
      report.presented = {image: {width: image.width, height: image.height},
        content: null, reason: 'Changed geometry, transform or border requires direct screenshot inspection; no pixel correspondence inferred'};
      report.status = 'observed'; return report;
    }
    const scaleX = image.width / canvas.width, scaleY = image.height / canvas.height;
    const bounds = {x: Math.round(crop.x * scaleX), y: Math.round(crop.y * scaleY),
      width: Math.round(crop.width * scaleX), height: Math.round(crop.height * scaleY)};
    assert.ok(bounds.x + bounds.width <= image.width && bounds.y + bounds.height <= image.height);
    const rgba = Buffer.alloc(bounds.width * bounds.height * 4);
    for (let y = 0; y < bounds.height; y++) image.data.copy(rgba, y * bounds.width * 4,
      ((bounds.y + y) * image.width + bounds.x) * 4, ((bounds.y + y) * image.width + bounds.x + bounds.width) * 4);
    const rgbaPath = name + '-presented-crop.rgba'; await fs.writeFile(path.join(output, rgbaPath), rgba);
    report.presented = {image: {width: image.width, height: image.height}, bounds, scaleX, scaleY,
      path: rgbaPath, bytes: rgba.length, sha256: sha(rgba),
      content: bounds.width >= 32 && bounds.height >= 8 && bounds.height <= 256
        ? analyzeBarContent(rgba, bounds.width, bounds.height) : null};
    report.status = 'observed'; return report;
  } catch (error) {report.status = 'failed'; report.error = error.stack; throw error;}
  finally {report.finished = Date.now(); await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');}
}
