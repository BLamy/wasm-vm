#!/usr/bin/env node
import fs from 'node:fs/promises';
import {runResourceCopyWire} from '../../renderer/virgl-command/tests/production-resource-copy-wire.mjs';
const fixture = JSON.parse(await fs.readFile(new URL('../../renderer/virgl-command/tests/omarchy-wallpaper-native-copy.json', import.meta.url)));
console.log(JSON.stringify(runResourceCopyWire(fixture)));
