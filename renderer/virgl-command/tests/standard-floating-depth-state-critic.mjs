// Concrete object identities and non-default sampled/pixel state, independently
// checked at the same original floating-depth transfer/range boundary.
import { checks, rig, add, finish, blob, physicalFence, poll, nativeRead } from './standard-floating-depth-rig.mjs';
import { fieldMisses } from './standard-floating-depth-critic.mjs';
import { command } from './standard-integer-images.mjs';
const unhex = text => Uint8Array.from(text.match(/../g) ?? [], value => Number.parseInt(value, 16));
function transfer(p, direction = 1) {
  const words = [6, p.level, 0, p.stride, 0, 0, 0, 0, p.width, p.height, 1, p.offset, direction];
  const raw = new Uint8Array(56), data = new DataView(raw.buffer); data.setUint32(0, 43 | 13 << 16, true);
  words.forEach((word, i) => data.setUint32(4+i*4, word, true)); return raw;
}
export async function runStateAcceptance() {
  const originals = await (await fetch('/renderer/virgl-command/tests/standard-floating-depth-critic-originals.json')).json();
  const c = checks(), gl = document.querySelector('#gpu').getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = { schema: 'fresh-floating-depth-nondefault-caller-state-v1', status: 'running', guestExecution: false,
    productionNegotiation: false, productionDrawAuthority: false, gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    runs: [], blobs: [], predictions: c.rows };
  window.__standardFloatingDepthEvidence = report;
  for (const source of originals.rows.filter(row => row.seed === 0x6b49172d)) {
    const format = source.format, packed = format === 126, r = rig(gl, c), g = r.traced;
    const metadata = { id: 6, target: 2, format, bind: 9, width: 15, height: 9, depth: 1, arraySize: 1, lastLevel: 3, nrSamples: 0, flags: 0 };
    const row = { kind: 'nondefault-caller-state', seed: source.seed, metadata, source: [], private: [] }, owned = [];
    report.runs.push(row);
    const make = (kind, ...args) => { const object = g['create'+kind](...args); if (!object) throw Error('caller '+kind+' allocation'); owned.push([kind, object]); return object; };
    try {
      add(r, metadata, unhex(source.backingHex)); const storage = r.allocations[0].storage;
      for (const plane of source.planes) {
        const prepared = c.ok(r.asyncAccess.prepareTransfer(1, command(transfer(plane))), 'state original transfer');
        c.ok(r.asyncAccess.provideInput(prepared.ticket, unhex(plane.inputHex)), 'state exact original fields');
        c.ok(r.asyncAccess.upload(prepared.ticket), 'state native original upload'); c.ok(r.asyncAccess.release(prepared.ticket), 'state input retirement');
        row.source.push({ level: plane.level, input: await blob(report, unhex(plane.inputHex)) });
      }
      row.uploadFence = await physicalFence(r, 'state-original-upload-completion');
      const lease = c.ok(r.store.retainStorage(1, 6, 'view'), 'state original sampler lease').lease;
      const view = c.ok(r.imageAccess.capture(lease, 1, 2), 'state private original range');
      const resolved = c.ok(r.imageAccess.resolve(view.token), 'state concrete native range');
      const readLease = c.ok(r.store.retainStorage(2, 6, 'readback'), 'state original read lease').lease;
      r.setLabel('state-independent-caller-objects');
      const program = make('Program');
      for (const [type, text] of [[g.VERTEX_SHADER, '#version 300 es\nvoid main(){gl_Position=vec4(0,0,0,1);}'],
        [g.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.125,0.25,0.5,1.0);}']]) {
        const shader = make('Shader', type); g.shaderSource(shader, text); g.compileShader(shader);
        c.same(g.getShaderParameter(shader, g.COMPILE_STATUS), true, 'actual caller shader compiles'); g.attachShader(program, shader);
      }
      g.linkProgram(program); c.same(g.getProgramParameter(program, g.LINK_STATUS), true, 'actual caller program links'); g.useProgram(program);
      const vao = make('VertexArray'); g.bindVertexArray(vao);
      const buffer = make('Buffer'); g.bindBuffer(g.COPY_WRITE_BUFFER, buffer); g.bufferData(g.COPY_WRITE_BUFFER, 512, g.STATIC_DRAW);
      for (const name of ['PIXEL_PACK_BUFFER', 'PIXEL_UNPACK_BUFFER', 'COPY_READ_BUFFER', 'ARRAY_BUFFER']) g.bindBuffer(g[name], buffer);
      const elements = make('Buffer'); g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, elements); g.bufferData(g.ELEMENT_ARRAY_BUFFER, 512, g.STATIC_DRAW);
      c.same(gl.getError(), gl.NO_ERROR, 'legal distinct element and other-data caller buffer classes');
      const color = make('Texture'); g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, color); g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, 8, 8);
      const read = make('Framebuffer'), draw = make('Framebuffer');
      g.bindFramebuffer(g.READ_FRAMEBUFFER, read); g.framebufferTexture2D(g.READ_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, color, 0); g.readBuffer(g.COLOR_ATTACHMENT0);
      g.bindFramebuffer(g.DRAW_FRAMEBUFFER, draw); g.framebufferTexture2D(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, color, 0); g.drawBuffers([g.COLOR_ATTACHMENT0]);
      const sampler = make('Sampler'); g.samplerParameteri(sampler, g.TEXTURE_COMPARE_MODE, g.COMPARE_REF_TO_TEXTURE); g.samplerParameteri(sampler, g.TEXTURE_COMPARE_FUNC, g.GREATER); g.bindSampler(0, sampler); g.bindSampler(3, sampler);
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, storage.texture);
      const textureNames = ['TEXTURE_BASE_LEVEL', 'TEXTURE_MAX_LEVEL', 'TEXTURE_COMPARE_MODE', 'TEXTURE_COMPARE_FUNC', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER'];
      [1, 2, g.COMPARE_REF_TO_TEXTURE, g.LEQUAL, g.LINEAR, g.LINEAR].forEach((value, i) => g.texParameteri(g.TEXTURE_2D, g[textureNames[i]], value));
      g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_2D, color);
      const pixelNames = ['PACK_ALIGNMENT', 'PACK_ROW_LENGTH', 'PACK_SKIP_PIXELS', 'PACK_SKIP_ROWS', 'UNPACK_ALIGNMENT', 'UNPACK_ROW_LENGTH', 'UNPACK_SKIP_PIXELS', 'UNPACK_SKIP_ROWS', 'UNPACK_IMAGE_HEIGHT', 'UNPACK_SKIP_IMAGES'];
      [8, 17, 2, 3, 8, 19, 1, 2, 23, 1].forEach((value, i) => g.pixelStorei(g[pixelNames[i]], value));
      g.viewport(2, 3, 5, 7); g.enable(g.SCISSOR_TEST); g.scissor(3, 2, 4, 5); g.enable(g.DEPTH_TEST); g.depthMask(true);
      g.enable(g.STENCIL_TEST); g.stencilFuncSeparate(g.FRONT, g.LESS, 37, 0x73); g.stencilFuncSeparate(g.BACK, g.GREATER, 91, 0x9d);
      g.stencilMaskSeparate(g.FRONT, 0xb7); g.stencilMaskSeparate(g.BACK, 0x69); g.stencilOpSeparate(g.FRONT, g.INCR, g.DECR, g.INVERT); g.stencilOpSeparate(g.BACK, g.REPLACE, g.ZERO, g.INCR_WRAP);
      const indexed = g.getExtension('OES_draw_buffers_indexed');
      if (indexed) for (let output = 0; output < g.getParameter(g.MAX_DRAW_BUFFERS); output++) {
        indexed[output % 2 ? 'enableiOES' : 'disableiOES'](g.BLEND, output);
        indexed.colorMaskiOES(output, output % 2 === 0, true, output % 3 === 0, false);
        indexed.blendEquationSeparateiOES(output, g.FUNC_SUBTRACT, g.FUNC_REVERSE_SUBTRACT); indexed.blendFuncSeparateiOES(output, g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ZERO);
      }
      c.same(gl.getError(), gl.NO_ERROR, 'nondefault caller setup enters with no pending native error');
      const state = () => {
        const active = g.getParameter(g.ACTIVE_TEXTURE), stencilNames = ['STENCIL_FUNC', 'STENCIL_REF', 'STENCIL_VALUE_MASK', 'STENCIL_WRITEMASK', 'STENCIL_FAIL', 'STENCIL_PASS_DEPTH_FAIL', 'STENCIL_PASS_DEPTH_PASS'];
        const result = { program: r.trace.id(g.getParameter(g.CURRENT_PROGRAM)), vao: r.trace.id(g.getParameter(g.VERTEX_ARRAY_BINDING)),
          read: r.trace.id(g.getParameter(g.READ_FRAMEBUFFER_BINDING)), draw: r.trace.id(g.getParameter(g.DRAW_FRAMEBUFFER_BINDING)),
          readAttachment: r.trace.id(g.getFramebufferAttachmentParameter(g.READ_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),
          drawAttachment: r.trace.id(g.getFramebufferAttachmentParameter(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)),
          readBuffer: g.getParameter(g.READ_BUFFER), active, viewport: [...g.getParameter(g.VIEWPORT)], scissor: [...g.getParameter(g.SCISSOR_BOX)], depthMask: g.getParameter(g.DEPTH_WRITEMASK),
          caps: ['BLEND', 'DEPTH_TEST', 'STENCIL_TEST', 'SCISSOR_TEST', 'CULL_FACE', 'DITHER', 'RASTERIZER_DISCARD', 'SAMPLE_ALPHA_TO_COVERAGE', 'SAMPLE_COVERAGE'].map(name => g.isEnabled(g[name])),
          stencil: [false, true].map(back => stencilNames.map(name => g.getParameter(g[back ? name.replace('STENCIL_', 'STENCIL_BACK_') : name]))),
          buffers: ['PIXEL_PACK_BUFFER_BINDING', 'PIXEL_UNPACK_BUFFER_BINDING', 'COPY_READ_BUFFER_BINDING', 'COPY_WRITE_BUFFER_BINDING', 'ARRAY_BUFFER_BINDING', 'ELEMENT_ARRAY_BUFFER_BINDING'].map(name => r.trace.id(g.getParameter(g[name]))),
          pixelStore: pixelNames.map(name => g.getParameter(g[name])), units: [] };
        for (const unit of [0, 1, 3]) {
          g.activeTexture(g.TEXTURE0+unit); result.units.push({ unit, texture: r.trace.id(g.getParameter(g.TEXTURE_BINDING_2D)), sampler: r.trace.id(g.getParameter(g.SAMPLER_BINDING)),
            ...(unit === 1 ? { sourceParameters: textureNames.map(name => g.getTexParameter(g.TEXTURE_2D, g[name])) } : {}) });
        }
        g.activeTexture(active);
        result.indexed = indexed ? Array.from({ length: g.getParameter(g.MAX_DRAW_BUFFERS) }, (_, i) => ({ mask: [...g.getIndexedParameter(g.COLOR_WRITEMASK, i)],
          blend: ['BLEND_EQUATION_RGB', 'BLEND_EQUATION_ALPHA', 'BLEND_SRC_RGB', 'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA'].map(name => g.getIndexedParameter(g[name], i)) })) : null;
        return result;
      };
      const before = state(); row.before = before; c.same(before.program !== null && before.vao !== null && before.read !== null && before.draw !== null, true, 'caller has actual nondefault object identities');
      c.same(gl.getError(), gl.NO_ERROR, 'nondefault caller snapshot has no native query error');
      // The unchanged transfer backend deliberately normalizes pixel state and
      // binds its own staging framebuffer/buffer. Qualify the new helper against
      // that inherited setup, rather than inventing a new backend restoration API.
      const transferState = { ...before, buffers: [null, null, ...before.buffers.slice(2)], pixelStore: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0] };
      r.setLabel('state-native-range-refresh'); c.ok(r.imageAccess.refresh(view.token), 'native range refresh with nondefault caller bindings');
      row.copyState = { before, after: state() }; c.same(row.copyState.after, before, 'native copies preserve concrete caller identity and state');
      row.copyFence = await physicalFence(r, 'state-range-copy-completed');
      const output = c.ok(r.store.readStorage(readLease, { x: 0, y: 0, z: 0, width: 15, height: 9, depth: 1 }), 'synchronous native fields under nondefault caller state').bytes;
      row.sync = await blob(report, output); row.syncState = { before, expected: transferState, after: state() }; c.same(row.syncState.after, transferState, 'packing restores concrete helper state after inherited pixel setup');
      c.same(fieldMisses(format, source.planes[0].predictions, output, true), [], 'nondefault caller public fields independently exact');
      const request = c.ok(r.asyncAccess.beginStorageRead(readLease, { x: 0, y: 0, z: 0, width: 15, height: 9, depth: 1 }), 'actual nondefault native PBO issue');
      const stagingFramebuffer = r.nativeObjects.find(object => object.name === 'createFramebuffer' && object.label === '').id;
      const issueState = { ...transferState, read: stagingFramebuffer, readAttachment: null };
      row.issueState = { before, expected: issueState, after: state() }; c.same(row.issueState.after, issueState, 'queued helper preserves identities beyond inherited staging bindings');
      const ready = await poll(r, request.ticket); row.async = await blob(report, ready.bytes); row.readFence = r.trace.events.filter(event => event.name === 'clientWaitSync').at(-1);
      const stagingBuffer = r.nativeEvents.filter(event => event.name === 'bufferData' && event.args[0] === g.PIXEL_PACK_BUFFER).at(-1).buffer;
      const collectState = { ...issueState, buffers: [null, null, stagingBuffer, ...before.buffers.slice(3)] };
      row.collectState = { before, expected: collectState, after: state() }; c.same(row.collectState.after, collectState, 'native collection preserves helper identities beyond inherited copy-read binding');
      c.same(fieldMisses(format, source.planes[0].predictions, ready.bytes, true), [], 'queued nondefault public fields independently exact'); c.ok(r.asyncAccess.release(request.ticket), 'nondefault read retires');
      for (let local = 0; local < 2; local++) {
        const plane = source.planes[local+1], native = await nativeRead(r, resolved.storage.texture, plane.width, plane.height, local, packed);
        row.private.push({ local, original: local+1, native: await blob(report, native) }); c.same(fieldMisses(format, plane.predictions, native), [], 'nondefault caller private range preserves original fields');
      }
      c.same(gl.getError(), gl.NO_ERROR, 'nondefault caller qualification has no native errors');
      c.ok(r.imageAccess.release(view.token), 'nondefault private view release'); c.ok(r.store.releaseStorage(lease), 'nondefault sampler lease release'); c.ok(r.store.releaseStorage(readLease), 'nondefault read lease release');
    } finally {
      g.bindFramebuffer(g.READ_FRAMEBUFFER, null); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null); g.useProgram(null); g.bindVertexArray(null);
      for (const unit of [0, 1, 3]) { g.activeTexture(g.TEXTURE0+unit); g.bindTexture(g.TEXTURE_2D, null); g.bindSampler(unit, null); }
      g.activeTexture(g.TEXTURE0);
      for (const [kind, object] of owned.reverse()) g['delete'+kind](object);
      await finish(r, report, row);
    }
  }
  report.status = 'passed'; return report;
}
