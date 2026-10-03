#!/usr/bin/env node
import fs from 'node:fs';import {proof,bank,kernelVectors,expected} from './oracle.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/ordered-mask-cases.json',import.meta.url))),seed=Number(process.argv[2]??0x6a57be21)>>>0;
const kernels=fixture.kernels.map(kernel=>({kernel,draws:kernelVectors(kernel,seed).map(vector=>({vector,bank:bank(kernel,vector),oracle:expected(kernel,vector,fixture)}))}));
process.stdout.write(JSON.stringify({schema:'ordered-mask-hardware-reference-v1',seed,proof:proof(seed),kernels})+'\n');
