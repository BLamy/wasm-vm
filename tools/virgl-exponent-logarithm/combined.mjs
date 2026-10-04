// An exact, isolated LG2 marker preserves every prior wrapper chain.
import {getCombinedCases as saturation} from '../virgl-saturation/combined.mjs';
export function getCombinedCases(){return saturation().map(c=>{const indices=[...c.text.matchAll(/IMM\[(\d+)\]/g)].map(m=>Number(m[1])),next=Math.max(...indices)+1;
 const last=[...c.text.matchAll(/^IMM\[\d+\].*\n/gm)].at(-1)[0];
 const text=c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[506]\n').replace(last,m=>m+`IMM[${next}] UINT32 {1065353216,1065353216,1065353216,1065353216}\n`).replace(/END\s*$/,`LG2 TEMP[506], IMM[${next}]\nEND\n`);
 return {...c,name:'exponent-'+c.name,text,base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-saturation/combined.mjs'}};
 });}
