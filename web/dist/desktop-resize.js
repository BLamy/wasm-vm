import { startLinuxBootWorker, stopLinuxController } from "./linux-worker-host.js";
import { PresentationController } from "./src/sink/presentation.js";
import { DisplayViewportController } from "./src/sink/viewport.js";
import { createPointerBridge, createWasmPointerAdapter, attachPointerBridge } from "./src/input/pointer.js";
import { createKeyboardBridge, createWasmKeyboardAdapter } from "./src/input/keyboard.js";
import { attachKeyboardCapture, createKeyboardCapturePolicy } from "./src/input/capture.js";
import { createKeyboardReconciler } from "./src/input/reconciliation.js";
import { desktopRecoveryOptions } from "./src/input/desktop-recovery-policy.js";

const query=new URLSearchParams(location.search);
const {test,bootargs}=desktopRecoveryOptions(location.search,location.hostname);
const container=document.getElementById("viewport"),status=document.getElementById("status");
const paints=[];
const presentation=new PresentationController(document.getElementById("desktop-canvas"),{
  scheduleFrames:true,
  requestFrame:callback=>requestAnimationFrame(ms=>{
    callback(ms);
    const state=presentation.snapshot(),last=paints.at(-1);
    if(!state.sizeMismatch&&state.latest&&(!last||last.width!==state.width||last.height!==state.height)){
      paints.push({ms:performance.now(),width:state.width,height:state.height,presents:state.successfulPresents});
      if(paints.length>512)paints.shift();
    }
  }),
});
const width=Number(query.get("width")||1280),height=Number(query.get("height")||800);
if(Number.isInteger(width)&&width>=320&&width<=4095)container.style.width=width+"px";
if(Number.isInteger(height)&&height>=240&&height<=4095)container.style.height=height+"px";
const viewport=new DisplayViewportController({container,presentation});
let controller=null,serial="",frames=0,error=null,disposed=false;
let detachPointer=()=>{},detachKeyboard=()=>{};
const modes=[],decoder=new TextDecoder();
function state(){return{frames,error,disposed,viewport:viewport.snapshot(),presentation:presentation.snapshot(),modes:[...modes],paints:[...paints]};}
async function command(verb){
  if(!test||!controller||!["status","log","display","display-watch","display-client"].includes(verb))throw Error("local display proof command unavailable");
  await controller.sendInput(new TextEncoder().encode(verb+"\n"));
}
async function dispose(){
  if(disposed)return;disposed=true;viewport.dispose();detachPointer();detachKeyboard();
  await stopLinuxController(controller);controller=null;presentation.dispose();
}
window.desktopResize={state,serial:()=>serial,command,dispose,presentation,viewport,
  controller:()=>controller,ready:false};
try{
  controller=await startLinuxBootWorker({
    manifestUrl:query.get("manifestUrl")||"./artifacts-alpine.json",mode:"chunked",
    imageManifestUrl:query.get("imageManifestUrl")||"./e5t22c-desktop/manifest.json",
    baseUrl:query.get("baseUrl")||"./e5t22c-desktop/",ramMib:256,bootargs,
    // The selected desktop has no recorded prefetch profile. Do not request the
    // unrelated headless Alpine profile (or silently tolerate its HTTP failure).
    bootProfileUrl:null,
    profile:test&&query.get("profile")==="1",
    bootSnapshot:false,persist:false,slirpNet:false,startPaused:true,
    fastInterpreter:true,jit:query.get("jit")!=="0",quantum:500000,
    onOutput(bytes){serial=(serial+decoder.decode(bytes,{stream:true})).slice(-1000000);document.getElementById("serial").textContent=serial.slice(-12000);},
    onDisplayFrame(frame){
      frames++;const last=modes.at(-1);
      if(!last||last.width!==frame.resourceWidth||last.height!==frame.resourceHeight){
        modes.push({ms:performance.now(),width:frame.resourceWidth,height:frame.resourceHeight,frame:frames});
        if(modes.length>512)modes.shift();
      }
      presentation.present(frame);viewport.applyCanvasStyle();
      status.textContent=`${frame.resourceWidth}×${frame.resourceHeight} guest · ${presentation.canvas.width}×${presentation.canvas.height} target · ${frames} frames`;
    },
    onError(failure){error=String(failure);status.textContent=error;},
  });
  if(disposed){await stopLinuxController(controller);controller=null;}
  else {
  const pointer=createPointerBridge(createWasmPointerAdapter(controller),{target:container,documentTarget:document,
    windowTarget:window,absoluteButtonDevice:"mouse",serializeTransport:true,isReady:()=>!!controller&&!disposed,
    getRect:()=>viewport.pointerRect()});
  detachPointer=attachPointerBridge(container,pointer,{documentTarget:document,windowTarget:window,capture:true,preventDefault:true});
  const keyboard=createKeyboardBridge(createWasmKeyboardAdapter(controller));
  const reconciler=createKeyboardReconciler(keyboard);
  const capture=createKeyboardCapturePolicy({initialCaptured:true,onGuestEvent:event=>reconciler.handleKeyEvent(event)});
  detachKeyboard=attachKeyboardCapture(container,capture,{capture:true});
  // Initial mode reaches the real GPU before the first guest instruction runs.
  await viewport.setController(controller);
  if(!disposed){await controller.resume();window.desktopResize.ready=true;container.focus();}
  }
}catch(failure){error=String(failure);status.textContent=error;}
addEventListener("beforeunload",()=>{void dispose();});
