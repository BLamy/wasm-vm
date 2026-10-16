// Direct native execution of the unchanged prior public factory's false selector.
import {runAcceptance as held} from './standard-instanced-stencil.mjs';
export async function runAcceptance(){
 const report=await held({mode:'matrix',smoke:true});
 window.__standardShadowSamplerEvidence=report;
 return report;
}
