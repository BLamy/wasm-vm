// Actual public Omarchy session: default uid/config/bar/Foot and trusted UI input.
import assert from 'node:assert/strict';
import {assertPhysicalKeyHolds} from './isolated-input.mjs';
import {assertInteractivePauseProbe} from './critic-fast-boots-final.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyPublicBarContent} from './critic-fast-boots-bar-content.mjs';
import {verifyDesktopActions} from './critic-desktop-actions.mjs';

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
      clock: await window.__linuxCtl.guestClockState(),
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
  const clockPolicy = await page.evaluate(() => {
    const options=window.__fastBootCritic?.workerBoots?.at(-1)?.options;
    return {guest:options?.guestClock,interactive:options?.interactiveClock};
  });
  const interactivePolicy=clockPolicy.interactive;
  const initialClock = await page.evaluate(() => window.__linuxCtl.guestClockState());
  const interactiveMode = interactivePolicy === 'paced-on-keyboard' ? 'paced-icount' :
    interactivePolicy === 'wall-on-keyboard' ? 'wall' :
    ['paced-icount','wall'].includes(clockPolicy.guest) ? clockPolicy.guest : null;
  if (interactiveMode) assert.equal(initialClock.mode, options.initialClockMode ||
    (interactivePolicy ? 'icount' : clockPolicy.guest));
  await record('initial-clock', {clockPolicy, interactivePolicy, initialClock});
  const canvas = page.locator('#ide-display-canvas');
  await canvas.scrollIntoViewIfNeeded();
  let box = await canvas.boundingBox();
  assert.ok(box?.width > 0 && box?.height > 0);
  await canvas.focus();
  if (await page.evaluate(() => document.documentElement.dataset.keyboardCapture) !== 'on') {
    await page.locator('#ide-keyboard-toggle').click(); await canvas.focus();
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
    for (const type of ['keydown', 'keyup']) document.addEventListener(type, window.__criticTrustedInputListener, true);
  });
  const wakeScreensaver = async stage => {
    const active = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow'));
    if (active.class === 'org.omarchy.screensaver') {
      await canvas.focus(); await page.keyboard.press('Escape', {delay: 100});
      await record(stage, {activeWindowBeforeWake: active});
    }
  };
  await wakeScreensaver('trusted-wake-before-bar');
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
    await wakeScreensaver('trusted-wake-waiting-bar');
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
  await canvas.scrollIntoViewIfNeeded();
  box = await canvas.boundingBox();
  assert.ok(box?.width > 0 && box?.height > 0);
  const initialCursorText = await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 cursorpos');
  const initialCursorParts = initialCursorText.match(/^(-?\d+),\s*(-?\d+)$/);
  assert.ok(initialCursorParts, initialCursorText);
  const initialCursor = {x:Number(initialCursorParts[1]),y:Number(initialCursorParts[2])};
  const candidates = [1/3,2/3].map(fraction => ({x:Math.round(foot.at[0]+foot.size[0]*fraction),
    y:Math.round(foot.at[1]+foot.size[1]/2)}));
  const distance = point => Math.hypot(point.x-initialCursor.x,point.y-initialCursor.y);
  const target = candidates.sort((a,b)=>distance(b)-distance(a))[0];
  assert.ok(distance(target)>=16, 'trusted pointer target deliberately differs from actual initial cursor');
  const initialWorkerCursor = await page.evaluate(()=>window.__cursor?.state?.()||null);
  const before = await page.evaluate(() => window.__linuxCtl.inputDeviceStats());
  const framesBefore = await page.evaluate(() => window.__keyboardCapture.frames());
  await record('geometry', {uid, layers, clients, monitors, foot, target, initialCursor, initialWorkerCursor, box, inputBefore: before, inputFramesBefore: framesBefore});
  const pageTarget={x:box.x + target.x * box.width / monitor.width,
    y:box.y + target.y * box.height / monitor.height};
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,pageTarget),
    'ide-display-canvas','trusted pointer reaches the visible guest display');
  await page.mouse.click(pageTarget.x,pageTarget.y);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ide-display-canvas');
  if (await page.evaluate(() => document.documentElement.dataset.keyboardCapture) !== 'on') {
    await page.locator('#ide-keyboard-toggle').click();
    await canvas.focus();
  }
  assert.equal(await page.evaluate(() => document.documentElement.dataset.keyboardCapture), 'on');
  await record('focused');
  // The default package may start its fullscreen screensaver while the cold
  // boot is being observed. DOM focus alone cannot establish guest focus.
  // Wake it through the same trusted input path, then inspect the actual
  // compositor before issuing the command whose effect we will assert.
  let activeWindow = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow'));
  if (activeWindow.class === 'org.omarchy.screensaver') {
    await page.keyboard.press('Escape', {delay: 100});
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
  if (options.prepareFactory) {
    // A factory capture is prepared through genuine input. Clear an unfinished
    // prompt and select the production paced clock before the desktop can idle.
    await canvas.focus();
    await page.keyboard.press('Control+c', {delay: 100});
    await record('trusted-factory-prompt-reset');
  }
  // Use fresh compositor geometry after the trusted wake. Do not count a
  // fullscreen screensaver or a stale layer mapping as a populated bar.
  const requireBarContent=options.barContentRequired!==false;
  assert.ok(requireBarContent||options.barActions===false,'bar interactions require their content proof');
  const contentDeadline = Date.now() + 360000;
  const barProbes = [];
  let barContent;
  do {
    await wakeScreensaver('trusted-wake-waiting-bar-content');
    const freshLayers = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers'));
    const freshClients = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients'));
    const freshMonitors = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j monitors'));
    const freshMonitor = freshMonitors.find(value => value.id === foot.monitor) || freshMonitors[0];
    const bars = Object.values(freshLayers[freshMonitor.name]?.levels || {}).flat()
      .filter(layer => layer.namespace === 'omarchy-bar' && layer.alpha > 0);
    assert.equal(bars.length, 1, 'one actual visible Omarchy bar on the focused monitor');
    // Preserve each exact crop, including blank first frames. Geometry and
    // occlusion errors still fail immediately; only absent content is retried.
    const probeName = name + '-bar-content-' + String(barProbes.length).padStart(3, '0');
    barContent = await verifyPublicBarContent(page, output, {layer: bars[0],
      monitor: freshMonitor, clients: freshClients, name: probeName, requireContent: false});
    barProbes.push({name: probeName, status: barContent.status,
      started: barContent.started, finished: barContent.finished,
      capture: barContent.capture, content: barContent.content});
    await record('bar-content-probe', {barContent, barProbes});
    if (barContent.status === 'passed'||!requireBarContent) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  } while (Date.now() < contentDeadline);
  if(requireBarContent)assert.equal(barContent.status, 'passed', 'actual package bar renders distributed content before the bounded deadline');
  await record(requireBarContent?'bar-content':'bar-content-observed-only', {barContent, barProbes,barContentRequired:requireBarContent});
  if (options.barActions !== false) {
    const barActions = await verifyDesktopActions(page, command, output, {name, monitor: barContent.monitor, layer: barContent.layer, foot,accelerated:options.accelerated??true});
    await record('bar-actions', {barActions});
    await page.mouse.click(box.x + target.x * box.width / monitor.width,
      box.y + target.y * box.height / monitor.height);
    await canvas.focus();
  }
  if(options.beforeTyping){await options.beforeTyping({foot,barContent});await record('factory-captured-before-typing');}
  // Only trusted Playwright keyboard events create this file in Foot. The serial
  // control channel merely reads it afterward; it never injects this command.
  // CDP type() can describe a shifted punctuation key without physical modifier
  // transitions. This original evdev path deliberately preserves physical codes,
  // so the acceptance command uses only unshifted keys, like actual typing.
  const text = options.text || 'touch /tmp/gpukeyboard42touch';
  const markerAbsent = await command(page, options.markerAbsent || 'test ! -e /tmp/gpukeyboard42touch', 300000);
  assert.equal(markerAbsent.exit, 0, 'trusted input marker must be absent before typing');
  await wakeScreensaver('trusted-wake-after-bar');
  await page.mouse.click(box.x + target.x * box.width / monitor.width,
    box.y + target.y * box.height / monitor.height);
  await canvas.focus();
  const immediateFocus = JSON.parse(await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow'));
  assert.equal(immediateFocus.pid, foot.pid, 'actual Foot retains guest focus immediately before typing');
  assert.notEqual(immediateFocus.visible, false); assert.notEqual(immediateFocus.acceptsInput, false);
  await page.mouse.click(box.x + target.x * box.width / monitor.width,
    box.y + target.y * box.height / monitor.height);
  await canvas.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ide-display-canvas');
  const typingInputStart=await page.evaluate(()=>window.__criticTrustedInputEvents.length);
  await page.keyboard.type(text, {delay: options.delay ?? 50});
  await page.keyboard.press('Enter');
  const typingInput=await page.evaluate(at=>window.__criticTrustedInputEvents.slice(at),typingInputStart);
  await record('physical-typing', {typingInput});
  const typingTiming=assertPhysicalKeyHolds(typingInput,Math.max(250,4*(options.delay??50)));
  await record('physical-typing-timing', {typingTiming});
  await record('typed', {typedText: text, immediateFocus, markerAbsent});
  await canvas.screenshot({path: path.join(output, name + '-typed.png')});
  let marker;
  const markerDeadline = Date.now() + 120000;
  for (let i = 0; ; ++i) {
    marker = await command(page, options.markerRead || 'test -f /tmp/gpukeyboard42touch && echo TRUSTED_TOUCH_42', 300000);
    await record('marker-' + i, {marker});
    if (marker.exit === 0 || Date.now() >= markerDeadline) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(marker.exit, 0, 'trusted Foot keyboard command ran');
  assert.equal(marker.stdout.trim(), options.expected ?? 'TRUSTED_TOUCH_42');
  const cursor = await read('XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 cursorpos');
  const coordinates = cursor.match(/^(-?\d+),\s*(-?\d+)$/);
  assert.ok(coordinates, cursor);
  assert.ok(Math.abs(Number(coordinates[1]) - target.x) <= 4, 'actual guest cursor X');
  assert.ok(Math.abs(Number(coordinates[2]) - target.y) <= 4, 'actual guest cursor Y');
  assert.ok(Math.hypot(Number(coordinates[1])-initialCursor.x,Number(coordinates[2])-initialCursor.y)>=16, 'actual guest cursor moved to a different point');
  const finalWorkerCursor = await page.evaluate(()=>window.__cursor?.state?.()||null);
  const held = await page.evaluate(() => window.__keyboardCapture.heldSnapshot());
  assert.deepEqual(held, [], 'no held keys after trusted physical command');
  if (interactiveMode) {
    const sample = () => page.evaluate(async () => ({
      clock: await window.__linuxCtl.guestClockState(),
      retired: (await window.__linuxCtl.jitStats()).guestRetired,
    }));
    await page.evaluate(() => window.__linuxCtl.pause());
    const before = await sample();
    assert.equal(before.clock.mode, interactiveMode, 'actual worker selected the requested interaction clock');
    const pauseStarted = performance.now();
    await new Promise(resolve => setTimeout(resolve, 5000));
    const after = await sample();
    assert.equal(after.clock.mtime, before.clock.mtime, 'explicit pause freezes actual machine time');
    assert.equal(after.retired, before.retired, 'explicit pause freezes actual retirement count');
    const pauseMillis = performance.now() - pauseStarted;
    const resumeSent = performance.now();
    await page.evaluate(() => window.__linuxCtl.resume());
    const resumed = await sample();
    await new Promise(resolve => setTimeout(resolve, 250));
    const progressed = await sample();
    const progressReceived = performance.now();
    const clockProbe = {beforePause: before.clock, afterPause: after.clock,
      resumed: resumed.clock, progressed: progressed.clock,
      retired: {beforePause: before.retired, afterPause: after.retired,
        resumed: resumed.retired, progressed: progressed.retired},
      pauseMillis, resumeSent, progressReceived, measurementRealm: 'Node performance.now'};
    clockProbe.bound = assertInteractivePauseProbe(clockProbe);
    await record('interactive-clock', {clockProbe});
  }
  const after = await page.evaluate(() => window.__linuxCtl.inputDeviceStats());
  await record('passed', {status: 'passed', cursor, initialCursor, initialWorkerCursor, finalWorkerCursor, marker, inputAfter: after});
  await canvas.screenshot({path: path.join(output, name + '.png')});
  return result;
  } catch (error) {
    await record('failed', {status: 'failed', error: error.stack || String(error)}).catch(() => {});
    await page.locator('#ide-display-canvas').screenshot({path: path.join(output, name + '-failed.png')}).catch(() => {});
    throw error;
  }
}
