// Independent Gallium packet/input model. No renderer, decoder or compiler import.
import { literalState } from './standard-draw-oracle.mjs';
export function constantModel(history, buffers, used) {
  const s=literalState(history),d=s.draw;
  const indexed=d.indexed?buffers.get(s.index.id):null;
  const v=indexed?new DataView(indexed.buffer,indexed.byteOffset,indexed.byteLength):null;
  s.ids=Array.from({length:d.count},(_,i)=>!v?d.start+i:
    s.index.size===1?v.getUint8(s.index.offset+i):s.index.size===2?v.getUint16(s.index.offset+i*2,true):v.getUint32(s.index.offset+i*4,true));
  s.min=Math.min(...s.ids);s.max=Math.max(...s.ids);
  s.fetches=used.map(attributeIndex=>{
    const e=s.activeElements[attributeIndex],b=s.buffers[e.buffer],raw=buffers.get(b.id),constant=b.stride===0;
    const first=constant||e.divisor?0:s.min,last=constant?0:e.divisor?Math.floor((s.effective-1)/e.divisor):s.max;
    const offset=b.offset+e.sourceOffset,components=e.format-27,view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    const values=[0,0,0,1],words=[];
    if(constant)for(let lane=0;lane<components;lane++){values[lane]=view.getFloat32(offset+lane*4,true);words.push(view.getUint32(offset+lane*4,true));}
    return {attributeIndex,resourceId:b.id,divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),
      constant,firstElement:first,lastElement:last,stride:b.stride,offset,components,firstByte:offset+first*b.stride,
      requiredEnd:offset+last*b.stride+components*4,...(constant?{genericValues:values,componentWords:words}:{})};
  });
  // This fixture's original TGSI constructs native-ID rectangle tiles and a
  // flat sum of active float inputs. Its complete source accompanies evidence.
  const coeff=s.shaders.get(0).match(/IMM\[2\] FLT32 \{([^}]+)\}/)[1].split(',').map(Number);
  s.color=(instance,id)=>{
    const sum=[0,0,0,0];
    for(const index of used){
      const e=s.activeElements[index],b=s.buffers[e.buffer],raw=buffers.get(b.id),view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
      const n=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id;
      for(let lane=0;lane<4;lane++){
        const value=lane<e.format-27?view.getFloat32(b.offset+e.sourceOffset+n*b.stride+lane*4,true):lane===3?1:0;
        sum[lane]=Math.fround(sum[lane]+value);
      }
    }
    const out=sum.map(value=>Math.fround(value*Math.fround(coeff[0])));
    out[2]=Math.fround(Math.fround((instance&7)*Math.fround(coeff[1]))+out[2]);
    out[1]=Math.fround(Math.fround((id&255)*Math.fround(coeff[2]))+out[1]);
    return out.map(value=>Math.round(Math.max(0,Math.min(1,value))*255));
  };
  s.pixel=(x,y,width,height)=>{
    const clip=2*(x+.5)/width-1,instance=Math.floor((clip-s.imm[1])/s.imm[0]);
    if(instance<0||instance>=s.effective)return [[0,0,0,0]];
    const local=(clip-s.imm[1]-instance*s.imm[0])/s.imm[0],diagonal=local+(y+.5)/height;
    const a=s.color(instance,s.ids[2]),b=s.color(instance,s.ids[d.mode===4?5:3]);
    return Math.abs(diagonal-1)<1e-6?[a,b]:[diagonal<1?a:b];
  };
  return s;
}
