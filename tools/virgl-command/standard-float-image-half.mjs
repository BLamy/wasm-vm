import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {sha256,repo} from './fixtures.mjs';
assert.equal(process.argv.length,3);const output=process.argv[2];
import{halfFromFloatWord}from'../../renderer/virgl-command/float-images.mjs';
import{wordValue}from'./standard-float-image-fixtures.mjs';
const floatFromHalf=word=>wordValue(16,word);
const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const records=[];
for(let half=0;half<65536;half++){
 const floating=floatFromHalf(half);records.push({half,floatWord:word(floating),roundtrip:halfFromFloatWord(word(floating))});
}
const inputWords=new Set([0,0x80000000,1,0x80000001,0x7f800000,0xff800000,0x7fc01234,0xffc0f123,0x7f7fffff,0xff7fffff,0x33800000,0x33000000,0x32ffffff,0x387fc000,0x38800000,0x477fe000,0x477ff000,0x477fffff]);
for(let half=0;half<0x7bff;half++){
 const mid=word((floatFromHalf(half)+floatFromHalf(half+1))/2);
 for(const input of[mid-1,mid,mid+1])for(const sign of[0,0x80000000])inputWords.add((input|sign)>>>0);
}
const rounding=[...inputWords].map(inputWord=>({inputWord,half:halfFromFloatWord(inputWord)}));
const sources=await Promise.all(['renderer/virgl-command/float-images.mjs','tools/virgl-command/standard-float-image-fixtures.mjs','tools/virgl-command/standard-float-image-half.mjs'].map(async path=>({path,sha256:sha256(await fs.readFile(repo+'/'+path))})));
await fs.writeFile(output,JSON.stringify({schema:'original-half-representation-v1',gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sources,records,rounding})+'\n');
process.stdout.write(JSON.stringify({records:records.length,rounding:rounding.length})+'\n');
