// Direct retained anchors, with the historical bodies and BigInt oracle intact.
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {reference} from '../../renderer/virgl-shader/tests/raw-bits.mjs';
import {draw} from '../../renderer/virgl-shader/tests/standard-browser.mjs';
const require=(v,m)=>{if(!v)throw new Error(m);};
export async function runAcceptance(){
 const report={status:'running',productionNegotiation:false,guestExecution:false,frames:[]};window.__retainedRawReport=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 require(gl&&gl.getExtension('EXT_color_buffer_float'),'physical float readback');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware renderer identity');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer),'physical GPU');
 const fixture=await(await fetch('/renderer/virgl-shader/tests/raw-bit-hardware.json')).json(),bridge=await createVirglShaderBridge();
 const vertexText='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
 const a=[0xffffffff,0x80000000,0x7fffffff,0x7fc00001],b=[0,1,31,32];
 for(const op of ['mov','and','or','not','shl','ushr']){
  const fragmentText=fixture.shaders.find(s=>s.name===`raw-${op}-fragment`).text;
  const pair=bridge.translatePair({vertexText,fragmentText});require(pair.ok&&pair.fragment.metadata.profile==='virgl-webgl2-raw-bits-v1','unchanged exact raw backend');
  const expectedWords=reference(op,a,b);
  for(const count of [0,1,7,15,23,31,32]){
   const bank=Array(184).fill(0);bank.splice(0,4,...a);bank.splice(176,4,count,count,count,count);bank.splice(180,4,...b);
   const expected=expectedWords.map(n=>Number((BigInt(n)>>BigInt(count&31))&1n));
   await draw(gl,pair,{name:`retained-${op}-${count}`,width:4,height:4,vertexText,fragmentText,fragmentWords:bank,budget:0,fixture:{op,a,b,count,expectedWords},expected:()=>expected},report,null);
  }
 }
 report.status='passed';return report;
}
