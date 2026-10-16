// Inspect only the actual Omarchy layer crop from the original presented frame.
// This proves distributed foreground pixels, not OCR. The recorded crop still
// requires independent visual inspection for readable glyphs/icons.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function analyzeBarContent(rgba, width, height) {
  assert.ok(Number.isSafeInteger(width) && width >= 32 && width <= 16384);
  assert.ok(Number.isSafeInteger(height) && height >= 8 && height <= 256);
  assert.equal(rgba.length, width * height * 4, 'exact captured RGBA extent');
  const border = 2, histogram = new Map();
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] === 0) continue;
      const key = `${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`;
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }
  const sorted = [...histogram].sort((a, b) => b[1] - a[1]);
  const background = (sorted[0]?.[0] || '0,0,0').split(',').map(Number);
  const eligiblePixels = sorted.reduce((n, row) => n + row[1], 0);
  const backgroundPixels = sorted[0]?.[1] || 0;
  let foregroundPixels = 0, minX = width, maxX = -1;
  const rows = new Set(), columns = new Set();
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] === 0) continue;
      const distances = background.map((value, channel) => Math.abs(rgba[at + channel] - value));
      if (Math.max(...distances) < 32 || distances.reduce((n, value) => n + value, 0) < 64) continue;
      foregroundPixels++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      rows.add(y); columns.add(Math.min(7, Math.floor(x * 8 / width)));
    }
  }
  const span = maxX >= minX ? maxX - minX + 1 : 0;
  const passed = eligiblePixels > 0 && backgroundPixels >= eligiblePixels / 2 &&
    foregroundPixels >= 32 && rows.size >= 4 && columns.size >= 2 &&
    span >= Math.max(32, Math.floor(width / 4));
  return {status: passed ? 'passed' : 'insufficient-content', width, height, border,
    background, eligiblePixels, backgroundPixels, foregroundPixels,
    foregroundRows: rows.size, occupiedColumns: [...columns].sort((a, b) => a - b),
    foregroundX: {min: maxX >= minX ? minX : null, max: maxX >= minX ? maxX : null, span},
    interpretation: 'Distributed contrasting bar content; readable glyphs/icons require inspection of the exact crop.'};
}

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

export async function verifyPublicBarContent(page, output, {layer, monitor, clients, name = 'public-bar-content', requireContent = true}) {
  assert.match(name, /^[a-z0-9-]+$/);
  await fs.mkdir(output, {recursive: true});
  const report = {scope: 'Original public canvas pixels inside the actual compositor bar layer',
    status: 'running', layer, monitor, clients, started: Date.now()};
  try {
    assert.equal(layer.namespace, 'omarchy-bar');
    assert.ok(layer.alpha > 0 && layer.pid > 0);
    assert.equal(monitor.scale, 1, 'default production desktop scale');
    assert.equal(monitor.x || 0, 0, 'default single monitor origin');
    assert.equal(monitor.y || 0, 0, 'default single monitor origin');
    const rect = {x: layer.x, y: layer.y, width: layer.w, height: layer.h};
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
    assert.ok(rect.x + rect.width <= monitor.width && rect.y + rect.height <= monitor.height);
    report.overlappingClients = clients.filter(client => client.mapped !== false &&
      client.hidden !== true && client.visible !== false &&
      intersects(rect, {x: client.at[0], y: client.at[1], width: client.size[0], height: client.size[1]}))
      .map(client => ({pid: client.pid, class: client.class, at: client.at, size: client.size}));
    const capture = await page.evaluate(({rect, monitor}) => {
      const canvas = document.getElementById('ide-display-canvas');
      if (!canvas?.width || !canvas?.height) throw Error('Original display canvas unavailable');
      const context = canvas.getContext('2d');
      if (!context) throw Error('The existing default Canvas2D presenter is required; no backend replacement');
      const sx = canvas.width / monitor.width, sy = canvas.height / monitor.height;
      const bounds = {x: Math.round(rect.x * sx), y: Math.round(rect.y * sy),
        width: Math.round(rect.width * sx), height: Math.round(rect.height * sy)};
      const pixels = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
      // Copy the unmodified captured region into a detached capture canvas so
      // its PNG and RGBA record describe exactly the same frame.
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = bounds.width; captureCanvas.height = bounds.height;
      captureCanvas.getContext('2d').putImageData(pixels, 0, 0);
      return {bounds, canvas: {width: canvas.width, height: canvas.height},
        rgba: Array.from(pixels.data), png: captureCanvas.toDataURL('image/png')};
    }, {rect, monitor});
    const rgba = Buffer.from(capture.rgba);
    const png = Buffer.from(capture.png.split(',')[1], 'base64');
    report.capture = {bounds: capture.bounds, canvas: capture.canvas,
      rgbaBytes: rgba.length, rgbaSha256: createHash('sha256').update(rgba).digest('hex'),
      pngBytes: png.length, pngSha256: createHash('sha256').update(png).digest('hex')};
    await fs.writeFile(path.join(output, name + '.rgba'), rgba);
    await fs.writeFile(path.join(output, name + '.png'), png);
    report.content = analyzeBarContent(rgba, capture.bounds.width, capture.bounds.height);
    assert.equal(report.overlappingClients.length, 0, 'Do not count Foot/screensaver pixels behind the bar');
    if (requireContent) assert.equal(report.content.status, 'passed', 'The actual bar contains distributed foreground pixels');
    report.status = report.content.status;
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error);
    throw error;
  } finally {
    report.finished = Date.now();
    await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
