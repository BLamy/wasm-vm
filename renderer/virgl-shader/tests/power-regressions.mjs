// Independent critic predictions: complete bit cubes, consumed lanes and versions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const view=new DataView(new ArrayBuffer(4)),word=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);},value=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`,rep=(i,w)=>imm(i,Array(4).fill(w));
const program=(extra,body)=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..6]','DCL CONST[0..45]',rep(0,word(1)),...extra,...body,'MOV OUT[0], IMM[0]','END',''].join('\n');
function cube(a,b){const mask=(a^b)>>>0,positions=Array.from({length:32},(_,i)=>i).filter(i=>(mask>>>i)&1);assert.ok(positions.length<=12);return Array.from({length:2**positions.length},(_,n)=>{let w=a&~mask;positions.forEach((p,i)=>{if(n&(1<<i))w|=1<<p;});return w>>>0;});}
const normalOrZero=w=>((w>>>23)&255)!==255&&(((w>>>23)&255)!==0||(w&0x7fffffff)===0);
function enumerateDomain(as,es){
 if(!as.every(normalOrZero)||!es.every(normalOrZero))return false;
 if(as.some(w=>(w&0x7fffffff)!==0&&(w>>>31)))return false;
 if(as.some(w=>(w&0x7fffffff)===0)&&!es.every(w=>value(w)>0))return false;
 const positive=as.filter(w=>(w&0x7fffffff)!==0);
 if(!positive.length)return true;
 // Exact powers of two use equal integer bounds; other positive words are
 // enclosed by adjacent binary exponents, independent of host log or pow.
 const bound=Math.max(...positive.flatMap(w=>{const low=((w>>>23)&255)-127;return [Math.abs(low),Math.abs(low+((w&0x7fffff)!==0))];}));
 return bound*Math.max(...es.map(w=>Math.abs(value(w))))<=120;
}
export function getPowerRegressions(){
 const cases=[],add=(name,text,ok,extra={})=>cases.push({name,stage:'fragment',text,ok,...extra});
 const bases=[0,0x80000000,1,0x80000001,0x00800000,0x80800000,word(.5),word(1),word(2),word(2)+1,word(-1),word(2**120),word(2**120)+1,0x7f7fffff,0x7f800000,0x7fc055aa];
 const exponents=[0,0x80000000,1,0x00800000,0x80800000,word(.5),word(-.5),word(1),word(-1),word(120),word(120)+1,word(2**23),word(2**29),0x7f7fffff,0xff7fffff,0x7f800000,0x7fc055aa];
 for(const a of bases)for(const e of exponents)for(const neg of [0,1,2,3]){
  const pa=(a^(neg&1?0x80000000:0))>>>0,pe=(e^(neg&2?0x80000000:0))>>>0;
  add(`boundary-${a}-${e}-${neg}`,program([rep(1,a),rep(2,e)],[`POW TEMP[2], ${neg&1?'-':''}IMM[1], ${neg&2?'-':''}IMM[2]`]),enumerateDomain([pa],[pe]),{postBase:pa,postExponent:pe});
 }
 for(const [a,b,e,f]of [[0,word(.5),0,0],[0,word(.5),word(-.5),word(-.5)],[0,word(.5),word(.5),word(.5)],
   [0,word(.5),0x00800000,0x01000000],[0,word(.5),word(1),word(1)],[0x80000000,0,word(.5),word(1.5)],
   [word(.5),word(.75),word(2),word(3)],[word(1),word(1.5),word(-2),word(2)],[word(-0),word(.5),word(.5),word(.5)],
   [word(1),word(2),word(80),word(80)],[word(.5),word(.5)+1,word(60),word(60)+1]]){
  const as=cube(a,b),es=cube(e,f);
  add(`joined-cube-${a}-${b}-${e}-${f}`,program([rep(1,a),rep(2,b),rep(3,e),rep(4,f)],['UIF CONST[43].xxxx','MOV TEMP[0], IMM[1]','MOV TEMP[1], IMM[3]','ELSE','MOV TEMP[0], IMM[2]','MOV TEMP[1], IMM[4]','ENDIF','POW TEMP[2], TEMP[0], TEMP[1]']),enumerateDomain(as,es),{baseCube:as,exponentCube:es});
 }
 // Novel attack: endpoints are positive but their complete exponent bit cube
 // includes +0. Independent enumeration, not endpoint testing, predicts reject.
 for(const [a,b]of [[0x00800000,0x01000000],[0x02000000,0x04000000]])for(const sign of [0,0x80000000]){
  const es=cube(a,b),as=cube(sign,word(.5));
  add(`novel-zero-exponent-cube-${a}-${b}-${sign}`,program([rep(1,sign),rep(2,word(.5)),rep(3,a),rep(4,b)],['UIF CONST[43].xxxx','MOV TEMP[0], IMM[1]','MOV TEMP[1], IMM[3]','ELSE','MOV TEMP[0], IMM[2]','MOV TEMP[1], IMM[4]','ENDIF','POW TEMP[2].yw, TEMP[0], TEMP[1]']),enumerateDomain(as,es),{baseCube:as,exponentCube:es});
 }
 for(let mask=1;mask<16;mask++)for(const sa of ['xyzw','wzyx','xxxx','yyyy','zxyw'])for(const se of ['xyzw','wzyx','zzzz','wwww','zxyw']){
  const a=[word(.5),0x7fc01234,1,word(1)],e=[word(2),0x7f800000,word(.5),0x80000001],lanes=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('');
  add(`consumed-mask-${mask}-${sa}-${se}`,program([imm(1,a),imm(2,e)],[`POW TEMP[2].${lanes}, IMM[1].${sa}, IMM[2].${se}`]),enumerateDomain([a['xyzw'.indexOf(sa[0])]],[e['xyzw'.indexOf(se[0])]]));
  add(`initialized-x-only-${mask}-${sa}-${se}`,program([rep(1,word(.5)),rep(2,word(2))],[`MOV TEMP[3].${sa[0]}, IMM[1].xxxx`,`MOV TEMP[4].${se[0]}, IMM[2].xxxx`,`POW TEMP[2].${lanes}, TEMP[3].${sa}, TEMP[4].${se}`]),true);
 }
 for(const source of [0,1])for(const target of ['TEMP[3]','TEMP[4]']){
  const lines=['MOV TEMP[3], IMM[1]','MOV TEMP[4], TEMP[3]','UADD TEMP[3], CONST[0], CONST[1]',`POW TEMP[2], ${source===0?target:'IMM[1]'}, ${source===1?target:'IMM[2]'}`];
  add(`saved-version-${source}-${target}`,program([rep(1,word(.5)),rep(2,word(2))],lines),target==='TEMP[4]');
 }
 for(const alias of [0,1])for(const mask of ['x','y','yw','xyzw']){
  add(`aliased-snapshots-${alias}-${mask}`,program([imm(1,[word(.5),word(1),word(2),word(.75)]),imm(2,[word(2),word(.5),word(-2),word(1)])],['MOV TEMP[3], IMM[1]','MOV TEMP[4], IMM[2]',`POW TEMP[${alias?4:3}].${mask}, TEMP[3].wzyx, TEMP[4].yxwz`]),true);
 }
 for(const lane of 'xyzw')for(const source of [0,1])for(const consumer of ['POW','F2I','SIN']){
  add(`no-result-lane-facts-${source}-${lane}-${consumer}`,program([rep(1,word(.5)),rep(2,word(2))],['MOV TEMP[3], IMM[1]','MOV TEMP[4], IMM[2]','POW TEMP[3].yw, TEMP[3], TEMP[4]',consumer==='POW'?`POW TEMP[2], ${source===0?'TEMP[3].'+lane.repeat(4):'IMM[1]'}, ${source===1?'TEMP[3].'+lane.repeat(4):'IMM[2]'}`:`${consumer} TEMP[2], TEMP[3].${lane.repeat(4)}`]),lane==='x'||lane==='z');
 }
 for(const source of [0,1])for(const producer of ['ADD','MUL','MOV_SAT','EX2','LG2','SIN','POW'])
  add(`opaque-${source}-${producer}`,program([rep(1,word(.5)),rep(2,word(2))],[`${producer} TEMP[3], IMM[1]${['ADD','MUL','POW'].includes(producer)?', IMM[2]':''}`,`POW TEMP[2], ${source===0?'TEMP[3]':'IMM[1]'}, ${source===1?'TEMP[3]':'IMM[2]'}`]),false);
 for(const [version,producer]of [[36,'SIN TEMP[1], IMM[0]'],[35,'EX2 TEMP[1], IMM[0]'],[34,'MOV_SAT TEMP[1], IMM[0]'],[33,'FRC_PRECISE TEMP[1], IMM[0]'],[32,'MIN TEMP[1], IMM[0], IMM[0]'],[31,'SSG TEMP[1], IN[0]'],[29,'I2F TEMP[1], IMM[0]'],[30,'F2I TEMP[1], CONST[0]'],[28,'ADD_PRECISE TEMP[1], IMM[0], IMM[0]'],[1,'MOV TEMP[1], IMM[0]']])
  add('wrapper-selector-v'+version,program([],[producer,'POW TEMP[2], IMM[0], IMM[0]']),true,{expectedBaseProfile:'virgl-webgl2-raw-bits-v'+version});
 const raster=JSON.parse(fs.readFileSync(new URL('./raster-bank-cases.json',import.meta.url))).cases[0];
 cases.push({name:'wrapper-selector-v27',stage:raster.stage,text:raster.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[505]\n').replace(/^IMM\[0\].*$/m,m=>m+'\nIMM[1] UINT32 {1065353216,1065353216,1065353216,1065353216}').replace(/END\s*$/,'POW TEMP[505], IMM[1], IMM[1]\nEND\n'),ok:true,expectedBaseProfile:'virgl-webgl2-raw-bits-v27'});
 return cases;
}
export function runPowerRegressions(translate,cases=getPowerRegressions()){
 const rows=[];for(const c of cases){const result=translate({stage:c.stage,text:c.text});rows.push({...c,result});
  try{assert.equal(result.ok,c.ok,c.name+' independent enumerated prediction');
   if(!c.ok)for(const k of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,k),false,c.name+' closed rejection');
   else{assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v37');assert.equal(result.metadata.powerContract.source,'post-swizzle-x-pair-replicated-before-mask');assert.equal(result.metadata.powerContract.result,'ordinary-highp-no-static-range-facts');if(c.expectedBaseProfile)assert.equal(result.metadata.powerBaseProfile,c.expectedBaseProfile);
    assert.match(result.glsl,/highp float power_base = .*; highp float power_exponent = .*; float_rhs = vec4\(0\.0\); if \(power_base != 0\.0\) float_rhs = vec4\(\/\* power:POW \*\/ pow\(power_base, power_exponent\)\)/,'both scalar pre-publication captures and explicit zero bypass');
    if(c.name.startsWith('aliased-snapshots-'))assert.match(result.glsl,/power_base = uintBitsToFloat\(raw_temp\[3\]\.w\); highp float power_exponent = uintBitsToFloat\(raw_temp\[4\]\.y\)/,'independent prewrite versions and first post-swizzle operands');}}
  catch(e){e.counterexample=rows.at(-1);throw e;}
 }return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined,root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output'),cases=getPowerRegressions();
 const report={schema:'virgl-power-critic-guards-v1',task:'E6-T12g6j2',status:'running',cases:cases.length,testSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
 try{if(native){report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};report.native=runPowerRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);}
  if(!args.includes('--native-only')){const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runPowerRegressions(r=>bridge.translate(r),cases);if(report.native)for(let i=0;i<cases.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'native/Wasm complete parity '+cases[i].name);}
  report.status='passed';
 }catch(e){report.status='failed';report.failure={message:e.message,counterexample:e.counterexample};throw e;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(cases.length+' independent power domain/lane/version guards passed');
}
