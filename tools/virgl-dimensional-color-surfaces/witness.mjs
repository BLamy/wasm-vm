// Complete original texel coordinates and bit expectations; no native shader readback input.
export function witness(f,{first=0,last=2,firstLayer=0,lastLayer=f.source.arraySize-1}={}){
 const texels=[],coordinates=[];
 for(const p of f.levels.filter(p=>p.level>=first&&p.level<=last)){
  const lo=f.target===7?firstLayer:0,hi=f.target===7?lastLayer:p.layers-1;
  for(let z=lo;z<=hi;z++)for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
   const u=(x+.5)/p.width,v=(y+.5)/p.height,lod=p.level-first;
   let c;
   if(f.target===4){const a=2*u-1,b=2*v-1;c=[[1,-b,-a],[-1,-b,a],[a,1,b],[a,-1,-b],[a,-b,1],[-a,-b,-1]][z];}
   else c=[u,v,f.target===3?(z+.5)/p.layers:z-firstLayer];
   coordinates.push(...c,lod);texels.push({level:p.level,layer:z,x,y,byteOffset:((z*p.height+y)*p.width+x)*4});
  }
 }
 const width=64,height=Math.ceil(texels.length/width),positions=[];
 for(let i=0;i<texels.length;i++)positions.push((2*(i%width)+1)/width-1,(2*Math.floor(i/width)+1)/height-1,0,1);
 return {first,last,firstLayer,lastLayer,width,height,texels,positions:new Uint8Array(new Float32Array(positions).buffer),coordinates:new Uint8Array(new Float32Array(coordinates).buffer)};
}
export function witnessWords(w,planes,zero=false){
 const words=new Uint32Array(w.width*w.height*4);
 if(!zero)for(const [i,t]of w.texels.entries()){
  const p=planes.find(p=>p.level===t.level);
  for(let lane=0;lane<4;lane++){
   const byte=p.bytes[t.byteOffset+lane];
   if(byte!==0&&byte!==255)throw Error('Exact witness requires original binary color bytes.');
   words[i*4+lane]=byte?0x3f800000:0;
  }
 }
 return new Uint8Array(words.buffer);
}
