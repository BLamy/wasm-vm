import {idCommand,submission} from './submit-acceptance.mjs';
import {allocation} from './native-dimensional-color-surfaces.mjs';
import {metadata,surface,packet,join,shader} from '../../../tools/virgl-dimensional-depth-surfaces/fixtures.mjs';
import {sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {pairTexts} from '../../../tools/virgl-dimensional-shaders/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
export function attackCases(){
 const rows=[];
 for(const target of [4,7])for(const format of [16,18,20,21,126])for(const attack of ['mip','layer','layer65535','multiple','reversed','format','role','non-depth','twoD-layer','target-mismatch','attachment-role','dimensions','feedback'])rows.push({target,format,bind:9,level:1,layer:0,attack,name:`attack/target${target}/format${format}/${attack}`});
 return rows;
}
export async function runAttack(rig,f,c,row,calls){
 let wire;
 const add=async meta=>{await rig.expect('original attack allocation',allocation(meta));await rig.expect('original attack membership',idCommand(0x202,1,meta.id));row.auxiliaryMetadata=meta;};
 switch(f.attack){
  case 'mip':wire=surface(22,6,3,0,f.format);break;
  case 'layer':wire=surface(22,6,f.level,f.source.arraySize,f.format);break;
  case 'layer65535':wire=surface(22,6,f.level,65535,f.format);break;
  case 'multiple':wire=surface(22,6,0,0,f.format,1);break;
  case 'reversed':wire=surface(22,6,0,1,f.format,0);break;
  case 'format':wire=surface(22,6,0,0,67);break;
  case 'role':await add({...f.source,id:8,bind:8});wire=surface(22,8,0,0,f.format);break;
  case 'non-depth':await add({...f.source,id:8,format:67,bind:10});wire=surface(22,8,0,0,f.format);break;
  case 'twoD-layer':await add(metadata(8,2,f.format,9,5,3,1,1,2));wire=surface(22,8,1,1,f.format);break;
  case 'target-mismatch':wire=packet(1,6,[22,6,f.format|(f.target===4?7:4)<<24,0|(f.source.arraySize-1)<<16,2<<8,0x688]);break;
  case 'attachment-role':wire=packet(5,0,[1,20,21]);break;
  case 'dimensions':await add(metadata(8,2,67,2,f.width+1,f.height));await rig.expect('original unequal color surface',submission(1,surface(22,8,0,0,67)));wire=packet(5,0,[1,21,22]);break;
  case 'feedback':{
   const pair=pairTexts('fragment',{target:f.target===4?'CUBE':'2D_ARRAY',type:'FLOAT',opcode:'TXL',slot:7});
   await add(metadata(8,0,64,16,f.positions.length,1));const bytes=new Float32Array(f.points.flatMap(()=>[.5,.5,0,0]));
   await rig.expect('original feedback coordinate words',submission(1,packet(9,0,[8,0,0,0,0,0,0,0,bytes.byteLength,1,1,...new Uint32Array(bytes.buffer)])));
   await rig.expect('original depth feedback sampler state',submission(1,join(shader(41,0,pair.vertexText),shader(43,1,pair.fragmentText),packet(1,5,[13,0,0,0,31,0,0,1,31]),packet(2,5,[13]),packet(6,0,[16,0,3,16,0,8]),sampler(50,{mip:0,min:0,mag:0}),packet(1,6,[51,6,f.format|f.target<<24,(f.source.arraySize-1)<<16,2<<8,0x688]),packet(10,0,[1,7,51]),packet(18,0,[1,7,50]),packet(31,0,[41,0]),packet(31,0,[43,1]))));
   wire=packet(8,0,[0,f.points.length,0,0,1,0,0,0,0,0,0xffffffff,0]);break;
  }
  default:throw Error('Unknown depth surface attack '+f.attack);
 }
 const before={host:copy(rig.host.bridge.inspect()),native:copy(rig.q.vm.inspect()),objects:rig.trace.objects.size,calls:calls.length};
 const record=await rig.expect('original dimensional depth refusal '+f.attack,submission(1,wire),0x1205);
 const after={host:copy(rig.host.bridge.inspect()),native:copy(rig.q.vm.inspect()),objects:rig.trace.objects.size,calls:calls.length};
 c.same(after.host.store,before.host.store,'refused depth surface preserves all original owners and budgets');
 if(f.attack!=='feedback')c.equal(after.objects,before.objects,'refused depth attachment publishes no native allocation');
 c.truth(!calls.slice(before.calls).some(x=>/^draw(?:Arrays|Elements)/.test(x.name)||x.name==='framebufferTextureLayer'||x.name==='framebufferTexture2D'),'depth surface refusal precedes every native draw and attachment');
 row.attack={name:f.attack,wire:[...wire],record,before,after};
 if(f.attack==='feedback')await rig.expect('original plain depth pipeline recovery',submission(1,join(packet(31,0,[0,1]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(2,5,[12]),packet(6,0,[16,0,3]))));
}
