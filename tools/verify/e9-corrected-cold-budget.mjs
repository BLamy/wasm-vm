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
  wasmSha256:'1f0d2c0eb3853aa0c1050f756743e75c12dd5bae26e9429a7f4b66811fde70aa',
  glueSha256:'fe77bfb7abe4695a0b0190e12964906ff440e1a56c1171c7aff4ea16c25c9dd8',
  productionWasmSha256:'bbf5e4b9219a25ddc7d3d2bbc8cb568a6d9fecbc0c7a44770c89e8a182adadd8',
  rendererSha256:'2701a54ee2f37200aba3936335e5564501ccafb0e12c6d99a2afc76cd095449d',
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
