// Observe the real package bar and display while sending trusted browser events.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyDesktopActions(page, command, output, {name, monitor, layer, foot, accelerated=true}) {
  assert.equal(typeof accelerated,'boolean');
  const report = {status: 'running', scope: 'trusted pointer and original Omarchy workspace buttons',
    accelerated, monitor, layer, foot, actions: []};
  const save = () => fs.writeFile(path.join(output, name + '-bar-actions.json'), JSON.stringify(report, null, 2) + '\n');
  const readWorkspace = async () => {
    const reply = await command(page, 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activeworkspace', 300000);
    assert.equal(reply.exit, 0); return JSON.parse(reply.stdout);
  };
  const canvas = page.locator('#ide-display-canvas'), box = await canvas.boundingBox();
  assert.ok(box?.width > 0 && box?.height > 0);
  assert.equal(monitor.width, 1280, 'pinned default desktop width');
  assert.equal(monitor.scale, 1);
  assert.equal(layer.x, monitor.x); assert.equal(layer.y, monitor.y);
  assert.ok(layer.h >= 20 && layer.h <= 40, 'actual default top bar geometry');
  const point = (x, y) => [box.x + x * box.width / monitor.width, box.y + y * box.height / monitor.height];
  try {
    report.before = {workspace: await readWorkspace(), gpu: await page.evaluate(() => wvmDemo.gpuStats()),
      display:await page.evaluate(()=>globalThis.__presentation.state())};
    assert.equal(report.before.workspace.id, foot.workspace.id, 'default Foot workspace is active');
    assert.ok([1, 2, 3, 4, 5].includes(foot.workspace.id));
    await page.evaluate(() => {
      const canvas = document.querySelector('#ide-display-canvas'), context = canvas.getContext('2d');
      const state = globalThis.__criticDesktopContinuity = {running: true, samples: [], events: []};
      state.listener = event => state.events.push({type: event.type, trusted: event.isTrusted,
        x: event.clientX, y: event.clientY, time: performance.now()});
      for (const type of ['pointermove', 'pointerdown', 'pointerup']) canvas.addEventListener(type, state.listener, true);
      const tick = () => {
        if (!state.running) return;
        const points = [0.02, 0.5, 0.98].flatMap(x => [0.02, 0.5, 0.98].map(y =>
          [Math.min(canvas.width - 1, Math.floor(x * canvas.width)), Math.min(canvas.height - 1, Math.floor(y * canvas.height))]));
        const alpha = points.map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
        state.samples.push({time: performance.now(), alpha, blank: alpha.every(value => value === 0),
          framesReceived: globalThis.__presentation?.state().framesReceived});
        if (state.samples.length >= 20000) { state.overflow = true; state.running = false; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    report.moves = [];
    for (const [x, y] of [[200, 220], [900, 600], [500, 300], [1100, 500], [250, 400], [700, 250]]) {
      report.moves.push({x, y, time: Date.now()});
      await page.mouse.move(...point(x, y), {steps: 8});
      await page.waitForTimeout(350);
    }
    // Workspaces.qml in the pinned original package uses five 20px buttons.
    // Their observed centers are45,65,85,105,125 on the default1280px bar.
    // Guest state, rather than a painted button or cursor, proves the action.
    const away = foot.workspace.id === 2 ? 1 : 2;
    for (const expected of [away, foot.workspace.id]) {
      const row = {expected, x: 25 + 20 * expected, y: layer.h / 2, started: Date.now()}; report.actions.push(row);
      await page.mouse.click(...point(row.x, row.y), {delay: 120});
      const deadline = Date.now() + 120000;
      do {
        row.observed = await readWorkspace(); await save();
        if (row.observed.id === expected) break;
        await page.waitForTimeout(1000);
      } while (Date.now() < deadline);
      assert.equal(row.observed.id, expected, 'trusted original top-bar click changes the guest workspace');
      row.finished = Date.now();
      await canvas.screenshot({path: path.join(output, name + '-workspace-' + expected + '.png')});
    }
    report.after = {workspace: await readWorkspace(), gpu: await page.evaluate(() => wvmDemo.gpuStats()),
      display:await page.evaluate(()=>globalThis.__presentation.state())};
    if(accelerated){
      assert.equal(report.after.gpu.counters.failed, 0);
      assert.ok(report.after.gpu.counters.draws > report.before.gpu.counters.draws, 'bar actions render new guest draws');
    }else{
      assert.equal(report.after.gpu?.qualified??false,false,'software choice stays on the software route');
      assert.ok(report.after.display.drawnPresents>report.before.display.drawnPresents,'software bar actions produce new actual scanout frames');
      assert.deepEqual(report.after.display.errors,[]);
    }
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); throw error; }
  finally {
    report.continuity = await page.evaluate(() => {
      const state = globalThis.__criticDesktopContinuity;
      if (!state) return null;
      state.running = false;
      for (const type of ['pointermove', 'pointerdown', 'pointerup']) document.querySelector('#ide-display-canvas').removeEventListener(type, state.listener, true);
      return {samples: state.samples, events: state.events, overflow: state.overflow ?? false};
    }).catch(error => ({error: String(error)}));
    await save();
  }
  try {
    assert.equal(report.continuity.overflow, false);
    assert.ok(report.continuity.samples.length >= 30, 'continuous actual canvas sampling');
    assert.equal(report.continuity.samples.filter(row => row.blank).length, 0, 'no fully transparent frames during movement or bar clicks');
    assert.ok(report.continuity.events.filter(row => row.type === 'pointermove').length >= 6);
    assert.ok(report.continuity.events.filter(row => row.type === 'pointerdown').length >= 2);
    assert.ok(report.continuity.events.every(row => row.trusted), 'all actual pointer actions were browser trusted');
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); throw error; }
  finally { await save(); }
  return report;
}
