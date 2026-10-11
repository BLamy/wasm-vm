// Original compiler readiness only: no native draw or production authority.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglStandardIntegerImageShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const vertexText='VERT\nDCL IN[0]\nDCL SV[0], VERTEXID\nDCL SV[1], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], SV[1]\n2: MOV OUT[1].y, SV[0].xxxx\n3: END\n';
const fragmentText='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const request={vertexText,fragmentText,signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:1};
const bridge=await createVirglStandardIntegerImageShaderBridge();
const result=bridge.translatePairImages(request);
if(!result.ok||!result.vertex.glsl.includes('uvec4(uint(gl_InstanceID))')||result.vertex.glsl.includes('wv_instance_base'))throw Error('original instance-base gap changed');
const paths=['renderer/virgl-shader/bridge.c','renderer/virgl-shader/standard_emit.c','renderer/virgl-shader/standard_guard.h','renderer/virgl-shader/standard.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'];
const pins=paths.map(path=>{const raw=fs.readFileSync(path);return {path,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')};});
const record={schema:'original-instance-base-gap-v1',sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),request,result,pins,ownedInstanceBaseUniform:false,nativeDrawExecuted:false,productionAuthority:false};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({sourceHead:record.sourceHead,originalPairAccepted:true,ownedInstanceBaseUniform:false,nativeDrawExecuted:false}));
