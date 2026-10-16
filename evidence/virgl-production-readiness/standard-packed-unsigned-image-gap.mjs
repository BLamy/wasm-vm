// Original packed UINT refusal at the independently verified D36 head.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createStandardPackedNormalizedResourceStore,computeStandardPackedNormalizedTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {STANDARD_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/color-images.mjs';
import {STANDARD_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/float-images.mjs';
import {STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/packed-float-images.mjs';
import {STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE} from '../../renderer/virgl-command/shared-exponent-images.mjs';
import {STANDARD_INTEGER_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/integer-images.mjs';
import {STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE} from '../../renderer/virgl-command/packed-normalized-images.mjs';
let allocations=0;
const backend={maxTextureSize:16384,colorProfile:STANDARD_COLOR_TRANSFER_PROFILE,floatProfile:STANDARD_FLOAT_COLOR_TRANSFER_PROFILE,
 packedFloatProfile:STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE,sharedExponentProfile:STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE,
 integerProfile:STANDARD_INTEGER_COLOR_TRANSFER_PROFILE,packedNormalizedProfile:STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE,
 allocate(){allocations++;throw Error('unqualified packed UINT reached allocation');},destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
const selected=createStandardPackedNormalizedResourceStore({backend});if(!selected.ok)throw Error(JSON.stringify(selected));
const hw=fs.readFileSync('renderer/virgl-shader/vendor/src/virgl_hw.h','utf8');
const names=new Set(['R10G10B10A2_UINT','B10G10R10A2_UINT']);
const formats=[...hw.matchAll(/VIRGL_FORMAT_([A-Z0-9_]+)\s*=\s*(\d+)/g)].map(row=>({name:row[1],format:Number(row[2])})).filter(row=>names.has(row.name)).sort((a,b)=>a.format-b.format);
if(formats.length!==2||formats.find(row=>row.name==='B10G10R10A2_UINT').format!==225||formats.find(row=>row.name==='R10G10B10A2_UINT').format!==253)throw Error('primary original packed UINT identity');
const records=[];
const packet=(opcode,words)=>{const raw=Buffer.alloc(4+words.length*4);raw.writeUInt32LE(opcode|words.length<<16,0);words.forEach((word,i)=>raw.writeUInt32LE(word>>>0,4+i*4));return raw.toString('hex');};
for(const f of formats)for(const lastLevel of [0,3])for(const bind of [8,2,10]){
 const metadata={id:6,target:2,format:f.format,bind,width:13,height:7,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:6,level:0,usage:0,stride:59,layerStride:0,dataOffset:5,direction:1,box:{x:0,y:0,z:0,width:13,height:7,depth:1}};
 const originalCreateWords=[6,2,f.format,bind,13,7,1,1,lastLevel,0,0];
 const originalTransferHex=packet(43,[6,0,0,59,0,0,0,0,13,7,1,5,1]);
 const create=selected.store.createResource(metadata),layout=computeStandardPackedNormalizedTransferLayout(metadata,fields,4096);
 if(create.ok||layout.ok||create.error.code!=='unsupported-resource'||layout.error.code!=='unsupported-resource'||allocations)throw Error('original packed UINT unexpectedly admitted');
 records.push({name:f.name,metadata,fields,originalCreateWords,originalTransferHex,backingByteLength:4096,create,layout});
}
selected.store.dispose();
const sources=['resources.mjs','color-images.mjs','float-images.mjs','packed-float-images.mjs','shared-exponent-images.mjs','integer-images.mjs','packed-normalized-images.mjs','shared-exponent-gpu.mjs'].map(name=>{const path='renderer/virgl-command/'+name,raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const result={schema:'packed-unsigned-image-storage-negative-v1',sourceSnapshotHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),originalFamily:formats,originalMetadataRecords:records.length,
 authority:'synthetic-owner-and-layout-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,allocations,sources,
 header:{path:'renderer/virgl-shader/vendor/src/virgl_hw.h',sha256:crypto.createHash('sha256').update(hw).digest('hex')},records};
fs.writeFileSync(new URL('./standard-packed-unsigned-image-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({formats:formats.length,records:records.length,allocations,sourceHead:result.sourceSnapshotHead,authority:result.authority}));
