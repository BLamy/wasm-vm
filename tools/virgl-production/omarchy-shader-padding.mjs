#!/usr/bin/env node
import fs from 'node:fs/promises';
import {runProductionShaderPadding} from '../../renderer/virgl-command/tests/production-shader-padding.mjs';
const fixtures=JSON.parse(await fs.readFile(new URL('../../renderer/virgl-command/tests/omarchy-chromium-shader-padding.json',import.meta.url),'utf8'));
console.log(JSON.stringify(runProductionShaderPadding(fixtures)));
