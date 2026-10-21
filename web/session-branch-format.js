// The child VM asset authenticates provenance and the policy; no live parent is needed to reopen.
const need=(value,message)=>{if(!value)throw Error('Session branch: '+message);};
const exact=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fields=['transition','phase','ordinal','sequence','retired'];
export const sameBranchPosition=(a,b)=>fields.every(key=>a[key]===b[key]);
export function branchConsolePrefix(read,at){
  const chunks=[...(read.consolePrefix?.length?[read.consolePrefix]:[]),
    ...read.receipts.filter(row=>row.kind==='host'&&row.channel===21&&BigInt(row.sequence)<=BigInt(at.sequence)).map(row=>row.bytes)];
  // The source's current output tail is copied separately in its host queues.
  const bytes=new Uint8Array(Math.min(65536,chunks.reduce((sum,part)=>sum+part.length,0)));let offset=bytes.length;
  for(let i=chunks.length-1;i>=0&&offset>0;i--){const part=chunks[i].subarray(Math.max(0,chunks[i].length-offset));offset-=part.length;bytes.set(part,offset);}
  return bytes;
}
export function validateBranchOrigin(input){
  need(input&&typeof input==='object'&&!Array.isArray(input),'origin is required');
  const value=JSON.parse(JSON.stringify(input));
  need(Object.keys(value).sort().join(',')==='consolePrefix,networkPolicy,parentId,parentManifestSha256,sourceDigestSha256,sourcePosition,version','origin fields');
  need(value.version===1&&typeof value.parentId==='string'&&/^[A-Za-z0-9_.:/-]{1,64}$/.test(value.parentId)
    &&hash(value.parentManifestSha256)&&hash(value.sourceDigestSha256),'origin identity');
  const p=value.sourcePosition;
  need(p&&Object.keys(p).sort().join(',')==='ordinal,phase,retired,sequence,transition'
    &&p.phase==='before'&&['transition','retired','sequence'].every(key=>exact(p[key]))
    &&BigInt(p.retired)<=BigInt(p.transition)&&BigInt(p.sequence)<0xffffffffffffffffn
    &&Number.isInteger(p.ordinal)&&p.ordinal>=0&&p.ordinal<=0xffffffff&&BigInt(p.ordinal)<=BigInt(p.sequence),'source position');
  need(value.networkPolicy==='offline-refuse-historical-v1','historical connections must remain offline');
  need(Array.isArray(value.consolePrefix)&&value.consolePrefix.length<=65536
    &&value.consolePrefix.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255),'console prefix bound');
  return value;
}
export function branchOrigin({parentId,parentManifestSha256,sourceDigestSha256,position,consolePrefix=new Uint8Array()}){
  need(consolePrefix instanceof Uint8Array&&consolePrefix.buffer instanceof ArrayBuffer&&consolePrefix.length<=65536,'owned console prefix');
  return validateBranchOrigin({version:1,parentId,parentManifestSha256,sourcePosition:Object.fromEntries(fields.map(key=>[key,position[key]])),
    sourceDigestSha256,networkPolicy:'offline-refuse-historical-v1',consolePrefix:[...consolePrefix]});
}
