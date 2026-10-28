// E9-T22u: a fresh original-cold diagnostic after the proven block DMA fix.
// This does not amend the supported v11 desktop qualification profile.
import {OLD_COLD_REPORT} from './e9-cold-prefix-budget.mjs';

export const CORRECTED_COLD_SOURCE=Object.freeze({
  failedPrefixReportSha256:'81ddc15dddddace2636d9e4a97b12544c7907ab09bed0f2e5e8ca2380f226575',
  preErrorTransition:'14350000000',
  preErrorRamDigest:'701fe081ade720cab198e2fab3e586648f9e407d3c3ef4eb15600e6e308ea4bd',
  frontierReportSha256:'5cb0ab6386e534f5d7711d57ca2544a4efa721ff82e87204e1ba810f249e737b',
  frontierStart:'21700000000',
  frontierEnd:'25200000000',
  unmodifiedWallMs:6557604.799999997,
});
export const CORRECTED_BLOCK_BUILD=Object.freeze({
  wasmSha256:'5dd5c93fdb600f68c1b7d74eaa3cbda2435692343e409c118f27371991041e9e',
  glueSha256:'c626772fedbe75251bb7461f11f5d7a4b5177a2c7170f9c7eed480e6c6224632',
  productionWasmSha256:'00159a8cb8f880b0dc88412c5a7009e8a74dfa546c47c36dd0d6859125873a87',
  rendererSha256:'6adfd6f5248c56933ee6e840b1c38f9de953f5369bdaa3cdea8e73928e023667',
  productionRendererSha256:'ac678419d5d27f56488c71940286d32901a55aa750bdf6c4508c9075c5eb3e1e',
});
export const CORRECTED_COLD_CAP=27000000000;
export const CORRECTED_COLD_WALL_MS=20*60*60*1000;
const GiB=1024**3,STAGE=512*1024**2,SAFETY=1.25;

export function calculateCorrectedColdBudget({hostFreeBytes,browserQuota,browserUsage}){
  for(const value of [hostFreeBytes,browserQuota,browserUsage])
    if(!Number.isSafeInteger(value)||value<0)throw Error('invalid corrected-cold capacity receipt');
  if(browserUsage>browserQuota)throw Error('invalid corrected-cold browser estimate');
  const scale=CORRECTED_COLD_CAP/OLD_COLD_REPORT.transitions;
  const predictedPayloadBytes=Math.ceil(OLD_COLD_REPORT.payloadBytes*scale*SAFETY);
  const oldHostConsumption=OLD_COLD_REPORT.hostFreeBefore-OLD_COLD_REPORT.hostFreeAfter;
  const predictedHostConsumption=Math.ceil(oldHostConsumption*scale*SAFETY);
  const recentTransitions=Number(BigInt(CORRECTED_COLD_SOURCE.frontierEnd)
    -BigInt(CORRECTED_COLD_SOURCE.frontierStart));
  const predictedWallMs=Math.ceil(CORRECTED_COLD_SOURCE.unmodifiedWallMs
    *CORRECTED_COLD_CAP/recentTransitions*SAFETY);
  const hostReserveBytes=4*GiB,sidecarReserveBytes=2*GiB;
  const hostRequiredBytes=predictedHostConsumption+predictedPayloadBytes
    +hostReserveBytes+sidecarReserveBytes;
  const rollingBrowserRequiredBytes=STAGE+GiB;
  if(predictedWallMs>=CORRECTED_COLD_WALL_MS)
    throw Error('corrected-cold wall budget cannot fit measured rate');
  if(predictedPayloadBytes>=16*GiB)
    throw Error('corrected-cold predicted graph exceeds retention');
  if(hostFreeBytes<hostRequiredBytes)
    throw Error('corrected-cold host capacity cannot fit two copies and reserve');
  if(browserQuota-browserUsage<rollingBrowserRequiredBytes)
    throw Error('corrected-cold browser quota cannot admit a final bounded write');
  return Object.freeze({calibration:{old20B:OLD_COLD_REPORT,
      laterFrontier:CORRECTED_COLD_SOURCE},
    transitionCap:String(CORRECTED_COLD_CAP),wallMs:CORRECTED_COLD_WALL_MS,
    predictedWallMs,predictedPayloadBytes,payloadStopBytes:predictedPayloadBytes-2*STAGE,
    predictedHostConsumption,hostRequiredBytes,hostFreeBytes,
    hostReserveBytes,sidecarReserveBytes,rollingBrowserRequiredBytes,
    browserQuota,browserUsage,browserAvailableBytes:browserQuota-browserUsage,
    checkpointCadence:50000000,retentionLimitBytes:16*GiB,safetyFactor:SAFETY,
    quotaPolicy:'rolling-live-admission-before-every-write'});
}
