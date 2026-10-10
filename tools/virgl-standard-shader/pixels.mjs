// Offline audit of captured GPU bytes. No renderer/compiler invocation and no
// expected pixels from the browser report are used as authority.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {originalOracle} from '../virgl-original-programs/oracle.mjs';
const root=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
const bits=x=>new Uint32Array(new Float32Array([x]).buffer)[0];
const f32=w=>new Float32Array(new Uint32Array([w]).buffer)[0];
const word=n=>Number(BigInt.asUintN(32,n)),signed=n=>BigInt.asIntN(32,BigInt(n));
const mask=b=>b?0xffffffff:0;
const banks=new WeakMap();
function decodedBank(frame){let b=banks.get(frame);if(!b){b={v:frame.fixture.vertex.map(f32),f:frame.fixture.fragment.map(f32)};banks.set(frame,b);}return b;}
function integers(op,a,b,c){
 const x=BigInt(a),y=BigInt(b),shift=y&31n;
 switch(op){
 case 'MOV':return a;case 'UADD':return word(x+y);case 'UMUL':return word(x*y);case 'INEG':return word(-x);
 case 'IMIN':return word(signed(a)<signed(b)?signed(a):signed(b));case 'IMAX':return word(signed(a)>signed(b)?signed(a):signed(b));
 case 'UMIN':return a<b?a:b;case 'UMAX':return a>b?a:b;
 case 'AND':return word(x&y);case 'OR':return word(x|y);case 'XOR':return word(x^y);case 'NOT':return word(~x);
 case 'SHL':return word(x<<shift);case 'ISHR':return word(signed(a)>>shift);case 'USHR':return word(x>>shift);
 case 'USEQ':return mask(a===b);case 'USNE':return mask(a!==b);case 'USLT':return mask(a<b);case 'USGE':return mask(a>=b);
 case 'ISLT':return mask(signed(a)<signed(b));case 'ISGE':return mask(signed(a)>=signed(b));
 case 'I2F':return bits(Number(signed(a)));case 'U2F':return bits(a);case 'UCMP':return a?b:c;
 default:throw Error('unrecognized independent integer operation '+op);
 }
}
function typed(op,a,b){
 switch(op){case 'FSEQ':return mask(a===b);case 'FSNE':return mask(a!==b);case 'FSLT':return mask(a<b);case 'FSGE':return mask(a>=b);case 'F2I':case 'F2U':return word(BigInt(Math.trunc(a)));default:throw Error(op);}
}
function floating(op,a,b,c){
 switch(op){
 case 'MUL':return a*b;case 'ADD':return a+b;case 'SUB':return a-b;case 'DIV':return a/b;case 'MAD':return a*b+c;case 'LRP':return a*b+(1-a)*c;
 case 'MIN':return a<b?a:b;case 'MAX':return a>b?a:b;case 'ABS':return Math.abs(a);case 'FRC':return a-Math.floor(a);case 'FLR':return Math.floor(a);case 'TRUNC':return Math.trunc(a);case 'CEIL':return Math.ceil(a);case 'SSG':return a===0?0:a<0?-1:1;
 case 'ROUND':{const low=Math.floor(a);return a-low<.5?low:a-low>.5?low+1:low%2===0?low:low+1;}
 case 'SEQ':return +(a===b);case 'SNE':return +(a!==b);case 'SLT':return +(a<b);case 'SGE':return +(a>=b);
 default:throw Error(op);
 }
}
function scalar(op,x,y){switch(op){case 'RCP':return 1/x;case 'RSQ':return 1/Math.sqrt(x);case 'SQRT':return Math.sqrt(x);case 'SIN':return Math.sin(x);case 'COS':return Math.cos(x);case 'EX2':return Math.exp(x*Math.LN2);case 'LG2':return Math.log(x)/Math.LN2;case 'POW':return Math.exp(Math.log(x)*y);default:throw Error(op);}}
function c580(bank){
 const c=bank.slice(12,16).map(f32),L=c[0],A=c[1],B=c[2],k=w=>f32(w);
 const first=L+A*k(1053486281)+B*k(1046281129),second=L-A*(k(1037578380)+k(1035420539))-B*(k(1031980538)+k(1067798374));
 const l=first**3,m=second**3,opacity=c[3]*k(bank[112]);
 return [l*k(1082291371)+m*(k(1047298914)-k(1079226764)), -l*k(1067605037)+m*(k(1076299332)-k(1051640170)), -l*k(998866771)+m*(k(1071289118)-k(1060377406))].map(n=>Math.max(n,0)**k(1055439406)*opacity).concat(opacity);
}
function expectation(frame,x,y,output){
 const s=frame.fixture;
 switch(s.kind){
 case 'math':return [s.base[0],scalar(s.op,s.x,s.y),scalar(s.op,s.x,s.y),s.base[3]];
 case 'scalar':{const at=s.swizzle[0]==='x'?0:1,value=scalar(s.op,s.a[at],s.b[at]);return[s.base[0],value,value,s.base[3]];}
 case 'float-vector':return s.a.map((a,i)=>floating(s.op,a,s.b[i],s.c[i]));
 case 'dot':return Array(4).fill(s.a.slice(0,s.n).reduce((sum,a,i)=>sum+a*s.b[i],0));
 case 'integer-word':assert.deepEqual(s.expectedWords,s.a.map((a,i)=>integers(s.op,a,s.b[i],s.c[i])));return[1,1,1,1];
 case 'typed-word':assert.deepEqual(s.expectedWords,s.a.map((a,i)=>typed(s.op,a,s.b[i])));return[1,1,1,1];
 case 'flat-words':assert.deepEqual(frame.banks.map(b=>b.actualWords),[s.words,s.words]);assert.equal(frame.vertex.metadata.outputs.find(o=>o.semantic==='GENERIC').type,'uvec4');return[1,1,1,1];
 case 'system':{const value=s.semantic==='VERTEXID'?frame.count-1:frame.instances-1;assert.equal(value,s.value);return Array(4).fill(value);}
 case 'derivative':return s.op==='DDX'?[1,0,0,0]:[0,1,0,0];
 case 'branch':return s.condition?s.a:s.b;
 case 'constant':return s.value;
 case 'loop':assert.equal(frame.banks[0].actualWords[0],s.count);return s.base.map((a,i)=>a+s.count*s.step[i]);
 case 'varying':{const w=[1-(x+y+1)/32,(x+.5)/32,(y+.5)/32];return[0,1].map(i=>s.flat?s.colors[2][i]:s.colors.reduce((n,c,j)=>n+c[i]*w[j],0)).concat(.5,1);}
 case 'mrt':return s.values[output];
 case 'position':return[x+.5,y+.5,.5,1];
 case 'discard':return s.negative?frame.clear:s.value;
 case 'original92':{
  const {v,f}=decodedBank(frame),axes=[0,1].map(axis=>{const half=axis?384:512;const first=(v[8+axis]+1)*half,last=(v[8+axis]+v[axis?5:0]+1)*half;const pixel=(axis?y:x)+.5;return{first,last,pixel,guest:f[16+axis]*(pixel-first)/(last-first)};});
  if(axes.some(a=>a.pixel<a.first||a.pixel>a.last))return frame.clear;
  const result=originalOracle(s.fragment,axes[0].guest,axes[1].guest);return result.discard?frame.clear:result.color;
 }
 case 'originalC580':{
  const [w,h]=s.fragment.slice(0,2).map(f32),px=(s.edge==='near'?0:w-4)+x+.5,py=(s.edge==='near'?0:h-4)+y+.5;
  return Math.min(px,w-px,py,h-py)<=1?c580(s.fragment):frame.clear;
 }
 default:throw Error('unrecognized independent fixture '+s.kind);
 }
}
const hardware=JSON.parse(await fs.readFile(path.join(root,'hardware/report.json'))),failed=JSON.parse(await fs.readFile(path.join(root,'fault-sine/report.json')));
assert.equal(hardware.status,'passed');assert.equal(hardware.acceptance.frames.length,125);assert.equal(hardware.acceptance.compiles.length,238);
const results=[];let pixels=0;
for(const frame of hardware.acceptance.frames){
 assert.equal(frame.mismatches.length,0);assert.equal(frame.budget,frame.fixture.kind==='originalC580'?.02:frame.fixture.kind==='original92'?.0001:.00005);
 for(const b of frame.banks)assert.deepEqual(b.actualWords,b.inputWords.slice(0,b.count*4));
 if(['original92','originalC580'].includes(frame.fixture.kind))assert.deepEqual(frame.banks.map(b=>b.actualWords),[frame.fixture.vertex,frame.fixture.fragment]);
 for(const output of frame.outputs){
  const p=output.pixels,zipped=await fs.readFile(path.join(root,'hardware',p.path)),bytes=gunzipSync(zipped);assert.equal(sha(zipped),p.gzipSha256);assert.equal(sha(bytes),p.sha256);assert.equal(bytes.length,frame.width*frame.height*16);
  let maxError=0;
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
   const expected=expectation(frame,x,y,output.output);for(let lane=0;lane<4;lane++){const actual=bytes.readFloatLE(((y*frame.width+x)*4+lane)*4),error=Math.abs(actual-expected[lane]);assert.ok(Number.isFinite(error)&&error<=frame.budget,`${frame.name} offline pixel ${x},${y},${lane}: ${actual} expected ${expected[lane]}`);maxError=Math.max(maxError,error);}pixels++;
  }
  results.push({name:frame.name,output:output.output,pixels:frame.width*frame.height,maxError,sha256:p.sha256});
 }
}
assert.equal(failed.status,'failed');assert.deepEqual(failed.browserErrors,{console:[],page:[],requests:[]});assert.ok(failed.failure.message.includes('dynamic-fragment-SIN-0 independent standard pixels'));
const fault=failed.acceptance.frames[0],good=hardware.acceptance.frames[0];assert.equal(fault.name,good.name);assert.equal(fault.fragment.glsl,good.fragment.glsl.replace('sin(','cos('));assert.deepEqual(fault.banks,good.banks);
assert.ok(fault.mismatches.length>0&&fault.mismatches[0].errors.some(e=>e>.1));
const report={schema:'standard-shader-offline-pixels-v1',status:'passed',frames:125,pixels,results,mutation:{operation:'SIN-to-COS',point:fault.mismatches[0],caught:true},oracleAuthority:'literal CPU math, integer arithmetic, pinned complete original analytic oracle; no emitted GLSL expected values'};
await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(`${pixels} independently recomputed physical pixels and actual SIN-to-COS mutation authenticated.`);
