// Independent handwritten equations for the captured full 92cb body.
// Inputs are original binary32 bank words. No generated shader or GPU pixel
// supplies coefficients, control decisions or primary expected colors.
const f=w=>new Float32Array(new Uint32Array([w]).buffer)[0];
const c={
  a:[1053486281,1046281129,1082291371,1055439406].map(f),
  b:[1037578380,1031980538,1035420539,1067798374].map(f),
  d:[1079226764,1051640170,1060377406].map(f),
  e:[1047298914,1076299332,1071289118].map(f),
  k:[1067605037,998866771].map(f),
  decode:[1095678034,1029785504,1065814589,1075419546,1025879765].map(f),
  encode:[1054168405,3177269152,994913820,1066116929,1053092943].map(f),
};
export const POWER_SITES=Object.freeze([105,106,107,221,222,225,231,250,251,254,260,
  283,284,287,293,309,310,313,319,342,535,536,537,685,686,687,689,690,691]);

function sourceColor(words){
  const [l,a,b,opacity]=words.slice(40,44).map(f);
  const s=l+a*c.a[0]+b*c.a[1];
  const u=l-a*c.b[0]-b*c.b[1],v=l-a*c.b[2]-b*c.b[3];
  const [s3,u3,v3]=[s*s*s,u*u*u,v*v*v];
  const linear=[s3*c.a[2]-u3*c.d[0]+v3*c.e[0],
    -s3*c.k[0]+v3*c.e[1]-u3*c.d[1],
    -s3*c.k[1]-v3*c.d[2]+u3*c.e[2]].map(value=>Math.max(value,0));
  return {linear,rgb:linear.map(value=>Math.pow(value,c.a[3])),opacity};
}

const models=new WeakMap();
function model(words){
  let value=models.get(words);
  if(!value){
    const decoded=words.map(f),initial=sourceColor(words);
    value={decoded,initial};models.set(words,value);
  }
  return value;
}

export function originalOracle(words,x,y){
  const {decoded,initial:color}=model(words);
  const get=(r,lane=0)=>decoded[r*4+lane];
  const left=x<get(0),right=x>get(1),top=y<get(0,1),bottom=y>get(1,1);
  const corner=left?(top?0:bottom?1:null):right?(top?2:bottom?3:null):null;
  let alpha=color.opacity*get(35),radius=null,dx=null,dy=null,fade=null;
  if(corner!==null){
    dx=Math.abs(x-get(corner<2?0:1));
    dy=Math.abs(y-get(corner===0||corner===2?0:1,1));
    radius=Math.sqrt(dx*dx+dy*dy);
    fade=(get(7)+get(5)-radius)/get(7);
    alpha*=radius>get(7)+get(5)?0:radius>get(5)?fade*fade*fade:1;
  }
  const edge=Math.min(y,x,get(4,1)-y,get(4)-x);
  // Every corner sets TEMP26 to a nonzero raw predicate; the ordinary
  // edge attenuation is selected only outside those corner paths.
  const edgeSelected=edge<get(7)&&corner===null;
  if(edgeSelected)alpha*=Math.pow(edge/get(7),get(8));
  if(x>=get(2)&&x<=get(3)&&y>=get(2,1)&&y<=get(3,1))alpha=0;
  const [scale,offset,divisor,exponent,threshold]=c.decode;
  const decodeBase=color.rgb.map(value=>(value+offset)/divisor);
  const linear=color.rgb.map((value,lane)=>value<=threshold?value/scale:
    Math.pow(decodeBase[lane],exponent));
  const premultiplied=linear.map(value=>value*alpha);
  const output=premultiplied.map(value=>value<=c.encode[2]?value*scale:
    Math.pow(value,c.encode[0])*divisor+c.encode[1]);
  return {color:output.concat(alpha),discard:alpha===0,corner,dx,dy,radius,fade,edge,
    initial:color,decodeBase,premultiplied};
}

export function powerPrediction(words,x,y,pc){
  if(pc>=105&&pc<=107)return {base:model(words).initial.linear[pc-105],exponent:c.a[3],masked:false};
  const o=originalOracle(words,x,y);
  const starts=[221,250,283,309];
  for(let corner=0;corner<4;corner++){
    const start=starts[corner];
    if(pc<start||pc>start+10)continue;
    if(o.corner!==corner)return null;
    if(pc===start)return {base:o.dx,exponent:2,masked:false};
    if(pc===start+1)return {base:o.dy,exponent:2,masked:false};
    if(pc===start+4)return {base:o.dx*o.dx+o.dy*o.dy,exponent:.5,masked:false};
    if(pc===start+10)return {base:o.fade,exponent:3,masked:o.fade<0};
  }
  if(pc===342)return {base:o.edge/4,exponent:3,masked:false};
  if(o.discard)return null;
  if(pc>=535&&pc<=537)return {base:o.decodeBase[pc-535],exponent:c.decode[3],masked:false};
  if(pc>=685&&pc<=687)return {base:Math.max(o.premultiplied[pc-685],0)/c.encode[3],exponent:c.encode[4],masked:false};
  if(pc>=689&&pc<=691)return {base:o.premultiplied[pc-689],exponent:c.encode[0],masked:false};
  throw new Error(`Unknown original power pc${pc}`);
}
