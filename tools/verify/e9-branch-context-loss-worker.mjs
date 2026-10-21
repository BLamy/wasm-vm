// Observe the real worker's WebGL context and inject a browser context-loss event.
// All machine, renderer, recording and publication code remains the production import.
let observed;
const getContext=OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext=function(...args){
 const context=getContext.apply(this,args);
 if(args[0]==='webgl2'&&context)observed={canvas:this,context};
 return context;
};
addEventListener('message',event=>{
 if(event.data?.type!=='verify-branch-context-loss')return;
 event.stopImmediatePropagation();
 const id=event.data.id,extension=observed?.context.getExtension('WEBGL_lose_context');
 if(!extension){postMessage({type:'verify-branch-context-lost',id,error:'real WebGL context/loss extension missing'});return;}
 observed.canvas.addEventListener('webglcontextlost',()=>postMessage({type:'verify-branch-context-lost',id,lost:observed.context.isContextLost()}),{once:true});
 extension.loseContext();
});
await import('/session-gpu-branch-worker.js');
