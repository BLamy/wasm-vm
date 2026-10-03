// Offline observation replay of literal TGSI; no compiler result is consumed.
import fs from 'node:fs';
import {bank,expected} from '../../renderer/virgl-command/tests/selected-lanes-oracle.mjs';
const fixture=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/selected-lanes-cases.json'));
const result={schema:'selected-lanes-literal-observations-v1',cases:{}};
for(const kernel of fixture.kernels){result.cases[kernel.case]={};for(const vector of fixture.vectors)result.cases[kernel.case][vector.name]={bank:bank(vector),...expected(kernel,vector,fixture)};}
process.stdout.write(JSON.stringify(result)+'\n');
