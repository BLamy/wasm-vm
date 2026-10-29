import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {stageGzipSnapshot} from './snapshot-stream-sabotaged.mjs';

const raw = Uint8Array.from({length: 4097}, (_, i) => (i * 31) & 255);
const digest = createHash('sha256').update(raw).digest('hex');
const gz = new Uint8Array(gzipSync(raw)); gz[gz.length - 2] ^= 0x80;
let made;
await assert.rejects(stageGzipSnapshot(gz, {uncompressedSize: raw.length, uncompressedSha256:digest}, size =>
  (made = {parts:[], freeCalled:false, append(b){this.parts.push(b.slice())}, byteLength(){return this.parts.reduce((n,b)=>n+b.length,0)},
    sha256(){return createHash('sha256').update(Buffer.concat(this.parts)).digest('hex')}, free(){this.freeCalled=true}})));
assert.equal(made.freeCalled, true, 'rejected staging must be freed');
