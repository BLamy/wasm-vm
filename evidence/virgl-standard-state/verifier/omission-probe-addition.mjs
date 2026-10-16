
export async function runOmissionProbe(plans){
 const gl=document.querySelector('canvas').getContext('webgl2'),original=await createVirglStandardShaderBridge(),spec=plans[0].specimen,rows=[];
 for(const field of ['uniforms','samplers']){
  const compiler={...original,translate(request){const out=cp(original.translate(request));if(out.ok&&request.stage==='fragment')out.metadata[field]=[];return out;},translatePair(request){const out=cp(original.translatePair(request));if(out.ok)out.fragment.metadata[field]=[];return out;}};
  const r=rig(gl,compiler,2,3);for(let i=0;i<4;i++)r.add(meta(5+i,2,67,8,2,2),new Uint8Array(spec.images[i]));
  const rec=await submit(r,1,join(setup(spec),draw(),transfer(1,8,8,2)),'critic-omitted-'+field);
  const draws=r.t.events.filter(x=>x.name==='drawArrays'||x.name==='drawElements');
  rows.push({field,prediction:{ok:false,nativeDraws:0},held:!rec.result.ok&&draws.length===0,result:rec.result,nativeDraws:draws,history:r.history,events:r.t.events,output:rec.output,native:draws.length?native(gl,r):null,compilerStage:compiler.translate({stage:'fragment',text:spec.fragment}),compilerPair:compiler.translatePair({vertexText:spec.vertex,fragmentText:spec.fragment})});
  finish(r);
 }
 return {schema:1,status:rows.every(x=>x.held)?'passed':'failed',cases:rows};
}
