// Deterministic real guest acceptance. All commands enter the original serial device.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runProductionAcceptance(page, output) {
  const state = () => page.evaluate(async () => ({gpu:await __production.controller.gpuStats(),display:__production.presentation.snapshot(),scheduler:await __production.controller.schedulerStats(),clock:await __production.controller.guestClockState(),errors:__production.errors}));
  async function command(text, marker, timeout=300000) {
    const start=await page.evaluate(()=>__production.serial.length);
    await page.evaluate(text=>__production.controller.sendInput(new TextEncoder().encode(text)),text+'\n');
    await page.waitForFunction(({start,marker})=>['\r','\n'].some(prefix=>__production.serial.slice(start).includes(prefix+marker.trim()+'\r\n')),{start,marker},{timeout});
    return page.evaluate(start=>__production.serial.slice(start),start);
  }
  const probe=await command(`mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t tmpfs tmpfs /run; mkdir -p /run/user/0 /dev/pts /dev/shm; mount -t devpts devpts /dev/pts; mount -t tmpfs tmpfs /dev/shm; export XDG_RUNTIME_DIR=/run/user/0 LANG=C.UTF-8; set -a; . /etc/environment.d/60-omarchy-browser.conf; set +a; unset LIBGL_ALWAYS_SOFTWARE LP_NUM_THREADS
test ! -e /usr/lib/dri/swrast_dri.so && test ! -e /usr/lib/dri/kms_swrast_dri.so && echo SOFTWARE_DRI_ABSENT
/opt/virgl-proof/eglinfo -p gbm -a gles; echo EGLINFO_RC=$?
/opt/virgl-proof/egl-index; echo EGL_INDEX_RC=$?
/opt/virgl-proof/textured-scene /dev/dri/renderD128; echo SCENE_RC=$?
echo __PRODUCTION_PROBE_COMPLETE`, '\r__PRODUCTION_PROBE_COMPLETE\r\n');
  assert.match(probe,/[\r\n]SOFTWARE_DRI_ABSENT\r\n/);assert.match(probe,/EGLINFO_RC=0/);assert.match(probe,/OpenGL ES profile renderer: virgl \(wasm-vm WebGL2 VirGL\)/);assert.match(probe,/OpenGL ES 3\.0 Mesa 26\.2\.2/);assert.match(probe,/TEXTURED_SCENE_END status=pass draws=3 checked_pixels=768/);assert.match(probe,/SCENE_RC=0/);
  assert.doesNotMatch(probe,/GL_(?:EXT|OES)_texture_border_clamp|GL_EXT_texture_sRGB_decode/);
  assert.match(probe,/EGL_INDEX_RC=0/);
  await fs.writeFile(path.join(output,'probe.txt'),probe);
  const cubeBefore=await state();
  const cubeWallStart=Date.now();
  const cube=await command('/opt/virgl-proof/kmscube --device=/dev/dri/card0 --mode=rgba --count=1001 --nonblocking; echo KMSCUBE_RC=$?; echo __PRODUCTION_CUBE_COMPLETE','\r__PRODUCTION_CUBE_COMPLETE\r\n',900000);
  const cubeWallMilliseconds=Date.now()-cubeWallStart;
  assert.match(cube,/Rendered 1000 frames/);assert.match(cube,/KMSCUBE_RC=0/);
  const cubeAfter=await state();assert.ok(cubeAfter.gpu.counters.completed-cubeBefore.gpu.counters.completed>=1000);assert.ok(cubeAfter.gpu.counters.draws-cubeBefore.gpu.counters.draws>=1000);assert.ok(cubeAfter.display.drawnPresents-cubeBefore.display.drawnPresents>=1000);
  await fs.writeFile(path.join(output,'cube.txt'),cube);await fs.writeFile(path.join(output,'cube-state.json'),JSON.stringify({before:cubeBefore,after:cubeAfter,wallMilliseconds:cubeWallMilliseconds,reportedFpsClock:'guest icount; not a wall-time performance measurement'},null,2));
  await command(`mkdir -p /run/udev; /usr/lib/systemd/systemd-udevd --daemon >/tmp/production-udev.log 2>&1; udevadm trigger --type=subsystems --action=add; udevadm trigger --type=devices --action=add; export LIBSEAT_BACKEND=seatd AQ_DRM_DEVICES=/dev/dri/card0; SEATD_VTBOUND=0 seatd -g root >/tmp/production-seatd.log 2>&1 &
cat > /tmp/production-hyprland.conf <<'CONF'
monitor = Virtual-1,1024x768@60,0x0,1
animations {
 enabled = false
}
misc {
 disable_hyprland_logo = true
 disable_splash_rendering = true
}
debug {
 disable_logs = false
}
CONF
Hyprland --i-am-really-stupid --config /tmp/production-hyprland.conf >/tmp/production-hyprland.log 2>&1 &
echo __PRODUCTION_COMPOSITOR_STARTED`, '\r__PRODUCTION_COMPOSITOR_STARTED\r\n');
  const ready=await command(`timeout 180 sh -c 'until XDG_RUNTIME_DIR=/run/user/0 hyprctl -i 0 monitors >/tmp/production-monitors.txt 2>&1; do sleep 1; done'; echo HYPRLAND_IPC_RC=$?
grep -E 'Using: OpenGL|Renderer:|eglCreateContext failed with GLES' /run/user/0/hypr/*/hyprland.log
echo __PRODUCTION_COMPOSITOR_READY`, '\r__PRODUCTION_COMPOSITOR_READY\r\n');
  assert.match(ready,/HYPRLAND_IPC_RC=0/);assert.match(ready,/retrying GLES 3\.0/);assert.match(ready,/Using: OpenGL ES 3\.0 Mesa/);assert.match(ready,/Renderer: virgl \(wasm-vm WebGL2 VirGL\)/);
  const before=await state();
  await command(`XDG_RUNTIME_DIR=/run/user/0 WAYLAND_DISPLAY=wayland-1 foot --app-id=virgl-production-proof --title='GPU rendering verified' sh -c 'printf "\\033[42m Real Mesa + Hyprland on WebGL2 \\033[0m\\n"; sleep 300' >/tmp/production-foot.log 2>&1 &
echo __PRODUCTION_CLIENT_STARTED`, '\r__PRODUCTION_CLIENT_STARTED\r\n');
  await page.waitForFunction(async ({completed,draws,presents})=>{const g=await __production.controller.gpuStats();return g.counters.completed>completed&&g.counters.draws>draws&&__production.presentation.snapshot().drawnPresents>presents;},{completed:before.gpu.counters.completed,draws:before.gpu.counters.draws,presents:before.display.drawnPresents},{timeout:300000,polling:1000});
  const clients=await command(`timeout 180 sh -c 'until XDG_RUNTIME_DIR=/run/user/0 hyprctl -i 0 -j clients > /tmp/production-clients.json && grep -q "GPU rendering verified" /tmp/production-clients.json; do sleep 2; done'; echo CLIENT_MAPPING_RC=$?
cat /tmp/production-clients.json; cat /tmp/production-foot.log; echo __PRODUCTION_CLIENTS_COMPLETE`,'\r__PRODUCTION_CLIENTS_COMPLETE\r\n');assert.match(clients,/CLIENT_MAPPING_RC=0/);assert.match(clients,/GPU rendering verified/);
  const final=await state();
  // Preserve the original transport's final request/response records even if
  // an assertion fails. Never infer a rejected packet from renderer counters.
  await fs.writeFile(path.join(output,'final-state.json'),JSON.stringify(final,null,2));
  await fs.writeFile(path.join(output,'hyprland.txt'),ready+'\n'+clients);
  await page.locator('#display').screenshot({path:path.join(output,'hyprland.png')});
  assert.equal(final.gpu.counters.failed,0);assert.equal(final.gpu.guestCommands.dropped,0);assert.deepEqual(final.errors,[]);
  const records=final.gpu.guestCommands.records;assert.ok(records.every(r=>r.response<0x1200));for(const type of [0x108,0x109,0x200,0x204,0x106,0x202,0x205,0x206,0x207,0x103,0x104])assert.ok(records.some(r=>r.type===type),'original command family '+type.toString(16));
  const digest=await page.evaluate(()=>__production.controller.stateDigest());assert.match(digest,/^[a-f0-9]{64}$/);
  await fs.writeFile(path.join(output,'hyprland.txt'),ready+'\n'+clients);await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify({status:'passed',probe:{pixels:768,draws:3},cube:{frames:1000},hyprland:true,guestDigest:digest,final},null,2));
  console.log('Actual VirGL-only Mesa,1000 cube frames,Hyprland client and scanout passed.');
}
