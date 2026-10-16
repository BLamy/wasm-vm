import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runProductionNumeric(page, output) {
  const start = await page.evaluate(()=>__production.serial.length);
  await page.evaluate(text=>__production.controller.sendInput(new TextEncoder().encode(text)),
    'mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t tmpfs tmpfs /run; mkdir -p /dev/shm; mount -t tmpfs tmpfs /dev/shm; '+
    'set -a; . /etc/environment.d/60-omarchy-browser.conf; set +a; unset LIBGL_ALWAYS_SOFTWARE LP_NUM_THREADS; '+
    '/opt/virgl-proof/egl-index; echo EGL_INDEX_RC=$?; echo __NUMERIC_PROBE_END\n');
  await page.waitForFunction(start=>__production.serial.slice(start).includes('\r\n__NUMERIC_PROBE_END\r\n'),start,{timeout:300000});
  const serial=await page.evaluate(start=>__production.serial.slice(start),start);
  await fs.writeFile(path.join(output,'numeric.txt'),serial);
  assert.match(serial,/GL_RENDERER=virgl \(wasm-vm WebGL2 VirGL\)/);
  assert.match(serial,/GL_VERSION=OpenGL ES 3\.0 Mesa 26\.2\.2/);
  assert.match(serial,/GL_CORE_LIMIT name=MAX_SAMPLES value=4 floor=4.*pass=1/);
  assert.match(serial,/GL_CORE_NUMERIC_PASS/);assert.match(serial,/EGL_PUBLIC_GLES_ONLY_PASS/);
  assert.match(serial,/GL_REQUIRED_MULTISAMPLE_PASS/);
  assert.match(serial,/GL_MESA_ORIGINAL_RESOLVE_PASS/);
  const samples=[...serial.matchAll(/GL_REQUIRED_MS_FORMAT name=([^ ]+).*pass=([01])/g)];
  assert.equal(samples.length,15);assert.ok(samples.every(value=>value[2]==='1'));
  assert.match(serial,/EGL_INDEX_PASS/);assert.match(serial,/EGL_INDEX_RC=0/);
  const limits=[...serial.matchAll(/GL_CORE_LIMIT name=([^ ]+) value=([0-9]+).*pass=([01])/g)];
  assert.equal(limits.length,29);assert.ok(limits.every(value=>value[3]==='1'));
  const state=await page.evaluate(async()=>({gpu:await __production.controller.gpuStats(),errors:__production.errors,digest:await __production.controller.stateDigest()}));
  assert.match(state.digest,/^[a-f0-9]{64}$/);assert.equal(state.gpu.counters.failed,0);assert.deepEqual(state.errors,[]);
  await fs.writeFile(path.join(output,'numeric.json'),JSON.stringify({status:'passed',limits:limits.map(v=>({name:v[1],value:Number(v[2])})),state},null,2));
}
