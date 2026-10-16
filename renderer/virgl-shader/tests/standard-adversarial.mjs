// Promoted fresh verifier test. CPU predictions never depend on emitted ESSL.
import {createVirglStandardShaderBridge} from '../standard.mjs';
import {draw} from './standard-browser.mjs';
export async function runAcceptance({planPath,fault=null}) {
 const report={status:'running',guestExecution:false,productionNegotiation:false,frames:[],fault};window.__standardCriticReport=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('hardware float context unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
 if(/software|swiftshader|llvmpipe|softpipe/i.test(report.renderer))throw Error('hardware context required');
 const plans=await(await fetch(planPath)).json(),bridge=await createVirglStandardShaderBridge();
 for(const plan of plans){
  const pair=bridge.translatePair({vertexText:plan.vertexText,fragmentText:plan.fragmentText});if(!pair.ok)throw Error('novel standard pair failed: '+JSON.stringify(pair));
  if(fault==='sine'){
   if(!pair.fragment.glsl.includes('sin('))throw Error('mutation site missing');
   pair.fragment={...pair.fragment,glsl:pair.fragment.glsl.replace('sin(','cos(')};
  }
  if(fault==='oracle')plan.expected=plan.expected.map((x,i)=>x+(i===0?.125:0));
  await draw(gl,pair,{...plan,name:'critic-dynamic-'+plan.stage+'-'+plan.seed,fixture:{kind:'critic-dynamic',seed:plan.seed,a:plan.a,scale:plan.scale,base:plan.base},expected:()=>plan.expected},report,null);
 }
 report.status='passed';document.querySelector('#status').textContent=plans.length+' independently predicted adversarial dynamic draws passed';document.querySelector('#renderer').textContent=report.renderer;return report;
}
