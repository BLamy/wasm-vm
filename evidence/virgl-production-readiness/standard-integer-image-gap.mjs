import fs from 'node:fs';
import crypto from 'node:crypto';
import {createStandardSharedExponentResourceStore,computeStandardSharedExponentTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {STANDARD_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/color-images.mjs';
import {STANDARD_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/float-images.mjs';
import {STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE} from '../../renderer/virgl-command/packed-float-images.mjs';
import {STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE} from '../../renderer/virgl-command/shared-exponent-images.mjs';
let allocations=0;
const backend={maxTextureSize:16384,colorProfile:STANDARD_COLOR_TRANSFER_PROFILE,floatProfile:STANDARD_FLOAT_COLOR_TRANSFER_PROFILE,packedFloatProfile:STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE,sharedExponentProfile:STANDARD_SHARED_EXPONENT_TRANSFER_PROFILE,allocate(){allocations++;throw Error('unqualified original integer image reached allocation');},destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
const selected=createStandardSharedExponentResourceStore({backend});if(!selected.ok)throw Error(JSON.stringify(selected));
const hw=fs.readFileSync('renderer/virgl-shader/vendor/src/virgl_hw.h','utf8'),formats=[];
for(const row of hw.matchAll(/VIRGL_FORMAT_(R(?:8|16|32)(?:G(?:8|16|32))?(?:B(?:8|16|32))?(?:A(?:8|16|32))?_(?:UINT|SINT))\s*=\s*(\d+)/g))if(Number(row[2])>=177&&Number(row[2])<=200)formats.push({name:row[1],format:Number(row[2])});
if(formats.length!==24)throw Error('original integer family identity');
const records=[];
for(const f of formats)for(const lastLevel of [0,3])for(const bind of [8,2,10]){
 const metadata={id:6,target:2,format:f.format,bind,width:13,height:7,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0};
 const fields={resourceHandle:6,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:13,height:7,depth:1}};
 const create=selected.store.createResource(metadata),layout=computeStandardSharedExponentTransferLayout(metadata,fields,4096);
 if(create.ok||layout.ok||create.error.code!=='unsupported-resource'||layout.error.code!=='unsupported-resource'||allocations)throw Error('original integer image unexpectedly admitted');
 records.push({name:f.name,metadata,fields,backingByteLength:4096,create,layout});
}
selected.store.dispose();
const sources=['resources.mjs','color-images.mjs','float-images.mjs','packed-float-images.mjs','shared-exponent-images.mjs','shared-exponent-gpu.mjs'].map(name=>{const path='renderer/virgl-command/'+name,raw=fs.readFileSync(path);return{path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const result={schema:'integer-image-storage-negative-preparation-v1',originalFamily:formats,originalMetadataRecords:records.length,sourceSnapshotHead:'131f7ec39a56b747e4107f9b2e5077e8215434f0',authority:'synthetic-owner-and-layout-refusal-only',nativeExecuted:false,guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,allocations,sources,header:{path:'renderer/virgl-shader/vendor/src/virgl_hw.h',sha256:crypto.createHash('sha256').update(hw).digest('hex')},records};
fs.writeFileSync(new URL('./standard-integer-image-gap.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({formats:formats.length,records:records.length,allocations,authority:result.authority}));
