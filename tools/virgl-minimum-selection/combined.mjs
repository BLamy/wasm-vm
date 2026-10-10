// One local minimum marker preserves each complete existing wrapper chain.
import {getCombinedCases as scalars} from '../virgl-scalar-operations/combined.mjs';
export function getCombinedCases(){return scalars().map(c=>({
 ...c,name:'minimum-'+c.name,
 text:c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[509]\n').replace(/END\s*$/,'MIN_PRECISE TEMP[509], IN[0], IN[0]\nEND\n'),
 base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-scalar-operations/combined.mjs'}
}));}
