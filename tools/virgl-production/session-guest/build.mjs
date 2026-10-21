import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packet,join,shader,word} from '../../virgl-command/standard-image-fixtures.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const fragment=color=>'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {'+color+'}\n0: MOV OUT[0], IMM[0]\n1: END\n';
const draw=packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
const initial=join(shader(10,0,vertex),packet(31,0,[10,0]),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,2]),packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),packet(4,0,[0,...[32,32,.5,32,32,.5].map(word)]));
const colors=[['green','0,1,0,1'],['red','1,0,0,1'],['blue','0,0,1,1']];
const arrays={visible_query:join(packet(1,9,[90,1,0,10]),packet(19,0,[90]),packet(31,0,[40,1]),draw,packet(20,0,[90]),packet(21,0,[90,0])),empty_query:join(packet(1,9,[91,1,0,11]),packet(19,0,[91]),packet(20,0,[91]),packet(21,0,[91,0])),invalid_query:packet(21,0,[999,0]),initial:join(initial,...colors.map(([,color],i)=>shader(40+i,1,fragment(color)))),...Object.fromEntries(colors.map(([name],i)=>[name,join(packet(31,0,[40+i,1]),draw)]))};
await fs.writeFile(path.join(root,'commands.h'),Object.entries(arrays).map(([name,bytes])=>'static const unsigned char '+name+'[]={'+[...bytes].join(',')+'};').join('\n')+'\n');
const container='wasm-vm-production-graphics-reference',dest='/capture/session-guest';
execFileSync('docker',['exec',container,'mkdir','-p',dest]);execFileSync('docker',['cp',root+'/.',container+':'+dest]);
for(const layered of [false,true]){
const stem=layered?'production-gpu-session-layered':'production-gpu-session';
execFileSync('docker',['exec','-w',dest,container,'riscv64-linux-gnu-gcc','-march=rv64imac_zicsr','-mabi=lp64','-mcmodel=medany','-mno-relax','-msmall-data-limit=0','-fno-pie','-fno-stack-protector','-ffreestanding','-nostdlib','-Os','-Wl,--no-relax,--build-id=none,-T,link.ld',...(layered?['-DE9_GPU_LAYERED']:[]),'start.S','main.c','-o','session.elf'],{stdio:'inherit'});
execFileSync('docker',['exec','-w',dest,container,'riscv64-linux-gnu-objcopy','-O','binary','session.elf','session.bin']);
await fs.mkdir(path.join(root,'../../../guest/prebuilt'),{recursive:true});execFileSync('docker',['cp',container+':'+dest+'/session.bin',path.join(root,'../../../guest/prebuilt/'+stem+'.bin')]);
const binary=await fs.readFile(path.join(root,'../../../guest/prebuilt/'+stem+'.bin'));
const names=new Set(['gpu','disk','pixels','queryData','response','diskBytes','fence',...(layered?['layeredPixels']:[])]);
const symbols=Object.fromEntries(execFileSync('docker',['exec','-w',dest,container,'riscv64-linux-gnu-nm','-S','--defined-only','session.elf'],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/)).filter(fields=>fields.length===4&&names.has(fields[3])).map(([address,size,,name])=>[name,{address:'0x'+address,bytes:parseInt(size,16)}]));
if(Object.keys(symbols).length!==names.size)throw Error('Missing guest symbols');
await fs.writeFile(path.join(root,'../../../guest/prebuilt/'+stem+'.json'),JSON.stringify({version:1,architecture:'rv64imac_zicsr-supervisor',scope:layered?'Original layered MMIO GPU/query/disk fixture; not Linux/Mesa':'Original MMIO GPU/query/disk fixture; not Linux/Mesa',sha256:createHash('sha256').update(binary).digest('hex'),bytes:binary.length,symbols},null,2)+'\n');
}
console.log('Built real original-MMIO supervisor guests; not a Linux/Mesa proof.');
