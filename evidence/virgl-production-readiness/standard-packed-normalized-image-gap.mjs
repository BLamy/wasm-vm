// Record original packed normalized storage/layout refusals at the verified D34 head.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createStandardIntegerColorResourceStore,computeStandardIntegerColorTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {STANDARD_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/color-images.mjs';
import {STANDARD_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/float-images.mjs';
import {STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/packed-float-images.mjs';
import {STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE} from '../../renderer/virgl-command/shared-exponent-images.mjs';
import {STANDARD_INTEGER_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/integer-images.mjs';

let allocations=0;
const backend={maxTextureSize:16384,colorProfile:STANDARD_COLOR_TRANSFER_PROFILE,floatProfile:STANDARD_FLOAT_COLOR_TRANSFER_PROFILE,
 packedFloatProfile:STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE,sharedExponentProfile:STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE,
 integerProfile:STANDARD_INTEGER_COLOR_TRANSFER_PROFILE,allocate(){allocations++;throw Error('unqualified packed normalized image reached allocation');},
 destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
const selected=createStandardIntegerColorResourceStore({backend});if(!selected.ok)throw Error(JSON.stringify(selected));
const hw=fs.readFileSync('renderer/virgl-shader/vendor/src/virgl_hw.h','utf8');
const wanted=new Set([5,6,7,8,122,131,135,308,319,320,321,407,409]);
const formats=[...hw.matchAll(/VIRGL_FORMAT_([A-Z0-9_]+)\s*=\s*(\d+)/g)].map(row=>({name:row[1],format:Number(row[2])})).filter(row=>wanted.has(row.format)).sort((a,b)=>a.format-b.format);
if(formats.length!==wanted.size||formats.some(row=>!row.name.endsWith('_UNORM')))throw Error('pinned packed normalized family identity');
const records=[];
for(const f of formats)for(const lastLevel of [0,3])for(const bind of [8,2,10]){
 const metadata={id:6,target:2,format:f.format,bind,width:13,height:7,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:6,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:13,height:7,depth:1}};
 const create=selected.store.createResource(metadata),layout=computeStandardIntegerColorTransferLayout(metadata,fields,4096);
 if(create.ok||layout.ok||create.error.code!=='unsupported-resource'||layout.error.code!=='unsupported-resource'||allocations)throw Error('original packed normalized image unexpectedly admitted');
 records.push({name:f.name,metadata,fields,backingByteLength:4096,create,layout});
}
selected.store.dispose();
const names=['resources.mjs','color-images.mjs','float-images.mjs','packed-float-images.mjs','shared-exponent-images.mjs','integer-images.mjs','shared-exponent-gpu.mjs'];
const sources=names.map(name=>{const path='renderer/virgl-command/'+name,raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const result={schema:'packed-normalized-image-storage-negative-v1',sourceSnapshotHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 originalFamily:formats,originalMetadataRecords:records.length,authority:'synthetic-owner-and-layout-refusal-only',nativeExecuted:false,
 guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,allocations,sources,
 header:{path:'renderer/virgl-shader/vendor/src/virgl_hw.h',sha256:crypto.createHash('sha256').update(hw).digest('hex')},records};
fs.writeFileSync(new URL('./standard-packed-normalized-image-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({formats:formats.length,records:records.length,allocations,authority:result.authority}));
