import {getCombinedCases as exponent} from '../virgl-exponent-logarithm/combined.mjs';
export function getCombinedCases(){return exponent().map(c=>{const indices=[...c.text.matchAll(/IMM\[(\d+)\]/g)].map(m=>Number(m[1])),next=Math.max(...indices)+1;
 const last=[...c.text.matchAll(/^IMM\[\d+\].*\n/gm)].at(-1)[0];
 const text=c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[505]\n').replace(last,m=>m+`IMM[${next}] UINT32 {0,0,0,0}\n`).replace(/END\s*$/,`SIN TEMP[505], IMM[${next}]\nEND\n`);
 return {...c,name:'sine-'+c.name,text,base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-exponent-logarithm/combined.mjs'}};
 });}
