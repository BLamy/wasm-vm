// Independent original vertex equations and literal fragment/gradient inputs.
// No emitted GLSL, compiler IR or translator result is an oracle input.
import {interpretColor} from '../virgl-radial-domain/oracle.mjs';
const scratch=new DataView(new ArrayBuffer(4));
export function word(x){scratch.setFloat32(0,x,true);return scratch.getUint32(0,true);}
export function number(x){scratch.setUint32(0,x,true);return scratch.getFloat32(0,true);}
const f=Math.fround,mul=(a,b)=>f(a*b),add=(a,b)=>f(a+b),div=(a,b)=>f(a/b);
const dot3=(a,b)=>add(add(mul(a[0],b[0]),mul(a[1],b[1])),mul(a[2],b[2]));
const normalize=v=>{const squared=dot3(v,v);if(!(squared>0&&Number.isFinite(squared)))throw new Error('Reference requires positive finite normal length');const inverse=f(1/Math.sqrt(squared));return v.map(x=>mul(x,inverse));};
const sumMatrix=(rows,p,translation=true)=>Array.from({length:4},(_,j)=>add(add(add(mul(rows[0][j],p[0]),mul(rows[1][j],p[1])),mul(rows[2][j],p[2])),translation?rows[3][j]:mul(rows[3][j],p[3])));
const transform2=(rows,p)=>[...Array.from({length:3},(_,j)=>add(add(mul(rows[0][j],p[0]),rows[2][j]),mul(rows[1][j],p[1]))),1];
export const TEXELS=[255,153,3,255,9,255,153,128,90,30,240,64,39,252,123,0];
export function vertexVectors(original,seed=0x619eca43){
 let state=seed>>>0;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;},pick=()=>((next()%17)-8)/8;
 return Array.from({length:32},(_,i)=>{
  const inputs=[[pick(),pick(),pick(),1],i<8?[[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0],[1,1,1,0],[-1,-1,-1,0]][i]:[(next()%7+1)/8,(next()%7+1)/8,(next()%7+1)/8,0],[((next()%4)+.5)/4,((next()%4)+.5)/4,0,1]];
  const constants=[[.5,0,0,0],[0,.75,0,0],[0,0,.25,0],[.125,-.25,.0625,1],[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  const id=original.sha256.slice(0,8);
  if(['3f78a90d','403b0529'].includes(id)){constants.splice(0,3,[.5,0,0,0],[0,.75,0,0],[.125,-.25,.0625,0]);constants[3]=[[.25,.5,.75,1],[-.25,.5,.125,1],[0,.25,.5,0],[.75,.125,.25,.5]][i%4];}
  if(id==='d4f702f7')constants.splice(4,4,[.5,0,0,0],[0,.75,0,0],[0,0,.25,0],[.125,-.25,.0625,1]);
  if(id==='403b0529')constants.length=3;
  else if(id==='3f78a90d'||id==='e9bc6d3b')constants.length=4;
  else if(!['12f6d594','d4f702f7'].includes(id))constants.length=0;
  return{name:'vertex-'+i,inputs:inputs.map(r=>r.map(f)),constants:constants.map(r=>r.map(f))};
 });
}
export function vertexExpected(original,vector){
 const id=original.sha256.slice(0,8),[p,n,uv]=vector.inputs,c=vector.constants;let position,generic=null;
 if(original.probe==='legacy-identity'||['0ec6a7a8','23b5f8a8'].includes(id)){position=p.slice();if(id==='23b5f8a8')generic=[n[0],n[1]];}
 else if(id==='e96102a3'){position=[p[0],p[1],0,1];generic=[n[0],n[1]];}
 else if(id==='e9bc6d3b')position=Array.from({length:4},(_,j)=>add(mul(c[3][j],p[3]),add(mul(c[2][j],p[2]),add(mul(c[1][j],p[1]),mul(c[0][j],p[0])))));
 else if(id==='3f78a90d'||id==='403b0529'){position=transform2(c,p);generic=id==='3f78a90d'?c[3].map(x=>add(mul(x,0),x)):[n[0],n[1]];}
 else if(id==='12f6d594'){
  position=sumMatrix(c,p);const transformed=Array.from({length:3},(_,j)=>add(add(add(mul(c[4][j],n[0]),mul(c[5][j],n[1])),mul(c[6][j],n[2])),c[7][j]));
  const light=dot3(normalize(transformed),[number(1059760811),number(1059760811),number(1051372203)]);generic=[Math.max(light,0),uv[0],uv[1]];
 }else if(id==='d4f702f7'){
  position=sumMatrix(c.slice(4),p,false);const eye=sumMatrix(c,p,false);if(eye[3]===0)throw new Error('Projective divisor must be nonzero');const q=eye.slice(0,3).map(x=>div(x,eye[3]));
  const transformed=Array.from({length:3},(_,j)=>add(add(mul(c[0][j],n[0]),mul(c[1][j],n[1])),mul(c[2][j],n[2])));
  const light=normalize(q.map((x,j)=>add([2,2,20][j],mul(x,-1))));generic=[Math.max(dot3(transformed,light),0),uv[0],uv[1]];
 }else throw new Error('Unlisted original vertex '+id);
 return{position:position.map(word),generic:generic?.map(word),positionUlpBudget:0,genericUlpBudget:['12f6d594','d4f702f7'].includes(id)?8:0,definedGenericMask:generic===null?0:(1<<generic.length)-1};
}
export function ulp(a,b){if(number(a)===number(b))return 0;const key=x=>x>>>31?0x80000000-(x&0x7fffffff):0x80000000+x;return Math.abs(key(a)-key(b));}
const byte=x=>Math.max(0,Math.min(255,Math.round(x*255)));
export function fragmentVectors(original){
 const id=original.sha256.slice(0,8);
 if(original.probe==='gradient'){
  const loop=original.metadata.uniforms[0].count===46,radial=!!original.metadata.constantRadialDomains,count=loop?46:26,first=loop?28:18,stops=loop?18:8;
  return [0,.03125,.0625,.25,.5,.75,1,1.5].flatMap((root,i)=>[0,1,3].map((spread,j)=>{
   const constants=Array.from({length:count},()=>[0,0,0,0]);constants[2]=radial?[0,0,1,0]:[root,0,1,0];constants[3][0]=spread;constants[4][0]=1;
   if(radial){constants[6][0]=root||.125;constants[8][0]=root||.125;}else constants[8][0]=1;
   for(let s=0;s<stops;s++){constants[10+s][0]=s/16;constants[first+s]=[[.25,.5,.75,1],[.75,.25,.125,.5],[.125,.75,.25,1],[.5,.125,.75,.5]][s%4].slice();}
   const raw=constants.flat().map(word);raw[36]=loop?18:8;const text=original.text.replace(/\b(FSEQ|FSNE|MOV)_PRECISE\b/g,'$1');
   const prediction=interpretColor({text},{stage:'fragment'},raw);
   return{name:`gradient-${i}-${j}`,uv:[.25,.75],bank:raw,expected:prediction.color,pixelBudget:1,reference:prediction};
  }));
 }
 return Array.from({length:8},(_,i)=>{
  const texel=TEXELS.slice((i%4)*4,(i%4)*4+4),uv=[i%2?.75:.25,(i%4)>=2?.75:.25],positive=i<4,light=positive?number(1059760811):0;
  let expected,constants=[];
  if(['00327010','9819066d'].includes(id))expected=texel.map((x,l)=>l===3?x:byte(mul(f(x/255),light)));
  else if(id==='67c701fa'){constants=[[.25,.5,.75,1],[.75,.125,.25,.5],[0,.5,1,0],[.125,.75,.5,1]][i%4];expected=constants.map(byte);}
  else if(id==='c00de140'){constants=[[.25,.5,.75,1],[.75,.125,.25,.5],[0,.5,1,0],[.125,.75,.5,1]][i%4];expected=constants.map(byte);}
  else if(id==='80d6db6a'){constants=positive?[.5,1,.25,.5]:[1,.5,1,1];expected=texel.map((x,l)=>byte(mul(f(x/255),constants[l])));}
  else if(id==='b28f0dbc'){constants=[positive?.5:1,0,0,0];expected=texel.map(x=>byte(mul(f(x/255),constants[0])));}
  else if(id==='ef095954')expected=texel;
  else throw new Error('Unlisted original fragment '+id);
  return{name:'fragment-'+i,uv,normal:positive?[1,0,0,0]:[-1,0,0,0],constants,expected,pixelBudget:['00327010','9819066d'].includes(id)?1:0};
 });
}
