import { rig as heldRig, finish as heldFinish } from './standard-ordered-stencil-rig.mjs';
import { createVirglStandardInstancedStencilAsyncRenderer } from '../state.mjs';
export { blob, nativeRead, physicalFence, submit, checks } from './standard-ordered-stencil-rig.mjs';

const draws = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']);
export function rig(gl, bridge, checks, fixture, options = {}) {
  let r, armed = false, failed = false;
  const states = [], controls = [];
  const snapshot = () => {
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    if (!program) return { program: null, base: null, attributes: [] };
    const location = gl.getUniformLocation(program, 'wv_instance_base');
    const attributes = [];
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i++) {
      const info = gl.getActiveAttrib(program, i), slot = gl.getAttribLocation(program, info.name);
      if (slot < 0) continue;
      attributes.push({ name: info.name, slot,
        enabled: gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
        integer: gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_INTEGER),
        type: gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_TYPE),
        stride: gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
        offset: gl.getVertexAttribOffset(slot, gl.VERTEX_ATTRIB_ARRAY_POINTER),
        divisor: gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_DIVISOR),
        buffer: r?.trace.id(gl.getVertexAttrib(slot, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)) ?? null });
    }
    return { program: r?.trace.id(program) ?? null, base: location ? gl.getUniform(program, location) : null, attributes };
  };
  const selected = options.rendererFactory ?? createVirglStandardInstancedStencilAsyncRenderer;
  const factory = config => selected({ ...config, gl: new Proxy(config.gl, {
    get(target, name) {
      const method = Reflect.get(target, name, target);
      if (typeof method !== 'function') return method;
      return (...args) => {
        const delivered = [...args], before = draws.has(name) ? snapshot() : null;
        if (options.reflection) {
          let value;
          const selected = options.reflection;
          if (name === 'getParameter' && args[0] === gl.MAX_VERTEX_UNIFORM_COMPONENTS && selected.startsWith('budget-'))
            value = Number(selected.slice(7));
          else if (name === 'getUniformLocation' && args[1] === 'wv_instance_base' && selected === 'location') value = null;
          else if (name === 'getUniformIndices' && args[1].length === 1 && args[1][0] === 'wv_instance_base') {
            if (selected === 'index') value = [gl.INVALID_INDEX];
            if (selected === 'undefined-index') value = [];
          } else if (name === 'getActiveUniforms' && args[1].length === 1 &&
              args[1][0] === gl.getUniformIndices(args[0], ['wv_instance_base'])[0]) {
            if (args[2] === gl.UNIFORM_TYPE && selected === 'type') value = [gl.FLOAT];
            if (args[2] === gl.UNIFORM_SIZE && selected === 'size') value = [2];
          } else if (name === 'getUniform' && selected === 'default') value = 1;
          if (value !== undefined) {
            const actual = method(...args);
            controls.push({ name, kind: 'tightened-native-reflection-query', selected,
              actual: actual === null || typeof actual === 'number' ? actual : ArrayBuffer.isView(actual) || Array.isArray(actual) ? [...actual] : 'native-location',
              delivered: value, eventSequence: r?.events.at(-1)?.sequence ?? 0 });
            return value;
          }
        }
        if (armed && name === 'uniform1ui' && args[1] > 0 && options.fault === 'base') {
          delivered[1] = 0;
          controls.push({ name, kind: 'actual-wrong-uint-base', original: args[1], delivered: 0,
            eventSequence: r.events.at(-1)?.sequence ?? 0 });
        }
        if (armed && options.fault === 'phase' && ['vertexAttribPointer', 'vertexAttribIPointer'].includes(name) &&
            gl.getVertexAttrib(args[0], gl.VERTEX_ATTRIB_ARRAY_DIVISOR) > 0) {
          const at = name === 'vertexAttribPointer' ? 5 : 4;
          if (args[at] > 8) {
            delivered[at] = 8;
            controls.push({ name, kind: 'actual-wrong-divisor-phase', slot: args[0], original: args[at], delivered: 8,
              eventSequence: r.events.at(-1)?.sequence ?? 0 });
          }
        }
        if (armed && !failed && options.failure === 'uint' && name === 'uniform1ui' && args[1] === 1) {
          failed = true;
          controls.push({ name, kind: 'actual-invalid-uint-binding', original: args[1],
            eventSequence: r.events.at(-1)?.sequence ?? 0 });
          target.uniform1f(...args);
          return;
        }
        if (armed && !failed && options.failure === 'pointer' &&
            ['vertexAttribPointer', 'vertexAttribIPointer'].includes(name)) {
          const at = name === 'vertexAttribPointer' ? 5 : 4;
          if (args[at] > 8 && gl.getVertexAttrib(args[0], gl.VERTEX_ATTRIB_ARRAY_DIVISOR) > 0) {
            failed = true; delivered[at] = -1;
            controls.push({ name, kind: 'actual-invalid-phase-pointer', original: args[at], delivered: -1,
              eventSequence: r.events.at(-1)?.sequence ?? 0 });
          }
        }
        const answer = method(...delivered);
        if (before) states.push({ name, args: [...args], before, after: snapshot(), label: r?.label ?? '',
          eventSequence: r?.events.at(-1)?.sequence ?? 0 });
        return answer;
      };
    }
  }) });
  r = heldRig(gl, bridge, checks, fixture, { ...options, rendererFactory: factory });
  const heldSnapshot = r.nativeOrderedState;
  r.nativeOrderedState = () => ({ ...heldSnapshot(), instance: snapshot() });
  r.instanceStates = states; r.instanceControls = controls;
  r.armInstanceControl = value => { armed = value; };
  return r;
}
export async function finish(r, report, row) {
  await heldFinish(r, report, row);
  row.instanceStates = r.instanceStates;
  row.instanceControls = r.instanceControls;
  return row;
}
