// Literal copy and numeric-domain predictions, independent of emitted GLSL/IR.
import {interpretColor} from '../virgl-radial-domain/oracle.mjs';
const bytes=new ArrayBuffer(4),view=new DataView(bytes);
export function number(word){view.setUint32(0,word,true);return view.getFloat32(0,true);}
export function admitted(word){const value=number(word);return Number.isFinite(value)&&(value===0||Math.abs(value)>=2**-126);}
export function proof(){const cases=[];for(let exponent=0;exponent<256;exponent++)for(const mantissa of[0,1,0x3fffff,0x7ffffe,0x7fffff])for(const sign of[0,0x80000000]){const word=(sign+exponent*0x800000+mantissa)>>>0;cases.push({word,admitted:admitted(word)});}return{schema:'raster-bank-independent-domain-v1',minimumNormal:2**-126,cases};}
export function vectors(kernel,seed=0x31db9275){
 if(kernel.kind==='original')return[0,1,2].map(i=>({name:'original-color-'+i,color:[[0x3e800000,0x3f000000,0x3f400000,0x3f800000],[0,0x3f800000,0,0x80000000],[0x3f000000,0x3e800000,0x3f000000,0x3f000000]][i],count:2}));
 const result=[{name:'positive-negative-zero',a:[0,0x80000000,0,0x80000000],b:[0x80000000,0,0x80000000,0],selector:0},
  {name:'raw-subnormal-selector',a:[0x3e800000,0x3f000000,0x3f400000,0x3f800000],b:[0x3f800000,0x3f400000,0x3f000000,0x3e800000],selector:1},
  {name:'normal-neighbors',a:[0x00800000,0x00800001,0x80800000,0x80800001],b:[0x7f7ffffe,0x7f7fffff,0xff7ffffe,0xff7fffff],selector:1}];
 if(kernel.stage==='vertex'){let state=seed>>>0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const word=state>>>0;return((word&0x807fffff)+((1+((word>>>23)%254))*0x800000))>>>0;};for(let i=0;i<3;i++)result.push({name:'normal-seed-'+i,a:Array.from({length:4},random),b:Array.from({length:4},random),selector:i%2});}
 return result;
}
export function bank(kernel,vector){
 if(kernel.kind==='original'){
  const values=Array(kernel.count*4).fill(0);
  // Zero coordinate matrices and a literal homogeneous (.5,0,1) make the
  // reference root exactly .5. The radial cone uses B=.5,C=.25,A=1;
  // its quadratic root is .5, within the existing admitted coefficient domain.
  values.splice(8,4,0x3f000000,0,0x3f800000,0);values[16]=0x3f800000;
  if(kernel.radial)values[28]=0x3f800000;else values[32]=0x3f800000;
  values[36]=vector.count;
  // Root equals the first lower breakpoint: the weight is zero, so the
  // original UCMP must actually copy bank alpha instead of taking LRP.
  values[40]=0x3f000000;values[44]=0x3f800000;
  for(let i=kernel.form==='nested'?18:28;i<(kernel.form==='nested'?26:46);i++)values.splice(i*4,4,...vector.color);
  return values;
 }
 const values=Array(kernel.count*4).fill(0);values.splice(0,4,...vector.a);values.splice(4,4,...vector.b);values[20]=vector.selector;return values;
}
export function expected(kernel,vector,fixture){
 const values=bank(kernel,vector);
 if(kernel.kind==='original'){const entry=fixture.cases.find(e=>e.name===kernel.case);return interpretColor({text:entry.text.replace(/\b(FSEQ|FSNE|MOV)_PRECISE\b/g,'$1')},kernel,values);}
 const a=vector.a,b=vector.b,result=[0x3f000000,0x3f000000,0x3f000000,0x3f000000],lanes='xyzw';
 if(kernel.variant==='alias'){result.splice(0,4,...a);for(const c of kernel.mask){const lane=lanes.indexOf(c);result[lane]=a[lanes.indexOf('xzyw'[lane])];}}
 else if(kernel.variant==='branch'){result.splice(0,4,...a);if(vector.selector!==0)for(const c of kernel.mask){const lane=lanes.indexOf(c);result[lane]=b[3-lane];}}
 else for(const c of kernel.mask){const lane=lanes.indexOf(c),left=a[3-lane];result[lane]=kernel.variant==='select'?(vector.selector!==0?left:b[lane]):kernel.variant==='max'?(number(left)>number(b[lane])?left:b[lane]):left;}
 if(!result.every(admitted))throw new Error('Independent oracle forbids unsafe copied raster execution');
 return{words:result,color:result.map(word=>Math.max(0,Math.min(255,Math.round(number(word)*255))))};
}
export function demands(kernel,fixture){return fixture.cases.find(e=>e.name===kernel.case).expected.constantRasterDomains[0].components;}
export function firstInvalid(values,components){for(const entry of components)for(let lane=0;lane<4;lane++)if((entry.mask&(1<<lane))&&!admitted(values[entry.register*4+lane]))return{register:entry.register,lane,word:values[entry.register*4+lane]};return null;}
