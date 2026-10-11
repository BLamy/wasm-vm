// Independent original-byte fixtures for the fresh D32 critic. No production tables.
export const seeds=[0x243f6a88,0x85a308d3,0x13198a2e];
export const selectors={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:1,unsignedColorMask:2};
export const vertexText='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
export const fragmentText='FRAG\nDCL OUT[5], COLOR[0]\nDCL OUT[2], COLOR[1]\nDCL OUT[7], COLOR[3]\nDCL SAMP[3]\nDCL SAMP[4]\nDCL SAMP[15]\nDCL SVIEW[3..4], 2D, UINT, UINT, UINT, UINT\nDCL SVIEW[15], 2D, SINT, SINT\nDCL TEMP[0..2]\nIMM[0] INT32 {1,2,0,1}\nIMM[1] FLT32 {-0.375,-0.625,0,-1}\nIMM[2] INT32 {1,0,0,0}\nIMM[3] UINT32 {17,2147483648,1065353216,3735928559}\n0: MOV TEMP[0], IMM[3]\n1: TXF TEMP[0].xw, IMM[0].yxzw, SAMP[3], 2D\n2: TXL TEMP[1], |IMM[1].yxzw|, SAMP[15], 2D\n3: MOV TEMP[1], -|TEMP[1].zyxw|\n4: MOV TEMP[2], IMM[3]\n5: TXQ TEMP[2].xyw, IMM[2].xxxx, SAMP[3], 2D\n6: MOV OUT[5], TEMP[0]\n7: MOV OUT[2], TEMP[2]\n8: MOV OUT[7], TEMP[1]\n9: END\n';
export const positions=[-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1];
export function novelFixtures(){
 return seeds.map(seed=>{
  let state=seed>>>0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const images=[{slot:3,originalFormat:196,signed:false,width:13,height:7,levels:4},{slot:15,originalFormat:200,signed:true,width:11,height:5,levels:4}];
  for(const image of images){
   const pool=image.signed?[0x3e800000,0x40200000,0xbe800000,0x3f800000,0x3f000000,0xbf000000,0x40800000,0xc0200000]:[0,1,0xffffffff,0x80000000,0x80000001,0x7fffffff,0xfffffffe,17,seed];
   image.planes=Array.from({length:image.levels},(_,level)=>{const width=Math.max(1,image.width>>level),height=Math.max(1,image.height>>level),bytes=new Uint8Array(width*height*16),view=new DataView(bytes.buffer);for(let at=0;at<bytes.length;at+=4)view.setUint32(at,pool[random()%pool.length],true);return {level,width,height,bytes:[...bytes]};});
  }
  return {name:'mixed-fetch-query-modifiers-'+seed.toString(16),seed,vertexText,fragmentText,selectors:{...selectors},frameWidth:8,frameHeight:6,images};
 });
}
export function originalPredictions(f){
 const image=f.images.find(i=>i.slot===3),fetch=image.planes[1],u=new DataView(Uint8Array.from(fetch.bytes).buffer),at=(1*fetch.width+2)*16;
 const signed=f.images.find(i=>i.slot===15),plane=signed.planes[1],s=new DataView(Uint8Array.from(plane.bytes).buffer),x=Math.floor(.625*plane.width),y=Math.floor(.375*plane.height),sample=Array.from({length:4},(_,lane)=>s.getUint32((y*plane.width+x)*16+lane*4,true));
 return {0:[u.getUint32(at,true),0x80000000,0x3f800000,u.getUint32(at+12,true)],1:[fetch.width,fetch.height,0x3f800000,image.levels],3:[2,1,0,3].map(lane=>((sample[lane]&0x7fffffff)^0x80000000)>>>0)};
}
export function criticCases(){
 const fixtures=novelFixtures(),cases=fixtures.map(f=>({name:f.name,kind:17,a:f.vertexText,b:f.fragmentText,selectors:f.selectors,okay:true,code:null})),base=cases[0];
 const refuse=(name,b,select=base.selectors,code='unsupported-feature')=>cases.push({...base,name,b,selectors:{...select},okay:false,code});
 for(const [name,b]of [['heterogeneous',base.b.replace('SINT, SINT','SINT, UINT')],['five-returns',base.b.replace('SINT, SINT','SINT, SINT, SINT, SINT, SINT')],['range-overlap',base.b.replace('DCL SAMP[15]','DCL SVIEW[4], 2D, UINT\nDCL SAMP[15]')],['sampler-range',base.b.replace('DCL SAMP[3]\nDCL SAMP[4]','DCL SAMP[3..4]')],['out-of-slot',base.b.replaceAll('[15]','[16]')],['missing-view',base.b.replace('DCL SVIEW[15], 2D, SINT, SINT\n','')]])refuse(name,b);
 for(const [name,mask]of [['color-extent',{signedColorMask:16}],['color-overlap',{unsignedColorMask:1}],['unemitted-semantic',{unsignedColorMask:4}],['vertex-overlap',{signedMask:1,unsignedMask:1}],['packed-overlap',{signedMask:1,packedSignedMask:1}],['buffer-extent',{bufferZeroMask:4}],['vertex-extent',{signedMask:65536}]])refuse(name,base.b,{...base.selectors,...mask},'invalid-input');
 return cases;
}
