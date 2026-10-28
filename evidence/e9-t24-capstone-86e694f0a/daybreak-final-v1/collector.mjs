import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import readline from 'node:readline';

const cwd='/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905';
const out='/private/tmp/e9-t24-daybreak-final-v1';
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
  const instructions=await fs.readFile('/private/tmp/e9-t24-daybreak-final-v1.instructions.txt','utf8');
  const started=await request('thread/start',{model:report.requestedModel,
    allowProviderModelFallback:false,cwd,approvalPolicy:'never',sandbox:'workspace-write',ephemeral:true,
    config:{web_search:'disabled',sandbox_workspace_write:{network_access:true,writable_roots:[cwd,'/private/tmp','/Users/blamy/.cargo','/Users/blamy/.npm']}},developerInstructions:instructions});
  threadId=started.thread.id;report.model=started.model;report.threadId=threadId;
  if(report.model!==report.requestedModel)throw Error('Daybreak model route mismatch');
  const turn=await request('turn/start',{threadId,model:report.requestedModel,
    cyberAccessProgram:'daybreakBlue',effort:'medium',
    input:[{type:'text',text:'Perform fresh FINAL E9-T24 capstone verification, including actual main production proof, under the human cold-scope waiver. Only you may mark verified; return VERDICT: verified | refuted | needs-evidence with exact citations and coverage.'}]});
  turnId=turn.turn.id;report.turnId=turnId;report.status='running';await save();
  console.log(JSON.stringify({status:report.status,model:report.model,
    cyberAccessProgram:report.cyberAccessProgram,threadId}));
}catch(error){report.status='failed';report.errors.push(error.message);await finish();
  console.log(JSON.stringify({status:report.status,error:error.message}));process.exitCode=1;}
