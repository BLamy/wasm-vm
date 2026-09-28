// Offline direct-property preparation. No keyboard/nonce acceptance is performed here.
import assert from "node:assert/strict";
import { withinTrialDeadline, assertInputTrialRuntime } from "./omarchy-input-trial.mjs";
import { modePreparationOptions, MODE_EXPORT_MS } from "./omarchy-mode-preparation.mjs";
import { assertOriginalPresentation } from "./omarchy-opaque-foot-command.mjs";
import { requestDirectOpaque } from "./omarchy-direct-opaque-command.mjs";
import { opaqueTerminalPixels } from "./omarchy-opaque-preparation.mjs";
import { assertOriginalInputGeometry } from "./omarchy-compositor-input-capture.mjs";

export async function prepareDirectOpaqueDesktop(page, deadline, report, { exec, observeRuntime, screenshot, capturePair }) {
  const assertPresentation = report.inputKernel ? assertOriginalInputGeometry : assertOriginalPresentation;
  const call=(fn,label)=>withinTrialDeadline(fn,deadline,`direct opaque preparation: ${label}`);
  const receipt=report.modePreparation={purpose:"offline-direct-opaque-preparation-no-input",startedAt:new Date().toISOString(),
    deadlineAt:new Date(deadline).toISOString(),status:"preparing",keyboardTested:false};
  try {
    assert.equal(report.restored,true);
    receipt.runtimeBefore=await call(()=>observeRuntime("direct-opaque-preparation-before"),"runtime");
    assertInputTrialRuntime(receipt.runtimeBefore,modePreparationOptions());
    assertPresentation(receipt.runtimeBefore.presentation);
    report.directOpaqueRequested=true;
    await requestDirectOpaque((command,ms)=>exec(command,"direct-opaque-preparation:configure",ms),deadline,report);
    receipt.foot=report.directOpaque.foot;
    receipt.presentationBaseline=await call(()=>page.evaluate(()=>window.__presentation.state()),"post-property baseline");
    receipt.baselineAt=new Date().toISOString();
    assertPresentation(receipt.presentationBaseline);
    const pixelCheck=opaqueTerminalPixels.toString();
    while (true) {
      const observed=await call(()=>page.evaluate(({foot,pixelCheck})=>{
        const state=window.__presentation.state(), pixels=window.__presentation.readPixels();
        if(state.backend!=="canvas2d")throw Error("opaque preparation requires native Canvas2D pixels");
        const assert={ok:value=>{if(!value)throw Error("invalid original terminal pixel geometry");}};
        const inspect=eval(`(${pixelCheck})`);
        return {state,pixels:inspect(pixels,state.width,state.height,foot)};
      },{foot:receipt.foot,pixelCheck}),"terminal pixels");
      receipt.lastPixels=observed; assertPresentation(observed.state);
      if(observed.pixels.nonblank && observed.state.framesReceived>receipt.presentationBaseline.framesReceived &&
        observed.state.successfulPresents>receipt.presentationBaseline.successfulPresents)break;
      console.log(`OMARCHY_OPAQUE_PREPARATION ${JSON.stringify({at:new Date().toISOString(),...observed.pixels,frames:observed.state.framesReceived})}`);
      await call(()=>new Promise(resolve=>setTimeout(resolve,5000)),"wait for visible Foot");
    }
    receipt.runtimeAfter=await call(()=>observeRuntime("direct-opaque-preparation-ready"),"ready runtime");
    assertInputTrialRuntime(receipt.runtimeAfter,modePreparationOptions());
    assertPresentation(receipt.runtimeAfter.presentation);
    await call(()=>screenshot("prepared-desktop.png"),"ready image");
    receipt.visibleAt=new Date().toISOString();
    const exportDeadline=Date.now()+MODE_EXPORT_MS;
    receipt.exportStartedAt=new Date(exportDeadline-MODE_EXPORT_MS).toISOString();
    receipt.exportDeadlineAt=new Date(exportDeadline).toISOString();
    await withinTrialDeadline(()=>capturePair(exportDeadline),exportDeadline,"opaque coherent export");
    receipt.exportFinishedAt=new Date().toISOString(); receipt.status="pair-captured-input-untested";
  } catch(error){receipt.status="preparation-failed-input-untested";receipt.error=String(error);throw error;}
  finally{receipt.finishedAt=new Date().toISOString();}
}
