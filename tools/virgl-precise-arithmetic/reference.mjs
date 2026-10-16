#!/usr/bin/env node
import fs from 'node:fs';
import {bank,expected,kernelVectors,proof} from './oracle.mjs';
const seed=Number(process.argv[2]??0x5e74bf09)>>>0;
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/precise-arithmetic-cases.json',import.meta.url)));
process.stdout.write(JSON.stringify({schema:'precise-arithmetic-reference-v1',seed,proof:proof(seed),kernels:fixture.kernels.map(kernel=>({kernel,vectors:kernelVectors(kernel,seed).map(vector=>({vector,bank:bank(kernel,vector),oracle:expected(kernel,vector)}))}))})+'\n');
