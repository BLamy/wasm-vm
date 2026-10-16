// Promoted by the fresh D58 critic: one original allocation, NPOT dimensions,
// slot15 in both stages, unequal private mip/layer ranges and unequal swizzles.
import {fixture} from './fixtures.mjs';
export function novelCase(){
 const common={target:'2D_ARRAY',type:'FLOAT',opcode:'TXL',slot:15,width:5,height:3,arraySize:7};
 const fragment=fixture({...common,name:'critic/NPOT/slot15/independent-private-ranges',stage:'fragment',firstLevel:0,lastLevel:2,firstLayer:1,lastLayer:3,wrap:0,swizzle:[2,0,5,4]});
 const vertex=fixture({...common,stage:'vertex',firstLevel:1,lastLevel:1,firstLayer:2,lastLayer:6,wrap:4,swizzle:[1,5,3,4]});
 const vc=[-.375,1.375,2.51,0],fc=[.625,.375,-.49,1];
 fragment.vertexText=`VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL SAMP[15]\nDCL SVIEW[15], 2D_ARRAY, FLOAT\nIMM[0] FLT32 {${vc.join(',')}}\n0: MOV OUT[0], IN[0]\n1: TXL OUT[1], IMM[0], SAMP[15], 2D_ARRAY\n2: END\n`;
 fragment.fragmentText=`FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL SAMP[15]\nDCL SVIEW[15], 2D_ARRAY, FLOAT\nDCL TEMP[0]\nIMM[0] FLT32 {${fc.join(',')}}\n0: TXL TEMP[0], IMM[0], SAMP[15], 2D_ARRAY\n1: XOR OUT[0], TEMP[0], IN[0]\n2: END\n`;
 const literal=(view,coordinate)=>{
   const L=view.firstLevel+coordinate[3],plane=fragment.levels[L],localLayers=view.lastLayer-view.firstLayer+1;
   const wrap=(i,n)=>view.wrap===0?((i%n)+n)%n:((i%(2*n)+2*n)%(2*n)<n?((i%(2*n)+2*n)%(2*n)):2*n-1-((i%(2*n)+2*n)%(2*n)));
   const x=wrap(Math.floor(coordinate[0]*plane.width),plane.width),y=wrap(Math.floor(coordinate[1]*plane.height),plane.height);
   const z=view.firstLayer+Math.max(0,Math.min(localLayers-1,Math.floor(coordinate[2]+.5)));
   const bytes=plane.bytes.subarray(((z*plane.height+y)*plane.width+x)*4,((z*plane.height+y)*plane.width+x+1)*4);
   return view.swizzle.map(k=>new Uint32Array(new Float32Array([k===4?0:k===5?1:bytes[k]/255]).buffer)[0]);
 };
 const a=literal(fragment,fc),b=literal(vertex,vc),xor=a.map((n,k)=>(n^b[k])>>>0);
 fragment.literalOracle={fragment:a,vertex:b,xor};
 fragment.extraTextures=[];fragment.extraViews=[{fixture:vertex,resource:6,handle:53,stateHandle:52}];
 fragment.expectedSamplers={fssamp15:{target:7,last:2},vssamp15:{target:7,last:0}};
 fragment.expectedPlane=new Uint8Array(new Uint32Array(Array(fragment.grid.width*fragment.grid.height).fill(xor).flat()).buffer);
 return fragment;
}
