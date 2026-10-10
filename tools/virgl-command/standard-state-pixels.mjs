#!/usr/bin/env node
// Audit saved pixels and native bindings from literal packets. No renderer,
// compiler or decoder participates in the offline equations.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { originalOracle } from "../virgl-original-programs/oracle.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const f = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes.readFloatLE(); };
const quant = value => Math.round(255 * Math.max(0, Math.min(1, value)));
const color = values => values.map(quant);
function packets(encoded) {
  const raw = Buffer.from(encoded, "hex"), result = [];
  for (let at = 0; at < raw.length;) {
    assert.ok(at + 4 <= raw.length);
    const header = raw.readUInt32LE(at), op = header & 255, kind = header >>> 8 & 255, count = header >>> 16,
      end = at + (count + 1) * 4;
    assert.ok(end <= raw.length, "literal packet boundary");
    result.push({ op, kind, at, raw: raw.subarray(at, end),
      words: Array.from({ length: count }, (_, i) => raw.readUInt32LE(at + (i + 1) * 4)) });
    at = end;
  }
  return result;
}
function state(frame) {
  const draw = frame.dump.draws.at(-1), ctx = draw.command.contextId,
    banks = [[], []], names = new Map(), selected = [null, null], views = [[], []], samplerStates = [[], []];
  let clear = [0, 0, 0, 0], elements = null, boundElements = null, buffers = [];
  for (const row of frame.history) {
    if (row.ctx !== ctx) continue;
    assert.equal(row.result.ok, true, "pixel history must be successful");
    for (const packet of packets(row.hex)) {
      const w = packet.words;
      if (packet.op === 1) {
        let object;
        if (packet.kind === 4) {
          assert.equal(packet.raw[24 + w[2] - 1], 0, "original shader NUL");
          object = { text: packet.raw.subarray(24, 24 + w[2] - 1).toString("ascii"), stage: w[1] };
        } else if (packet.kind === 6) object = { resource: w[1], swizzle: Array.from({ length: 4 }, (_, lane) => w[5] >>> (lane * 3) & 7) };
        else if (packet.kind === 5) object = { elements: Array.from({ length: (w.length - 1) / 4 }, (_, i) => w.slice(1 + i * 4, 5 + i * 4)) };
        else object = { words: w };
        names.set(w[0], object);
      } else if (packet.op === 3) names.delete(w[0]);
      else if (packet.op === 31) selected[w[1]] = w[0] ? names.get(w[0]) : null;
      else if (packet.op === 12 && w[0] < 2 && w[1] === 0) banks[w[0]] = w.slice(2);
      else if (packet.op === 7) clear = w.slice(1, 5).map(f).map(quant);
      else if (packet.op === 2 && packet.kind === 5) boundElements = w[0] ? names.get(w[0]) : null;
      else if (packet.op === 6) buffers = Array.from({ length: w.length / 3 }, (_, i) => w.slice(i * 3, i * 3 + 3));
      else if (packet.op === 10 || packet.op === 18) {
        const target = packet.op === 10 ? views : samplerStates;
        w.slice(2).forEach((handle, i) => { target[w[0]][w[1] + i] = handle ? names.get(handle) : null; });
      }
    }
  }
  elements = boundElements.elements;
  const program = frame.dump.programs.find(p => p.generation === draw.programGeneration);
  assert.deepEqual([program.vertexTGSI, program.fragmentTGSI], selected.map(s => s.text), "retained literal shader identity");
  assert.equal(frame.dump.complete, true); assert.ok(Object.values(frame.dump.dropped).every(n => n === 0));
  for (const attribute of frame.native.attributes) {
    const index = Number(attribute.name.slice(3)), [offset, divisor, slot, format] = elements[index],
      [stride, start, resource] = buffers[slot], raw = Buffer.from(attribute.hex, "hex");
    assert.equal(divisor, 0); assert.ok(format >= 28 && format <= 31);
    assert.deepEqual([attribute.components, attribute.offset, attribute.stride, attribute.resourceId], [format - 27, start + offset, stride, resource]);
    const fetch = draw.command.vertexFetches.find(entry => entry.attributeIndex === index);
    assert.equal(fetch.resourceGeneration, attribute.generation);
    assert.ok(fetch.requiredEnd <= raw.length); assert.equal(fetch.offset, attribute.offset);
  }
  return { banks, selected, views, samplerStates, clear, program, draw };
}
function expected(frame, st) {
  const { banks: [v, b], selected, clear } = st, get = (bank, slot) => Array.from({ length: 4 }, (_, lane) => f(bank[slot * 4 + lane] ?? 0));
  const fixture = frame.fixture;
  if (fixture.kind === "bank") {
    let output;
    if (selected[1].text.includes("CONST[510]")) output = get(b, 510);
    else if (selected[1].text.includes("ADD TEMP[0], CONST[511]"))
      output = get(b, 0).map((n, lane) => n + get(b, 511)[lane] + get(v, 511)[lane]);
    else output = get(b, 0);
    return () => color(output);
  }
  if (fixture.kind === "flat") {
    assert.ok(st.program.vertexESSL300.includes("flat out uvec4 vso_g15"));
    return () => [.25, .5, .75, 1].map((n, lane) => v[2044 + lane] === b[lane] ? quant(n) : 0);
  }
  if (fixture.kind === "generic16") {
    const out = Array(4).fill(0);
    for (let index = 0; index < 16; index++) get(v, index).forEach((n, lane) => { out[lane] += n / 16; });
    return () => color(out);
  }
  if (fixture.kind === "samplers") {
    for (const sampler of frame.native.samplers) {
      const stage = sampler.stage === "vertex" ? 0 : 1, view = st.views[stage][15];
      assert.equal(sampler.unit, stage === 0 ? 31 : 15); assert.equal(sampler.resourceId, view.resource);
      assert.ok(sampler.value === null || sampler.value === sampler.unit);
      assert.deepEqual(view.swizzle, fixture.views[stage]);
    }
    const out = Array(4).fill(0);
    for (let stage = 0; stage < 2; stage++) for (let lane = 0; lane < 4; lane++) {
      const view = st.views[stage][15].swizzle[lane];
      out[lane] += view === 4 ? 0 : view === 5 ? 255 : fixture.images[stage][view];
    }
    return () => out.map(n => Math.min(n, 255));
  }
  if (fixture.kind === "position") {
    const scale = get(b, 0); return (x, y) => color([(x + .5) * scale[0], (y + .5) * scale[1], .5 * scale[2], scale[3]]);
  }
  if (fixture.kind === "dynamic-discard") return x => x + .5 < f(b[0]) ? clear : color(get(b, 1));
  if (fixture.kind === "terminal-discard" || fixture.kind === "degenerate-line") return () => clear;
  if (fixture.kind === "system-values") return (x, y) => Array(4).fill(quant((2 * (x + .5) / frame.width + (y + .5) / frame.height) / 4));
  if (fixture.kind === "inactive-uniforms") return () => color([.25, .5, .75, 1]);
  if (fixture.kind === "original92") {
    const axis = (a, p) => {
      const scale = a ? 384 : 512, start = scale * (f(v[8 + a]) + 1), end = scale * (f(v[a ? 5 : 0]) + f(v[8 + a]) + 1);
      return { start, end, value: f(b[16 + a]) * (p + .5 - start) / (end - start) };
    };
    return (x, y) => {
      const a = axis(0, x), c = axis(1, y);
      if (x + .5 < a.start || x + .5 > a.end || y + .5 < c.start || y + .5 > c.end) return clear;
      const out = originalOracle(b, a.value, c.value); return out.discard ? clear : color(out.color);
    };
  }
  if (fixture.kind === "originalC580") {
    const a = [1053486281, 1046281129, 1082291371, 1055439406].map(f),
      c = [1037578380, 1031980538, 1035420539, 1067798374].map(f),
      d = [1079226764, 1051640170, 1060377406].map(f), e = [1047298914, 1076299332, 1071289118].map(f),
      k = [1067605037, 998866771].map(f), input = get(b, 3);
    const root = input[0] + input[1] * a[0] + input[2] * a[1],
      difference = input[0] - input[1] * (c[0] + c[2]) - input[2] * (c[1] + c[3]), s = root ** 3, u = difference ** 3,
      opacity = input[3] * f(b[112]),
      rgb = [s * a[2] - u * d[0] + u * e[0], -s * k[0] + u * e[1] - u * d[1], -s * k[1] - u * d[2] + u * e[2]],
      output = color(rgb.map(n => Math.max(n, 0) ** a[3] * opacity).concat(opacity)), w = f(b[0]), h = f(b[1]);
    return (x, y) => {
      const px = (fixture.edge === "near" ? 0 : w - 4) + x + .5, py = (fixture.edge === "near" ? 0 : h - 4) + y + .5;
      return Math.min(px, w - px, py, h - py) <= 1 ? output : clear;
    };
  }
  throw new Error("unknown offline oracle " + fixture.kind);
}
const directory = path.resolve(process.argv[2]), audit = { schema: 1, status: "running", frames: [], faults: [] };
for (const name of ["hardware", "fault-suffix"]) {
  const report = JSON.parse(await fs.readFile(path.join(directory, name, "report.json"))), fault = name !== "hardware",
    result = fault ? report.partial : report.browserResult.result;
  assert.equal(report.status, fault ? "failed" : "passed");
  if (fault) assert.ok(report.browserResult.error.message.includes("short-bank-0 independent physical pixel oracle"));
  const failed = [];
  for (const frame of result.frames) {
    const zipped = await fs.readFile(path.join(directory, name, frame.pixels.path)), raw = gunzipSync(zipped);
    assert.equal(sha(zipped), frame.pixels.gzipSha256); assert.equal(sha(raw), frame.pixels.sha256);
    assert.equal(raw.length, frame.width * frame.height * 4);
    const st = state(frame), oracle = expected(frame, st);
    if (!fault) for (const uniform of frame.native.uniforms) {
      assert.ok(uniform.activeCount <= uniform.declaredCount && uniform.declaredCount <= 512);
      const bank = st.banks[uniform.stage], wanted = Array.from({ length: uniform.activeCount * 4 }, (_, i) => bank[i] ?? 0);
      assert.deepEqual(uniform.words, wanted, frame.label + " offline native word custody");
      const capture = frame.dump.draws.at(-1).uploads.find(row => row.stage === uniform.stage);
      assert.deepEqual(capture.words, wanted, "planned words equal actual read native words");
    }
    let maxError = 0;
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const wanted = oracle(x, y);
      for (let lane = 0; lane < 4; lane++) maxError = Math.max(maxError, Math.abs(raw[(y * frame.width + x) * 4 + lane] - wanted[lane]));
    }
    const held = maxError <= (frame.fixture.kind === "originalC580" ? 6 : 1);
    if (!held) failed.push(frame.label);
    (fault ? audit.faults : audit.frames).push({ label: frame.label, pixels: frame.width * frame.height, maxError, held, sha256: sha(raw) });
  }
  assert.deepEqual(failed, fault ? ["short-bank-0"] : [], "saved pixel sensitivity");
}
assert.equal(audit.frames.length, 55); audit.pixels = audit.frames.reduce((n, row) => n + row.pixels, 0);
assert.equal(audit.pixels, 2371168); audit.status = "passed";
await fs.writeFile(path.join(directory, "physical-audit.json"), JSON.stringify(audit, null, 2) + "\n");
console.log("Offline audit passed: " + audit.frames.length + " frames, " + audit.pixels + " pixels; actual upload mutation detected");
