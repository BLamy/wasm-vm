import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runProductionRecovery(page,output) {
  const state=()=>page.evaluate(async()=>({gpu:await __production.controller.gpuStats(),display:__production.presentation.snapshot(),input:await __production.controller.inputDeviceStats(),errors:__production.errors}));
  async function command(text,marker) {
    const start=await page.evaluate(()=>__production.serial.length);
    await page.evaluate(text=>__production.controller.sendInput(new TextEncoder().encode(text)),text+'\n');
    await page.waitForFunction(({start,marker})=>['\r','\n'].some(prefix=>__production.serial.slice(start).includes(prefix+marker+'\r\n')),{start,marker},{timeout:180000});
  }
  await command(`mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t tmpfs tmpfs /run; mkdir -p /run/user/0; export XDG_RUNTIME_DIR=/run/user/0; set -a; . /etc/environment.d/60-omarchy-browser.conf; set +a; unset LIBGL_ALWAYS_SOFTWARE LP_NUM_THREADS
/opt/virgl-proof/kmscube --device=/dev/dri/card0 --mode=rgba --count=1001 --nonblocking >/tmp/recovery-cube.log 2>&1 &
recovery_cube_pid=$!
echo __RECOVERY_STARTED`, '__RECOVERY_STARTED');
  await page.waitForFunction(async()=>{const g=await __production.controller.gpuStats();return g.qualified&&g.counters.draws>=3;},null,{timeout:180000,polling:500});
  const before=await state();await page.locator('#display').screenshot({path:path.join(output,'before-loss.png')});
  assert.equal(await page.evaluate(()=>__production.controller.loseGpuContext('pending')),true);
  await page.waitForFunction(async()=>Boolean((await __production.controller.gpuStats()).lost),null,{timeout:15000,polling:100});
  const lost=await state();await page.locator('#display').screenshot({path:path.join(output,'context-lost.png')});
  await command(`kill "$recovery_cube_pid"; printf '\\033[2JGPU context loss: CPU display and serial are alive\\n' >/dev/tty1
echo __RECOVERY_SERIAL_ALIVE`, '__RECOVERY_SERIAL_ALIVE');
  await page.waitForFunction(presents=>__production.presentation.snapshot().drawnPresents>presents,lost.display.drawnPresents,{timeout:30000,polling:100});
  const snapshots=await page.evaluate(async()=>{const results={};for(const method of ['saveDesktopSnapshot','snapshotSave','snapshotRestore','snapshotImport'])try{await __production.controller[method](new Uint8Array());results[method]='unexpected success';}catch(error){results[method]=String(error.message);}return results;});
  for(const message of Object.values(snapshots))assert.match(message,/Accelerated GPU sessions require a cold restart/);
  await page.evaluate(async()=>{await __production.controller.sendTabletEvent(3,0,16384);await __production.controller.sendTabletEvent(3,1,32768);await __production.controller.syncTablet();});
  const recovered=await state();assert.equal(recovered.gpu.qualified,false);assert.equal(recovered.gpu.pending,null);assert.equal(recovered.gpu.store.resources.length,0);assert.deepEqual(recovered.errors,[]);
  assert.ok(recovered.gpu.guestCommands.records.length>lost.gpu.guestCommands.records.length,'original GPU queue continued after loss');
  const event=await page.evaluate(()=>__production.gpu.find(e=>e.type==='loss-injected'));assert.ok(event?.pending,'loss occurred during a pending physical GPU fence');
  await fs.writeFile(path.join(output,'recovery.json'),JSON.stringify({status:'passed',before,lost,recovered,snapshots,injection:event},null,2));
  await page.locator('#display').screenshot({path:path.join(output,'recovered-2d.png')});
  console.log('Actual pending WebGL context loss,queue settlement,CPU display/input and snapshot rejection passed.');
}
