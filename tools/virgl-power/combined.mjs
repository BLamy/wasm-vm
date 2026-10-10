import {getCombinedCases as exponent} from '../virgl-sine/combined.mjs';
export function getCombinedCases(){return exponent().map(c=>{const indices=[...c.text.matchAll(/IMM\[(\d+)\]/g)].map(m=>Number(m[1])),next=Math.max(...indices)+1;
 const last=[...c.text.matchAll(/^IMM\[\d+\].*\n/gm)].at(-1)[0];
 const text=c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[504]\n').replace(last,m=>m+`IMM[${next}] UINT32 {1065353216,1065353216,1065353216,1065353216}\n`).replace(/END\s*$/,`POW TEMP[504], IMM[${next}], IMM[${next}]\nEND\n`);
 return {...c,name:'power-'+c.name,text,base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-sine/combined.mjs'}};
 });}
