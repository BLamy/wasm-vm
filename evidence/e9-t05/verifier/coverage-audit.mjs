// Read V8's recorded function/block counts with native UTF-16 offsets; no product execution.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd(),out='evidence/e9-t05/verifier';
const coveragePaths=['target/evidence/e9-t05-worker-repaired/browser/javascript-coverage.json',
  'target/evidence/e9-t05-repair-critic-coverage.json','target/evidence/e9-t05-repair-aba-critic-coverage.json'];
const coverage=coveragePaths.flatMap(file=>JSON.parse(fs.readFileSync(file,'utf8')));
const files=['web/session-checkpoints.js','web/loader.js','web/linux-worker-protocol.js','web/roadmap.js','web/gpu-checkpoint-build.js'];
const report={note:'Counts describe observed V8 blocks/functions, not exhaustive branch coverage.',coveragePaths,files:{}};
const sha=text=>createHash('sha256').update(text).digest('hex');
for(const file of files) {
  const source=fs.readFileSync(file,'utf8'),name=file.slice(4);
  const entries=coverage.filter(entry=>new URL(entry.url).pathname==='/'+name);
  for(const entry of entries)if(sha(entry.source)!==sha(source))throw Error('stale V8 source '+file);
  const lines=source.split('\n');let offset=0;
  const offsets=lines.map(line=>{const at=offset;offset+=line.length+1;return at;});
  const countAt=(entry,at)=>{
    const ranges=entry.functions.flatMap(fn=>fn.ranges).filter(range=>range.startOffset<=at&&at<range.endOffset);
    if(!ranges.length)return 0;
    ranges.sort((a,b)=>(a.endOffset-a.startOffset)-(b.endOffset-b.startOffset));
    return ranges[0].count;
  };
  const diff=execFileSync('git',['diff','--unified=0','34954a201d25f218663f682215a785319cd1b832','4ce36a932feaf171c09cd8b25e90d3fc9ff376ac','--',file],{encoding:'utf8'});
  const hunks=[...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(.*)$/gm)].map(match=>{
    const start=Number(match[1]),size=match[2]===undefined?1:Number(match[2]);
    const observed=[],unobserved=[],declarative=[];
    for(let line=start;line<start+size;line++) {
      const text=lines[line-1]??'',trim=text.trim();
      if(!trim||trim.startsWith('//')||/^[{};,]+$/.test(trim)){declarative.push(line);continue;}
      const at=offsets[line-1]+text.search(/\S/);
      if(entries.some(entry=>countAt(entry,at)>0))observed.push(line);else unobserved.push(line);
    }
    return {start,size,context:match[3].trim(),observed,unobserved,declarative};
  });
  const functions=entries.flatMap(entry=>entry.functions).map(fn=>({name:fn.functionName,
    count:fn.ranges[0]?.count,start:fn.ranges[0]?.startOffset,end:fn.ranges[0]?.endOffset,
    zeroBlocks:fn.ranges.filter(range=>range.count===0).map(range=>({start:range.startOffset,end:range.endOffset}))}));
  report.files[file]={source_sha256:sha(source),recordings:entries.length,hunks,functions};
}
fs.writeFileSync(out+'/coverage-blocks.json',JSON.stringify(report,null,2)+'\n');
for(const [name,file] of Object.entries(report.files)) {
  console.log(name,'recordings='+file.recordings,'hunks='+file.hunks.length,
    'unobserved='+file.hunks.flatMap(hunk=>hunk.unobserved).join(','));
}
