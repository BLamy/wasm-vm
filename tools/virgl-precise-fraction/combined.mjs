// One local fraction marker preserves each complete earlier wrapper chain.
import {getCombinedCases as minimums} from '../virgl-minimum-selection/combined.mjs';
export function getCombinedCases(){return minimums().map(c=>({
 ...c,name:'fraction-'+c.name,fraction:true,
 text:c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[508]\n').replace(/END\s*$/,'FRC_PRECISE TEMP[508], IN[0]\nEND\n'),
 base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-minimum-selection/combined.mjs'}
}));}
