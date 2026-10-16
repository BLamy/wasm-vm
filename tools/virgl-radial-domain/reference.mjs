#!/usr/bin/env node
// Recompute the literal hardware predictions without consuming any GPU result.
import fs from 'node:fs';
import {proof,hardwareBank,interpretColor,thresholdWord} from './oracle.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../renderer/virgl-shader/tests/radial-domain-cases.json',import.meta.url)));
const predict=(kernel,coefficient,color)=>{const bank=hardwareBank(kernel,coefficient,color);return{coefficient,bank,oracle:interpretColor(fixture.cases.find(c=>c.name===kernel.case),kernel,bank)}};
const kernels=fixture.kernels.map(k=>({kernel:k,draws:(k.kind==='mini'?[thresholdWord,thresholdWord+1,thresholdWord|0x80000000,(thresholdWord+1)|0x80000000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff]:[0x3f800000,0xbf800000]).map(w=>predict(k,w>>>0))}));
const lifecycle=['plain','indirect','loop'].map(kind=>{const k=fixture.kernels.find(k=>k.case===kind+'-vertex');return{kind,draws:[predict(k,0x3f800000),predict(k,thresholdWord,[0x3f000000,0x3e800000,0x3f000000,0x3f800000]),predict(k,0xbf800000),predict(k,0x3f800000),predict(k,0x3f800000),predict(k,0x3f800000)]}});
process.stdout.write(JSON.stringify({schema:'radial-literal-hardware-reference-v1',proof:proof(),kernels,lifecycle})+'\n');
