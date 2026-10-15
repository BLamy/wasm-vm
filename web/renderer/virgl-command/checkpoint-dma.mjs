// Lossless bounded word runs for boot-splash DMA. Incompressible data stays owned raw bytes.
import {checkpointBytes} from './checkpoint-codec.mjs';
export const CHECKPOINT_DMA_MAX_BYTES=32*1024*1024;
const need=(value,message)=>{if(!value)throw Error('GPU checkpoint DMA: '+message);};
export function packCheckpointDma(source) {
  const raw=new Uint8Array(checkpointBytes(source));
  need(raw.length<=CHECKPOINT_DMA_MAX_BYTES,'input exceeds transfer budget');
  if(raw.length<256||raw.length%4!==0)return raw;
  const input=new DataView(raw.buffer),output=new Uint8Array(raw.length),view=new DataView(output.buffer);
  const words=raw.length/4;let at=0,literal=0,used=0;
  const literals=end=>{
    if(end===literal)return true;
    const count=end-literal;if(used+4+count*4>output.length)return false;
    view.setUint32(used,count,true);used+=4;output.set(raw.subarray(literal*4,end*4),used);used+=count*4;return true;
  };
  while(at<words) {
    const value=input.getUint32(at*4,true);let end=at+1;
    while(end<words&&input.getUint32(end*4,true)===value)end++;
    if(end-at>=3){
      if(!literals(at)||used+8>output.length)return raw;
      view.setUint32(used,0x80000000|(end-at),true);view.setUint32(used+4,value,true);used+=8;at=end;literal=at;
    }else at=end;
  }
  if(!literals(words)||used+64>=raw.length)return raw;
  return {encoding:'u32-runs-v1',length:raw.length,bytes:output.slice(0,used)};
}
export function unpackCheckpointDma(value) {
  if(ArrayBuffer.isView(value)){
    const raw=checkpointBytes(value);need(raw.length<=CHECKPOINT_DMA_MAX_BYTES,'raw transfer budget');return new Uint8Array(raw);
  }
  need(value&&value.encoding==='u32-runs-v1'&&Number.isSafeInteger(value.length)&&value.length>=256&&
    value.length<=CHECKPOINT_DMA_MAX_BYTES&&value.length%4===0,'invalid packed transfer');
  const bytes=checkpointBytes(value.bytes);need(bytes.length>=8&&bytes.length<value.length&&bytes.length%4===0,'invalid packed length');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),output=new Uint8Array(value.length),out=new DataView(output.buffer);
  let at=0,used=0;
  while(at<bytes.length){
    need(at+4<=bytes.length,'truncated packet');const header=view.getUint32(at,true);at+=4;
    const count=header&0x7fffffff;need(count>0&&count<=(output.length-used)/4,'invalid run extent');
    if(header&0x80000000){
      need(at+4<=bytes.length,'truncated run');const word=view.getUint32(at,true);at+=4;
      for(let i=0;i<count;i++)out.setUint32(used+i*4,word,true);
    }else{
      need(count*4<=bytes.length-at,'truncated literal');output.set(bytes.subarray(at,at+count*4),used);at+=count*4;
    }
    used+=count*4;
  }
  need(used===output.length,'incomplete packed transfer');return output;
}
