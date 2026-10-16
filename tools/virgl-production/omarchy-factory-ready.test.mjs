import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {wallpaperMatches,startupWindowReady} from './omarchy-factory-ready.mjs';

test('wallpaper gate accepts the independently verified original grid and rejects incomplete or wrong frames',async()=>{
  const original=await fs.readFile(new URL('./fixtures/omarchy-original-wallpaper-grid.rgba',import.meta.url));
  assert.equal(wallpaperMatches(original),true);
  assert.equal(wallpaperMatches(Buffer.alloc(original.length)),false);
  const changed=Buffer.from(original);changed[200]^=1;assert.equal(wallpaperMatches(changed),false);
  assert.throws(()=>wallpaperMatches(original.subarray(4)));
});

const sample=(time,extra={})=>({time,clock:{mtime:String(time*10000)},
  native:{core:[{pid:367,comm:'Hyprland',starttime:'123'}],jobs:[{exit:0,stdout:''},{exit:0,stdout:''}]},
  scheduler:{fetchRequestedChunks:2400,fetchWaits:30,retiredInstructions:String(time*1000)},...extra});
const ready=()=>[sample(0),sample(5000),sample(10000)];
test('settling requires a progressing guest, finished system/user jobs and a full disk-demand quiet interval',()=>{
  assert.equal(startupWindowReady(ready()),true);
  assert.equal(startupWindowReady(ready().slice(1)),false);
  assert.equal(startupWindowReady([sample(0),sample(1000),sample(2000)]),false);
  for(const attack of ['system-job','user-job','job-query-failure','core-restart','disk-demand','disk-wait','missing-counters','paused-guest','guest-time-not-advanced']){
    const rows=ready(),last=rows.at(-1);
    if(attack==='system-job')last.native.jobs[0].stdout='3 startup.service start running\n';
    if(attack==='user-job')last.native.jobs[1].stdout='4 app-daemon.service start waiting\n';
    if(attack==='job-query-failure')last.native.jobs[1].exit=1;
    if(attack==='core-restart')last.native.core[0].starttime='124';
    if(attack==='disk-demand')last.scheduler.fetchRequestedChunks++;
    if(attack==='disk-wait')last.scheduler.fetchWaits++;
    if(attack==='missing-counters')delete last.scheduler.fetchWaits;
    if(attack==='paused-guest')for(const row of rows)row.scheduler.retiredInstructions='0';
    if(attack==='guest-time-not-advanced')last.clock.mtime='1';
    assert.equal(startupWindowReady(rows),false,attack);
  }
  const transient=sample(-5000);transient.native.jobs[1].stdout='startup.service start running\n';
  assert.equal(startupWindowReady([transient,...ready()]),true,'a completed earlier startup job does not poison a later quiet window');
});
