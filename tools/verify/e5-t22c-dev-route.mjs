import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { hashFile, sha256 } from "./e5-t18e-publication.mjs";
const chunks=process.env.E5_T22C_CHUNKS||"target/e5-t22c/chunks/acceptance";
const child=spawn("bash",["tools/serve-dev.sh","0"],{detached:true,
  env:{...process.env,PYTHONUNBUFFERED:"1",E5_T22C_DESKTOP_ASSET_DIR:chunks},stdio:["ignore","pipe","pipe"]});
let transcript="",finished=false;
child.stdout.on("data",bytes=>{transcript+=bytes;});child.stderr.on("data",bytes=>{transcript+=bytes;});
const completion=new Promise(resolve=>child.on("close",()=>{finished=true;resolve();}));
try {
  const deadline=Date.now()+10000;let port;
  while(Date.now()<deadline&&!finished){
    port=Number(/http:\/\/localhost:(\d+)\//.exec(transcript)?.[1]);
    if(port)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(port,`bounded dev-server startup: ${transcript}`);
  const get=pathname=>new Promise((resolve,reject)=>{
    const request=http.get({host:"127.0.0.1",port,path:pathname},response=>{
      const parts=[];response.on("data",bytes=>parts.push(bytes));response.on("end",()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(parts)}));
    });
    request.setTimeout(10000,()=>request.destroy(Error("bounded dev-route request")));request.on("error",reject);
  });
  const manifest=await get("/e5t22c-desktop/manifest.json");assert.equal(manifest.status,200);
  const expected=await readFile(chunks+"/manifest.json");assert.deepEqual(manifest.bytes,expected);
  assert.equal(manifest.headers["cross-origin-opener-policy"],"same-origin");
  assert.equal(manifest.headers["cross-origin-embedder-policy"],"require-corp");
  const key=JSON.parse(expected).chunks[0],chunk=await get("/e5t22c-desktop/chunks/"+key+".bin");
  assert.equal(chunk.status,200);assert.equal(sha256(chunk.bytes),key);
  const forbidden=[];
  for(const pathname of ["/e5t22c-desktop/README.md","/e5t22c-desktop/chunks/%2e%2e/manifest.json","/e5t22c-desktop/chunks/../../MANIFEST.txt","/e5t22c-desktop/chunks/not-a-hash.bin"]){
    const response=await get(pathname);assert.equal(response.status,404);forbidden.push({path:pathname,status:response.status});
  }
  const result={manifestSha256:sha256(manifest.bytes),chunkSha256:key,forbidden,
    serverSha256:await hashFile("tools/serve-dev.sh"),recorderSha256:await hashFile("tools/verify/e5-t22c-dev-route.mjs")};
  await mkdir("evidence/e5-t22c/dev-route",{recursive:true});
  await writeFile("evidence/e5-t22c/dev-route/scripted-proof.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));
} finally {
  // Only the process group created above belongs to this disposable proof.
  if(!finished){try{process.kill(-child.pid,"SIGTERM");}catch(error){if(error.code!=="ESRCH")throw error;}}
  await completion;
}
