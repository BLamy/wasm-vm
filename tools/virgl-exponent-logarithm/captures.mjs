// Literal captured use sites; known initializers do not claim full-body admission.
import {bits,imm} from "./cases.mjs";
export const CAPTURES=[
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 485,
    "statement": "EX2 TEMP[303].x, TEMP[302].xxxx",
    "op": "EX2",
    "destination": 303,
    "source": 302,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 486,
    "statement": "EX2 TEMP[303].y, TEMP[302].yyyy",
    "op": "EX2",
    "destination": 303,
    "source": 302,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 487,
    "statement": "EX2 TEMP[303].z, TEMP[302].zzzz",
    "op": "EX2",
    "destination": 303,
    "source": 302,
    "variant": "mask-4-zzzz"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 534,
    "statement": "EX2 TEMP[332].x, TEMP[331].xxxx",
    "op": "EX2",
    "destination": 332,
    "source": 331,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 535,
    "statement": "EX2 TEMP[332].y, TEMP[331].yyyy",
    "op": "EX2",
    "destination": 332,
    "source": 331,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 536,
    "statement": "EX2 TEMP[332].z, TEMP[331].zzzz",
    "op": "EX2",
    "destination": 332,
    "source": 331,
    "variant": "mask-4-zzzz"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 543,
    "statement": "EX2 TEMP[336].x, TEMP[335].xxxx",
    "op": "EX2",
    "destination": 336,
    "source": 335,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 544,
    "statement": "EX2 TEMP[336].y, TEMP[335].yyyy",
    "op": "EX2",
    "destination": 336,
    "source": 335,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 545,
    "statement": "EX2 TEMP[336].z, TEMP[335].zzzz",
    "op": "EX2",
    "destination": 336,
    "source": 335,
    "variant": "mask-4-zzzz"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 637,
    "statement": "LG2 TEMP[376].x, TEMP[375].xxxx",
    "op": "LG2",
    "destination": 376,
    "source": 375,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 638,
    "statement": "LG2 TEMP[376].y, TEMP[375].yyyy",
    "op": "LG2",
    "destination": 376,
    "source": 375,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 639,
    "statement": "LG2 TEMP[376].z, TEMP[375].zzzz",
    "op": "LG2",
    "destination": 376,
    "source": 375,
    "variant": "mask-4-zzzz"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 684,
    "statement": "LG2 TEMP[403].x, TEMP[30].xxxx",
    "op": "LG2",
    "destination": 403,
    "source": 30,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 685,
    "statement": "LG2 TEMP[403].y, TEMP[30].yyyy",
    "op": "LG2",
    "destination": 403,
    "source": 30,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 686,
    "statement": "LG2 TEMP[403].z, TEMP[30].zzzz",
    "op": "LG2",
    "destination": 403,
    "source": 30,
    "variant": "mask-4-zzzz"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 698,
    "statement": "LG2 TEMP[412].x, TEMP[30].xxxx",
    "op": "LG2",
    "destination": 412,
    "source": 30,
    "variant": "mask-1-xxxx"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 699,
    "statement": "LG2 TEMP[412].y, TEMP[30].yyyy",
    "op": "LG2",
    "destination": 412,
    "source": 30,
    "variant": "mask-2-yyyy"
  },
  {
    "path": "evidence/virgl-workload-inventory/captures/es2gears/shaders/92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi",
    "sha256": "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
    "line": 700,
    "statement": "LG2 TEMP[412].z, TEMP[30].zzzz",
    "op": "LG2",
    "destination": 412,
    "source": 30,
    "variant": "mask-4-zzzz"
  }
];
export const captureInput=op=>({name:'captured-input',a:(op==='EX2'?[-2,1,.5,2]:[.5,1,2,4]).map(bits),b:[1,2,4,8].map(bits)});
export function captureText(c){const v=captureInput(c.op);return ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]',`DCL TEMP[0..${Math.max(c.source,c.destination)}]`,imm(0,v.a),imm(1,v.b),imm(2,[8388607,1056964608,23,0]),`MOV TEMP[${c.source}], IMM[0]`,`MOV TEMP[${c.destination}], IMM[0]`,c.statement,`MOV TEMP[0], TEMP[${c.destination}]`,'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy','USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');}
export const getCapturedCases=()=>CAPTURES.map(c=>({name:'captured-'+c.op+'-'+c.line,stage:'vertex',text:captureText(c),ok:true,primary:true,capture:c}));
