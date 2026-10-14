// Actual public Omarchy session: default uid/config/bar/Foot and trusted UI input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyPublicBarContent} from './critic-fast-boots-bar-content.mjs';

export async function verifyPublicDesktopInput(page, command, output, options = {}) {
  const name = options.name || 'public-desktop-input';
  assert.match(name, /^[a-z0-9-]+$/);
  const result = {status: 'running', scope: 'trusted browser events through the original guest input devices',
    options, stages: []};
  const record = async (stage, values = {}) => {
    Object.assign(result, values);
    result.stages.push({stage, time: Date.now()});
    result.browserInput = await page.evaluate(async () => ({
      events: window.__criticTrustedInputEvents || [],
      focus: document.activeElement?.id,
      capture: document.documentElement.dataset.keyboardCapture,
      stats: await window.__linuxCtl.inputDeviceStats(),
      frames: window.__keyboardCapture.frames(),
      diagnostics: window.__keyboardCapture.diagnostics(),
      held: window.__keyboardCapture.heldSnapshot(),
      debug: window.__keyboardCapture.stats(),
    }));
    await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(result, null, 2));
  };
  try {
  const read = async text => {
    const result = await command(page, text, 300000);
    assert.equal(result.exit, 0, text);
    return result.stdout.trim();
  };
  const uid = await read('id -u');
  assert.equal(uid, '1000', 'the public serial session belongs to Omarchy');
  let layers, mapped;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.namespace && value.w > 0 && value.h > 0 && value.pid > 0) mapped.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  // Desktop-ready is a compositor milestone. The package's independent bar
  // process can still be compiling its first frame when that milestone fires.
  // Observe actual mapping/alpha, with a bounded deadline; never force startup.
  const barDeadline = Date.now() + 360000;
  do {
    layers = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'));
    mapped = []; visit(layers);
    if (mapped.some(layer => layer.namespace === 'omarchy-bar' && layer.alpha > 0)) break;
    await record('waiting-package-bar', {uid, layers});
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < barDeadline);
  assert.ok(mapped.some(layer => layer.namespace === 'omarchy-bar' && layer.alpha > 0),
    'actual package bar is mapped and visible');
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
  const framesBefore = await page.evaluate(() => window.__keyboardCapture.frames());
  await record('geometry', {uid, layers, clients, monitors, foot, target, box, inputBefore: before, inputFramesBefore: framesBefore});
  await page.mouse.click(box.x + target.x * box.width / monitor.width,
    box.y + target.y * box.height / monitor.height);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ide-display-canvas');
  if (await page.evaluate(() => document.documentElement.dataset.keyboardCapture) !== 'on') {
    await page.locator('#ide-keyboard-toggle').click();
    await canvas.focus();
  }
  assert.equal(await page.evaluate(() => document.documentElement.dataset.keyboardCapture), 'on');
  await page.evaluate(() => {
    window.__criticTrustedInputEvents = [];
    if (window.__criticTrustedInputListener) return;
    window.__criticTrustedInputListener = event => window.__criticTrustedInputEvents.push({
      type: event.type, key: event.key, code: event.code, trusted: event.isTrusted,
      repeat: event.repeat, shift: event.shiftKey, ctrl: event.ctrlKey,
      alt: event.altKey, meta: event.metaKey, time: performance.now(),
      target: event.target?.id, focus: document.activeElement?.id,
    });
    for (const type of ['keydown', 'keyup'])
      document.addEventListener(type, window.__criticTrustedInputListener, true);
  });
  await record('focused');
  // The default package may start its fullscreen screensaver while the cold
  // boot is being observed. DOM focus alone cannot establish guest focus.
  // Wake it through the same trusted input path, then inspect the actual
  // compositor before issuing the command whose effect we will assert.
  let activeWindow = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow'));
  if (activeWindow.class === 'org.omarchy.screensaver') {
    await page.keyboard.press('Escape');
    await record('trusted-wake', {activeWindowBeforeWake: activeWindow});
  }
  const focusDeadline = Date.now() + 120000;
  while (Date.now() < focusDeadline) {
    activeWindow = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow'));
    if (activeWindow.pid === foot.pid && activeWindow.visible !== false &&
        activeWindow.acceptsInput !== false) break;
    await page.mouse.click(box.x + target.x * box.width / monitor.width,
      box.y + target.y * box.height / monitor.height);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(activeWindow.pid, foot.pid, 'actual default Foot receives guest focus');
  assert.notEqual(activeWindow.visible, false, 'actual focused Foot is visible');
  assert.notEqual(activeWindow.acceptsInput, false, 'actual focused Foot accepts input');
  await record('guest-focused', {activeWindow});
  // Use fresh compositor geometry after the trusted wake. Do not count a
  // fullscreen screensaver or a stale layer mapping as a populated bar.
  const freshLayers = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'));
  const freshClients = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients'));
  const freshMonitors = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j monitors'));
  const freshMonitor = freshMonitors.find(value => value.id === foot.monitor) || freshMonitors[0];
  const bars = Object.values(freshLayers[freshMonitor.name]?.levels || {}).flat()
    .filter(layer => layer.namespace === 'omarchy-bar' && layer.alpha > 0);
  assert.equal(bars.length, 1, 'one actual visible Omarchy bar on the focused monitor');
  const barContent = await verifyPublicBarContent(page, output, {layer: bars[0],
    monitor: freshMonitor, clients: freshClients, name: name + '-bar-content'});
  await record('bar-content', {barContent});
  // Only trusted Playwright keyboard events create this file in Foot. The serial
  // control channel merely reads it afterward; it never injects this command.
  // CDP type() can describe a shifted punctuation key without physical modifier
  // transitions. This original evdev path deliberately preserves physical codes,
  // so the acceptance command uses only unshifted keys, like actual typing.
  const text = options.text || 'touch /tmp/gpukeyboard42touch';
  await page.keyboard.type(text, {delay: options.delay ?? 15});
  await page.keyboard.press('Enter');
  await record('typed', {typedText: text});
  await canvas.screenshot({path: path.join(output, name + '-typed.png')});
  let marker;
  for (let i = 0; i < 20; ++i) {
    marker = await command(page, options.markerRead || 'test -f /tmp/gpukeyboard42touch && echo TRUSTED_TOUCH_42', 300000);
    await record('marker-' + i, {marker});
    if (marker.exit === 0) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(marker.exit, 0, 'trusted Foot keyboard command ran');
  assert.equal(marker.stdout.trim(), options.expected ?? 'TRUSTED_TOUCH_42');
  const cursor = await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 cursorpos');
  const coordinates = cursor.match(/^(-?\d+),\s*(-?\d+)$/);
  assert.ok(coordinates, cursor);
  assert.ok(Math.abs(Number(coordinates[1]) - target.x) <= 4, 'actual guest cursor X');
  assert.ok(Math.abs(Number(coordinates[2]) - target.y) <= 4, 'actual guest cursor Y');
  const after = await page.evaluate(() => window.__linuxCtl.inputDeviceStats());
  await record('passed', {status: 'passed', cursor, marker, inputAfter: after});
  await canvas.screenshot({path: path.join(output, name + '.png')});
  return result;
  } catch (error) {
    await record('failed', {status: 'failed', error: error.stack || String(error)}).catch(() => {});
    await page.locator('#ide-display-canvas').screenshot({path: path.join(output, name + '-failed.png')}).catch(() => {});
    throw error;
  }
}
