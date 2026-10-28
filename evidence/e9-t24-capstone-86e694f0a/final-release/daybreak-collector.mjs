import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import readline from 'node:readline';

const cwd='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const out='/private/tmp/e9-t24-final-release-audit-v1';
await fs.mkdir(out,{recursive:true});
const report={requestedModel:'gpt-daybreak-blue-latest',cyberAccessProgram:'daybreakBlue',
  route:'local Codex app-server fresh ephemeral workspace-write child; final critic writes limited to task/status/queue/tests',started:new Date().toISOString(),
  status:'starting',sandbox:{mode:'workspace-write',networkAccess:true},allowProviderModelFallback:false,messages:[],commands:[],errors:[]};
const child=spawn('/Users/blamy/.local/bin/codex',['-c','mcp_servers={}','app-server','--stdio'],
  {cwd,stdio:['pipe','pipe','pipe']});
let next=0,threadId,turnId,done=false;
const jobs=new Map();
const save=()=>fs.writeFile(out+'/routing.json',JSON.stringify(report,null,2)+'\n');
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
const request=(method,params)=>new Promise((resolve,reject)=>{
  const id=++next;jobs.set(id,{resolve,reject});send({id,method,params});
});
child.stderr.on('data',()=>{});
const finish=async()=>{
  if(done)return;done=true;clearTimeout(deadline);report.finished=new Date().toISOString();
  await save();await fs.writeFile(out+'/report.md',report.messages.join('\n\n')+'\n');await fs.writeFile(out+'/verdict.md',(report.final??report.messages.at(-1)??'No final verdict')+'\n');
  child.stdin.end();child.kill('SIGTERM');
};
const deadline=setTimeout(async()=>{
  report.status='timed-out';if(threadId&&turnId)await request('turn/interrupt',{threadId,turnId}).catch(()=>{});
  await finish();
},3600000);
readline.createInterface({input:child.stdout}).on('line',line=>{
  let value;try{value=JSON.parse(line);}catch{return;}
  if(value.id!==undefined&&jobs.has(value.id)){
    const job=jobs.get(value.id);jobs.delete(value.id);
    value.error?job.reject(Error(JSON.stringify(value.error))):job.resolve(value.result);return;
  }
  if(value.id!==undefined&&value.method){
    send({id:value.id,error:{code:-32601,message:'No approvals or dynamic application tools'}});return;
  }
  if(value.method==='item/completed'&&value.params.threadId===threadId){
    const item=value.params.item;
    if(item.type==='agentMessage'){report.messages.push(item.text);if(item.phase==='final')report.final=item.text;console.log(item.text.slice(0,700));}
    if(item.type==='commandExecution')report.commands.push({command:item.command,exitCode:item.exitCode});
  }
  if(value.method==='error'){report.errors.push(value.params.error);void save();}
  if(value.method==='turn/completed'&&value.params.threadId===threadId&&value.params.turn.id===turnId){
    report.rootCompletion={threadId:value.params.threadId,turnId:value.params.turn.id};
    report.status=value.params.turn.status;report.turnError=value.params.turn.error;void finish();
  }
});
child.on('exit',code=>{if(!done){report.status='server-exited';report.exitCode=code;void finish();}});
try{
  await request('initialize',{clientInfo:{name:'wasm-vm-daybreak-t24-final',title:'Requested Daybreak validation subagent',version:'1'},capabilities:{experimentalApi:true}});
  send({method:'initialized',params:{}});
  const instructions="You are the human-requested actual Daybreak Blue independent FINAL RELEASE METADATA verifier. This is a LOW-RISK post-verdict metadata-only check. The full high-risk T24 capstone is already verified by DIFFERENT actual Daybreak root01a18490-e730-7530-9cf4-b92b59bef28f/turn01a18490-e9f1-70e3-beac-6504e166cb56, reportSHA28cc4f7dd68e68ceb48ffca3a95ffe60433d8ebed000bd9d148ccc81f0e24b53, routing668dc89855a31398c83b48e879382018e164ae70908a547db705f80c93e88af3, committed evidence/e9-t24-capstone-86e694f0a/daybreak-final-v1. Do this yourself with NO nested agents or model substitution. Do NOT reopen completed gates, launch browsers, run cold boots/replay/matrices, require new clones/attacks, change any source/task/queue/status or deploy/GitHub state. Read AGENTS and T24 scope, predict before inspecting direct results, and carry all existing HELD findings. Write ONLY /private/tmp/e9-t24-final-release-audit-v1/audit.md and scratch.\n\nWorker mechanically preserved the actual verifier status/log/queue at50b226e93, then changed only five source/dist roadmap/task/SW metadata files at current clean6789cbdeeeed070bbe2703530b3a4e099f3b7fa6. This marks E9 and bounded capstone verified while leaving originalT22u/T22p/T22c/T22d cancelled and full originalOmarchy/performance unproven. NormalWasm00159a8cb8f880b0dc88412c5a7009e8a74dfa546c47c36dd0d6859125873a87 and stampac678419d5d27f56488c71940286d32901a55aa750bdf6c4508c9075c5eb3e1e/build8a6b47429414270020b818211614666d446233de92fcb1515830ea6cbb1991b6 are unchanged. Localmakewebdist, exactclosure/docs checks passed. Existing tools/deploy-cloudflare.sh published metadata to MAIN https://wasm-vm.pages.dev/ with branchmain, only3changedPagesfiles, exactR2checks and stagingtransforms preserved/restored. Receipt target/evidence/e9-t24-production-metadata-v1/report.json, cleanheadsame6789. Direct public worker check target/evidence/e9-t24-production-metadata-v1/visible-status/report.json PASSED, reports actual E9verified/capstoneverified pip, publicT24verified and4waivedcancelled, all8assetbytes matchinglocal, and127/0zeroerrors. Browsertrace/screenshot there. The original complete actual two-profile public UI proof is stilltarget/evidence/e9-t24-production-v1/session-ui/report.json SHAb8ae94bd0ed03bee63820684b45bab34c2e0edc7741589dcbce608af98842ec9; do not repeat it for metadata-only changes.\n\nCheck the exact 93ca76956bc5721098feaa07449389d3a35b8b9b..HEAD diff: only actualverifier task/queue/evidence preservation and the5metadatafiles; no runtime,package,wasm,renderer/worker/sourcepolicy changes. Check actualfinal routing/model/root/verdict binding, currenttask verified and allotherE9tasks terminalverified/cancelled, no remainingE9active. Freshly GET the relevant public metadata/runtime bytes with cachebusting and compare with the actuallocal/staged values; inspect publicJSON T24verified/fourcancelled and E9blurb explicitlyunprovenfullcold/performance, no originalqualification falseclaims. Verify PR625 now OPEN/ready for review/base624, currenthead6789, and all47nativePRs remainopen/unmerged. Nativeghstackview mustuse --json, noTUI. PRdescription correctscopeactualverdict. Do not merge or alterPRs. If everything holds, return RELEASE CHECK: passed and write precise small audit with command/results/hashes/limitations. This does not set T24status (alreadysetbyactualfreshcritic) or pretend the optional criticChrome startup failures were passingbrowsergates. If a metadata inconsistency is real, return RELEASE CHECK: failed with exact smallest demand. No unrelated requirements or permissions/questions. Finish this direct low-risk check now.";
  const started=await request('thread/start',{model:report.requestedModel,
    allowProviderModelFallback:false,cwd,approvalPolicy:'never',sandbox:'workspace-write',ephemeral:true,
    config:{web_search:'disabled',sandbox_workspace_write:{network_access:true,writable_roots:[cwd,'/private/tmp','/Users/blamy/.cargo','/Users/blamy/.npm']}},developerInstructions:instructions});
  threadId=started.thread.id;report.model=started.model;report.threadId=threadId;
  if(report.model!==report.requestedModel)throw Error('Daybreak model route mismatch');
  const turn=await request('turn/start',{threadId,model:report.requestedModel,
    cyberAccessProgram:'daybreakBlue',effort:'medium',
    input:[{type:'text',text:'Perform only the final low-risk public release metadata check. Return RELEASE CHECK: passed | failed; preserve existing verified status and all completed proof.'}]});
  turnId=turn.turn.id;report.turnId=turnId;report.status='running';await save();
  console.log(JSON.stringify({status:report.status,model:report.model,
    cyberAccessProgram:report.cyberAccessProgram,threadId}));
}catch(error){report.status='failed';report.errors.push(error.message);await finish();
  console.log(JSON.stringify({status:report.status,error:error.message}));process.exitCode=1;}
