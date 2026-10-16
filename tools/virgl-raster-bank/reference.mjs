#!/usr/bin/env node
import fs from 'node:fs';import {proof,vectors,bank,expected} from './oracle.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/raster-bank-cases.json',import.meta.url))),seed=Number(process.argv[2]??0x31db9275)>>>0;
process.stdout.write(JSON.stringify({schema:'raster-bank-hardware-reference-v1',seed,proof:proof(),kernels:fixture.kernels.map(kernel=>({kernel,draws:vectors(kernel,seed).map(vector=>({vector,bank:bank(kernel,vector),oracle:expected(kernel,vector,fixture)}))}))})+'\n');
