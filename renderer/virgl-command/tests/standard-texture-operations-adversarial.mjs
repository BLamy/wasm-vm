/** Independent original TXF + TXQ capture; no emitted-source numerical oracle. */
import { rig, submit, finish, blob, nativeRead } from './standard-texture-operations-rig.mjs';
import { checks } from './standard-instanced-draws.mjs';
import { createVirglStandardTextureShaderBridge } from '../../virgl-shader/standard.mjs';
import { meta, packet, join, setupPackets, viewPackets, operationDraw, imageView, textureTransfer } from '../../../tools/virgl-command/standard-texture-operations-fixtures.mjs';
const tgsi = (stage, declarations, operations) => stage + '\n' + declarations.join('\n') + '\n' + [...operations, 'END'].map((v, i) => i + ': ' + v + '\n').join('');
const positions = () => new Uint8Array(Float32Array.from([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]).buffer);
function input(width, height, lastLevel, seed) {
  let state = seed >>> 0, offset = 11;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const planes = [];
  for (let level = 0; level <= lastLevel; level++) {
    const w = Math.max(1, width >>> level), h = Math.max(1, height >>> level);
    const bytes = Uint8Array.from({ length: w * h * 4 }, (_, i) => (next() + i * 37 + level * 71) & 255);
    const stride = w * 4 + 7; planes.push({ level, width: w, height: h, offset, stride, input: bytes });
    offset += (h - 1) * stride + bytes.length / h + 9;
  }
  const backing = new Uint8Array(offset).fill(0x6b);
  for (const p of planes) for (let y = 0; y < p.height; y++) backing.set(p.input.subarray(y * p.width * 4, (y + 1) * p.width * 4), p.offset + y * p.stride);
  return { metadata: { ...meta(6, 2, 67, 10, width, height), lastLevel }, planes, backing };
}
export function specimen(stage, seed, swizzle) {
  const common = ['DCL TEMP[0..1]', 'DCL SAMP[11]', 'DCL SVIEW[11], 2D, FLOAT', 'IMM[0] INT32 {1,0,0,1}', 'IMM[1] INT32 {0,0,0,0}', 'IMM[2] FLT32 {0.0625,0.0625,0.0625,0.0625}'];
  const texture = ['TXF TEMP[0], IMM[0], SAMP[11], 2D', 'TXQ TEMP[1].w, IMM[1], SAMP[11], 2D', 'U2F TEMP[1].w, TEMP[1].wwww', 'MUL TEMP[1].w, TEMP[1].wwww, IMM[2].wwww'];
  const vertex = stage === 'vertex' ? tgsi('VERT', ['DCL IN[0]', 'DCL IN[1]', 'DCL OUT[0], POSITION', 'DCL OUT[1], GENERIC[0]', ...common], ['MOV OUT[0], IN[0]', ...texture, 'MOV OUT[1], TEMP[0]', 'MOV OUT[1].w, TEMP[1].wwww']) : tgsi('VERT', ['DCL IN[0]', 'DCL IN[1]', 'DCL OUT[0], POSITION'], ['MOV OUT[0], IN[0]']);
  const fragment = stage === 'fragment' ? tgsi('FRAG', ['DCL OUT[0], COLOR', ...common], [...texture, 'MOV OUT[0], TEMP[0]', 'MOV OUT[0].w, TEMP[1].wwww']) : tgsi('FRAG', ['DCL IN[0], GENERIC[0], PERSPECTIVE', 'DCL OUT[0], COLOR'], ['MOV OUT[0], IN[0]']);
  return { width: 8, height: 8, stage, slot: 11, firstLevel: 1, lastLevel: 4, swizzle, vertex, fragment, positions: positions(), coordinates: new Uint8Array(96), source: input(19, 13, 4, seed), parameters: { s: 2, t: 2, r: 2, min: 0, mip: 0, mag: 0, minLod: -1000, maxLod: 1000 } };
}
function originalColor(source, first, last, swizzle) {
  const p = source.planes[first + 1], texel = [...p.input.subarray(4, 8)];
  const color = swizzle.map(v => v === 4 ? 0 : v === 5 ? 255 : texel[v]);
  color[3] = Math.round((last - first + 1) / 16 * 255); return color;
}
export async function runAcceptance({ seed = 0x749ad013, fault = null } = {}) {
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  const bridge = await createVirglStandardTextureShaderBridge(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const report = { status: 'running', guestExecution: false, productionNegotiation: false, gpu: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), seed, frames: [], runs: [], blobs: [], predictions: c.rows };
  window.__standardTextureOperationsEvidence = report;
  for (const stage of ['vertex', 'fragment']) for (const swizzle of [[1,5,0,2], [2,0,4,1]]) {
    const s = specimen(stage, seed, swizzle), r = rig(gl, bridge, c, s, { delay: ({ ordinal }) => ((seed >>> (ordinal % 19)) ^ ordinal) & 3, step: 1, fault });
    r.blobs = report.blobs;
    r.add(meta(3,0,64,0,s.positions.length), s.positions); r.add(meta(7,0,64,0,s.coordinates.length), s.coordinates);
    const original = r.add(s.source.metadata, s.source.backing), target = r.allocations[0].storage.texture;
    const row = { stage, seed, swizzle, slot: 11, range: [1,4], sourceGeneration: original.generation, source: s.source.metadata, vertex: s.vertex, fragment: s.fragment, originalColor: originalColor(s.source,1,4,swizzle), positions: await blob(report,s.positions), coordinates: await blob(report,s.coordinates), backing: await blob(report,s.source.backing), planes: [], actions: [], final: null };
    for (const p of s.source.planes) row.planes.push({ ...p, input: await blob(report,p.input) });
    report.runs.push(row);
    const capture = async (label, source = s.source, first = 1, last = 4) => {
      const record = await submit(r,1,operationDraw(),label); c.ok(record.result,'independent original combined draw'); c.same(record.result.gpuComplete,true,'independent combined completed physical fence');
      const pixels = nativeRead(gl,target,67,8,8,0), color = originalColor(source,first,last,swizzle), mismatch = [...pixels].flatMap((v,i) => Math.abs(v-color[i%4]) > 1 ? [{ at:i, observed:v, expected:color[i%4] }] : []);
      const frame = { run: report.runs.length-1, label, historyIndex:r.history.length-1, dump:record.dump, range:[first,last], source:source===s.source?'original':'replacement', color, pixels:await blob(report,pixels), bindings:[], query:r.draws.at(-1).queries, cache:r.renderer.inspect() };report.frames.push(frame);
      const textureUnit = (stage==='vertex'?16:0)+11; gl.activeTexture(gl.TEXTURE0+textureUnit); const native = gl.getParameter(gl.TEXTURE_BINDING_2D);
      for (let local=0; local<=last-first; local++) { const p = source.planes[first+local], raw = nativeRead(gl,native,67,p.width,p.height,local); frame.bindings.push({local,original:first+local,width:p.width,height:p.height,bytes:await blob(report,raw)}); c.same([...raw],[...p.input],'independent full native selected mip'); }
      gl.activeTexture(gl.TEXTURE0); c.same(gl.getError(),gl.NO_ERROR,'independent native captures no error');
      if (fault) report.sabotage={fault,fenceCompleted:record.result.gpuComplete,held:mismatch.length===0,miss:mismatch.slice(0,8)};
      c.same(mismatch.slice(0,8),[],'independent original retained fetch/query pixels at completed native fence');
      c.same(frame.query,[{name:(stage==='vertex'?'vs':'fs')+'samplevels11',type:gl.INT,size:1,value:last-first+1}],'independent captured local query count');
      return frame;
    };
    try {
      c.ok((await submit(r,1,setupPackets(s),'independent-link-before-view')).result,'independent original link before view');
      c.ok((await submit(r,1,viewPackets(s),'independent-original-view')).result,'independent original retained view');
      const first = await capture('independent-first'), warm = await capture('independent-warm'); c.same(warm.cache.work.programLinks,first.cache.work.programLinks,'independent warm native cache');
      c.ok(r.store.unref(6),'independent original public ID unref'); const replacement = input(11,7,1,(seed ^ 0x8c174e31) >>> 0), fresh = r.add(replacement.metadata,replacement.backing);
      row.replacement={metadata:replacement.metadata,generation:fresh.generation,backing:await blob(report,replacement.backing),planes:[]};for(const p of replacement.planes)row.replacement.planes.push({...p,input:await blob(report,p.input)});
      row.actions.push({kind:'unequal-public-id-reuse',inspection:r.store.inspect()}); c.same(fresh.generation>original.generation,true,'independent unequal replacement new generation');
      await capture('independent-old-range-after-reuse'); c.ok(r.renderer.resetCaches(),'independent reset caches'); c.ok(r.renderer.restoreContext(1),'independent restore old captured context'); await capture('independent-old-range-after-restore');
      c.ok((await submit(r,1,join(...replacement.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),imageView(91,6,67,0,1,swizzle),packet(10,0,[stage==='vertex'?0:1,11,91])),'independent-explicit-new-view')).result,'independent explicit view replacement');
      await capture('independent-new-view-selected',replacement,0,1);
    } finally { await finish(r,report,row); }
  }
  report.status='passed';return report;
}
