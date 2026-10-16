// Independent deterministic branch audit of the exact frozen loader block.
// State vectors are deliberately synthetic; physical worker checks are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
let repo = directory;
while (!await fs.stat(path.join(repo, 'web/loader.js')).then(value => value.isFile(), () => false)) {
  const parent = path.dirname(repo); assert.notEqual(parent, repo, 'locate repository loader'); repo = parent;
}
const loader = await fs.readFile(path.join(repo, 'web/loader.js'), 'utf8');
const marker = loader.indexOf('    // The reconstructed renderer must physically present');
assert.ok(marker >= 0);
const start = loader.indexOf('    if(gpuWarmData) {', marker);
const end = loader.indexOf('\n    return {', start);
const block = loader.slice(start, end);
assert.ok(block.includes('if(retiredInstructions>0&&freshDrawn)break;'));
const sha = body => createHash('sha256').update(body).digest('hex');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const receipt = (epoch = '0000000000000003', status = 'drawn', sequence = null) => ({epoch, status, sequence});
const gpu = (changes = {}) => ({epoch:'0000000000000003', qualified:true, lost:false,
  disposed:false, poisoned:false, counters:{failed:0, begun:863, completed:863, draws:605},
  scanout:{retirements:[receipt()]}, ...changes});
const timeout = /resumed CPU or fresh physical scanout did not become ready/;
const unusable = /resumed worker stopped or GPU owner became unusable/;
const vectors = [
  {name:'fresh repair without spontaneous draws', states:[gpu()], retired:1, outcome:'ready'},
  {name:'fresh ordinary frame', states:[gpu({scanout:{retirements:[receipt(undefined, 'drawn', '0000000000000091')]}})], retired:1, outcome:'ready'},
  {name:'old history and genuine fresh repair', states:[gpu({scanout:{retirements:[receipt('0000000000000002'), receipt()]}})], retired:1, outcome:'ready'},
  {name:'CPU progress after first poll', states:[gpu()], retired:0, nextRetired:1, outcome:'ready'},
  {name:'zero current-loader retirements despite historical GPU counters', states:[gpu()], retired:0, failure:timeout},
  {name:'old epoch drawn', states:[gpu({scanout:{retirements:[receipt('0000000000000002')]}})], retired:1, failure:timeout},
  {name:'cancelled current repair', states:[gpu({scanout:{retirements:[receipt(undefined,'cancelled')]}})], retired:1, failure:timeout},
  {name:'superseded current repair', states:[gpu({scanout:{retirements:[receipt(undefined,'superseded')]}})], retired:1, failure:timeout},
  {name:'failed current repair', states:[gpu({scanout:{retirements:[receipt(undefined,'failed')]}})], retired:1, failure:timeout},
  {name:'undrawn current repair', states:[gpu({scanout:{retirements:[]}})], retired:1, failure:timeout},
  {name:'qualified flag false', states:[gpu(),gpu({qualified:false})], retired:1, failure:unusable},
  {name:'lost even if qualified is stale', states:[gpu(),gpu({lost:true})], retired:1, failure:unusable},
  {name:'disposed even if qualified is stale', states:[gpu(),gpu({disposed:true})], retired:1, failure:unusable},
  {name:'poisoned even if qualified is stale', states:[gpu(),gpu({poisoned:true})], retired:1, failure:unusable},
  {name:'epoch changed after capture', states:[gpu(),gpu({epoch:'0000000000000004'})], retired:1, failure:unusable},
  {name:'GPU failed counter', states:[gpu(),gpu({counters:{failed:1}})], retired:1, failure:unusable},
  {name:'stopped CPU', states:[gpu()], retired:1, stopped:true, failure:unusable},
];
async function execute(source, vector) {
  let clock=0, calls=0;
  const events=[];
  const body = ['let retiredInstructions=initialRetired,stopped=initialStopped,gpuWarmData={};',
    'const setTimeout=(resolve)=>{retiredInstructions=nextRetired;advance();resolve();};',source,
    'return {restored:gpuWarmData===null};'].join('\n');
  const run = new AsyncFunction('productionGpu','performance','initialRetired','nextRetired',
    'initialStopped','advance','onState','finish','taskQuiescence','machine',body);
  const productionGpu={inspect:()=>structuredClone(vector.states[Math.min(calls++, vector.states.length-1)])};
  let value,error;
  try { value=await run(productionGpu,{now:()=>clock},vector.retired,vector.nextRetired??vector.retired,
    vector.stopped??false,()=>{clock=30001;},s=>events.push(['state',s]),
    s=>events.push(['finish',s]),{stop:async()=>events.push(['stop'])},
    {closeStorage:()=>events.push(['closeStorage'])}); }
  catch (caught) {error=caught.message;}
  return {name:vector.name,events,value,error,inspections:calls,simulatedMillis:clock};
}
function judge(actual, vector) {
  if(vector.outcome==='ready') {
    assert.equal(actual.error,undefined,vector.name);
    assert.deepEqual(actual.value,{restored:true});
    assert.deepEqual(actual.events,[['state','restored']]);
  } else {
    assert.match(actual.error??'',vector.failure,vector.name);
    assert.deepEqual(actual.events,[['finish','error'],['stop'],['closeStorage']]);
    assert.equal(actual.value,undefined);
  }
}
const report={schema:'independent-exact-warm-guard-vectors-v1',kind:'synthetic branch audit, not physical GPU evidence',
  loaderSha256:sha(loader),extractedSha256:sha(block),status:'running',rows:[],negativeControls:[]};
for(const vector of vectors) {const result=await execute(block,vector);judge(result,vector);report.rows.push(result);}
const mutants=[
  {name:'remove CPU-progress predicate',from:'retiredInstructions>0&&freshDrawn',to:'freshDrawn',vector:vectors[4]},
  {name:'accept stale or cancelled receipt',from:"receipt.epoch===epoch&&receipt.status==='drawn'",to:'true',vector:vectors[5]},
  {name:'ignore unusable owner flags',from:'stopped || !current.qualified || current.lost || current.disposed || current.poisoned || current.epoch!==epoch || current.counters.failed>0',to:'false',vector:vectors[13]},
];
for(const mutant of mutants) {
  assert.equal(block.split(mutant.from).length,2,'one exact private mutation');
  const changed=block.replace(mutant.from,mutant.to),result=await execute(changed,mutant.vector);
  assert.throws(()=>judge(result,mutant.vector),'the independent oracle rejects weakened readiness');
  report.negativeControls.push({name:mutant.name,privateBlockSha256:sha(changed),observed:result,oracleRejected:true});
}
report.status='passed';


// Execute the actual page-side timeout selector, keeping the loader/worker unchanged.
const main = await fs.readFile(path.join(repo, 'web/main.js'), 'utf8');
const policyStart = main.indexOf('workerBootTimeoutMs:');
assert.ok(policyStart >= 0);
const policy = main.slice(policyStart + 'workerBootTimeoutMs:'.length, main.indexOf(',\n', policyStart)).trim();
const select = expression => new Function('opts', 'query', 'return (' + expression + ');');
const selector = select(policy);
const policyRows = [
  {name:'GPU warm default', opts:{virgl:true,bootSnapshot:true}, query:'', expected:600000},
  {name:'GPU default snapshot selection', opts:{virgl:true}, query:'', expected:600000},
  {name:'explicit GPU cold keeps protocol default', opts:{virgl:true,bootSnapshot:false}, query:'', expected:undefined},
  {name:'software warm keeps protocol default', opts:{virgl:false,bootSnapshot:true}, query:'', expected:undefined},
  {name:'ordinary guest keeps protocol default', opts:{}, query:'', expected:undefined},
  {name:'explicit tiny GPU budget', opts:{virgl:true,bootSnapshot:true}, query:'workerBootTimeoutMs=1000', expected:1000},
  {name:'explicit ordinary budget', opts:{}, query:'workerBootTimeoutMs=200000', expected:200000},
  {name:'zero explicit budget bounds to1', opts:{virgl:true}, query:'workerBootTimeoutMs=0', expected:1},
  {name:'empty explicit budget bounds to1', opts:{virgl:true}, query:'workerBootTimeoutMs=', expected:1},
  {name:'malformed explicit budget bounds to1', opts:{virgl:true}, query:'workerBootTimeoutMs=invalid', expected:1},
  {name:'negative explicit budget bounds to1', opts:{virgl:true}, query:'workerBootTimeoutMs=-5', expected:1},
];
for (const row of policyRows) assert.equal(selector(row.opts,new URLSearchParams(row.query)),row.expected,row.name);
const oldDefault = 'opts.virgl && opts.bootSnapshot !== false ? 600_000 : undefined';
assert.equal(policy.split(oldDefault).length,2);
const oldSelector=select(policy.replace(oldDefault,'undefined'));
assert.throws(()=>assert.equal(oldSelector({virgl:true,bootSnapshot:true},new URLSearchParams()),600000));
assert.equal(policy.split('query.has("workerBootTimeoutMs")').length,2);
const ignoredOverride=select(policy.replace('query.has("workerBootTimeoutMs")','false'));
assert.throws(()=>assert.equal(ignoredOverride({virgl:true},new URLSearchParams('workerBootTimeoutMs=1000')),1000));
console.log(JSON.stringify({status:report.status,scope:report.kind,guardVectors:report.rows.length,guardMutants:report.negativeControls.length,
  timeoutVectors:policyRows.length,timeoutMutants:2,loaderSha256:sha(loader),mainSha256:sha(main),extractedGuardSha256:report.extractedSha256,timeoutSelectorSha256:sha(policy)}));
