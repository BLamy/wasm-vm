#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './cases.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'vertex','fragment'].includes(fault));
const files=['tools/virgl-hex-literals/cases.mjs'];
await runVirglBrowser({options,task:'E6-T12g6c',boundary:'canonical hexadecimal FLT32 words; isolated synthetic programs',reportFields:{productionNegotiation:false},
  modulePath:'/renderer/virgl-shader/tests/hex-literals.mjs',windowReportKey:'__virglHexLiteralsReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,
  pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-shader/tests/hex-literals.mjs','tools/virgl-hex-literals/cases.mjs'],
  html:browserDocument({title:'Exact hexadecimal TGSI literals',heading:'Hexadecimal binary32 literals on physical WebGL2',description:'Independent carrier word and bit-plane pixel equations. Guest production negotiation remains disabled.'}),
  validate(a){assert.equal(a.seed,seed);assert.equal(a.fault,fault);assert.equal(a.vertices.length,278);assert.equal(a.fragments.length,324);assert.equal(a.checkedWords,13344);assert.equal(a.checkedPixels,5184);assert.equal(a.objects.live,0);},
  successMessage:a=>`${a.checkedWords} exact physical words and ${a.checkedPixels} pixels; all literal objects disposed.`});
