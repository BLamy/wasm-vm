// Independent integer/rational expectations for authored inputs, never emitted GLSL.
import { rsqBound } from '../../virgl-shader/tests/dot-reciprocals.mjs';
const require = (value, message) => { if (!value) throw new Error(message); };
function gcd(a,b){a=a<0n?-a:a;while(b){const t=a%b;a=b;b=t;}return a;}
const r=(n,d=1n)=>{if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};};
const add=(a,b)=>r(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>r(a.n*b.d-b.n*a.d,a.d*b.d),mul=(a,b)=>r(a.n*b.n,a.d*b.d),div=(a,b)=>r(a.n*b.d,a.d*b.n),neg=a=>r(-a.n,a.d),cmp=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const pow=e=>e>=0?r(1n<<BigInt(e)):r(1n,1n<<BigInt(-e)),json=a=>({numerator:String(a.n),denominator:String(a.d)}),from=a=>r(BigInt(a.numerator),BigInt(a.denominator));
export function classify(word){const e=Math.floor(word/8388608)%256,m=word%8388608;return e===255?(m?'nan':'infinity'):e===0?(m?'subnormal':'zero'):'normal';}
export function decode(word){require(!['nan','infinity'].includes(classify(word)),'finite independent rational decode');const e=Math.floor(word/8388608)%256,m=word%8388608;return mul(r(BigInt(e===0?m:8388608+m)*(word>=2147483648?-1n:1n)),pow(e===0?-149:e-150));}
function exponent(a){const n=a.n<0n?-a.n:a.n;require(n>0n,'nonzero normal result');let e=n.toString(2).length-a.d.toString(2).length;if(cmp(r(n,a.d),pow(e))<0)e--;return e;}
export function exactWord(a){if(a.n===0n)return 0;const sign=a.n<0n?2147483648:0,e=exponent(a),q=div(r(a.n<0n?-a.n:a.n,a.d),pow(e-23));require(e>=-126&&e<=127&&q.n%q.d===0n,'exact normal dyadic result');return sign+(e+127)*8388608+Number(q.n/q.d-8388608n);}
const exact=a=>({kind:'exact',value:json(a),words:a.n===0n?[0,2147483648]:[exactWord(a)]}),raw=word=>({kind:'raw',words:[word]});
function division(a,b){require(cmp(b,pow(-126))>=0&&cmp(b,pow(126))<=0,'quantitative positive denominator domain');const q=div(a,b),e=exponent(q),abs=r(q.n<0n?-q.n:q.n,q.d),ulp=pow(e-23),radius=mul(r(5n,2n),ulp),boundary=cmp(abs,pow(e))===0;
require(cmp(sub(abs,radius),pow(-126))>=0&&cmp(add(abs,radius),pow(e+1))<0&&(boundary||cmp(sub(abs,radius),pow(e))>=0),'normal quantitative interval');return {kind:'division',numerator:json(a),denominator:json(b),quotient:json(q),exponent:e,ulpQuantum:json(ulp),lower:json(sub(q,radius)),upper:json(add(q,radius)),boundary};}
function dot(a,b){const terms=a.map((v,i)=>mul(v,b[i]));terms.forEach(exactWord);for(const [i,j,k]of[[0,1,2],[0,2,1],[1,2,0]]){exactWord(add(terms[i],terms[j]));exactWord(add(add(terms[i],terms[j]),terms[k]));}return terms.reduce(add,r(0n));}
const swizzle=(v,indices)=>[...indices].map(c=>v['xyzw'.indexOf(c)]),zip=(a,b,fn)=>a.map((v,i)=>fn(v,b[i]));
const blend=(w,a,b)=>add(mul(w,a),mul(sub(r(1n),w),b));
const N=[r(1n,4n),r(3n,4n),r(1n,2n),r(-2n)],I=[r(1n,4n),r(3n,4n),r(0n),r(1n)],quarter=r(1n,4n);
export function expectedPages(kernel,vector,fixture){
 const A=vector.c0.map(decode),B=vector.c45.map(decode),pages=[fixture.atlas.orientationWords.map(raw),vector.c0.map(raw),vector.c45.map(raw)];
 const emit=v=>pages.push(v.map(exact));
 if(kernel.family==='arithmetic'){
  emit(zip(A.map(neg),swizzle(N,'yzxw'),add));emit(zip(N,B,add));emit(zip(A,N.map(neg),mul));emit(zip(N,swizzle(B,'yzxw'),mul));
  emit(A.map((v,i)=>add(mul(v,N[i]),B[i])));emit(N.map((v,i)=>add(mul(v,B[i]),A[i])));emit(N.map((v,i)=>add(mul(v,v),B[i])));
  pages.push(A.map(v=>division(v,N[1])),N.map(v=>division(v,B[2])));
  emit(zip(A,N,(x,y)=>cmp(x,y)>=0?x:y));emit(zip(N,B.map(neg),(x,y)=>cmp(x,y)>=0?x:y));emit(B.map(neg).map(v=>{let floor=v.n/v.d;if(v.n<0n&&v.n%v.d!==0n)floor--;return sub(v,r(floor));}));
  emit(A.map((v,i)=>blend(v,N[i],B[i])));emit(N.map((v,i)=>blend(v,B[i],v)));emit(N.map((v,i)=>blend(v,v,B[i])));
  emit(Array(4).fill(dot(swizzle(A,'zxy').map(neg),swizzle(N,'yzx'))));emit(Array(4).fill(dot(N.slice(0,3),swizzle(B,'yzx'))));
  pages.push(Array(4).fill(division(r(1n),A[1])),Array(4).fill(rsqBound(B[2])));
 }else if(kernel.family==='provenance'){
  const condition=vector.condition,H=N.map(v=>add(v,quarter)),select=(c,a,b)=>a.map((v,i)=>c[i]!==0?v:b[i]),aw=vector.c0,bw=vector.c45,iw=I.map(exactWord),hw=H.map(exactWord),values=[];
  values.push([aw[1],aw[0],aw[2],aw[3]]);
  values.push(swizzle(swizzle(select(condition,iw,aw),'wzyx'),'yxwz'));
  values.push(swizzle(select(condition,hw,bw),'yzxw'));
  values.push(select(swizzle(condition,'yxwz'),select(condition,hw,aw),bw));
  values.push(select(condition,aw,hw));
  const yes=select(condition,swizzle(aw,'yxzw'),swizzle(bw,'wzyx'));values.push([...yes.slice(0,2),...aw.slice(2)]);
  const no=select(swizzle(condition,'zyxw'),swizzle(aw,'yzxw'),swizzle(bw,'zxyw'));values.push([...no.slice(0,3),bw[3]]);
  values.push(swizzle(bw,'zwyx'));
  pages.push(...values.map(v=>v.map(raw)));values.forEach((v,i)=>emit(v.map(word=>[2,5].includes(i)?mul(decode(word),r(2n)):add(decode(word),quarter))));
 }else if(kernel.family==='subnormal'){
  const selected=swizzle(vector.c0,'zwyx').map((v,i)=>vector.condition[i]!==0?v:swizzle(vector.c45,'yxwz')[i]);[selected[0],selected[1]]=[selected[1],selected[0]];const copied=swizzle(selected,'wzyx');
  const scaled=words=>words.map(word=>{const value=mul(decode(word),pow(126)),entry=exact(value);if(classify(word)==='subnormal')return {kind:'flush-set',inputWord:word,preserved:json(value),words:[0,2147483648,exactWord(value)]};return entry;});
  pages.push(scaled(vector.c0),scaled(vector.c45),copied.map(raw),scaled(copied));
 }else if(kernel.family==='texture'){
  const samples=[0,7].map((slot,i)=>{const coords=i?swizzle(B,'yx'):A.slice(0,2),x=cmp(coords[0],r(1n,2n))>=0?1:0,y=cmp(coords[1],r(1n,2n))>=0?1:0,bytes=fixture.vectors.textures.find(v=>v.slot===slot).bytes;return bytes.slice((2*y+x)*4,(2*y+x+1)*4).map(byte=>r(BigInt(byte),255n));});
  samples.forEach(emit);samples.forEach(v=>emit(v.map(x=>add(mul(x,r(1n,2n)),quarter))));
 }else throw new Error('unknown authored kernel');
 require(pages.length===kernel.pages.length,'complete independent page oracle');return pages;
}
export function observation(oracle,word){const classification=classify(word);if(oracle.words)return {...oracle,observedWord:word,classification,accepted:oracle.words.includes(word)};
 if(classification!=='normal')return {...oracle,observedWord:word,classification,accepted:false};const value=decode(word),lo=from(oracle.lower),hi=from(oracle.upper);return {...oracle,observedWord:word,classification,observedValue:json(value),accepted:cmp(value,lo)>=0&&cmp(value,hi)<=0,...(oracle.kind==='rsq'?{errorLower:json(sub(value,from(oracle.rootUpper))),errorUpper:json(sub(value,from(oracle.rootLower)))}:{error:json(sub(value,from(oracle.quotient)))})};}
export function coupledExpected(vector){const choose=v=>v.c0.map((word,i)=>v.condition[i]!==0?word:v.c45[i]),v=choose(vector.vertex).map(decode),f=choose(vector.fragment).map(decode);const numbers=v.map(x=>Number(x.n)/Number(x.d)),colors=v.map((x,i)=>add(mul(x,quarter),f[i]));return {rectangle:[32*(1-numbers[0]),32*(1-numbers[1]),64*numbers[0],64*numbers[1]],color:colors.map(x=>Number((x.n*255n*2n+x.d)/(2n*x.d)))};}
