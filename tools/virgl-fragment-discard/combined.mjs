import {getCombinedCases as coordinates} from '../virgl-fragment-coordinates/combined.mjs';
// Synthetic simultaneous obligations retain their complete predecessor body.
// A literal positive zero adds no domain or initialization authority.
export function getCombinedCases() {
 return coordinates().map(c=>{
  const ids=[...c.text.matchAll(/^IMM\[(\d+)\]/gm)].map(m=>Number(m[1]));
  const index=Math.max(-1,...ids)+1;if(index>=32)throw new Error('discard fixture immediate bound');
  const lines=c.text.trimEnd().split('\n'),at=lines.findIndex(line=>!line.startsWith('FRAG')&&!line.startsWith('PROPERTY')&&!line.startsWith('DCL')&&!line.startsWith('IMM'));
  lines.splice(at,0,`IMM[${index}] UINT32 {0,0,0,0}`);
  lines.splice(lines.indexOf('END'),0,`KILL_IF IMM[${index}]`);
  return {...c,name:'discard-'+c.name,text:lines.join('\n')+'\n',always:false,base:{stage:'fragment',text:c.text,sourceGenerator:'tools/virgl-fragment-coordinates/combined.mjs'}};
 });
}
