// Exact original statement bindings; initialization does not admit full bodies.
import {imm,vectors,carrier} from './cases.mjs';
export const CAPTURES=[
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi',sha256:'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba',line:76,statement:'SIN TEMP[51].x, TEMP[19].xxxx',op:'SIN',source:19,destination:51,variant:'mask-1-xxxx'},
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi',sha256:'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba',line:175,statement:'SIN TEMP[114].x, TEMP[21].xxxx',op:'SIN',source:21,destination:114,variant:'mask-1-xxxx'}
];
export const captureInput=()=>vectors()[0];
export function captureText(c){
 const standard=carrier('SIN',captureInput()),prefix=standard.slice(0,standard.indexOf('MOV TEMP[0], IMM[0]')),tail=standard.slice(standard.indexOf('AND TEMP[1], TEMP[0]'));
 return prefix.replace('DCL TEMP[0..3]',`DCL TEMP[0..${c.destination}]`)+`MOV TEMP[${c.source}], IMM[0]\nMOV TEMP[${c.destination}], IMM[0]\n${c.statement}\nMOV TEMP[0], TEMP[${c.destination}]\n`+tail;
}
export const getCapturedCases=()=>CAPTURES.map(c=>({name:'captured-sine-'+c.line,stage:'vertex',text:captureText(c),ok:true,primary:true,capture:c}));
