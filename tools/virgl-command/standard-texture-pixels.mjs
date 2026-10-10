#!/usr/bin/env node
// Reconstruct texels and guest transfer bytes from original wire/input records.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {originalTransfer,levels,canonical,nativeFromGuest,padded} from './standard-texture-fixtures.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function audit(directory,{fault=false}={}){
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8')),e=report.browserResult.result??report.partial,blobs=new Map(),rows=[],outputs=[];
  for(const row of e.blobs){assert.ok(!blobs.has(row.key));const gz=await fs.readFile(path.join(directory,row.path)),raw=gunzipSync(gz);assert.equal(sha(gz),row.gzipSha256);assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.bytes);blobs.set(row.key,new Uint8Array(raw));}
  const raw=key=>{assert.ok(blobs.has(key),'original blob '+key);return blobs.get(key);};
  const states=e.runs.map(run=>{
    const m=run.originalMetadata,chain=levels(m),states=[];
    const current=chain.map(l=>canonical(m.format,new Uint8Array(l.byteLength)));
    states.push(current.map(b=>new Uint8Array(b)));
    for(const operation of run.operations){
      const o=originalTransfer(operation.wire),l=chain[o.level];assert.ok(l,'original selected level exists');const layout=operation.layout,stride=o.stride||l.width*4,layerStride=o.layerStride||stride*l.height,footprint=(o.box.height-1)*stride+o.box.width*4,offset=o.op===9?0:o.offset;
      assert.deepEqual([layout.level,layout.levelWidth,layout.levelHeight],[o.level,l.width,l.height]);assert.deepEqual([layout.rowBytes,layout.rowCount,layout.rowStride,layout.layerStride,layout.footprintBytes,layout.requiredEnd,layout.tightBytes],[o.box.width*4,o.box.height,stride,layerStride,footprint,offset+footprint,o.box.width*o.box.height*4]);
      if(!operation.rejected&&!operation.cancelled){
        if(operation.gpuOnly){assert.equal(operation.gpuOnly.level,o.level);const rgba=operation.gpuOnly.rgba,view=new DataView(current[o.level].buffer);for(let i=0;i<l.width*l.height;i++){if(m.format===233){const r=Math.round(rgba[0]*1023),g=Math.round(rgba[1]*1023),b=Math.round(rgba[2]*1023);view.setUint32(i*4,(b+g*1024+r*1048576+3221225472)>>>0,true);}else{const c=rgba.map(v=>Math.round(v*255));current[o.level].set(m.format===2?[c[2],c[1],c[0],255]:c,i*4);}}}
        const uploading=o.op===9||o.direction===1||o.flags===1;
        if(uploading){
          let input;
          if(o.op===9){input=new Uint8Array(o.dataWords.length*4);const view=new DataView(input.buffer);o.dataWords.forEach((w,i)=>view.setUint32(i*4,w,true));assert.equal(input.length,Math.ceil(footprint/4)*4);assert.deepEqual([...input.subarray(0,raw(operation.input).length)],[...raw(operation.input)]);}
          else input=raw(operation.input);
          for(let y=0;y<o.box.height;y++){const start=operation.asynchronous?y*o.box.width*4:offset+y*stride,row=input.subarray(start,start+o.box.width*4);assert.equal(row.length,o.box.width*4);current[o.level].set(canonical(m.format,row),((o.box.y+y)*l.width+o.box.x)*4);}
        }else if(operation.output){
          const tight=new Uint8Array(o.box.width*o.box.height*4);for(let y=0;y<o.box.height;y++)tight.set(current[o.level].subarray(((o.box.y+y)*l.width+o.box.x)*4,((o.box.y+y)*l.width+o.box.x+o.box.width)*4),y*o.box.width*4);
          const expected=operation.asynchronous?tight:padded(tight,o.box.width,o.box.height,offset,stride),observed=raw(operation.output),held=Buffer.from(expected).equals(Buffer.from(observed));outputs.push({run:e.runs.indexOf(run),operation:run.operations.indexOf(operation),level:o.level,bytes:observed.length,asynchronous:operation.asynchronous,fenceCompleted:operation.fenceCompleted??false,held});
          if(operation.asynchronous)assert.equal(operation.fenceCompleted,true,'original read completed native fence');if(!fault)assert.ok(held,'independent complete original inverse transfer');
        }
      }
      states.push(current.map(b=>new Uint8Array(b)));
    }
    assert.ok(Object.values(run.final.budgets).every(v=>v===0),'final resource budgets retire');
    return states;
  });
  for(const row of e.levels){const predicted=states[row.run][row.operationCount][row.level],actual=raw(row.native),words=row.metadata.format===233?Array.from({length:actual.length/4},(_,i)=>new DataView(actual.buffer,actual.byteOffset,actual.byteLength).getUint32(i*4,true)):[...actual],native=nativeFromGuest(row.metadata.format,predicted);assert.deepEqual(words,row.nativeWords,'native words bind full GPU blob');assert.deepEqual(words,native,'independent original packets predict complete native texels');assert.deepEqual([...raw(row.expectedGuest)],[...predicted],'worker expected bytes are original-wire-derived');rows.push({run:row.run,operationCount:row.operationCount,level:row.level,label:row.label,texels:row.width*row.height,held:true});}
  if(fault){assert.equal(e.sabotage.fenceCompleted,true);assert.equal(e.sabotage.held,false);assert.ok(!Buffer.from(raw(e.sabotage.expected)).equals(Buffer.from(raw(e.sabotage.observed))));assert.ok(outputs.some(r=>r.asynchronous&&r.fenceCompleted&&!r.held));assert.match(report.browserResult.error.message,/independent original level oracle after completed native fence/);}
  else assert.ok(outputs.every(r=>r.held));
  return {status:'passed',rows,outputs,texels:rows.reduce((n,r)=>n+r.texels,0),nativeFenceReads:outputs.filter(r=>r.asynchronous).length,fault};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+path.resolve(process.argv[1])).href){const directory=path.resolve(process.argv[2]),hardware=await audit(path.join(directory,'hardware')),faults=[];for(const name of ['upload-level','read-level'])faults.push(await audit(path.join(directory,'fault-'+name),{fault:true}));await fs.writeFile(path.join(directory,'physical-audit.json'),JSON.stringify({status:'passed',...hardware,faults},null,2)+'\n');console.log('Full original mip/offset/row/native-texel and completed-fence inverse audit passed');}
