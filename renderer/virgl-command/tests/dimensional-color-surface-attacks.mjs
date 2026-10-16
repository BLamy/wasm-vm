// Independently framed invalid original surfaces, followed by a valid draw.
import {idCommand,header,submission} from './submit-acceptance.mjs';
import {packet,join,shader,sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {keys,metadata,surface} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
import {pairTexts} from '../../../tools/virgl-dimensional-shaders/fixtures.mjs';
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const copy=v=>JSON.parse(JSON.stringify(v));
function allocation(m){const b=header(0x204,0,72);keys.forEach((k,i)=>put(b,24+i*4,m[k]));return b;}
export function attackCases(){
 const rows=[];
 for(const target of [3,4,7]){
  for(const attack of ['mip','multi-layer','reversed','format','role','twoD-layer','layer65535','feedback'])rows.push({target,bind:10,level:0,layer:0,attack,name:`attack/target${target}/${attack}`});
  for(const level of [0,1,2])rows.push({target,bind:10,level,layer:0,attack:'layer-bound',name:`attack/target${target}/mip${level}/layer-bound`});
 }
 for(const target of [4,7])rows.push({target,bind:10,level:0,layer:0,attack:'depth-surface',name:`attack/target${target}/depth-surface`});
 return rows;
}
export async function attack(rig,f,c,row,calls){
 let wire;
 const add=async meta=>{await rig.expect('original auxiliary allocation',allocation(meta));await rig.expect('original auxiliary membership',idCommand(0x202,1,meta.id));row.auxiliaryMetadata=meta;};
 switch(f.attack){
  case 'mip':wire=surface(21,6,3,0);break;
  case 'layer-bound':wire=surface(21,6,f.level,f.levels[f.level].layers);break;
  case 'layer65535':wire=surface(21,6,f.level,65535);break;
  case 'multi-layer':wire=surface(21,6,0,0,67,1);break;
  case 'reversed':wire=surface(21,6,0,1,67,0);break;
  case 'format':wire=surface(21,6,0,0,2);break;
  case 'role':await add({...f.source,id:8,bind:8});wire=surface(21,8,0,0);break;
  case 'twoD-layer':await add(metadata(8,2,67,10,5,3,1,1,2));wire=surface(21,8,1,1);break;
  case 'depth-surface':await add({...f.source,id:8,format:16,bind:9});wire=surface(21,8,0,0,16);break;
  case 'feedback':{
   const target={3:'3D',4:'CUBE',7:'2D_ARRAY'}[f.target],pair=pairTexts('fragment',{target,type:'FLOAT',opcode:'TXL',slot:7}),fragment=pair.fragmentText;
   await add(metadata(4,0,64,16,32,1));const bytes=new Float32Array([.5,.5,.5,0,.5,.5,.5,0]);
   // Original inline buffer transfer, not a host storage write.
   const original=packet(9,0,[4,0,0,0,0,0,0,0,32,1,1,...new Uint32Array(bytes.buffer)]);
   await rig.expect('original feedback coordinates',submission(1,original));
   const layers=f.target===4?5<<16:f.target===7?4<<16:0,swizzle=0|1<<3|2<<6|3<<9;
   await rig.expect('original feedback shader/views',submission(1,join(shader(41,0,pair.vertexText),shader(42,1,fragment),packet(1,5,[13,0,0,0,31,0,0,1,31]),packet(2,5,[13]),packet(6,0,[16,0,3,16,0,4]),sampler(50,{mip:0,min:0,mag:0}),packet(1,6,[51,6,67|f.target<<24,layers,2<<8,swizzle]),packet(10,0,[1,7,51]),packet(18,0,[1,7,50]),packet(31,0,[41,0]),packet(31,0,[42,1]))));
   wire=packet(8,0,[0,2,0,0,1,0,0,0,0,0,0xffffffff,0]);break;
  }
  default:throw Error('Unknown original surface attack '+f.attack);
 }
 const before={host:copy(rig.host.bridge.inspect()),native:copy(rig.q.vm.inspect()),objects:rig.trace.objects.size,calls:calls.length};
 const record=await rig.expect('original surface refusal '+f.attack,submission(1,wire),0x1205);
 const after={host:copy(rig.host.bridge.inspect()),native:copy(rig.q.vm.inspect()),objects:rig.trace.objects.size,calls:calls.length};
 c.same(after.host.store,before.host.store,'refusal preserves original storage ownership and budgets');
 if(f.attack!=='feedback')c.equal(after.objects,before.objects,'refused object publishes no native allocation');
 c.truth(!calls.slice(before.calls).some(x=>/^draw(?:Arrays|Elements)/.test(x.name)||x.name==='framebufferTextureLayer'||x.name==='framebufferTexture2D'&&x.arguments[2]>=34069&&x.arguments[2]<=34074),'refusal precedes draw and dimensional attachment');
 row.attack={name:f.attack,wire:[...wire],record,before,after};
 if(f.attack==='feedback')await rig.expect('original plain pipeline recovery',submission(1,join(packet(31,0,[0,1]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(2,5,[12]),packet(6,0,[16,0,3]))));
}
