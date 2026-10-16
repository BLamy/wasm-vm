// Reuse this critic's existing owned Playwright page through its Node inspector.
// Never select another Node/browser session, replace transport, or synthesize output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = new URL('file://' + path.join(repo, 'tools/virgl-production/critic-fast-boots.mjs')).href;
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = targets.find(value => value.url === expected);
assert.ok(target, 'only the existing critic-owned fast-boot Node target is eligible');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
let sequence = 0, pausedResolve;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  } else if (message.method === 'Debugger.paused') pausedResolve?.(message.params);
});
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
}
try {
  await send('Runtime.enable');
  const existing = await send('Runtime.evaluate', {expression: 'Boolean(globalThis.__criticOwnedPage)', returnByValue: true});
  if (!existing.result.value) {
    await send('Debugger.enable');
    const source = await fs.readFile(path.join(repo, 'tools/virgl-production/critic-fast-boots.mjs'), 'utf8');
    const lineNumber = source.split('\n').findIndex(line => line.includes('const state=await page.evaluate'));
    assert.ok(lineNumber > 0);
    const paused = new Promise(resolve => { pausedResolve = resolve; });
    const breakpoint = await send('Debugger.setBreakpointByUrl', {url: expected, lineNumber});
    const event = await Promise.race([paused, new Promise((_, reject) => setTimeout(() => reject(Error('owned harness breakpoint deadline')), 30000))]);
    const frame = event.callFrames.find(value => value.functionName === 'waitActualReady');
    assert.ok(frame, 'the page comes only from the original acceptance function');
    const installed = await send('Debugger.evaluateOnCallFrame', {callFrameId: frame.callFrameId,
      expression: '(globalThis.__criticOwnedPage = page, true)', returnByValue: true});
    assert.equal(installed.result.value, true);
    await send('Debugger.removeBreakpoint', {breakpointId: breakpoint.breakpointId});
    await send('Debugger.resume');
  }
  const request = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const result = await send('Runtime.evaluate', {expression:
    'globalThis.__criticOwnedPage.evaluate(async request => window.wvmDemo.run(request.command, request.timeout || 300000), ' + JSON.stringify(request) + ')',
    awaitPromise: true, returnByValue: true});
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  await fs.writeFile(process.argv[3], JSON.stringify({scope: 'actual original public serial controller', request, result: result.result.value}, null, 2));
  console.log(JSON.stringify(result.result.value));
} finally {
  await send('Debugger.resume').catch(() => {});
  socket.close();
}
