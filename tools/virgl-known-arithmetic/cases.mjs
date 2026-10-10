// Literal schedules; predictions use the previously verified rational oracle.
import {operation,classify,roundRational,vectors} from '../virgl-precise-arithmetic/oracle.mjs';
import {FLOW_CASES} from './flow-cases.mjs';
export const SEEDS=[0x6a09e667,0xbb67ae85,0x3c6ef372];
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nEND\n';
export const PARTNER_FRAGMENT='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {.25,.5,.75,1}\nMOV OUT[0], IMM[0]\nEND\n';
export const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
export const imm=(i,w)=>`IMM[${i}] UINT32 {${w.join(',')}}`;
export const normal=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export function cpuPairs(seed){
 const pairs=[];for(const v of vectors(seed))for(let lane=0;lane<4;lane++)if(normal(v.a[lane])&&normal(v.b[lane]))for(const op of ['ADD','MUL'])pairs.push({op,a:v.a[lane],b:v.b[lane],expected:operation(op,v.a[lane],v.b[lane])});
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<512;i++){const a=((next()&0x807fffff)|((1+next()%254)<<23))>>>0,b=((next()&0x807fffff)|((1+next()%254)<<23))>>>0;
  for(const op of ['ADD','MUL'])pairs.push({op,a,b,expected:operation(op,a,b)});}
 return pairs;
}
export function physicalPlan(seed=SEEDS[0]){
 const samples=[[[0,0x80000000,0,0x80000000],[0,0,0x80000000,0x80000000]],
  [[bits(1),bits(1)+1,bits(-1),bits(-1)+1],Array(4).fill(bits(2**-24))],
  [[bits(1),bits(-2),bits(.25),bits(-32)],[bits(-1),bits(2),bits(.5),bits(-.5)]],
  [[0x00800000,0x00800001,bits(.5),bits(2)],[bits(1),bits(1),bits(2),bits(.5)]]];
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<4;i++)samples.push([Array.from({length:4},()=>bits((next()%20001-10000)/1024)),Array.from({length:4},()=>bits((next()%10001-5000)/1024))]);
 const rows=[];for(const op of ['ADD','MUL'])for(let mask=1;mask<=15;mask++)for(const alias of [false,true]){
  const v=samples[(mask+Number(alias))%samples.length],a=v[0],b=v[1],sa=alias?'wzyx':'xyzw',sb=mask%2?'zxyw':'wzyx',negative=mask%3===0;
  const words=a.slice();for(let lane=0;lane<4;lane++)if(mask&(1<<lane))words[lane]=operation(op,(a['xyzw'.indexOf(sa[lane])]^(negative?0x80000000:0))>>>0,b['xyzw'.indexOf(sb[lane])]);
  if(!words.every(normal))continue;
  const integers=words.map(w=>{const x=classify(w);return Number(BigInt.asUintN(32,x.n/x.d));});
  const numeric=integers.map(w=>roundRational(BigInt(w>=0x80000000?w-0x100000000:w),1n));
  rows.push({name:`${op}-${mask}-${alias}-${seed}`,op,mask,alias,sa,sb,negative,a,b,words,integers,numeric});
 }
 const a=Array(4).fill(bits(.25)),b=Array(4).fill(bits(.5)),words=a.map((w,i)=>operation('MUL',operation('ADD',w,b[i]),b[i]));
 rows.push({name:'CHAIN-'+seed,op:'MUL',mask:15,alias:true,sa:'xyzw',sb:'xyzw',negative:false,chain:true,a,b,words,integers:Array(4).fill(0),numeric:Array(4).fill(0)});
 return rows;
}
function header(stage,row){return[stage==='vertex'?'VERT':'FRAG',...(stage==='vertex'?['DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]','DCL OUT[3], GENERIC[2]','DCL OUT[4], GENERIC[3]']:['DCL OUT[0], COLOR']),
 'DCL TEMP[0..6]',imm(0,row.a),imm(1,row.b),imm(2,[0x7fffff,0x3f000000,23,0]),imm(3,[0,8,16,24]),imm(4,[255,255,255,255])];}
function body(row){const mask=[...'xyzw'].filter((_,i)=>row.mask&(1<<i)).join('');return[row.chain?'ADD TEMP[0], IMM[0], IMM[1]':'MOV TEMP[0], IMM[0]',`${row.op} TEMP[0].${mask}, ${row.negative?'-':''}${row.alias?'TEMP[0]':'IMM[0]'}.${row.sa}, IMM[1].${row.sb}`,'F2I TEMP[1], TEMP[0]'];}
export function carrier(row){return[...header('vertex',row),...body(row),'AND TEMP[2], TEMP[0], IMM[2].xxxx','OR TEMP[2], TEMP[2], IMM[2].yyyy','USHR TEMP[3], TEMP[0], IMM[2].zzzz','OR TEMP[3], TEMP[3], IMM[2].yyyy','I2F TEMP[4], TEMP[1]','ADD TEMP[5], TEMP[0], IN[1]','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[2]','MOV OUT[2], TEMP[3]','MOV OUT[3], TEMP[4]','MOV OUT[4], TEMP[5]','END',''].join('\n');}
export function bytesFragment(row,lane=0,converted=false){return[...header('fragment',row),...body(row),`USHR TEMP[2], TEMP[${Number(converted)}].${'xyzw'[lane].repeat(4)}, IMM[3]`,'AND TEMP[2], TEMP[2], IMM[4]','I2F TEMP[3], TEMP[2]','I2F TEMP[4], IMM[4]','DIV OUT[0], TEMP[3], TEMP[4]','END',''].join('\n');}
export function mathCarrier(producer,consumer){return['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL TEMP[0..2]',imm(0,Array(4).fill(bits(.25))),imm(1,Array(4).fill(bits(.5))),imm(2,Array(4).fill(bits(2))),`${producer} TEMP[0], IMM[0], IMM[1]`,`${consumer} TEMP[1], TEMP[0]${consumer==='POW'?', IMM[2]':''}`,'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','END',''].join('\n');}
export function getCases(){
 const cases=[],add=(name,stage,text,ok)=>cases.push({name,stage,text,ok,partner:stage==='vertex'?PARTNER_FRAGMENT:PARTNER_VERTEX,pairOk:ok});
 for(const c of FLOW_CASES)add(c.name,c.stage,c.text,c.ok);
 for(const seed of SEEDS)for(const row of physicalPlan(seed)){
  add(row.name,'vertex',carrier(row),true);add(row.name+'-bytes','fragment',bytesFragment(row),true);
 }
 for(const producer of ['ADD','MUL'])for(const consumer of ['SIN','POW','EX2','LG2'])add('physical-math/'+producer+'/'+consumer,'vertex',mathCarrier(producer,consumer),true);
 const h=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL CONST[0..45]','DCL TEMP[0..6]',imm(0,Array(4).fill(bits(.25))),imm(1,Array(4).fill(bits(.5))),imm(2,Array(4).fill(bits(2)))];
 const program=(lines,head=h)=>[...head,...lines,'END',''].join('\n');
 add('missing-live-predecessor','fragment',program(['UIF CONST[43].xxxx','ADD TEMP[0], IMM[0], IMM[1]','ELSE','MOV TEMP[1], IMM[0]','ENDIF','SIN OUT[0], TEMP[0]']),false);
 for(const op of ['ADD','MUL']){
  for(const consumer of ['SIN OUT[0], TEMP[0]','POW OUT[0], TEMP[0], IMM[2]','EX2 OUT[0], TEMP[0]','LG2 OUT[0], TEMP[0]','F2I TEMP[1], TEMP[0]\nI2F OUT[0], TEMP[1]'])
   add(op+'/'+consumer,'fragment',program([`${op} TEMP[0], IMM[0], IMM[1]`,consumer]),true);
  for(const source of ['IN[0]','CONST[0]','TEMP[1]'])add(op+'/unknown/'+source,'fragment',program(['MOV TEMP[1], IN[0]',`${op} TEMP[0], ${source}, IMM[1]`,'SIN OUT[0], TEMP[0]']),false);
  for(const line of ['UADD TEMP[0], CONST[0], CONST[1]','MOV TEMP[0], IN[0]',`UIF CONST[43].xxxx\n${op} TEMP[0], IMM[0], IMM[1]\nELSE\nMOV TEMP[0], IN[0]\nENDIF`])
   add(op+'/killed/'+line,'fragment',program([`${op} TEMP[0], IMM[0], IMM[1]`,line,'SIN OUT[0], TEMP[0]']),false);
  add(op+'/same-join','fragment',program(['UIF CONST[43].xxxx',`${op} TEMP[0], IMM[0], IMM[1]`,'ELSE',`${op} TEMP[0], IMM[0], IMM[1]`,'ENDIF','SIN OUT[0], TEMP[0]']),true);
  add(op+'/different-join','fragment',program([imm(3,Array(4).fill(bits(2**32))),'UIF CONST[43].xxxx',`${op} TEMP[0], IMM[0], IMM[1]`,'ELSE',`${op} TEMP[0], IMM[0], IMM[3]`,'ENDIF','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),false);
  for(const [a,b]of [[0x7f7fffff,0x7f7fffff],[0x00800000,bits(.5)],[1,bits(1)],[0x7f800000,bits(1)],[0x7fc00001,bits(1)]])
   add(op+'/unsafe/'+a+'/'+b,'fragment',program([imm(3,Array(4).fill(a)),imm(4,Array(4).fill(b)),`${op} TEMP[0], IMM[3], IMM[4]`,'F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),op==='ADD'&&a===0x00800000);
 }
 add('direct-bank-composition','fragment',program(['ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','F2I TEMP[2], CONST[0]','I2F OUT[0], TEMP[2]']),true);
 add('discard-composition','fragment',program(['ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','KILL_IF -TEMP[0]']),true);
 add('indirect-known','fragment',program(['DCL ADDR[0]','ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','UARL ADDR[0].x, TEMP[1].xxxx','MOV OUT[0], CONST[ADDR[0].x]']),true);
 for(const line of ['ADD TEMP[0], |IMM[0]|, IMM[1]','ADD TEMP[0], IMM[0]','ADD TEMP[7], IMM[0], IMM[1]','MUL TEMP[0], IMM[0], IMM[1], IMM[2]'])
  add('malformed/'+line,'fragment',program([line,'SIN OUT[0], TEMP[0]']),false);
 return cases;
}
