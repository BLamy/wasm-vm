// Evidence loader, not a renderer input API. Runtime decoding never reads captures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const capture = 'evidence/virgl-corpus/captures/textured-scene';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestSha = 'cbe711eb1d57dbaf416d684b351ade01642eff298ecb7869b04063925466f8cf';
const expected = [
  [161, 5736, '364452bac8463817df9b95ae07be7203ec8411bd6be08ab43029f7c69be028cc'],
  [173, 4164, '11d7a8a13799e2c6a35a34ce40afd121e0d2e62370b9f0ca6b18002d4257470c'],
  [185, 4236, 'a30bdebf440d44f28e95bcb4f28a33f1a51db5350239acd50c8ec73bb9192396'],
  [197, 4164, '21b0c51152d709ad80365dd8ea0ea209a50bd2451dee23f77de6a4ed088ed4b0'],
  [209, 4292, '4850440acce5f52b247b9d04192c5fb757dec723b05f3dabe7a1ca53478b81b6'],
  [221, 4164, 'c3e72f8d3b61dcae9cfd7aacd6a2c817686fa695a318d861139ce12bb504ec17'],
  [233, 4144, '077179667c9698bec4e54db75a1d8a458514ddf87a220ce05ff20eeed532a3da'],
  [249, 11480, 'ae7a34f64af64e7bcfa324f1f70aec362ca207197a5e085727644aca793c351e'],
];
const shaderHashes = {
  VERT: 'e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33',
  FRAG: '80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808',
};

export async function loadFixtures() {
  const sources = [];
  async function checked(relative, digest, size) {
    const bytes = await fs.readFile(path.join(repo, relative));
    assert.equal(sha256(bytes), digest, `changed capture input ${relative}`);
    if (size !== undefined) assert.equal(bytes.length, size, `capture size ${relative}`);
    sources.push({ path: relative, bytes: bytes.length, sha256: digest });
    return bytes;
  }
  const manifest = JSON.parse(await checked(`${capture}/manifest.json`, manifestSha));
  const events = (await checked(`${capture}/events.jsonl`, manifest.events.sha256, manifest.events.bytes))
    .toString('utf8').trim().split('\n').map(JSON.parse);
  const submissions = [];
  const rawSubmits = events.filter((e) => e.type === 'submit_cmd' && e.phase === 'enter');
  assert.equal(rawSubmits.length, expected.length);
  for (const [index, [event, size, digest]] of expected.entries()) {
    const e = rawSubmits[index];
    assert.equal(e.seq, event);
    assert.equal(e.ctxId, 2);
    const blob = e.blobs.find((b) => b.role === 'command');
    assert.ok(blob, `missing command blob ${event}`);
    assert.equal(blob.sha256, digest);
    assert.equal(blob.bytes, size);
    const relative = `${capture}/blobs/${digest}.bin`;
    let bytes;
    try { bytes = await checked(relative, digest, size); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const compressed = await fs.readFile(path.join(repo, `${relative}.gz`));
      bytes = gunzipSync(compressed, { maxOutputLength: size });
      assert.equal(bytes.length, size);
      assert.equal(sha256(bytes), digest);
      sources.push({ path: `${relative}.gz`, bytes: compressed.length, sha256: sha256(compressed),
        decodedBytes: size, decodedSha256: digest });
    }
    submissions.push({ event, contextId: e.ctxId, sourceSha256: digest, data: [...bytes] });
  }
  const shaders = {};
  for (const [stage, digest] of Object.entries(shaderHashes)) {
    shaders[stage] = (await checked(`${capture}/shaders/${digest}.tgsi`, digest)).toString('ascii');
  }
  return { fixtures: { submissions, shaders }, sources };
}
