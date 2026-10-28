#!/usr/bin/env node
// E9-T22s: attribute the first block error from the sealed cold prefix.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {authenticateOfflineBase,verifiedBaseRequest} from './e9-cold-block-base-integrity.mjs';

const args=process.argv.slice(2),argument=name=>{
  const at=args.indexOf(name);assert(at>=0&&args[at+1],name);return args[at+1];
};
const root=path.resolve(import.meta.dirname,'../..'),web=path.join(root,'web/dist');
const source=await fs.realpath(path.resolve(argument('--source')));
const requestedOut=path.resolve(argument('--output'));
const out=path.join(await fs.realpath(path.dirname(requestedOut)),path.basename(requestedOut));
const development=args.includes('--development');
const limit=argument('--limit');
assert(/^[1-9][0-9]*$/.test(limit)&&BigInt(limit)===14450000000n);
const baseReportFile=await fs.realpath(path.resolve(argument('--base-report')));
assert(out!==source&&!out.startsWith(source+path.sep),'source and output must be separate');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const treeDigest=async directory=>{
  const whole=createHash('sha256');
  const visit=async(relative='')=>{
    for(const name of (await fs.readdir(path.join(directory,relative))).sort()){
      const next=path.join(relative,name),full=path.join(directory,next),stat=await fs.lstat(full);
      if(stat.isDirectory()){whole.update('d\0'+next+'\0');await visit(next);}
      else if(stat.isSymbolicLink())whole.update('l\0'+next+'\0'+await fs.readlink(full)+'\0');
      else{assert(stat.isFile(),'unexpected source evidence type '+next);
        const file=createHash('sha256');for await(const part of createReadStream(full))file.update(part);
        whole.update('f\0'+next+'\0'+String(stat.size)+'\0'+file.digest('hex')+'\0');}
    }
  };
  await visit();return whole.digest('hex');
};
const freeBytes=async directory=>{
  const stat=await fs.statfs(directory);
  return String(BigInt(stat.bavail)*BigInt(stat.bsize));
};
const git=(...values)=>execFileSync('git',values,{cwd:root,encoding:'utf8'}).trim();
const PIN={
  report:'0d2d37842f96a7d9b203a420d6debec108f982322a562838605c56d2b74ab17f',
  recovery:'a5f79826020bf0858cae9211204338ed481aae15e7eff3a7de60f3aeed00e7d8',
  storage:'3f6b6d4282023372d3b7c7f5bf59d5eed7828e4d36d952eff79dd9ab63872035',
  closure:'81fbecf6c138652d5cf533cd32fbe576c1f4133562864e395664f76cf28f6677',
  byteOracle:'bf77383a441d5c0edf5d3959852126c99b266ae9eaf5cc713d1cf7c67caaf3c5',
};
const readPinned=async(file,digest)=>{
  const bytes=await fs.readFile(path.join(source,file));
  assert.equal(sha(bytes),digest,'changed cold graph input '+file);return bytes;
};
const sourceReport=JSON.parse(await readPinned('report.json',PIN.report));
const recovery=JSON.parse(await readPinned('recovery-report.json',PIN.recovery));
const archive=JSON.parse(await readPinned('saved/storage.json',PIN.storage));
const priorClosure=JSON.parse(await readPinned('retained-closure/report.json',PIN.closure));
const priorOracle=JSON.parse(await readPinned('cold-prefix-byte-oracle/report.json',PIN.byteOracle));
if(!development)assert.equal(git('status','--porcelain'),'','freeze exact diagnostic harness');
const basePointer=JSON.parse(await fs.readFile(baseReportFile));
const offlineBase=await authenticateOfflineBase(baseReportFile,
  path.join(root,'target/e9-workload-base-cache',
    'manifest-'+basePointer.manifestSha256+'.json'));
assert.equal(sourceReport.status,'cold-prefix-frontier');
assert.equal(sourceReport.result.final.transition,'21700000000');
assert.equal(sourceReport.result.frontier.reason,'host-space-admission');
assert.equal(recovery.status,'recovered-prefix-passed');
assert.equal(recovery.source.head,'720f53afe0153a2425e4f01a607ab16c5705fa6b');
assert.equal(recovery.source.treeSha256Before,recovery.source.treeSha256After);
assert.equal(priorClosure.status,'retained-closure-passed');
assert.equal(priorOracle.status,'exact-v3-prefix-passed');
assert.equal(archive.stores.sessions.length,1);
const sourceError=sourceReport.result.frontier.consoleTail.match(
  /I\/O error, dev vda, sector ([0-9]+) op 0x1:\(WRITE\)/);
assert(sourceError,'original source lacks the first vda write error');
const sourceExt4=sourceReport.result.frontier.consoleTail.match(
  /EXT4-fs warning \(device vda\):[^\r\n]*I\/O error[^\r\n]*/);
assert(sourceExt4,'original source lacks the EXT4 write-error witness');
assert(sourceReport.result.console.includes(sourceError[0])
  &&sourceReport.result.console.includes(sourceExt4[0])
  &&sourceReport.result.console.indexOf(sourceError[0])
    <sourceReport.result.console.indexOf(sourceExt4[0]),
  'original source vda/EXT4 error ordering changed');
const receipts=JSON.parse(await readPinned(sourceReport.result.receiptFile.file,
  sourceReport.result.receiptFile.sha256));
const serialReceipts=receipts.filter(row=>row.channel===21);
const errorReceipt=serialReceipts.at(-1);
assert.equal(errorReceipt.transition,'14365728640',
  'cold guest error moved from the sealed final serial receipt');
const consoleBytes=Buffer.from(sourceReport.result.console);
const finalSerial=consoleBytes.subarray(-errorReceipt.bytesLength);
assert.equal(sha(finalSerial),errorReceipt.sha256,
  'last serial receipt differs from the sealed vda/EXT4 output');
assert(finalSerial.includes(Buffer.from(sourceError[0]))
  &&finalSerial.includes(Buffer.from(sourceExt4[0])),
  'vda/EXT4 error is absent from the final serial receipt');
const checkpointAt=transition=>{
  const point=sourceReport.result.checkpoints.find(row=>row.transition===transition);
  assert(point,'missing cold checkpoint '+transition);return point;
};
const anchorCheckpoint=checkpointAt('13950000000');
const targetCheckpoint=checkpointAt('14350000000');
const nextCheckpoints=['14400000000','14450000000'].map(checkpointAt);
assert(anchorCheckpoint.full&&!targetCheckpoint.full
  &&BigInt(targetCheckpoint.transition)<BigInt(errorReceipt.transition)
  &&BigInt(errorReceipt.transition)<BigInt(nextCheckpoints[0].transition),
  'source checkpoint does not bracket the original vda/EXT4 error');
let serialOffset=0;
for(const row of serialReceipts){
  assert(Number.isSafeInteger(row.bytesLength)&&row.bytesLength>=0,
    'sealed serial receipt length');
  const bytes=consoleBytes.subarray(serialOffset,serialOffset+row.bytesLength);
  assert.equal(bytes.length,row.bytesLength,'serial receipt exceeds sealed console');
  assert.equal(sha(bytes),row.sha256,
    'sealed console differs from serial receipt '+row.sequence);
  serialOffset+=row.bytesLength;
}
assert.equal(serialOffset,consoleBytes.length,
  'serial receipt stream does not cover the full source console');
const serialPrefixAt=checkpoint=>{
  const length=serialReceipts.filter(row=>BigInt(row.sequence)<=BigInt(checkpoint.sequence))
    .reduce((sum,row)=>sum+row.bytesLength,0);
  return consoleBytes.subarray(0,length);
};
const sourceConsolePrefix=serialPrefixAt(targetCheckpoint);
assert.equal(sha(serialPrefixAt(anchorCheckpoint)),sha(sourceConsolePrefix),
  'this cold prefix must have no serial receipts between anchor and target');
const sourceConsoleWitnesses=nextCheckpoints.map(row=>{
  const bytes=serialPrefixAt(row);
  return {transition:row.transition,sha256:sha(bytes),bytes:bytes.length};
});
const sourceReceipts=receipts.filter(row=>BigInt(row.sequence)>BigInt(targetCheckpoint.sequence)
  &&BigInt(row.sequence)<=BigInt(nextCheckpoints.at(-1).sequence))
  .map(row=>({position:Object.fromEntries(['transition','phase','ordinal','sequence','retired']
    .map(key=>[key,row[key]])),ticket:row.ticket,channel:row.channel,outcome:row.outcome,
    bytesLength:row.bytesLength,sha256:row.sha256}));
assert.equal(sourceReceipts.length,13);
assert(!sourceConsolePrefix.includes(Buffer.from(sourceError[0]))
  &&sourceConsoleWitnesses.every(row=>row.sha256===sha(consoleBytes)),
  'serial receipt checkpoints do not bracket the original block error');
const sourceTreeBefore=await treeDigest(source);
await fs.mkdir(out,{recursive:false});
const report={task:'E9-T22s',status:'running',development,
  scope:'Passive first block-error attribution from an authenticated exact cold checkpoint; no first-frame or causality claim',
  source:{directory:source,pins:PIN,sourceHead:recovery.source.head,
    recoveredHead:recovery.head,failedAt:recovery.source.failedAt,
    originalTreeSha256:recovery.source.treeSha256Before,
    recoveredTreeSha256Before:sourceTreeBefore},
  sourceGuestAtFrontier:{serialShell:sourceReport.result.serialShell,
    networkService:sourceReport.result.networkServiceBefore,
    serviceOrdering:sourceReport.result.serviceOrdering,
    desktopCandidates:sourceReport.result.desktopCandidates,
    guestConsoleTail:sourceReport.result.frontier.consoleTail,
    firstErrorReceipt:{transition:errorReceipt.transition,sequence:errorReceipt.sequence,
      bytesLength:errorReceipt.bytesLength,sha256:errorReceipt.sha256},
    sourceConsolePrefixSha256:sha(sourceConsolePrefix),sourceConsoleWitnesses},
  head:git('rev-parse','HEAD'),limit,started:new Date().toISOString(),
  browser:{origin:recovery.browser.origin,version:null,sourceVersion:recovery.browser.version,
    staticRequests:[],blockedRequests:[],blockedSockets:[],pageErrors:[],localBaseReads:[]},
  offlineBase:offlineBase?{reportSha256:offlineBase.reportSha256,
    indexSha256:offlineBase.indexSha256,manifestSha256:offlineBase.manifestSha256,
    uniqueChunks:offlineBase.uniqueChunks,bytes:offlineBase.bytes}:null,
  preflight:{},progress:[],result:null};
let context,page,traceStarted=false,server;
try{
  report.hostFreeBytesBefore=await freeBytes(out);
  // The two independent accepted oracles run against symlinked, read-only
  // source inputs. Their new proof directories live only in this output.
  const view=path.join(out,'input-view');await fs.mkdir(view);
  for(const name of ['report.json','saved','initial.state','final.state',
    'replay-window-0.state','replay-window-1.state'])
    await fs.symlink(path.join(source,name),path.join(view,name));
  const oracle=(command,values)=>execFileSync(command,values,{cwd:root,encoding:'utf8',
    stdio:['ignore','pipe','pipe'],timeout:45*60*1000});
  if(development){
    report.preflight={status:'skipped-in-development; never acceptance evidence'};
  }else{
    report.preflight.closure=oracle('node',['tools/verify/e9-workload-retained-closure.mjs',
      '--directory',view,'--prefix']).trim();
    report.preflight.byteOracle=oracle('python3',['-B','tools/verify/e9-cold-prefix-files.py',
      '--directory',view]).trim();
    const freshClosure=JSON.parse(await fs.readFile(path.join(view,'retained-closure/report.json')));
    const freshOracle=JSON.parse(await fs.readFile(path.join(view,'cold-prefix-byte-oracle/report.json')));
    assert.equal(freshClosure.status,'retained-closure-passed');
    assert.equal(freshClosure.objects,3523);assert.equal(freshClosure.chunks,13177);
    assert.equal(freshClosure.browserSha256,PIN.report);
    assert.equal(freshOracle.status,'exact-v3-prefix-passed');
    assert.equal(freshOracle.checkpoints,435);
    assert.equal(freshOracle.finalWitness,sourceReport.result.final.digest);
    report.preflight.closureSha256=sha(await fs.readFile(path.join(view,'retained-closure/report.json')));
    report.preflight.byteOracleSha256=sha(await fs.readFile(path.join(view,'cold-prefix-byte-oracle/report.json')));
  }
  const pins=new Map();
  for(const row of [...sourceReport.served,...sourceReport.replayStaticAssets]){
    if(pins.has(row.name))assert.equal(pins.get(row.name),row.sha256,'changed source asset pin');
    pins.set(row.name,row.sha256);
  }
  const diagnostic='/__verify__/e9-cold-block-error-worker.mjs';
  const pageModule='/__verify__/e9-cold-block-error-page.mjs';
  const packagePrefix='/__verify__/e9-t22s-pkg/';
  const diagnosticFiles=new Map();
  const addDiagnostic=(name,bytes)=>{assert(!pins.has(name),'diagnostic asset collides with source');diagnosticFiles.set(name,bytes);pins.set(name,sha(bytes));};
  const workerSource=await fs.readFile(path.join(root,'tools/verify/e9-cold-block-error-worker.mjs'));
  const pageSource=await fs.readFile(path.join(root,'tools/verify/e9-cold-block-error-page.mjs'));
  addDiagnostic(diagnostic,workerSource);addDiagnostic(pageModule,pageSource);
  const packageDir=path.join(root,'target/e9-t22s-diagnostic-pkg');
  const addPackage=async(relative='')=>{for(const name of (await fs.readdir(path.join(packageDir,relative))).sort()){const next=path.join(relative,name),full=path.join(packageDir,next),stat=await fs.lstat(full);if(stat.isDirectory())await addPackage(next);else if(stat.isFile()&&/\.(js|wasm)$/.test(next))addDiagnostic(packagePrefix+next.replaceAll(path.sep,'/'),await fs.readFile(full));}};
  await addPackage();
  const diagnosticWasm=diagnosticFiles.get(packagePrefix+'wasm_vm_wasm_bg.wasm');
  assert(diagnosticWasm&&diagnosticFiles.has(packagePrefix+'wasm_vm_wasm.js'),'private wasm bundle incomplete');
  report.diagnosticAssets=[...diagnosticFiles].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha(bytes)}));
  for(const [name,digest]of pins){
    assert(name.startsWith('/')&&!name.includes('..'));
    if(diagnosticFiles.has(name))continue;
    assert.equal(sha(await fs.readFile(path.join(web,'.'+name))),digest,
      'recovered replay runtime changed '+name);
  }
  const origin=new URL(recovery.browser.origin);
  assert.equal(origin.hostname,'127.0.0.1');
  const mime=new Map([['.js','text/javascript'],['.mjs','text/javascript'],
    ['.wasm','application/wasm'],['.json','application/json'],['.css','text/css']]);
  server=createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,origin).pathname;
      assert.equal(req.method,'GET');
      if(name==='/'){
        res.writeHead(200,{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin',
          'Cross-Origin-Embedder-Policy':'require-corp'}).end('<!doctype html><title>Offline cold frontier</title><link rel="icon" href="data:,">');
        return;
      }
      assert(pins.has(name),'unsealed diagnostic asset '+name);
      const bytes=diagnosticFiles.get(name)??await fs.readFile(path.join(web,'.'+name));
      assert.equal(sha(bytes),pins.get(name),'diagnostic asset changed '+name);
      res.writeHead(200,{'Content-Type':mime.get(path.extname(name))??'application/octet-stream',
        'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin',
        'Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
    }catch(error){res.writeHead(500).end(String(error));}
  });
  await new Promise((resolve,reject)=>server.once('error',reject)
    .listen(Number(origin.port),origin.hostname,resolve));
  const profile=path.join(out,'chrome-profile');
  execFileSync('cp',['-cR',path.join(source,'chrome-profile'),profile],
    {stdio:['ignore','pipe','pipe']});
  context=await chromium.launchPersistentContext(profile,{headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],serviceWorkers:'block',
    viewport:{width:1200,height:900}});
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin.origin||request.method()!=='GET'||url.search
      ||url.pathname!=='/'&&!pins.has(url.pathname)){
      report.browser.blockedRequests.push({url:url.href,method:request.method()});
      return route.abort();
    }
    if(url.pathname!=='/')report.browser.staticRequests.push({name:url.pathname,sha256:pins.get(url.pathname)});
    return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>{
    report.browser.blockedSockets.push(socket.url());socket.close();
  });
  await context.tracing.start({screenshots:true,snapshots:false,sources:true});traceStarted=true;
  page=await context.newPage();page.setDefaultTimeout(0);
  page.on('pageerror',error=>report.browser.pageErrors.push(String(error.stack??error)));
  page.on('console',message=>{if(message.type()==='error')report.browser.pageErrors.push(message.text());});
  const version=await(await context.newCDPSession(page)).send('Browser.getVersion');
  report.browser.version=version.product.slice('Chrome/'.length);
  await page.exposeFunction('frontierProgress',async value=>{
    report.progress.push(value);if(report.progress.length>128)report.progress.shift();
    await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(value,null,2)+'\n');
    console.log(JSON.stringify(value));
  });
  await page.exposeFunction('readOfflineBase',async ref=>{
    assert(offlineBase,'offline base cache was not provided');
    const bytes=await verifiedBaseRequest(offlineBase.files,ref);
    report.browser.localBaseReads.push({sha256:ref.sha256,length:bytes.length,
      source:'frozen-image-manifest-verified-local-file'});
    return bytes.toString('base64');
  });
  await page.goto(origin.origin+'/');
  report.result=await page.evaluate(async input=>
    (await import(input.pageModule)).run(input),{
    pageModule,diagnosticWorker:diagnostic,diagnosticWasmSha256:sha(diagnosticWasm),
    database:sourceReport.result.database,id:sourceReport.result.sessionId,
    manifestSha256:sourceReport.result.authenticatedHistory.manifestSha256,
    statistics:sourceReport.result.retentionAtEnd,
    anchorCheckpoint,targetCheckpoint,nextCheckpoints,
    errorReceipt:{transition:errorReceipt.transition,sequence:errorReceipt.sequence,
      sha256:errorReceipt.sha256,bytesLength:errorReceipt.bytesLength},
    sourceConsolePrefix:[...sourceConsolePrefix],
    sourceConsolePrefixSha256:sha(sourceConsolePrefix),
    sourceConsoleWitnesses,sourceConsoleSha256:sha(consoleBytes),
    sourceReceipts,
    sourceReportSha256:PIN.report,
    sourceErrorSector:sourceError[1],
    sourceErrorLine:sourceError[0],sourceExt4Line:sourceExt4[0],
    sourceConsole:sourceReport.result.console,
    retainedObjects:archive.stores.objects.map(row=>row.key),
    baseManifestSha256:offlineBase.manifestSha256,
    limit,nextRequest:0});
  assert.equal(report.browser.blockedRequests.length,0,'no blocked continuation requests');
  assert.equal(report.browser.blockedSockets.length,0,'no attempted continuation sockets');
  assert.equal(report.browser.pageErrors.length,0,'no browser page errors');
  assert.equal(report.result?.localBaseReads,report.browser.localBaseReads.length,
    'offline base IPC receipt count changed');
  assert(['block-error-attributed','exact-witness-divergence'].includes(report.result.status),
    'the first block failure must be attributed or an exact divergence proven');
  if(report.result.firstFailure||report.result.divergence){
    const trace={task:'E9-T22s',sourceReportSha256:PIN.report,
      sourceCheckpoint:report.result.source.checkpoint,
      sourceWitnesses:report.result.originalRuntime?.witnesses??[],
      diagnosticWitnesses:report.result.intermediateWitnesses,
      unavailableBase:report.result.unavailableBase,
      failureControl:report.result.failureControl,
      coarse:report.result.coarseFailure,fineBracket:report.result.fineBracket,
      firstFailure:report.result.firstFailure,classification:report.result.classification,
      guestError:report.result.guestError,
      divergence:report.result.divergence,
      outputAtFrontier:report.result.source.outputAtFrontier};
    const bytes=Buffer.from(JSON.stringify(trace,null,2)+'\n');
    await fs.writeFile(path.join(out,'request-trace.json'),bytes);
    report.requestTrace={file:'request-trace.json',bytes:bytes.length,sha256:sha(bytes)};
  }
  report.status=development?'development-'+report.result.status:report.result.status;
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  try{if(page)await page.screenshot({path:path.join(out,'screen.png'),fullPage:true});}
  catch(error){report.screenshotError=String(error.message);}
  if(traceStarted)try{await context.tracing.stop({path:path.join(out,'browser-trace.zip')});}
    catch(error){report.traceError=String(error.message);}
  for(const name of ['screen.png','browser-trace.zip']){
    try{const bytes=await fs.readFile(path.join(out,name));
      report.browser[name]={bytes:bytes.length,sha256:sha(bytes)};}
    catch(error){report.browser[name]={error:String(error.message)};}
  }
  await context?.close().catch(error=>{report.contextCloseError=String(error.message);});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  report.hostFreeBytesAfter=await freeBytes(out);
  report.storage={hostFreeBytesBefore:report.hostFreeBytesBefore,
    hostFreeBytesAfter:report.hostFreeBytesAfter,
    hostUsedBytesDelta:(BigInt(report.hostFreeBytesBefore)
      -BigInt(report.hostFreeBytesAfter)).toString(),
    offlineBaseUniqueBytes:offlineBase?.bytes??'0'};
  report.source.recoveredTreeSha256After=await treeDigest(source);
  if(report.source.recoveredTreeSha256After!==sourceTreeBefore){
    report.status='failed';report.sourceChanged=true;process.exitCode=1;
  }
  report.finished=new Date().toISOString();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,output:out,failure:report.failure,
    firstFailure:report.result?.firstFailure?.position,
    divergence:report.result?.divergence?.position}));
}
