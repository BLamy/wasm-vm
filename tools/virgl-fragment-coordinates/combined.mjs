import {getCombinedCases as power} from '../virgl-power/combined.mjs';
// Port isolated obligation fixtures to fragments. These are synthetic probes;
// they do not stand in for an unchanged captured compositor program.
export function getCombinedCases(){
 return power().map(c=>{
  let base=c.text.replace(/^VERT\n/,'FRAG\nDCL TEMP[500..501]\n')
   .replace('DCL IN[0]','DCL IN[0], GENERIC[0], PERSPECTIVE')
   .replace('DCL IN[1]','DCL IN[1], GENERIC[1], PERSPECTIVE')
   .replace('DCL OUT[0], POSITION','DCL OUT[0], COLOR')
   .replace(/^DCL OUT\[[12]\].*\n/gm,'').replaceAll('OUT[1]','TEMP[500]').replaceAll('OUT[2]','TEMP[501]');
  const text=base.replace(/^FRAG\n/,'FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\n')
   .replace('IN[0], GENERIC[0], PERSPECTIVE','IN[0], POSITION, LINEAR');
  const partner='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[1]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nEND\n';
  return{name:'coordinate-'+c.name,stage:'fragment',text,ok:true,primary:true,pairOk:true,partner,base:{stage:'fragment',text:base,sourceGenerator:'tools/virgl-power/combined.mjs'}};
 });
}
