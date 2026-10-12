import {shadowFixtures,inputBytes,expectedWords,originalSamplerWords,pairTexts} from '../virgl-shadow-shaders/fixtures.mjs';
import {packet,join,shader,word,imageView,surface,textureTransfer,metadata} from '../virgl-floating-depth-consumer/fixtures.mjs';
export {packet,join,shader,word,imageView,surface,textureTransfer,metadata};
export const BASE='4e924b694715ec40e653e2e0c87ecc49c929d040';
export function cases({smoke=false,mode='matrix',seed=0x493a170d}={}){
 if(mode==='query-only')return ['vertex','fragment'].map(stage=>({name:stage+'/shadow-query-only',stage,opcode:'TXQ',slot:7,swizzle:[5,4,0,3],filter:'linear',compareFunction:3,format:18,firstLevel:0,lastLevel:2,step:1}));
 if(mode==='formats'){const upper= [16,20,21,126].flatMap(format=>['vertex','fragment'].flatMap(stage=>['TEX','TXL','TXD','TXP',...(stage==='fragment'?['TXB']:[])].flatMap(opcode=>[0,1,2,3,4,5,6,7].map(compareFunction=>({name:`${stage}/depth${format}/${opcode}/fn${compareFunction}`,stage,opcode,slot:compareFunction%2?15:7,swizzle:compareFunction%2?[3,4,5,0]:[0,1,2,3],filter:compareFunction%2?'linear':'nearest',compareFunction,format,firstLevel:0,lastLevel:2,step:1,delay:(Math.imul(seed,compareFunction+1)>>>0)%4})))));return upper.concat(upper.filter(f=>[16,20,21].includes(f.format)&&['TEX','TXP'].includes(f.opcode)).map(f=>({...f,name:f.name+'/lower-endpoint',lowerEndpoint:true})));}
 if(mode==='mips')return ['vertex','fragment'].flatMap(stage=>['TEX','TXL','TXD','TXP',...(stage==='fragment'?['TXB']:[])].map(opcode=>({name:stage+'/private-range/'+opcode,stage,opcode,slot:7,swizzle:[0,5,4,1],filter:'nearest',compareFunction:3,format:18,firstLevel:1,lastLevel:3,step:1,delay:(seed>>>0)%4})));
 if(mode==='typed')return [196,200].flatMap(format=>[[0,1,2,3],[3,4,5,0]].map(swizzle=>({name:`typed/${format}/${swizzle.join('')}`,stage:'fragment',opcode:'TEX',slot:7,swizzle,filter:'nearest',compareFunction:7,format,typed:true,firstLevel:0,lastLevel:2,step:1})));
 if(mode==='bindings'||mode==='refusals'||mode==='reflection'||mode==='boundaries'||mode==='same-image')return [{name:mode,stage:'fragment',opcode:'TEX',slot:7,swizzle:[0,4,5,3],filter:'nearest',compareFunction:7,format:18,firstLevel:0,lastLevel:2,step:1,delay:(seed>>>0)%4,...(mode==='bindings'?{crossStage:true}:{})}];
 const all=shadowFixtures().filter(f=>!f.packed&&!f.ids&&!f.biasProbe);
 const selected=all.filter(f=>smoke?f.opcode==='TEX'&&f.slot===0&&f.filter==='nearest'&&f.swizzle.join('')==='0123':
  f.opcode==='TEX'&&f.slot===0&&f.filter==='nearest'&&f.swizzle.join('')==='0123'||f.compareFunction===3||f.query||f.mask||f.source);
 return selected.map((f,i)=>({...f,format:18,firstLevel:0,lastLevel:2,delay:i%3,step:i%2?1:64}));
}
export function fixture(f){const input=inputBytes(f),positions=input.positions,inputs=[positions,input.coordinates,input.dx,input.dy],format=f.format??18,bpp=f.typed?16:format===126?8:format===16?2:4,endpoint=[16,20,21].includes(format);
 if(endpoint){const dv=new DataView(inputs[1].buffer);for(let i=0;i<input.width*input.height;i++){const q=f.opcode==='TXP'?2:1;dv.setFloat32(i*16+8,(f.lowerEndpoint?[-.25,0,.25]:[.75,1,1.25])[i%3]*q,true);}}
 const levels=input.levels.map(p=>({...p,level:p.level+f.firstLevel}));if(f.firstLevel)levels.unshift({level:0,width:8,height:4,bytes:new Uint8Array(new Float32Array(32).fill(.125).buffer)});
 const planes=levels.map(p=>{const bytes=new Uint8Array(p.width*p.height*bpp),v=new DataView(bytes.buffer),old=new DataView(p.bytes.buffer);for(let i=0;i<p.width*p.height;i++){const z=endpoint?(f.lowerEndpoint?0:1):old.getFloat32(i*4,true);if(f.typed)[1,0xffffffff,0x80000000,0xdeadbeef].forEach((word,j)=>v.setUint32(i*16+j*4,word,true));else if(format===16)v.setUint16(i*2,Math.round(z*65535),true);else if(format===20)v.setUint32(i*4,(Math.round(z*0xffffff)<<8)|37,true);else if(format===21)v.setUint32(i*4,Math.round(z*0xffffff)|(73<<24),true);else {v.setFloat32(i*bpp,z,true);if(format===126)bytes[i*bpp+4]=93;}}return{level:p.level,width:p.width,height:p.height,input:bytes,stride:p.width*bpp+7,offset:5+p.level*200};}),backing=new Uint8Array(2000).fill(0xa7);
 for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*bpp,(y+1)*p.width*bpp),p.offset+y*p.stride);
 return {...f,...input,inputs,sourceExpression:f.source,source:{metadata:metadata(6,format,levels[0].width,levels[0].height,levels.at(-1).level,f.typed?8:9),backing,planes},target:metadata(1,196,input.width,input.height,0,2),...pairTexts(f.stage,f)};}
export function setup(f){return join(...f.inputs.map((bytes,i)=>textureTransfer([3,4,5,7][i],0,bytes.length,1)),...f.source.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),
 shader(10,0,f.vertexText),shader(11,1,f.fragmentText),packet(1,5,[12,...f.inputs.flatMap((_,i)=>[0,0,i,31])]),packet(2,5,[12]),packet(6,0,f.inputs.flatMap((_,i)=>[16,0,[3,4,5,7][i]])),surface(20,1,196,0),packet(5,0,[1,0,20]),
 packet(4,0,[0,...[f.width/2,f.height/2,.5,f.width/2,f.height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),
 packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]));}
export function view(f,{viewHandle=51,stateHandle=50,mode=1,compare=f.compareFunction,resource=6,format=f.format,swizzle=f.swizzle}={}){
 const words=originalSamplerWords({...f,compareFunction:compare}).slice(1);words[0]=stateHandle;words[1]=(words[1]&~(1<<15))|(mode<<15);
 return join(packet(1,7,words),imageView(viewHandle,resource,format,f.firstLevel,f.lastLevel,swizzle),packet(10,0,[f.stage==='vertex'?0:1,f.slot,viewHandle]),packet(18,0,[f.stage==='vertex'?0:1,f.slot,stateHandle]));}
export const draw=f=>packet(8,0,[0,f.inputs[0].length/16,f.biasProbe?4:0,0,1,0,0,0,0,0,0xffffffff,0]);
export function expected(f){const out=new Uint32Array(f.width*f.height*4);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){let words=expectedWords({...f,source:f.sourceExpression},x,y);
 if(f.opcode==='TXQ')words=[4,2,0,3];
 if([16,20,21].includes(f.format)){const ref=Math.min(1,Math.max(0,(f.lowerEndpoint?[-.25,0,.25]:[.75,1,1.25])[x])),z=f.lowerEndpoint?0:1,value=Number([false,ref<z,ref===z,ref<=z,ref>z,ref!==z,ref>=z,true][f.compareFunction]);words=f.swizzle.map(c=>word(c===4?0:c===5?1:value));}
 if(f.crossStage)words=[0,x===0?word(1):0,word(1),x===0?0:word(1)];
 if(f.typed)words=f.swizzle.map(c=>c===4?0:c===5?1:[1,0xffffffff,0x80000000,0xdeadbeef][c]);
 if(f.sameImage)words=[words[0],word(.5),0,word(1)];out.set(words,(y*f.width+x)*4);} ;return new Uint8Array(out.buffer);}
