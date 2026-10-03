#!/usr/bin/env node
// Literal predictions are computed before any GPU output is consulted.
import fs from 'node:fs';import {proof,bank,kernelVectors,expected} from './oracle.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/precise-word-cases.json',import.meta.url))),seed=Number(process.argv[2]??0x741cc28d)>>>0;
const kernels=fixture.kernels.map(kernel=>({kernel,draws:kernelVectors(kernel,seed).map(vector=>({vector,bank:bank(kernel,vector),oracle:expected(kernel,vector,fixture)}))}));
process.stdout.write(JSON.stringify({schema:'precise-literal-hardware-reference-v1',seed,proof:proof(seed),kernels})+'\n');
