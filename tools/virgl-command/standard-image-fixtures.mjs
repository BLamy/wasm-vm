/** Original image words and literal color planes, independent of the renderer. */
import {packet,join,meta,shader,clear} from '../../renderer/virgl-command/tests/standard-instanced-draws.mjs';
import {sampler,bind,draw,word,specimen} from './standard-sampler-fixtures.mjs';
import {image,levels,hex,unhex,nativeFromGuest} from './standard-texture-fixtures.mjs';
export {packet,join,meta,shader,clear,sampler,bind,draw,word,specimen,image,levels,hex,unhex,nativeFromGuest};
export const imageView=(handle,id,format,first,last,swizzle=[0,1,2,3])=>packet(1,6,[handle,id,format|2<<24,0,first|last<<8,swizzle.reduce((n,k,i)=>n|k<<i*3,0)]);
export const surface=(handle,id,format,level)=>packet(1,8,[handle,id,format,level,0]);
export const textureTransfer=(id,level,w,h,offset=0,stride=0)=>packet(43,0,[id,level,0,stride,stride?stride*h:0,0,0,0,w,h,1,offset,1]);
export const shapes=[[8,4],[7,5],[1,9],[13,1]];
export function source(width,height,format,seed,lastLevel=Math.floor(Math.log2(Math.max(width,height)))){
 const metadata={...meta(6,2,format,10,width,height),lastLevel},planes=levels(metadata).map(l=>({...l,input:image(format,l.width,l.height,l.level,seed).bytes}));let length=5;
 for(const p of planes){p.offset=length;p.stride=p.width*4+3;length+=(p.height-1)*p.stride+p.width*4+5;}
 const backing=new Uint8Array(length).fill(0x17);for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
 return{metadata,planes,backing};
}
export function statePackets(s,src){return join(textureTransfer(3,0,s.positions.length,1),...src.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),shader(1,0,s.vertex),shader(2,1,s.fragment),packet(1,5,[3,0,0,0,31]),packet(2,5,[3]),packet(6,0,[16,0,3]),surface(4,1,67,0),packet(5,0,[1,0,4]),packet(4,0,[0,...[s.width/2,s.height/2,.5,s.width/2,s.height/2,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));}
function rgba(format,bytes,index){const at=index*4;if(format===233){const w=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at,true);return[(w>>>20&1023)*255/1023,(w>>>10&1023)*255/1023,(w&1023)*255/1023,255];}return format===2?[bytes[at+2],bytes[at+1],bytes[at],255]:[...bytes.subarray(at,at+4)];}
export function lookup(src,range,lod,p,swizzle=[0,1,2,3],coord=[.25,.25]){
 const maximum=range[1]-range[0],lambda=Math.min(p.maxLod,Math.max(p.minLod,lod)),magnify=lambda<=0,filter=magnify?p.mag:p.min;
 const texel=(plane,x,y)=>rgba(src.metadata.format,plane.input,Math.min(plane.height-1,Math.max(0,y))*plane.width+Math.min(plane.width-1,Math.max(0,x)));
 const at=local=>{const plane=src.planes[range[0]+local],x=coord[0]*plane.width,y=coord[1]*plane.height;if(!filter)return texel(plane,Math.floor(x),Math.floor(y));const u=x-.5,v=y-.5,a=Math.floor(u),b=Math.floor(v),fx=u-a,fy=v-b,neighbors=[texel(plane,a,b),texel(plane,a+1,b),texel(plane,a,b+1),texel(plane,a+1,b+1)];return[0,1,2,3].map(k=>(1-fx)*(1-fy)*neighbors[0][k]+fx*(1-fy)*neighbors[1][k]+(1-fx)*fy*neighbors[2][k]+fx*fy*neighbors[3][k]);};
 let color;if(magnify||p.mip===2)color=at(0);else if(p.mip===0)color=at(Math.min(maximum,Math.max(0,Math.floor(lambda+.5))));else{const l=Math.min(maximum,Math.max(0,lambda)),a=Math.floor(l),b=Math.min(maximum,a+1),f=l-a,x=at(a),y=at(b);color=x.map((n,k)=>n*(1-f)+y[k]*f);}
 return swizzle.map(k=>k===4?0:k===5?255:color[k]);
}
export function originalPixels(src,vsRange,fsRange,p,vertexSwizzle=[0,1,2,3],fragmentSwizzle=[0,1,2,3],width=8,height=8){const a=lookup(src,vsRange,0,p,vertexSwizzle),b=lookup(src,fsRange,0,p,fragmentSwizzle),color=a.map((n,k)=>Math.max(0,Math.min(255,Math.round((n+b[k])/2)))),pixels=new Uint8Array(width*height*4);for(let i=0;i<width*height;i++)pixels.set(color,i*4);return{pixels,color};}
