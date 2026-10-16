// A local numerical zero marker preserves every complete prior wrapper chain.
import {getCombinedCases as fractions} from '../virgl-precise-fraction/combined.mjs';
export function getCombinedCases(){return fractions().map(c=>({...c,name:'saturation-'+c.name,saturation:true,
 text:c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[507]\n').replace(/END\s*$/,'MOV_SAT TEMP[507], IN[0]\nEND\n'),
 base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-precise-fraction/combined.mjs'}}));}
