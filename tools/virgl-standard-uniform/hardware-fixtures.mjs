// Original raw buffers and independent pixel/word predictions, never compiler output.
import {program,basicVertex,basicFragment,allBanks,zeroSelectors} from './cases.mjs';
export function bankWords(count,seed) {
  const words=new Uint32Array(count*4);let value=seed>>>0;
  for(let index=0;index<words.length;++index) {value^=value<<13;value^=value>>>17;value^=value<<5;words[index]=value>>>0;}
  const edges=[0,0x80000000,0xffffffff,0x7fc01234,0x7f800000,0xff800000,0x00800000,0x00000001,
    0x007fffff,0x3f800001,0xbf800001,0x7f7fffff,0xdeadbeef,0x12345678,0x80000001,0x7fa055aa];
  words.set(edges.slice(0,words.length));words.set(edges.slice(0,Math.min(16,words.length)),Math.max(0,words.length-16));return words;
}
const floatWords=values=>new Uint32Array(new Float32Array(values).buffer);
const quad=new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]);
const coord='PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR';
function byteOutput(shift) {
  return program('fragment','DCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0]\n'+
    'IMM[0] UINT32 {'+[shift,shift,shift,shift].join(',')+'}\nIMM[1] UINT32 {255,255,255,255}',
    ['USHR TEMP[0], IN[0], IMM[0]','AND TEMP[0], TEMP[0], IMM[1]','U2F OUT[0], TEMP[0]']);
}
function atlasVertex(slot,count,width,base,offset) {
  const address='ADDR[0].x'+(offset?' '+(offset>0?'+':'')+offset:'');
  return program('vertex','DCL SV[0], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n'+
    'DCL CONST['+slot+'][0..'+(count-1)+']\nDCL ADDR[0]\nDCL TEMP[0..1]\n'+
    'IMM[0] FLT32 {'+(2/width)+','+(1/width-1)+',0.0,1.0}\nIMM[1] UINT32 {'+[base,base,base,base].join(',')+'}\n'+
    'IMM[2] FLT32 {0.0,0.0,0.0,1.0}',
    ['U2F TEMP[0], SV[0]','MOV OUT[0], IMM[2]','MAD OUT[0].x, TEMP[0].xxxx, IMM[0].xxxx, IMM[0].yyyy',
      'UADD TEMP[1], SV[0], IMM[1]','UARL ADDR[0].x, TEMP[1].xxxx','MOV OUT[1], CONST['+slot+']['+address+']']);
}
function atlasFragment(slot,count,shift,base,offset) {
  const address='ADDR[0].x'+(offset?' '+(offset>0?'+':'')+offset:'');
  return program('fragment',coord+'\nDCL OUT[0], COLOR\nDCL CONST['+slot+'][0..'+(count-1)+']\nDCL ADDR[0]\nDCL TEMP[0..1]\n'+
    'IMM[0] UINT32 {'+[shift,shift,shift,shift].join(',')+'}\nIMM[1] UINT32 {255,255,255,255}\n'+
    'IMM[2] UINT32 {'+[base,base,base,base].join(',')+'}',
    ['F2U TEMP[0], IN[0]','UADD TEMP[0], TEMP[0], IMM[2]','UARL ADDR[0].x, TEMP[0].xxxx',
      'MOV TEMP[1], CONST['+slot+']['+address+']','USHR TEMP[1], TEMP[1], IMM[0]',
      'AND TEMP[1], TEMP[1], IMM[1]','U2F OUT[0], TEMP[1]']);
}
export function hardwareFixtures() {
  const fixtures=[];
  for(const stage of ['vertex','fragment'])for(let slot=0;slot<=12;++slot)for(const shift of [0,8,16,24]) {
    const count=slot?1024:512,width=count,seed=(0x6e624eb7+slot*101+(stage==='vertex'?0:7919))>>>0;
    const name=stage+'-slot-'+slot+'-full-shift-'+shift,words=bankWords(count,seed),bufferZeroMask=slot?0:stage==='vertex'?1:2;
    fixtures.push({name,kind:'atlas',stage,slot,shift,count,width,height:1,base:0,offset:0,seed,mode:stage==='vertex'?'POINTS':'TRIANGLES',
      vertices:stage==='vertex'?width:3,selectors:{...zeroSelectors,bufferZeroMask},
      vertexText:stage==='vertex'?atlasVertex(slot,count,width,0,0):basicVertex,
      fragmentText:stage==='fragment'?atlasFragment(slot,count,shift,0,0):byteOutput(shift),
      attributes:stage==='vertex'?[]:[{index:0,type:'float',data:quad}],banks:[{stage,slot,count,words}],
      expected:x=>Array.from({length:4},(_,lane)=>(words[x*4+lane]>>>shift)&255)});
  }
  for(const stage of ['vertex','fragment'])for(const slot of [0,1,12])for(const sign of [-1,1]) {
    const count=slot?1024:512,offset=sign*(count-1),base=sign<0?count-1:0,width=1,shift=24,seed=(0x34567891+slot*77)>>>0,words=bankWords(count,seed);
    fixtures.push({name:stage+'-slot-'+slot+'-offset-'+offset,kind:'atlas',stage,slot,shift,count,width,height:1,base,offset,seed,
      mode:stage==='vertex'?'POINTS':'TRIANGLES',vertices:stage==='vertex'?width:3,selectors:{...zeroSelectors,bufferZeroMask:slot?0:stage==='vertex'?1:2},
      vertexText:stage==='vertex'?atlasVertex(slot,count,width,base,offset):basicVertex,
      fragmentText:stage==='fragment'?atlasFragment(slot,count,shift,base,offset):byteOutput(shift),
      attributes:stage==='vertex'?[]:[{index:0,type:'float',data:quad}],banks:[{stage,slot,count,words}],
      expected:()=>Array.from({length:4},(_,lane)=>(words[(base+offset)*4+lane]>>>shift)&255)});
  }
  for(const bufferZeroMask of [0,1,2,3]) {
    const banks=[];for(const stage of ['vertex','fragment'])for(let slot=0;slot<=12;++slot) {
      const count=slot?1024:512,words=bankWords(count,0x23456789+slot*31+(stage==='vertex'?0:88));
      const value=(slot+1)*(stage==='vertex'?1:2);words.set(floatWords([value,value+1,value+2,value+3]),(count-1)*4);banks.push({stage,slot,count,words});
    }
    // 13 banks in each stage, plus the separate VS system block, all active.
    fixtures.push({name:'all-active-banks-zero-'+bufferZeroMask,kind:'all-banks',width:16,height:16,mode:'TRIANGLES',vertices:3,
      selectors:{...zeroSelectors,bufferZeroMask},vertexText:allBanks('vertex'),fragmentText:allBanks('fragment'),
      attributes:[{index:0,type:'float',data:quad}],banks,expected:()=>[273,299,325,351]});
  }
  for(const bufferZeroMask of [0,1,2,3]) {
    const vertexText=program('vertex','DCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL IN[4]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..1]\nDCL CONST[0][0]\nDCL CONST[12][0..1023]',
      ['MOV OUT[0], IN[0]','I2F TEMP[0], IN[1]','U2F TEMP[1], IN[2]','ADD TEMP[0], TEMP[0], TEMP[1]',
        'ADD TEMP[0], TEMP[0], IN[3]','ADD TEMP[0], TEMP[0], IN[4]','ADD TEMP[0], TEMP[0], CONST[0][0]',
        'ADD OUT[1], TEMP[0], CONST[12][1023]']);
    const fragmentText=program('fragment','DCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0][0]\nDCL OUT[0], COLOR',
      ['ADD OUT[0], IN[0], CONST[0][0]']);
    const packedScaled=(1020|(3<<10)|(1022<<20)|(2<<30))>>>0,packedNormalized=(512|(511<<10)|(0<<20)|(2<<30))>>>0;
    const user=bankWords(1024,0xc1234abc);user.set(floatWords([2,2,2,2]),1023*4);
    fixtures.push({name:'all-four-vertex-formats-zero-'+bufferZeroMask,kind:'formats',width:16,height:16,mode:'TRIANGLES',vertices:3,
      selectors:{signedMask:2,unsignedMask:4,packedSignedMask:24,packedNormalizedMask:16,bufferZeroMask},vertexText,fragmentText,
      attributes:[{index:0,type:'float',data:quad},
        {index:1,type:'signed',data:new Int32Array(Array(3).fill([-2,-1,2,-2]).flat())},
        {index:2,type:'unsigned',data:new Uint32Array(Array(3).fill([3,4,5,6]).flat())},
        {index:3,type:'packed',data:new Uint32Array([packedScaled,packedScaled,packedScaled])},
        {index:4,type:'packed',data:new Uint32Array([packedNormalized,packedNormalized,packedNormalized])}],
      banks:[{stage:'vertex',slot:0,count:1,words:floatWords([.25,.5,.75,1])},
        {stage:'vertex',slot:12,count:1024,words:user},{stage:'fragment',slot:0,count:1,words:floatWords([1,2,3,4])}],
      expected:()=>[-.75,11.5,10.75,8]});
  }
  fixtures.push({name:'declared-unused-banks',kind:'unused',width:16,height:16,mode:'TRIANGLES',vertices:3,selectors:{...zeroSelectors},
    vertexText:basicVertex.replace('\n0:','\nDCL CONST[1][7..1023]\nDCL CONST[12][0]\n0:'),fragmentText:basicFragment,
    attributes:[{index:0,type:'float',data:quad}],banks:[{stage:'vertex',slot:1,count:1024,words:bankWords(1024,0x6789abcd)},
      {stage:'vertex',slot:12,count:1,words:bankWords(1,0x13579abc)}],expected:()=>[.25,.5,.75,1]});
  return fixtures;
}
