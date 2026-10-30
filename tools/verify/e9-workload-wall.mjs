// Pure host-wall policy shared by the frozen desktop browser run and its boundary proof.
export const OLD_DESKTOP_WALL_MS=8*60*60*1000;
export const QUALIFIED_DESKTOP_WALL_MS=16*60*60*1000;
export const FROZEN_V10_SHA256='3e118664a0079556aa446066e1562649bcc7aabbccef00c78e426d2862000de6';
const keys=value=>Object.keys(value??{}).sort().join(',');

export function validateDesktopWallAmendment(amendment,previousSha256){
  if(!amendment||keys(amendment)!=='desktopHostWallMs,previousQualification,retainedFailure,scope,task,version'
    ||amendment.version!==11||amendment.task!=='E9-T22n'
    ||amendment.scope!=='Host wall allowance only for the unchanged cold Omarchy qualification; no timing or full-workload claim'
    ||amendment.desktopHostWallMs!==QUALIFIED_DESKTOP_WALL_MS
    ||keys(amendment.previousQualification)!=='path,sha256'
    ||amendment.previousQualification.path!=='docs/design/session-workload-qualification-v10.json'
    ||previousSha256!==FROZEN_V10_SHA256
    ||amendment.previousQualification.sha256!==FROZEN_V10_SHA256
    ||keys(amendment.retainedFailure)!=='head,oldHostWallMs,reportSha256,transition'
    ||amendment.retainedFailure.head!=='a161b0f8d6a4e7e4d19de7170fe7ad52a2f416f6'
    ||amendment.retainedFailure.reportSha256!=='12b51f16c8502c9c4243e1c639c8d619a015c780bb5fa97630caa32fe224e593'
    ||amendment.retainedFailure.oldHostWallMs!==OLD_DESKTOP_WALL_MS
    ||amendment.retainedFailure.transition!=='17550000000')
    throw Error('invalid E9-T22n wall-only qualification amendment');
  return amendment.desktopHostWallMs;
}

export function desktopWallOpen(nowMs,begunMs,wallMs){
  return Number.isFinite(nowMs)&&Number.isFinite(begunMs)
    &&Number.isSafeInteger(wallMs)&&wallMs>0&&nowMs>=begunMs
    &&nowMs-begunMs<wallMs;
}
