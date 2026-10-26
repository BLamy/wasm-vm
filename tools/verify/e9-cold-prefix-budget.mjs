// E9-T22r: finite, independently measurable admission for a fresh cold prefix.
// The old 20B run is preserved at the SHA below. Its browser quota grew with
// usage while retaining a 10 GiB rolling headroom, so each write is admitted
// against the live estimate rather than pretending the initial quota is fixed.
export const OLD_COLD_REPORT={
  sha256:'4857b8b536a5d274c6dd210f13d3d01efc03350818bae8a386c0124178495d4e',
  transitions:20000000000,
  durationMs:33327978,
  payloadBytes:9650697147,
  hostFreeBefore:41827426304,
  hostFreeAfter:22281621504,
  browserQuotaBefore:10737418240,
  browserQuotaAfter:20394355493,
  browserUsageAfter:9656937253
};
export const EXACT_LATCH_BUILD={
  wasmSha256:'a5ff5ce2d6a69477392423cfd126d409ce74e83fe243c0efa0e60e7f94048b0f',
  rendererSha256:'e0388d4cf6a2cd9b956889f52d7773efa5ad9ceda4ce8d6535a710c0445d97d3',
  oldWasmSha256:'202a094ca0bd39e623dace01323451295728c786f8b77342296b1e9ea0c3544b',
  oldRendererSha256:'821691a929712744d80a0624866cff34b6d963d6490bfaed265743428522b32d'
};

const GiB=1024**3,stageBytes=512*1024**2;
export const PREFIX_TRANSITION_CAP=22000000000;
export const PREFIX_WALL_MS=14*60*60*1000;
export const PREFIX_SAFETY_FACTOR=1.25;
const scaled=(value,scale)=>Math.ceil(value*scale*PREFIX_SAFETY_FACTOR);

export function calculateColdPrefixBudget({hostFreeBytes,browserQuota,browserUsage}){
  for(const value of [hostFreeBytes,browserQuota,browserUsage])
    if(!Number.isSafeInteger(value)||value<0)throw Error('invalid cold-prefix capacity receipt');
  if(browserUsage>browserQuota)throw Error('invalid cold-prefix browser estimate');
  const scale=PREFIX_TRANSITION_CAP/OLD_COLD_REPORT.transitions;
  const predictedPayloadBytes=scaled(OLD_COLD_REPORT.payloadBytes,scale);
  const oldHostConsumption=OLD_COLD_REPORT.hostFreeBefore-OLD_COLD_REPORT.hostFreeAfter;
  const predictedHostConsumption=scaled(oldHostConsumption,scale);
  const predictedWallMs=scaled(OLD_COLD_REPORT.durationMs,scale);
  const hostReserveBytes=4*GiB,sidecarReserveBytes=2*GiB;
  const hostRequiredBytes=Math.max(predictedHostConsumption+hostReserveBytes,
    2*predictedPayloadBytes+sidecarReserveBytes+hostReserveBytes);
  const rollingBrowserRequiredBytes=stageBytes+GiB;
  if(predictedWallMs>=PREFIX_WALL_MS)throw Error('cold-prefix wall budget cannot fit measured rate');
  if(predictedPayloadBytes>=16*GiB)throw Error('cold-prefix predicted graph exceeds retention');
  if(hostFreeBytes<hostRequiredBytes)throw Error('cold-prefix host capacity cannot fit two copies and reserve');
  if(browserQuota-browserUsage<rollingBrowserRequiredBytes)
    throw Error('cold-prefix browser quota cannot admit a final bounded write');
  if(OLD_COLD_REPORT.browserQuotaAfter-OLD_COLD_REPORT.browserUsageAfter<rollingBrowserRequiredBytes
    ||OLD_COLD_REPORT.browserQuotaBefore<rollingBrowserRequiredBytes)
    throw Error('old cold run does not prove rolling browser headroom');
  return Object.freeze({calibration:OLD_COLD_REPORT,transitionCap:String(PREFIX_TRANSITION_CAP),
    wallMs:PREFIX_WALL_MS,predictedWallMs,predictedPayloadBytes,
    payloadStopBytes:predictedPayloadBytes-2*stageBytes,predictedHostConsumption,
    hostRequiredBytes,hostFreeBytes,hostReserveBytes,sidecarReserveBytes,
    rollingBrowserRequiredBytes,browserQuota,browserUsage,
    browserAvailableBytes:browserQuota-browserUsage,checkpointCadence:50000000,
    retentionLimitBytes:16*GiB,safetyFactor:PREFIX_SAFETY_FACTOR,
    quotaPolicy:'rolling-live-admission-before-every-write'});
}
