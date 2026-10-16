// Original TGSI, sampler/view packets and literal pre-evidence forecast.
export const selectors={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0,signedColorMask:0,unsignedColorMask:1};
export const vertexText=`VERT
DCL IN[0]
DCL IN[1]
DCL IN[2]
DCL OUT[0], POSITION
DCL OUT[1], GENERIC[0]
DCL OUT[2], GENERIC[1]
DCL TEMP[0]
DCL SAMP[7]
DCL SAMP[15]
DCL SVIEW[7], SHADOW2D, FLOAT, FLOAT, FLOAT, FLOAT
DCL SVIEW[15], SHADOW2D, FLOAT
IMM[0] UINT32 {305419896,2147483649,3735928559,4294967295}
0: MOV OUT[0], IN[0]
1: MOV TEMP[0], IMM[0]
2: TXP_SAT_PRECISE TEMP[0].xw, |IN[1].wzyx|, SAMP[7], SHADOW2D
3: MOV OUT[1], TEMP[0]
4: MOV OUT[2], IN[2]
5: END
`;
export const fragmentText=`FRAG
DCL IN[0], GENERIC[0], CONSTANT
DCL IN[1], GENERIC[1], CONSTANT
DCL OUT[0], COLOR
DCL TEMP[0..1]
DCL SAMP[7]
DCL SAMP[15]
DCL SVIEW[7], 2D, FLOAT
DCL SVIEW[15], SHADOW2D, FLOAT
IMM[0] INT32 {1,0,0,0}
0: MOV TEMP[0], IN[0]
1: TXL_SAT_PRECISE TEMP[0].yz, |IN[1].zxyw|, SAMP[7], SHADOW2D
2: TXQ TEMP[1].xyw, IMM[0], SAMP[7], 2D
3: XOR TEMP[0].y, TEMP[0], TEMP[1].xxxx
4: XOR TEMP[0].z, TEMP[0], TEMP[1].wwww
5: MOV OUT[0], TEMP[0]
6: END
`;
export const expectedWords=[1065353216,1065353218,1065353219,1065353216,0,1065353218,1065353219,0,0,1065353218,1065353219,0,1065353216,2,1065353219,1065353216,0,2,1065353219,0,0,1065353218,1065353219,0];
export const views={vertex:[2,5,4,0],fragment:[4,1,5,3]};
export const depths={vertex:[.5,.5,.5],fragment:[.25,.75,.125]};
export const comparisonFunctions={vertex:1,fragment:6};
export const units={vertex:3,fragment:9};
export function originalSamplerWords(stage){return [(9<<16)|(7<<8)|1,177,2|(2<<3)|(2<<6)|(1<<15)|(comparisonFunctions[stage]<<16),0,0,0x40000000,0,0,0,0];}
export function originalViewWords(stage){return [(6<<16)|(6<<8)|1,188,144,18|(2<<24),0,2<<8,views[stage].reduce((word,lane,i)=>word|(lane<<(3*i)),0)];}
export function inputs(){
 const positions=[],vertex=[],fragment=[];
 for(let y=0;y<2;y++)for(let x=0;x<3;x++){
  positions.push(2*(x+.5)/3-1,2*(y+.5)/2-1,0,1);
  // Absolute reversed values become (.5,1.5,reference*2,2), then TXP divides by two.
  vertex.push(-2,-[.25,.5,.75][x]*2,-1.5,-.5);
  // zxyw becomes (.25,.75,reference,LOD).
  fragment.push(.75,[.25,.5,.75][x],.25,y);
 }
 return [positions,vertex,fragment].map(values=>new Uint8Array(new Float32Array(values).buffer));
}
export const request={vertexText,fragmentText,...selectors};
