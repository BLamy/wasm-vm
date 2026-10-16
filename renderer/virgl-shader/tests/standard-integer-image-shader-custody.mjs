import {runAcceptance as originalAcceptance} from './standard-integer-image-shader-browser.mjs';

const need=(value,message)=>{if(!value)throw Error(message);};

// Record identities on the actual native methods, without replacing their results.
export async function runAcceptance(options){
 const prototype=WebGL2RenderingContext.prototype,names=['fenceSync','clientWaitSync','deleteSync','readPixels'];
 const methods=Object.fromEntries(names.map(name=>[name,prototype[name]])),identities=new WeakMap(),ledger=[];
 let report,event=0;
 try{
  prototype.fenceSync=function(...args){
   const sync=methods.fenceSync.apply(this,args);
   need(sync instanceof WebGLSync&&this.isSync(sync),'actual native WebGLSync');
   need(!identities.has(sync),'distinct actual native fence object');
   const current=window.__integerImageShaderReport,frame=current.frames.at(-1),program=this.getParameter(this.CURRENT_PROGRAM);
   const row={id:ledger.length+1,frame:current.frames.length-1,nativeClass:sync.constructor.name,created:this.isSync(sync),createdAt:++event,condition:args[0],flags:args[1],polls:[],reads:[],retired:false,
    imageState:{unit:this.getParameter(this.ACTIVE_TEXTURE)-this.TEXTURE0,base:this.getTexParameter(this.TEXTURE_2D,this.TEXTURE_BASE_LEVEL),max:this.getTexParameter(this.TEXTURE_2D,this.TEXTURE_MAX_LEVEL),immutableLevels:this.getTexParameter(this.TEXTURE_2D,this.TEXTURE_IMMUTABLE_LEVELS)},
    samplers:frame.samplers.map(s=>{const location=this.getUniformLocation(program,s.name),index=this.getUniformIndices(program,[s.name])[0];return {name:s.name,active:location!==null,unit:location===null?null:this.getUniform(program,location),type:location===null?null:this.getActiveUniforms(program,[index],this.UNIFORM_TYPE)[0],size:location===null?null:this.getActiveUniforms(program,[index],this.UNIFORM_SIZE)[0]};}),
    queries:frame.queries.map(q=>{const location=this.getUniformLocation(program,q.name),index=this.getUniformIndices(program,[q.name])[0];return {name:q.name,type:this.getActiveUniforms(program,[index],this.UNIFORM_TYPE)[0],actualLevels:this.getUniform(program,location)};}),
    outputs:frame.outputs.map(o=>({location:o.location,actualLocation:this.getFragDataLocation(program,'fsout_c'+o.location)}))};
   identities.set(sync,row);ledger.push(row);frame.nativeFenceId=row.id;return sync;
  };
  prototype.clientWaitSync=function(sync,flags,timeout){
   const row=identities.get(sync);need(row&&!row.retired,'live identified native fence');
   const status=methods.clientWaitSync.call(this,sync,flags,timeout);row.polls.push({event:++event,flags,timeout,status});return status;
  };
  prototype.deleteSync=function(sync){
   const row=identities.get(sync);need(row&&!row.retired,'delete identified native fence');
   const value=methods.deleteSync.call(this,sync);row.retired=!this.isSync(sync);row.retiredAt=++event;return value;
  };
  prototype.readPixels=function(x,y,width,height,format,type,...rest){
   const row=ledger.at(-1);need(row?.retired&&[0x911a,0x911c].includes(row.polls.at(-1)?.status),'read after identified successful physical completion');
   const value=methods.readPixels.call(this,x,y,width,height,format,type,...rest);
   row.reads.push({event:++event,afterCompletedFence:row.id,x,y,width,height,format,type});return value;
  };
  report=await originalAcceptance(options);report.nativeFenceCustody=ledger;
  need(ledger.length===report.frames.length&&new Set(ledger.map(row=>row.id)).size===ledger.length,'complete unique native fence custody');
  for(const [index,row]of ledger.entries()){
   const frame=report.frames[index],last=row.polls.at(-1);
   need(row.frame===index&&frame.nativeFenceId===row.id&&row.created&&row.retired&&row.polls.length===frame.gpuComplete.waits,'identified native draw completion');
   need(last.status===frame.gpuComplete.status&&[0x911a,0x911c].includes(last.status),'actual native successful completion state');
  }
  return report;
 }finally{
  for(const name of names)prototype[name]=methods[name];
  if(!report&&window.__integerImageShaderReport)window.__integerImageShaderReport.nativeFenceCustody=ledger;
 }
}
