// Preserve complete existing loop/radial/raster/arithmetic/conversion metadata.
import {getCombinedCases as conversions} from '../virgl-signed-conversions/combined.mjs';
export function getCombinedCases(){return conversions().map(c=>({
  ...c,name:'scalar-'+c.name,
  text:c.text.replace(/^(VERT|FRAG)\n/,'$1\nDCL TEMP[510]\n').replace(/END\s*$/,'SSG TEMP[510], IN[0]\nEND\n'),
  base:{...c.base,text:c.text,sourceGenerator:'tools/virgl-signed-conversions/combined.mjs'}
}));}
