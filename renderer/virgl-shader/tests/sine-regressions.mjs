import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const v=new DataView(new ArrayBuffer(4)),word=x=>{v.setFloat32(0,x,true);return v.getUint32(0,true);},value=w=>{v.setUint32(0,w,true);return v.getFloat32(0,true);};
const legal=w=>{const x=value(w);return Number.isFinite(x)&&((w>>>23&255)!==0||x===0)&&Math.abs(x)<=8;};
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`,rep=(i,w)=>imm(i,Array(4).fill(w));
const program=(extra,body)=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..4]','DCL CONST[0..45]',rep(0,word(1)),...extra,...body,'END',''].join('\n');
function possibilities(base,mask){const positions=Array.from({length:32},(_,i)=>i).filter(i=>(mask>>>i)&1);assert.ok(positions.length<=12);return Array.from({length:2**positions.length},(_,n)=>{let w=base&~mask;positions.forEach((p,i)=>{if(n&(1<<i))w|=1<<p;});return w>>>0;});}
export function getSineRegressions(){
 const cases=[],add=(name,text,ok,extra={})=>cases.push({name,stage:'fragment',text,ok,...extra});
 const boundary=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc0babe,
 ...[-9,-8,-1,-.5,.5,1,8,9].flatMap(x=>{const w=word(x);return[w-1,w,w+1];})];
 for(const w of boundary)for(const neg of [false,true]){const post=(w^(neg?0x80000000:0))>>>0;add(`boundary-${w}-${neg}`,program([rep(1,w)],[`SIN TEMP[1], ${neg?'-':''}IMM[1]`,'MOV OUT[0], IMM[0]']),legal(post),{postModifierWord:post});}
 for(let mask=1;mask<16;mask++)for(const sw of ['xyzw','wzyx','yyyy','zzzz','zxyw'])for(const neg of [false,true]){
  const a=[word(8),0x7fc01234,1,word(-.75)],lanes=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join(''),post=(a['xyzw'.indexOf(sw[0])]^(neg?0x80000000:0))>>>0;
  add(`mask-${mask}-${sw}-${neg}`,program([imm(1,a)],[`SIN TEMP[1].${lanes}, ${neg?'-':''}IMM[1].${sw}`,'MOV OUT[0], IMM[0]']),legal(post),{postModifierWord:post});
  add(`initialized-consumed-only-${mask}-${sw}-${neg}`,program([rep(1,word(.75))],[`MOV TEMP[0].${sw[0]}, IMM[1].xxxx`,`SIN TEMP[1].${lanes}, ${neg?'-':''}TEMP[0].${sw}`,'MOV OUT[0], IMM[0]']),true);
 }
 for(const base of [word(1),word(-1),word(7.5),word(8),0,0x00800000,0x7f000000])for(const mask of [1,3,0x80000000,0x80000001,0x800003ff,0x00800001])for(const neg of [false,true]){
  const poss=possibilities(base,mask).map(w=>(w^(neg?0x80000000:0))>>>0);
  add(`partial-${base}-${mask}-${neg}`,program([rep(1,mask),rep(2,(base&~mask)>>>0)],['AND TEMP[0], CONST[0], IMM[1]','OR TEMP[0], TEMP[0], IMM[2]',`SIN TEMP[1], ${neg?'-':''}TEMP[0]`,'MOV OUT[0], IMM[0]']),poss.every(legal),{possibilities:poss.length,enumeratedMinimum:Math.min(...poss.map(value)),enumeratedMaximum:Math.max(...poss.map(value))});
 }
 for(const [a,b]of [[1,1.5],[-1,1],[-8,8],[8,8+2**-20],[0,2**-126]]){
  const wa=word(a),wb=word(b),mask=(wa^wb)>>>0,poss=possibilities(wa,mask);
  add(`join-fact-cube-${wa}-${wb}`,program([rep(1,wa),rep(2,wb)],['UIF CONST[43].xxxx','MOV TEMP[0], IMM[1]','ELSE','MOV TEMP[0], IMM[2]','ENDIF','SIN TEMP[1], TEMP[0]','MOV OUT[0], IMM[0]']),poss.every(legal),{possibilities:poss.length});
 }
 for(const source of ['IN[0]','CONST[0]','TEMP[0]'])add('opaque-'+source,program([],['ADD TEMP[0], IN[0], IMM[0]',`SIN TEMP[1], ${source}`,'MOV OUT[0], IMM[0]']),false);
 for(const target of ['TEMP[0]','TEMP[1]'])add('saved-source-'+target,program([],['MOV TEMP[0], IMM[0]','MOV TEMP[1], TEMP[0]','UADD TEMP[0], CONST[0], CONST[1]',`SIN TEMP[2], ${target}`,'MOV OUT[0], IMM[0]']),target==='TEMP[1]');
 for(const producer of ['SIN','EX2','LG2','MOV_SAT','FRC_PRECISE','TRUNC','SSG','I2F'])add('computed-'+producer,program([],[`${producer} TEMP[0], ${producer==='I2F'?'CONST[0]':'IN[0]'}`,'SIN TEMP[1], TEMP[0]','MOV OUT[0], IMM[0]']),producer==='SSG');
 for(const w of [0,word(.5),word(8)])for(const consumer of ['F2I TEMP[1], TEMP[0]','SIN TEMP[1], TEMP[0]','EX2 TEMP[1], TEMP[0]','LG2 TEMP[1], TEMP[0]'])add('no-sine-result-facts-'+w+'-'+consumer,program([rep(1,w)],['SIN TEMP[0], IMM[1]',consumer,'MOV OUT[0], IMM[0]']),false);
 // Novel lane-locality attack: a new y/w version cannot erase x's old facts,
 // and x's known facts cannot lend a bound to newly computed y/w results.
 for(const lane of 'xyzw')for(const consumer of ['SIN TEMP[1]','F2I TEMP[1]'])add('novel-aliased-lane-'+lane+'-'+consumer,program([],['MOV TEMP[0], IMM[0]','SIN TEMP[0].yw, -TEMP[0].xxxx',`${consumer}, TEMP[0].${lane.repeat(4)}`,'MOV OUT[0], IMM[0]']),lane==='x'||lane==='z');
 for(const overwrite of ['MOV TEMP[0].y, IMM[0].xxxx','MOV TEMP[0].y, IN[0].xxxx','UADD TEMP[0].y, CONST[0], CONST[1]'])add('novel-repaired-one-lane-'+overwrite,program([],['MOV TEMP[0], IMM[0]','SIN TEMP[0].yw, IMM[0]',overwrite,'SIN TEMP[1], TEMP[0].yyyy','MOV OUT[0], IMM[0]']),overwrite.startsWith('MOV TEMP[0].y, IMM'));
 for(const kill of ['UADD TEMP[0].x, CONST[0], CONST[1]','MOV TEMP[0].x, IN[0].xxxx'])add('join-killed-version-'+kill,program([],['MOV TEMP[0], IMM[0]','UIF CONST[43].xxxx',kill,'ELSE','MOV TEMP[0].x, IMM[0].xxxx','ENDIF','SIN TEMP[1], TEMP[0]','MOV OUT[0], IMM[0]']),false);
 for(const op of ['SIN_PRECISE','SIN_SAT','sin','COS','POW'])add('unsupported-'+op,program([],[`${op} TEMP[0], IMM[0]${op==='POW'?', IMM[0]':''}`,'MOV OUT[0], IMM[0]']),false);
 for(const token of ['|IMM[0]|','- |IMM[0]|','IMM[0].xy','CONST[46]'])add('bad-source-'+token,program([],[`SIN TEMP[1], ${token}`,'MOV OUT[0], IMM[0]']),false);
 // Exercise every new wrapper-selector arm while preserving its complete
 // existing consumer obligations; these are independent, minimal programs.
 for(const [version,producer]of [[35,'EX2 TEMP[1], IMM[0]'],[34,'MOV_SAT TEMP[1], IMM[0]'],[33,'FRC_PRECISE TEMP[1], IMM[0]'],[32,'MIN TEMP[1], IMM[0], IMM[0]'],[31,'SSG TEMP[1], IN[0]'],[29,'I2F TEMP[1], IMM[0]'],[30,'F2I TEMP[1], CONST[0]'],[28,'ADD_PRECISE TEMP[1], IMM[0], IMM[0]'],[1,'MOV TEMP[1], IMM[0]']])
  add('wrapper-selector-v'+version,program([],[producer,'SIN TEMP[2], IMM[0]','MOV OUT[0], IMM[0]']),true,{expectedBaseProfile:'virgl-webgl2-raw-bits-v'+version});
 const raster=JSON.parse(fs.readFileSync(new URL('./raster-bank-cases.json',import.meta.url))).cases[0];
 cases.push({name:'wrapper-selector-v27',stage:raster.stage,text:raster.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[505]\n').replace(/^IMM\[0\].*$/m,m=>m+'\nIMM[1] UINT32 {0,0,0,0}').replace(/END\s*$/,'SIN TEMP[505], IMM[1]\nEND\n'),ok:true,expectedBaseProfile:'virgl-webgl2-raw-bits-v27'});
 return cases;
}
export function runSineRegressions(translate,cases=getSineRegressions()){
 const rows=[];for(const c of cases){const result=translate({stage:c.stage,text:c.text});rows.push({...c,result});
  try{assert.equal(result.ok,c.ok,c.name+' independent enumerated-domain/version prediction');
   if(!c.ok)for(const k of ['glsl','metadata','vertex','fragment'])assert.equal(Object.hasOwn(result,k),false,c.name+' closed rejection');
   else{assert.equal(result.metadata.profile,'virgl-webgl2-raw-bits-v36');assert.equal(result.metadata.sineContract.source,'post-swizzle-x-replicated-before-mask');assert.equal(result.metadata.sineContract.result,'ordinary-highp-no-static-range-facts');if(c.expectedBaseProfile)assert.equal(result.metadata.sineBaseProfile,c.expectedBaseProfile,'complete wrapper-selector base');
    assert.match(result.glsl,/float_rhs = vec4\(\/\* sine:SIN \*\/ sin\(/,'one scalar broadcast snapshot');assert.equal((result.glsl.match(/\/\* sine:SIN \*\//g)||[]).length,(c.text.match(/^SIN /gm)||[]).length);}}
  catch(e){e.counterexample=rows.at(-1);throw e;}
 }return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined,root=path.resolve(get('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../..')),native=get('--native'),output=get('--output'),cases=getSineRegressions();
 const report={schema:'virgl-sine-critic-guards-v1',task:'E6-T12g6j1',status:'running',cases:cases.length,testSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
 try{if(native){report.nativeBinary={path:path.resolve(native),sha256:createHash('sha256').update(fs.readFileSync(native)).digest('hex')};report.native=runSineRegressions(({stage,text})=>JSON.parse(execFileSync(path.resolve(native),[stage],{input:text,maxBuffer:4e6})),cases);}
  if(!args.includes('--native-only')){const {createVirglShaderBridge}=await import(pathToFileURL(path.join(root,'renderer/virgl-shader/index.mjs')));const bridge=await createVirglShaderBridge();report.wasm=runSineRegressions(r=>bridge.translate(r),cases);if(report.native)for(let i=0;i<cases.length;i++)assert.deepEqual(report.native[i].result,report.wasm[i].result,'native/Wasm exact parity '+cases[i].name);}
  report.status='passed';
 }catch(e){report.status='failed';report.failure={message:e.message,counterexample:e.counterexample};throw e;}
 finally{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(cases.length+' independent sine domain/lane/version guards passed');
}
