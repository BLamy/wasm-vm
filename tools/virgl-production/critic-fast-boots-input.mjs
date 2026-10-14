// Actual public Omarchy session: default uid/config/bar/Foot and trusted UI input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyPublicDesktopInput(page, command, output) {
  const read = async text => {
    const result = await command(page, text, 300000);
    assert.equal(result.exit, 0, text);
    return result.stdout.trim();
  };
  const uid = await read('id -u');
  assert.equal(uid, '1000', 'the public serial session belongs to Omarchy');
  const layers = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'));
  const mapped = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.namespace && value.w > 0 && value.h > 0 && value.pid > 0) mapped.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(layers);
  assert.ok(mapped.some(layer => layer.namespace === 'omarchy-bar'), 'actual package bar is mapped');
  let clients, foot;
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    clients = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients'));
    foot = clients.find(client => /foot/i.test(client.class || client.initialClass || '') &&
      client.mapped !== false && client.hidden !== true && client.pid > 0);
    if (foot) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  assert.ok(foot, 'default Omarchy startup maps its actual Foot client');
  assert.equal(await read('ps -o uid= -p ' + foot.pid), '1000', 'Foot runs as the original desktop user');
  const monitors = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j monitors'));
  const monitor = monitors.find(value => value.id === foot.monitor) || monitors[0];
  assert.ok(monitor?.width > 0 && monitor?.height > 0);
  assert.equal(monitor.scale, 1, 'default package display scale');
  const canvas = page.locator('#ide-display-canvas');
  const box = await canvas.boundingBox();
  assert.ok(box?.width > 0 && box?.height > 0);
  const target = {x: Math.round(foot.at[0] + foot.size[0] / 2),
    y: Math.round(foot.at[1] + foot.size[1] / 2)};
  const before = await page.evaluate(() => window.__linuxCtl.inputDeviceStats());
  await page.mouse.click(box.x + target.x * box.width / monitor.width,
    box.y + target.y * box.height / monitor.height);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ide-display-canvas');
  if (await page.evaluate(() => document.documentElement.dataset.keyboardCapture) !== 'on') {
    await page.locator('#ide-keyboard-toggle').click();
    await canvas.focus();
  }
  assert.equal(await page.evaluate(() => document.documentElement.dataset.keyboardCapture), 'on');
  // Only trusted Playwright keyboard events create this file in Foot. The serial
  // control channel merely reads it afterward; it never injects this command.
  await page.keyboard.type('echo gpukeyboard42pass > /tmp/gpukeyboard42', {delay: 15});
  await page.keyboard.press('Enter');
  let marker;
  for (let i = 0; i < 20; ++i) {
    marker = await command(page, 'cat /tmp/gpukeyboard42', 300000);
    if (marker.exit === 0) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(marker.exit, 0, 'trusted Foot keyboard command ran');
  assert.equal(marker.stdout.trim(), 'gpukeyboard42pass');
  const cursor = await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 cursorpos');
  const coordinates = cursor.match(/^(-?\d+),\s*(-?\d+)$/);
  assert.ok(coordinates, cursor);
  assert.ok(Math.abs(Number(coordinates[1]) - target.x) <= 4, 'actual guest cursor X');
  assert.ok(Math.abs(Number(coordinates[2]) - target.y) <= 4, 'actual guest cursor Y');
  const after = await page.evaluate(() => window.__linuxCtl.inputDeviceStats());
  const result = {status: 'passed', uid, layers, clients, monitors, foot, target, cursor,
    marker, inputBefore: before, inputAfter: after};
  await fs.writeFile(path.join(output, 'public-desktop-input.json'), JSON.stringify(result, null, 2));
  await canvas.screenshot({path: path.join(output, 'public-desktop-input.png')});
  return result;
}
