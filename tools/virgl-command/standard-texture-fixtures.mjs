// Original VirGL wire words and independent bounded literal texture inputs.
export const metadata=(id=1,width=7,height=5,lastLevel=2,format=67,bind=10)=>({id,target:2,format,bind,width,height,depth:1,arraySize:1,lastLevel,nrSamples:0,flags:0});
export const box=(width,height,x=0,y=0)=>({x,y,z:0,width,height,depth:1});
export function packet(op,words){const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
export const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export const unhex=s=>Uint8Array.from(s.match(/../g)??[],x=>parseInt(x,16));
export function transfer(meta,level,region,direction=1,offset=0,stride=0,layerStride=0,usage=0){return packet(43,[meta.id,level,usage,stride,layerStride,region.x,region.y,0,region.width,region.height,1,offset,direction]);}
export function copyTransfer(meta,level,region,staging,flags=1,offset=0,stride=0,layerStride=0){return packet(45,[meta.id,level,0,stride,layerStride,region.x,region.y,0,region.width,region.height,1,staging,offset,flags]);}
export function inline(meta,level,region,input,stride=0,layerStride=0){const padded=new Uint8Array(Math.ceil(input.length/4)*4);padded.set(input);const v=new DataView(padded.buffer),words=Array.from({length:padded.length/4},(_,i)=>v.getUint32(i*4,true));return packet(9,[meta.id,level,0,stride,layerStride,region.x,region.y,0,region.width,region.height,1,...words]);}
export function levels(meta){const out=[];for(let n=0;n<=meta.lastLevel;n++){const width=Math.max(1,Math.floor(meta.width/2**n)),height=Math.max(1,Math.floor(meta.height/2**n));out.push({level:n,width,height,byteLength:width*height*4});}return out;}
export function image(format,width,height,level,seed=0x243f6a88){
  const bytes=new Uint8Array(width*height*4),native=[],v=new DataView(bytes.buffer);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,r=(seed+17*x+31*y+53*level)>>>0,g=(seed+71*x+11*y+97*level)>>>0,b=(seed+41*x+83*y+19*level)>>>0,a=(seed+23*x+61*y+37*level)>>>0;
    if(format===233){const rr=r%1024,gg=g%1024,bb=b%1024;v.setUint32(i*4,(bb+gg*1024+rr*1048576+(a%4)*1073741824)>>>0,true);native.push((rr+gg*1024+bb*1048576+3221225472)>>>0);}
    else {bytes.set(format===2?[b&255,g&255,r&255,a&255]:[r&255,g&255,b&255,a&255],i*4);native.push(...[r&255,g&255,b&255,format===2?255:a&255]);}
  }
  return {bytes,native};
}
export function canonical(format,input){const b=new Uint8Array(input);if(format===2)for(let i=3;i<b.length;i+=4)b[i]=255;if(format===233)for(let i=3;i<b.length;i+=4)b[i]|=192;return b;}
export function padded(input,width,height,offset=5,stride=width*4+3){const out=new Uint8Array(offset+(height-1)*stride+width*4).fill(0xa7);for(let y=0;y<height;y++)out.set(input.subarray(y*width*4,(y+1)*width*4),offset+y*stride);return out;}
export function nativeFromGuest(format,bytes){const out=[];if(format===233){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<bytes.length;i+=4){const w=v.getUint32(i,true),b=w%1024,g=Math.floor(w/1024)%1024,r=Math.floor(w/1048576)%1024;out.push((r+g*1024+b*1048576+3221225472)>>>0);}}else for(let i=0;i<bytes.length;i+=4)out.push(...(format===2?[bytes[i+2],bytes[i+1],bytes[i],255]:bytes.subarray(i,i+4)));return out;}
export function originalTransfer(wire){const b=unhex(wire),v=new DataView(b.buffer),header=v.getUint32(0,true),op=header&255,n=header>>>16;if(b.length!==(n+1)*4||![9,43,45].includes(op))throw Error('invalid original transfer');const w=Array.from({length:n},(_,i)=>v.getUint32(4+i*4,true));return {op,id:w[0],level:w[1],usage:w[2],stride:w[3],layerStride:w[4],box:{x:w[5],y:w[6],z:w[7],width:w[8],height:w[9],depth:w[10]},...(op===9?{dataWords:w.slice(11)}:op===43?{offset:w[11],direction:w[12]}:{staging:w[11],offset:w[12],flags:w[13]})};}
