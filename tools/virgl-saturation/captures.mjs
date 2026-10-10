// Exact captured instructions, isolated with declared numerical inputs. These
// witnesses do not trim or claim admission of the original full shaders.
export const CAPTURES=[
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi',sha256:'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f',line:71,statement:'DIV_SAT TEMP[61].x, TEMP[60].xxxx, IMM[2].xxxx',source:60,destination:61,op:'DIV_SAT',variant:'mask-1'},
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi',sha256:'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f',line:85,statement:'DIV_SAT TEMP[71].x, TEMP[70].xxxx, IMM[2].xxxx',source:70,destination:71,op:'DIV_SAT',variant:'mask-1'},
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi',sha256:'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba',line:448,statement:'MOV_SAT TEMP[283].xyz, TEMP[31].xyzz',source:31,destination:283,op:'MOV_SAT',variant:'mask-7'},
 {path:'evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi',sha256:'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba',line:600,statement:'MOV_SAT TEMP[360].xyz, TEMP[30].xyzz',source:30,destination:360,op:'MOV_SAT',variant:'mask-7'}
];
export const captureInput={name:'original-instruction',a:[0xc0000000,0,0x3e800000,0x40000000],b:[0,0,0,0],d:Array(4).fill(0x3f800000)};
export function captureText(c){return['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]',`DCL TEMP[0..${c.destination}]`,
 'IMM[0] UINT32 {'+captureInput.a.join(',')+'}','IMM[1] UINT32 {0,0,0,0}','IMM[2] UINT32 {1065353216,0,0,0}','IMM[3] UINT32 {8388607,1056964608,23,0}',
 `MOV TEMP[${c.source}], IMM[0]`,`MOV TEMP[${c.destination}], IMM[0]`,c.statement,
 `AND TEMP[1], TEMP[${c.destination}], IMM[3].xxxx`,'OR TEMP[1], TEMP[1], IMM[3].yyyy',`USHR TEMP[2], TEMP[${c.destination}], IMM[3].zzzz`,'OR TEMP[2], TEMP[2], IMM[3].yyyy','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');}
export const getCapturedCases=()=>CAPTURES.map(c=>({name:'captured-'+c.op+'-'+c.line,stage:'vertex',text:captureText(c),ok:true,primary:true,saturation:true,capture:c}));
