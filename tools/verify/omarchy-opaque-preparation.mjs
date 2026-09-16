// Offline original-resolution preparation. This module never sends physical input.
import assert from "node:assert/strict";
import { withinTrialDeadline, assertInputTrialRuntime } from "./omarchy-input-trial.mjs";
import { modePreparationOptions, MODE_EXPORT_MS } from "./omarchy-mode-preparation.mjs";
import { requestOpaqueFoot, assertOriginalPresentation } from "./omarchy-opaque-foot-command.mjs";

export const ACTIVE_FOOT_COMMAND = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow";
export function opaqueTerminalPixels(pixels, canvasWidth, canvasHeight, foot) {
  assert.ok(pixels.length === canvasWidth * canvasHeight * 4);
  assert.ok(canvasWidth === 1280 && canvasHeight === 800);
  assert.ok(foot?.class === "foot" && foot.mapped && !foot.hidden && foot.address);
  const [x,y] = foot.at, [width,height] = foot.size;
  assert.ok([x,y,width,height].every(Number.isFinite));
  assert.ok(x >= 0 && y >= 26 && width >= 200 && height >= 100 && x+width <= 1280 && y+height <= 800);
  let bright = 0; const colors = new Set();
  // Native Canvas2D coordinates; exclude the bar, border and terminal margins.
  for (let py=Math.ceil(y+10); py<Math.floor(y+55); py++) {
    for (let px=Math.ceil(x+12); px<Math.floor(x+Math.min(width-12,300)); px++) {
      const i=(py*canvasWidth+px)*4, r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      if (pixels[i+3] && Math.max(r,g,b)>140) { bright++; colors.add((r<<16)|(g<<8)|b); }
    }
  }
  return { brightPixels: bright, brightColors: colors.size, nonblank: bright >= 80 && colors.size >= 8 };
}

export async function prepareOpaqueDesktop(page, deadline, report, { exec, observeRuntime, screenshot, capturePair }) {
  const call=(fn,label)=>withinTrialDeadline(fn,deadline,`opaque preparation: ${label}`);
  const receipt=report.modePreparation={purpose:"offline-opaque-preparation-no-input",startedAt:new Date().toISOString(),
    deadlineAt:new Date(deadline).toISOString(),status:"preparing",keyboardTested:false};
  try {
    assert.equal(report.restored,true);
    receipt.runtimeBefore=await call(()=>observeRuntime("opaque-preparation-before"),"runtime");
    assertInputTrialRuntime(receipt.runtimeBefore,modePreparationOptions());
    assertOriginalPresentation(receipt.runtimeBefore.presentation);
    report.opaqueFootRequested=true;
    await requestOpaqueFoot((command,ms)=>exec(command,"opaque-preparation:configure",ms),deadline,report);
    const active=await call(()=>exec(ACTIVE_FOOT_COMMAND,"opaque-preparation:active",deadline-Date.now()),"active Foot");
    assert.equal(active.exit,0); receipt.foot=JSON.parse(active.stdout);
    receipt.presentationBaseline=await call(()=>page.evaluate(()=>window.__presentation.state()),"post-property baseline");
    receipt.baselineAt=new Date().toISOString();
    assertOriginalPresentation(receipt.presentationBaseline);
    const pixelCheck=opaqueTerminalPixels.toString();
    while (true) {
      const observed=await call(()=>page.evaluate(({foot,pixelCheck})=>{
        const state=window.__presentation.state(), pixels=window.__presentation.readPixels();
        if(state.backend!=="canvas2d")throw Error("opaque preparation requires native Canvas2D pixels");
        const assert={ok:value=>{if(!value)throw Error("invalid original terminal pixel geometry");}};
        const inspect=eval(`(${pixelCheck})`);
        return {state,pixels:inspect(pixels,state.width,state.height,foot)};
      },{foot:receipt.foot,pixelCheck}),"terminal pixels");
      receipt.lastPixels=observed; assertOriginalPresentation(observed.state);
      if(observed.pixels.nonblank && observed.state.framesReceived>receipt.presentationBaseline.framesReceived &&
        observed.state.successfulPresents>receipt.presentationBaseline.successfulPresents)break;
      console.log(`OMARCHY_OPAQUE_PREPARATION ${JSON.stringify({at:new Date().toISOString(),...observed.pixels,frames:observed.state.framesReceived})}`);
      await call(()=>new Promise(resolve=>setTimeout(resolve,5000)),"wait for visible Foot");
    }
    receipt.runtimeAfter=await call(()=>observeRuntime("opaque-preparation-ready"),"ready runtime");
    assertInputTrialRuntime(receipt.runtimeAfter,modePreparationOptions());
    assertOriginalPresentation(receipt.runtimeAfter.presentation);
    await call(()=>screenshot("prepared-desktop.png"),"ready image");
    receipt.visibleAt=new Date().toISOString();
    const exportDeadline=Date.now()+MODE_EXPORT_MS;
    receipt.exportStartedAt=new Date(exportDeadline-MODE_EXPORT_MS).toISOString();
    receipt.exportDeadlineAt=new Date(exportDeadline).toISOString();
    await withinTrialDeadline(capturePair,exportDeadline,"opaque coherent export");
    receipt.exportFinishedAt=new Date().toISOString(); receipt.status="pair-captured-input-untested";
  } catch(error){receipt.status="preparation-failed-input-untested";receipt.error=String(error);throw error;}
  finally{receipt.finishedAt=new Date().toISOString();}
}
