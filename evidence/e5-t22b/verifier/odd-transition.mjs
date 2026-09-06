import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from '../../../web/node_modules/playwright/index.mjs';

const repo = process.cwd();
const out = path.join(repo, 'evidence/e5-t22b/verifier');
const root = path.join(repo, 'web/dist');
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, {'Content-Type':'text/html'}).end('<!doctype html><body></body>');
  const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + '/')) return res.writeHead(404).end();
  try { const bytes=await readFile(file);res.writeHead(200, {'Content-Type':'text/javascript'}).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,
  executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results = [];
try {
  for (const backend of ['canvas2d','webgl2']) for (const dpr of [1,1.5,2]) {
    const context = await browser.newContext({deviceScaleFactor:dpr});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    const result = await page.evaluate(async ({backend,dpr}) => {
      const {PresentationController} = await import('/src/sink/presentation.js');
      const {DisplayViewportController} = await import('/src/sink/viewport.js');
      const {absoluteCoordinatesFromEvent} = await import('/src/input/pointer.js');
      const container = document.createElement('div');
      container.style.cssText='position:relative;width:351px;height:263px;overflow:hidden;background:black';
      const canvas = document.createElement('canvas'); container.append(canvas); document.body.append(container);
      const p = new PresentationController(canvas,{defaultBackend:backend,scheduleFrames:true});
      const v = new DisplayViewportController({container,presentation:p});
      const raf = () => new Promise(requestAnimationFrame);
      const frame = (w,h,partial=false) => ({resourceWidth:w,resourceHeight:h,
        pixels:Uint32Array.from({length:w*h},(_,i) => {
          const x=i%w,y=Math.floor(i/w);
          return (0xff000000 | (((x*13+y*7+19)&255)<<16) | (((x*3+y*17+29)&255)<<8) | ((x+y+71)&255))>>>0;
        }),rect:partial?{x:w-1,y:h-1,width:1,height:1}:{x:0,y:0,width:w,height:h}});
      const inspect = (label,sw,sh) => {
        const state=p.snapshot(), pixels=p.readPixels();
        let mismatches=0,first=null;
        for(let y=0;y<state.height;y++) for(let x=0;x<state.width;x++) {
          const row=state.backend==='webgl2'?state.height-1-y:y;
          const offset=4*(row*state.width+x);
          const expected=x<sw&&y<sh?[(x*13+y*7+19)&255,(x*3+y*17+29)&255,(x+y+71)&255,255]:[0,0,0,255];
          const actual=Array.from(pixels.slice(offset,offset+4));
          if(actual.some((value,i)=>value!==expected[i])) {mismatches++; first??={x,y,expected,actual};}
        }
        return {label,mismatches,first,state,source:[sw,sh]};
      };
      const checks=[];
      p.present(frame(337,251)); await raf();
      for(const [w,h] of [[329,277],[371,243],[351,263]]) {
        container.style.width=w+'px';container.style.height=h+'px';v.measure();
        checks.push(inspect('immediate-resize-'+w,337,251));
        p.present(frame(337,251,true));await raf();
        checks.push(inspect('partial-old-'+w,337,251));
      }
      const rect=container.getBoundingClientRect();
      const pointer=absoluteCoordinatesFromEvent({clientX:rect.left+340/dpr,clientY:rect.top+255/dpr},v.pointerRect());
      const mode=v.snapshot().desired;
      p.present(frame(mode.width,mode.height,true));
      p.present(frame(mode.width,mode.height,true));
      await raf();
      checks.push(inspect('two-matching-partial-frames-before-raf',mode.width,mode.height));
      if(backend==='webgl2') {
        p.present(frame(337,251,true));await raf();
        const old=p.canvas; p.backend.gl.getExtension('WEBGL_lose_context').loseContext();
        for(let n=0;n<120&&p.backendName!=='canvas2d';n++) await raf();
        checks.push({...inspect('context-replay-without-new-frame',337,251),replaced:!old.isConnected});
      }
      const css={width:p.canvas.style.width,height:p.canvas.style.height};
      v.dispose();p.dispose();
      return {backend,dpr,checks,pointer,css,mode};
    },{backend,dpr});
    results.push(result);
    await context.close();
  }
  const files=['web/src/sink/presentation.js','web/dist/src/sink/presentation.js','web/src/sink/viewport.js','web/dist/src/sink/viewport.js','web/src/sink/frame-scheduler.js'];
  const digests=Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
  const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),digests,results};
  await writeFile(path.join(out,process.env.ATTACK_REPORT||'odd-transition.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(results.map(r=>({backend:r.backend,dpr:r.dpr,pointer:r.pointer,checks:r.checks.map(c=>({label:c.label,mismatches:c.mismatches,first:c.first}))})),null,2));
  assert.ok(results.every(r=>r.checks.every(c=>c.mismatches===0)), 'independent transition pixel oracle failed');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
