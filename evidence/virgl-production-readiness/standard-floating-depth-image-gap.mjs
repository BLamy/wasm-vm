import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {computeStandardPackedUnsignedTransferLayout} from '../../renderer/virgl-command/resources.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const sha=data=>createHash('sha256').update(data).digest('hex');
const sources=[];
for(const name of ['resources','color-images','float-images','packed-float-images','shared-exponent-images','integer-images','packed-normalized-images','packed-unsigned-images','shared-exponent-gpu']){
 const file='renderer/virgl-command/'+name+'.mjs',bytes=await fs.readFile(path.join(repo,file));
 sources.push({path:file,bytes:bytes.length,sha256:sha(bytes)});
}
const headerPath='renderer/virgl-shader/vendor/src/virgl_hw.h',header=await fs.readFile(path.join(repo,headerPath));
const enums=[['Z32_FLOAT',18,4],['Z32_FLOAT_S8X24_UINT',126,8]];
for(const [symbol,format] of enums)assert.match(header.toString(),new RegExp('VIRGL_FORMAT_'+symbol+'\\s*=\\s*'+format+'\\b'));
const record={schema:'original-floating-depth-negative-readiness-v1',
 sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
 selectedLayout:'computeStandardPackedUnsignedTransferLayout',guestExecution:false,
 productionAuthority:false,nativeAllocation:false,sources,
 originalEnumSource:{path:headerPath,sha256:sha(header)},enums:enums.map(([symbol,format,pixelBytes])=>({symbol,format,pixelBytes})),rows:[]};
for(const [symbol,format,pixelBytes] of enums)for(const bind of [1,8,9])for(const lastLevel of [0,2])for(const direction of [1,2]){
 const metadata={id:29,target:2,format,bind,width:5,height:3,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:29,level:lastLevel,usage:0,stride:(lastLevel?1:5)*pixelBytes+1,layerStride:0,
  box:{x:lastLevel?0:1,y:lastLevel?0:1,z:0,width:lastLevel?1:3,height:1,depth:1},dataOffset:3,direction};
 const result=computeStandardPackedUnsignedTransferLayout(metadata,fields,128);
 assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-resource');
 record.rows.push({symbol,metadata,fields,backingByteLength:128,result});
}
const destination=process.argv[2]??fileURLToPath(new URL('standard-floating-depth-image-gap.json',import.meta.url));
await fs.writeFile(destination,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({status:'negative-recorded',sourceHead:record.sourceHead,refusals:record.rows.length,nativeAllocation:false,output:destination}));
