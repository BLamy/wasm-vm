#!/usr/bin/env node
// Reproducible, explicitly scoped storage-boundary guests; never full Linux proof.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const write=process.argv.slice(2).join(' ')==='--write';
assert(write||process.argv.length===2,'use --write to refresh committed assets; default checks only');
const sha=b=>createHash('sha256').update(b).digest('hex');
const container='wasm-vm-production-graphics-reference',dest='/capture/e9-gpu-journal-stream';
const imageId=execFileSync('docker',['inspect','--format','{{.Image}}',container],{encoding:'utf8'}).trim();
const compiler=execFileSync('docker',['exec',container,'riscv64-linux-gnu-gcc','--version'],{encoding:'utf8'}).split('\n')[0];
const source=await fs.readFile(path.join(root,'tools/verify/fixtures/e9-gpu-journal-stream.c'));
const start=await fs.readFile(path.join(root,'tools/virgl-production/session-guest/start.S'));
const linker=await fs.readFile(path.join(root,'tools/virgl-production/session-guest/link.ld'));
execFileSync('docker',['exec',container,'mkdir','-p',dest]);
for(const [file,name]of [['tools/verify/fixtures/e9-gpu-journal-stream.c','main.c'],['tools/virgl-production/session-guest/start.S','start.S'],['tools/virgl-production/session-guest/link.ld','link.ld']])execFileSync('docker',['cp',path.join(root,file),container+':'+dest+'/'+name]);
const flags=['-march=rv64imac_zicsr','-mabi=lp64','-mcmodel=medany','-mno-relax','-msmall-data-limit=0','-fno-pie','-fno-stack-protector','-ffreestanding','-nostdlib','-Os','-Wall','-Wextra','-Werror','-Wl,--no-relax,--build-id=none,-T,link.ld'];
const out=path.join(root,'target/e9-gpu-journal-stream-build');await fs.mkdir(out,{recursive:true});
const chunks=[];for(let i=0;i<256;i++)chunks.push(sha(Buffer.alloc(262144,i)));
const image=Buffer.from(JSON.stringify({version:1,image_len:67108864,chunk_size:262144,layout:'split',chunks})+'\n');
const outputs=[['e9-gpu-journal-stream-image.json',image]],receipts=[];
for(const [name,inputs,blocks]of [['count',4100,0],['bytes',1,256]]){
 const args=[...flags,'-DINPUT_COUNT='+inputs,'-DBLOCK_COUNT='+blocks,'start.S','main.c','-o','guest.elf'];
 execFileSync('docker',['exec','-w',dest,container,'riscv64-linux-gnu-gcc',...args],{stdio:'inherit'});
 execFileSync('docker',['exec','-w',dest,container,'riscv64-linux-gnu-objcopy','-O','binary','guest.elf','guest.bin']);
 const file=path.join(out,name+'.bin');execFileSync('docker',['cp',container+':'+dest+'/guest.bin',file]);const binary=await fs.readFile(file);
 const metadata={version:1,scope:'Real freestanding UART/immutable-block storage-boundary fixture; not Linux/Mesa, full desktop, replay or performance qualification',variant:name,inputs,blocks,architecture:'rv64imac_zicsr-supervisor',imageSha256:sha(image),sourceSha256:sha(source),startSha256:sha(start),linkerSha256:sha(linker),compiler:{imageId,compiler,arguments:args},bytes:binary.length,sha256:sha(binary)};
 outputs.push(['e9-gpu-journal-stream-'+name+'.bin',binary],['e9-gpu-journal-stream-'+name+'.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n')]);receipts.push(metadata);
}
for(const[name,bytes]of outputs){const file=path.join(root,'web/assets',name);if(write)await fs.writeFile(file,bytes);else assert.deepEqual(await fs.readFile(file),bytes,'reproducible asset '+name);}
console.log(JSON.stringify({status:write?'assets-refreshed':'assets-reproduced',receipts}));
