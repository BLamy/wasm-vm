import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {originalOracle,powerPrediction,POWER_SITES} from './oracle.mjs';
import {GUARD_CASES} from './guard-cases.mjs';

const directory=process.argv[2],report=JSON.parse(fs.readFileSync(path.join(directory,'browser/report.json')));
const a=report.acceptance,sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(report.status,'passed');assert.equal(a.status,'passed');
assert.equal(report.task,'E6-T12g6m');assert.equal(a.executionRealm,'dedicated-offscreen-worker');
assert.equal(a.productionDrawAuthority,false);assert.equal(a.guestExecution,false);
assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
assert.equal(a.renderer,'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)');
assert.equal(a.banks.length,3);
const native=fs.readFileSync(path.join(directory,'native.out'),'utf8');
assert.equal(native,fs.readFileSync(path.join(directory,'wasm.out'),'utf8'));
const compiled=native.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
assert.equal(compiled.length,3);assert.ok(native.includes('OWNERSHIP mutations=1 allocations=9'));
assert.ok(native.includes('STATUS passed; complete original with guarded powers'));
const binary=fs.readFileSync(path.join(directory,'geometry.bin'));
assert.equal(sha(binary),'0d8bf78697b9be39a58c9274e221a89a9903f8587dfa2cf5cf5b754ae82e27ac');
const f=word=>new Float32Array(new Uint32Array([word]).buffer)[0];
function readback(row){
  const zipped=Buffer.from(row.readbackGzipBase64,'base64');
  assert.equal(sha(zipped),row.readbackGzipSha256);
  const raw=gunzipSync(zipped);assert.equal(raw.length,1024*768*16);assert.equal(sha(raw),row.readbackSha256);
  return new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
}
const results=[];
for(let index=0;index<3;index++){
  const row=a.banks[index],pair=compiled[index];
  assert.equal(row.bank,index);assert.equal(pair.ok,true);
  assert.equal(row.vertexGlsl,pair.vertex.glsl);assert.equal(row.fragmentGlsl,pair.fragment.glsl);
  assert.equal(row.vertexGlslSha256,sha(row.vertexGlsl));assert.equal(row.fragmentGlslSha256,sha(row.fragmentGlsl));
  assert.deepEqual(row.vertexMetadata,pair.vertex.metadata);assert.deepEqual(row.fragmentMetadata,pair.fragment.metadata);
  assert.deepEqual(row.certificate,pair.private92cbComplete);assert.equal(row.certificate.completeSource,true);
  assert.equal(row.certificate.instructions,716);assert.deepEqual(row.certificate.powerSites,POWER_SITES);
  assert.equal(row.fragmentMetadata.powerContract.proof,'checked-actual-operands-before-evaluation');
  const at=72+index*656;
  const vertex=Array.from({length:16},(_,i)=>binary.readUInt32LE(at+i*4));
  const words=Array.from({length:148},(_,i)=>binary.readUInt32LE(at+64+i*4));
  assert.deepEqual(row.boundVertexWords,vertex);assert.deepEqual(row.boundFragmentWords,words);
  assert.deepEqual(row.drawState,{viewport:[0,0,1024,768],samples:0,framebufferStatus:36053,colorFormat:34836,mode:5,count:4});
  assert.equal(row.attachment.componentType,5126);assert.deepEqual(row.attachment.channelBits,[32,32,32,32]);
  assert.equal(row.attachment.textureMatches,true);assert.equal(row.attachment.objectType,5890);
  assert.ok(row.boundAttributes.every(value=>value.enabled&&value.type===5126&&value.size===2&&
    !value.normalized&&value.offset===value.expectedOffset&&value.stride===16&&value.divisor===0&&value.bufferMatches));
  assert.deepEqual(row.logs,{vertex:'',fragment:'',link:''});
  assert.equal(row.rendererAtDraw,a.renderer);assert.deepEqual(row.precisionAtDraw,a.precision);
  const axis=(lane,size)=>{
    const half=size/2,start=half*(f(vertex[8+lane])+1);
    const end=half*(f(vertex[lane?5:0])+f(vertex[8+lane])+1);
    return Array.from({length:size},(_,pixel)=>start<=pixel+.5&&pixel+.5<=end?
      f(words[16+lane])*(pixel+.5-start)/(end-start):null);
  };
  const xs=axis(0,1024),ys=axis(1,768);
  let covered=0,survived=0,discarded=0,maxOutputError=0;
  const primary=readback(row);
  for(let y=0;y<768;y++)for(let x=0;x<1024;x++){
    const at=(y*1024+x)*4;
    if(xs[x]===null||ys[y]===null){for(let lane=0;lane<4;lane++)assert.equal(primary[at+lane],-10000);continue;}
    covered++;const expected=originalOracle(words,xs[x],ys[y]);
    if(expected.discard){discarded++;for(let lane=0;lane<4;lane++)assert.equal(primary[at+lane],-10000);}
    else{
      survived++;
      for(let lane=0;lane<4;lane++){
        const error=Math.abs(primary[at+lane]-expected.color[lane]);
        assert.ok(Number.isFinite(error)&&error<=0.0001,`primary bank${index} (${x},${y}) lane${lane}`);
        maxOutputError=Math.max(maxOutputError,error);
      }
    }
  }
  assert.deepEqual([row.covered,row.survived,row.discarded],[covered,survived,discarded]);
  assert.ok(Math.abs(row.maxOutputError-maxOutputError)<1e-12);
  assert.equal(row.probes.length,29);const probes=[];
  for(const probe of row.probes){
    assert.ok(POWER_SITES.includes(probe.pc));const raw=readback(probe);
    let hits=0,masked=0,zeros=0,minBase=Infinity,maxBase=-Infinity,maxRelative=0,maxInputError=0;
    for(let y=0;y<768;y++)for(let x=0;x<1024;x++){
      const at=(y*1024+x)*4,base=raw[at],exponent=raw[at+1],result=raw[at+2],tag=raw[at+3];
      const expected=xs[x]===null||ys[y]===null?null:powerPrediction(words,xs[x],ys[y],probe.pc);
      if(!expected){assert.equal(tag,0);continue;}
      hits++;assert.equal(tag,expected.masked?2:1);assert.equal(exponent,expected.exponent);
      assert.ok(Number.isFinite(base));const inputError=Math.abs(base-expected.base);
      assert.ok(inputError<=((probe.pc<=107||probe.pc>=535)?0.000001:0.001));
      maxInputError=Math.max(maxInputError,inputError);minBase=Math.min(minBase,base);maxBase=Math.max(maxBase,base);
      if(expected.masked){masked++;assert.ok(base<0);assert.equal(result,0);continue;}
      assert.ok(base>=0&&Number.isFinite(result)&&result>=0);
      if(base===0){zeros++;assert.equal(result,0);}
      else{
        const value=Math.pow(base,exponent),relative=Math.abs(result-value)/value;
        assert.ok(Number.isFinite(relative)&&relative<=1/16384);maxRelative=Math.max(maxRelative,relative);
      }
    }
    assert.deepEqual([probe.hits,probe.masked,probe.zeros],[hits,masked,zeros]);
    assert.equal(probe.minBase,hits?minBase:null);assert.equal(probe.maxBase,hits?maxBase:null);
    assert.ok(Math.abs(probe.maxInputError-maxInputError)<1e-12);
    assert.ok(Math.abs(probe.maxRelative-maxRelative)<1e-12);
    probes.push({pc:probe.pc,hits,masked,zeros,maxInputError,maxRelative,readbackSha256:probe.readbackSha256});
  }
  results.push({bank:index,covered,survived,discarded,maxOutputError,probes,readbackSha256:row.readbackSha256});
}
assert.deepEqual(a.guard.cases.map(({name,base,exponent,expected})=>[name,base,exponent,expected]),GUARD_CASES);
for(const item of a.guard.cases){
  const ideal=item.expected?(f(item.base)===0?0:Math.pow(f(item.base),f(item.exponent))):0;
  assert.equal(item.ideal,ideal);assert.equal(item.actual[0],item.expected?1:-1);
  assert.equal(item.actual[2],ideal===0?1:0);assert.equal(item.actual[3],1);
  if(ideal===0)assert.equal(item.actual[1],0);
  else assert.ok(Math.abs(item.actual[1]-ideal)/ideal<=1/16384);
}
assert.equal(a.guard.snapshotSha256,sha(a.guard.snapshot));
const literalSnapshot=a.banks[0].fragmentGlsl.slice(a.banks[0].fragmentGlsl.indexOf(' { highp float power_base = '));
assert.ok(literalSnapshot.startsWith(a.guard.snapshot.replace('power_base = uintBitsToFloat(words.x);',
  literalSnapshot.match(/power_base = [^;]+;/)[0]).replace('power_exponent = uintBitsToFloat(words.y);',
  literalSnapshot.match(/power_exponent = [^;]+;/)[0])));
assert.equal(a.guard.helperSha256,sha(a.guard.helper));assert.ok(a.banks[0].fragmentGlsl.includes(a.guard.helper));
assert.equal(results.reduce((sum,row)=>sum+row.covered,0),1612644);
for(const pc of POWER_SITES)assert.ok(results.reduce((sum,row)=>sum+row.probes.find(probe=>probe.pc===pc).hits,0)>0,
  `every live original numerical site pc${pc} actually executed`);
fs.writeFileSync(path.join(directory,'physical-audit.json'),JSON.stringify({status:'passed',gitHead:report.gitHead,
  pixels:1612644,powerSites:29,guardCases:22,results},null,2)+'\n');
console.log('Full raw readbacks replayed: 1,612,644 pixels, all 29 live powers, 22 guard boundaries.');
