// Offline replay of literal TGSI, never compiler metadata or generated GLSL.
import fs from 'node:fs';
import {interpret} from '../../renderer/virgl-shader/tests/raw-equality-oracle.mjs';
const f=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/raw-equality-cases.json')),result={};
for(const kernel of f.kernels){result[kernel.case]={};for(const v of kernel.vectorSet==='finite'?f.finiteVectors:f.vectors){const words=Array(184).fill(0);words.splice(0,4,...v.a);words.splice(172,4,...v.c);words.splice(180,4,...v.b);const state=interpret(kernel.probeText,{0:[0,0,0,0x3f800000],1:[0,0,0,0x3f800000]},words);result[kernel.case][v.name]=[0,1,2,3].map(lane=>state.read('TEMP[117]',lane));}}
process.stdout.write(JSON.stringify(result)+'\n');
