import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {analyzeBarContent} from './critic-fast-boots-bar-content.mjs';

const width = 1280, height = 26;
const blankReceipt = JSON.parse(readFileSync(new URL('./fixtures/omarchy-blank-bar.json', import.meta.url)));
const blankGzip = readFileSync(new URL('./fixtures/omarchy-blank-bar.rgba.gz', import.meta.url));
assert.equal(createHash('sha256').update(blankGzip).digest('hex'), blankReceipt.gzipSha256);
const recordedBlank = gunzipSync(blankGzip);
assert.equal(recordedBlank.length, blankReceipt.rgbaBytes);
assert.equal(createHash('sha256').update(recordedBlank).digest('hex'), blankReceipt.rgbaSha256);
function blank() {
  return new Uint8Array(recordedBlank);
}
function paint(rgba, x, y, w, h, color = [192, 202, 245, 255]) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) rgba.set(color, (row * width + col) * 4);
  }
}

test('recorded old blank Omarchy bar has no foreground content', () => {
  // Actual screenshot18 SHA eebbda015d2dcc2e7d4f7ba240e59c53ef2400a8efb0e68719271d626834bd6e:
  // rows799..824 are exactly1280x26 of RGB26,27,38. This negative fixture
  // preserves the measured crop, not a value derived from the analyzer.
  const result = analyzeBarContent(blank(), width, height);
  assert.equal(result.status, 'insufficient-content');
  assert.equal(result.foregroundPixels, 0);
});

test('a cursor-sized mark cannot stand in for populated bar content', () => {
  const rgba = blank(); paint(rgba, 630, 5, 16, 16);
  const result = analyzeBarContent(rgba, width, height);
  assert.equal(result.status, 'insufficient-content');
  assert.equal(result.foregroundPixels, 256);
});

test('a horizontal divider cannot stand in for glyph rows', () => {
  const rgba = blank(); paint(rgba, 4, 12, width - 8, 1);
  const result = analyzeBarContent(rgba, width, height);
  assert.equal(result.status, 'insufficient-content');
  assert.equal(result.foregroundRows, 1);
});

test('two separated literal F glyphs establish distributed foreground', () => {
  const rgba = blank();
  const glyph = ['11111', '10000', '10000', '11110', '10000', '10000', '10000'];
  for (const left of [80, 960]) {
    for (let y = 0; y < glyph.length; y++) {
      for (let x = 0; x < glyph[y].length; x++) {
        if (glyph[y][x] === '1') paint(rgba, left + x * 2, 6 + y * 2, 2, 2);
      }
    }
  }
  const result = analyzeBarContent(rgba, width, height);
  assert.equal(result.status, 'passed');
  assert.equal(result.foregroundPixels, 112); // Four pixels per cell,14 cells per F.
  assert.equal(result.foregroundRows, 14);
  assert.equal(result.foregroundX.min, 80);
  assert.equal(result.foregroundX.max, 969);
});
