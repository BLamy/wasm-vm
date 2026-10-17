// Saved guest limits can be reused only where the actual qualified hardware supports them.
const floors=[2048,256,2048,256,16,16,16384,1,16,16,512,512,64,4];
const need=(condition,message)=>{if(!condition)throw Error('gpu_checkpoint_profile: '+message);};
export function selectCheckpointProfile(actual,saved) {
  need(actual && saved && saved.renderer===actual.renderer,'renderer differs');
  const hostWords=Array.from(saved.hostWords??[]),available=Array.from(actual.hostWords??[]),formatRoles=Array.from(saved.formatRoles??[]),roles=Array.from(actual.formatRoles??[]);
  need(hostWords.length===14&&available.length===14&&hostWords.every((n,i)=>Number.isInteger(n)&&n>=floors[i]&&n<=0xffffffff),'invalid saved limits');
  for(let i=0;i<14;i++)need(i===7?available[i]>0&&hostWords[i]%available[i]===0:hostWords[i]<=available[i],'unsupported saved limit'+i);
  need(formatRoles.length%2===0&&formatRoles.length<=512&&roles.length%2===0,'invalid format roles');
  const supported=new Map();for(let i=0;i<roles.length;i+=2)supported.set(roles[i],roles[i+1]);const seen=new Set();
  for(let i=0;i<formatRoles.length;i+=2){const id=formatRoles[i],mask=formatRoles[i+1];need(Number.isInteger(id)&&id>=0&&id<512&&!seen.has(id)&&Number.isInteger(mask)&&mask>0&&(mask&~31)===0,'invalid saved format role');seen.add(id);need((supported.get(id)&mask)===mask,'unsupported saved format'+id);}
  return Object.freeze({hostWords:Uint32Array.from(hostWords),formatRoles:Uint32Array.from(formatRoles),renderer:saved.renderer});
}
