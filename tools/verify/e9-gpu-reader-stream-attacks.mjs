// Browser proof uses real recorded histories. Stored mutants are never executions.
export async function readGpuHistoryWindows(page,proof){
 return page.evaluate(async proof=>{
  const {SessionStore}=await import('/session-store.js'),{SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js'),{SessionGpuJournal}=await import('/session-gpu-journal.js'),{checkpointHash}=await import('/session-checkpoints.js'),module=await import('/pkg/wasm_vm_wasm.js');
  const store=await SessionStore.open(proof.database),report={cases:[],checks:[],candidates:0};let foreign;
  globalThis.__gpuReaderAttackReport=report;const original=module.WasmLinux.newExactGpuSession;module.WasmLinux.newExactGpuSession=()=>{report.candidates++;throw Error('reader allocated a replay candidate');};
  const need=(ok,detail)=>{if(!ok)throw Error('Reader proof: '+detail);};
  const rejects=async(name,call,code='StaleCursor')=>{let error;try{await call();}catch(e){error={code:e.code,message:e.message,anchor:e.anchor??null};}need(error?.code===code,name+': '+JSON.stringify(error));report.checks.push({name,...error});};
  try{
   for(const recorded of [...proof.cases,...(proof.physical?[proof.physical]:[])]){
    const result={variant:recorded.variant,windows:[],pages:[]};report.cases.push(result);let escaped,stale;
    await SessionGpuHistoryReader.withOpen(store,recorded.id,{},async reader=>{
     escaped=reader;result.metadata=reader.metadata;need(result.metadata.nativeAdmitted===false&&result.metadata.storageAuthenticated,'storage-only reader');
     let cursor=reader.initialEventCursor;
     if(foreign)await rejects('foreign-reader-cursor',()=>reader.nextReceiptWindow(foreign));
     if(cursor){await rejects('copied-cursor',()=>reader.nextReceiptWindow({...cursor}));await rejects('wrong-stream-cursor',()=>reader.nextWitnessWindow(cursor));}
     while(cursor){
      const consumed=cursor,reading=reader.nextReceiptWindow(cursor);if(result.windows.length===0)await rejects('concurrent-'+recorded.variant+'-cursor',()=>reader.nextReceiptWindow(cursor),'ReaderBusy');const window=await reading;need(window.nativeAdmitted===false,'native window claim');
      const {receipts,payloads,nextCursor,...identity}=window;
      result.windows.push({...structuredClone(identity),receipts:receipts.map(row=>{const {bytes,...fields}=row;return {...structuredClone(fields),byteLength:bytes.length,bytesSha256:checkpointHash(bytes)};}),payloads:payloads.map(body=>({sha256:[...body.sha256].map(b=>b.toString(16).padStart(2,'0')).join(''),length:body.length,bytesSha256:checkpointHash(body.bytes)}))});
      await rejects('replayed-'+recorded.variant+'-window-'+window.index,()=>reader.nextReceiptWindow(consumed));
      foreign=consumed;stale=consumed;
      // Returned data belongs to this caller and cannot authorize later windows.
      receipts[0].transition='999999999';receipts[0].ticket='999999999';receipts[0].outcome[0]='4';receipts[0].bytes.fill(255);
      window.range.lastPosition.sequence='999999999';window.session.revision='999999999';cursor=nextCursor;
     }
     cursor=reader.initialWitnessCursor;
     while(cursor){const consumed=cursor,window=await reader.nextWitnessWindow(cursor),{rows,nextCursor,...identity}=window;result.pages.push({...identity,rows:rows.map(row=>({...row,digest:[...row.digest]}))});await rejects('replayed-'+recorded.variant+'-page-'+window.index,()=>reader.nextWitnessWindow(consumed));rows[0].sequence='999999999';rows[0].digest.fill(255);cursor=nextCursor;}
     result.resident=reader.resident;
    });
    let revoked;try{await escaped.nextReceiptWindow(stale);}catch(error){revoked=error.code;}need(revoked==='ReaderRevoked','callback exit failed to revoke reader');report.checks.push({name:'callback-exit-'+recorded.variant,code:revoked});
    need(result.windows.reduce((sum,w)=>sum+w.range.count,0)===recorded.receipts,'complete receipt counts');need(result.windows[0].range.firstSequence==='1'&&result.windows.at(-1).range.lastSequence===recorded.final.sequence,'exact endpoints');
   }
   const count=proof.cases[0],small=await SessionGpuJournal.readExact(store,count.smallV1.id,{configuration:count.configuration});need(small.receipts.length===2048&&small.witnesses.length===2&&small.manifest.end.sequence===count.smallV1.end.sequence,'unchanged small v1 reader');report.smallV1={id:count.smallV1.id,receipts:small.receipts.length,witnesses:small.witnesses.length,begin:small.manifest.begin,end:small.manifest.end};
   need(report.candidates===0,'candidate allocation');return report;
  }finally{module.WasmLinux.newExactGpuSession=original;await store.close();}
 },proof);
}
export async function attackGpuHistoryReader(page,proof){
 return page.evaluate(async proof=>{
  const {SessionStore}=await import('/session-store.js'),{SessionGpuHistoryReader}=await import('/session-gpu-history-reader.js'),{sessionValidateManifest,sessionIndexEventChunk}=await import('/session-pkg/wasm_vm_session.js'),{checkpointHash,checkpointReference,checkpointChunks,readCheckpointObject}=await import('/session-checkpoints.js'),{witnessCommitment,witnessExtension}=await import('/session-witness-pages.js'),{decodeKeyframeDescriptor,encodeKeyframeDescriptor,isKeyframeDescriptorPrefix}=await import('/session-keyframes.js'),{decodeGpuExactFrame,encodeGpuExactFrame}=await import('/session-gpu-replay-format.js'),{encodeCheckpointData}=await import('/renderer/virgl-command/checkpoint-codec.mjs'),module=await import('/pkg/wasm_vm_wasm.js');
  const store=await SessionStore.open(proof.database),report={checks:[],candidates:0,consumerCallbacks:0,mutants:[]},encoder=new TextEncoder(),decoder=new TextDecoder(),json=v=>encoder.encode(JSON.stringify(v)),parse=b=>JSON.parse(decoder.decode(b));
  const need=(ok,detail)=>{if(!ok)throw Error('Reader attack: '+detail);},canonical=v=>sessionValidateManifest(json(v));
  const rawDb=await new Promise((resolve,reject)=>{const q=indexedDB.open(proof.database);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  const raw=(table,key,replacement,remove=false)=>new Promise((resolve,reject)=>{const tx=rawDb.transaction(table,replacement===undefined&&!remove?'readonly':'readwrite',{durability:'strict'});let saved;tx.oncomplete=()=>resolve(saved);tx.onabort=()=>reject(tx.error);const object=tx.objectStore(table),q=object.get(key);q.onsuccess=()=>{saved=q.result;if(remove)object.delete(key);else if(replacement!==undefined)object.put(replacement,key);};});
  globalThis.__gpuReaderAttackReport=report;const original=module.WasmLinux.newExactGpuSession;module.WasmLinux.newExactGpuSession=()=>{report.candidates++;throw Error('reader allocated a replay candidate');};
  const refused=async(name,call,pattern,expectedAnchor)=>{let failure;try{await call();}catch(e){failure={message:e.message,code:e.code??null,anchor:e.anchor??null};}need(failure&&(!pattern||pattern.test(failure.message)),name+' did not reject: '+JSON.stringify(failure));if(expectedAnchor){need(failure.message.includes(expectedAnchor),name+' missing exact anchor '+expectedAnchor);need(/^[0-9a-f]{64}$/.test(failure.anchor?.object),name+' missing structured content anchor');}report.checks.push({name,...failure});return failure;};
  const unopened=id=>SessionGpuHistoryReader.withOpen(store,id,{},async()=>{report.consumerCallbacks++;throw Error('unsafe consumer callback');});
  const count=proof.cases[0],byteCase=proof.cases[1],opened=await store.openSession(count.id),manifest=parse(opened.manifest);
  const put=async(writer,bytes)=>{const ref=checkpointReference(bytes);await writer.put(ref,checkpointChunks(bytes));return ref;};
  const bindRuntime=async(m,writer,config)=>{
   const vm=await put(writer,json(config));m.machine.vm_build=vm.sha256;m.assets.find(a=>a.role==='vm').content=vm;let previous=null;
   for(const point of m.checkpoints){let ref=point.machine,prefix;for await(const bytes of store.stream(ref)){prefix=bytes.subarray(0,8);break;}let delta;if(isKeyframeDescriptorPrefix(prefix)){delta=decodeKeyframeDescriptor(await readCheckpointObject(store,ref,1048576));ref=delta.frame;}
    const frame=decodeGpuExactFrame(await readCheckpointObject(store,ref,2*1048576)),bytes=encodeGpuExactFrame({...frame.meta,runtime:vm.sha256},frame.native,frame.pending,frame.output),next=await put(writer,bytes);
    point.machine=delta?await put(writer,encodeKeyframeDescriptor({...delta,parent:previous,frame:next})):next;previous=point.machine;
   }
  };
  const candidate=async(name,mutate,pattern,base=manifest,accept=false)=>{
   const id='reader-attack-'+name,writer=await store.writer(id);let bytes;
   try{const m=structuredClone(base);m.id=id;await mutate(m,writer);bytes=canonical(m);await writer.publish(bytes);report.mutants.push({name,id,manifestSha256:checkpointHash(bytes),manifestBytes:[...bytes]});}
   finally{await writer.release();}
   try{if(accept){let rows=0;await SessionGpuHistoryReader.withOpen(store,id,{},async reader=>{let c=reader.initialEventCursor;while(c){const w=await reader.nextReceiptWindow(c);need(!w.nativeAdmitted,'storage-only format control');rows+=w.range.count;c=w.nextCursor;}});report.checks.push({name,status:'storage-format-control-accepted',rows,nativeExecutionClaimed:false});}else await refused(name,()=>unopened(id),pattern);}finally{await raw('sessions',id,undefined,true);}
  };
  try{
   // CAS corruption is introduced in a true middle object, then fully restored.
   const middle=manifest.events[Math.floor(manifest.events.length/2)].content;
   const byteManifest=byteCase.saved.manifest,bodyChunk=byteManifest.events[Math.floor(byteManifest.events.length/2)],bodyRecords=parse(await readCheckpointObject(store,bodyChunk.content,4*1048576)),body=bodyRecords.find(r=>r.payload.storage==='blob').payload.content;
   for(const [label,ref]of [['middle-event',middle],['middle-body',body]]){
    const descriptor=await raw('objects',ref.sha256),part=descriptor.parts[Math.floor(descriptor.parts.length/2)],saved=await raw('chunks',part.sha256),bytes=new Uint8Array(await saved.arrayBuffer());
    for(const mode of ['corrupt','missing']){try{if(mode==='corrupt'){const bad=bytes.slice();bad[Math.floor(bad.length/2)]^=1;await raw('chunks',part.sha256,new Blob([bad]));}else await raw('chunks',part.sha256,undefined,true);
      await refused(mode+'-'+label,()=>unopened(label==='middle-event'?count.id:byteCase.id),/Corrupt|Authentication/,part.sha256);
     }finally{await raw('chunks',part.sha256,saved);}}
    try{await raw('objects',ref.sha256,{...descriptor,length:String(Number(descriptor.length)+1)});await refused('wrong-length-'+label,()=>unopened(label==='middle-event'?count.id:byteCase.id),/Corrupt|length|Authentication/);}finally{await raw('objects',ref.sha256,descriptor);}
   }
   // Storage-valid, rehashed chunks isolate the new ticket and adapter admission.
   const chunkIndex=Math.floor(manifest.events.length/3),sourceChunk=manifest.events[chunkIndex],sourceRecords=parse(await readCheckpointObject(store,sourceChunk.content,4*1048576));
   for(const kind of ['duplicate-ticket','noncanonical-ticket','exhausted-ticket','descending-before-ticket','wrong-adapter']){
    await candidate(kind,async(m,writer)=>{const rows=structuredClone(sourceRecords),index=Math.min(2,rows.length-1),intent=parse(Uint8Array.from(rows[index].intent)),prior=parse(Uint8Array.from(rows[index-1].intent));
     if(kind==='duplicate-ticket')intent.ticket=prior.ticket;
     if(kind==='noncanonical-ticket')intent.ticket='01';
     if(kind==='exhausted-ticket')intent.ticket='18446744073709551615';
     if(kind==='descending-before-ticket')intent.ticket='0';
     if(kind==='wrong-required')rows[index].required=false;
     if(kind==='wrong-adapter')intent.version=2;
     rows[index].intent=[...json(intent)];const bytes=json(rows),ref=await put(writer,bytes);m.events[chunkIndex]=parse(sessionIndexEventChunk(bytes));need(m.events[chunkIndex].content.sha256===ref.sha256,'rehashed chunk identity');
    },/Ticket|Adapter|input|Input|GPU/);
   }
   // Invalid coordinates are rejected even when injected after the writer boundary.
   for(const kind of ['duplicate-sequence','omitted-sequence','reversed-middle','same-transition-retired','wrong-required']){
    const saved=await raw('sessions',count.id),m=structuredClone(manifest),rows=structuredClone(sourceRecords),index=2;
    if(kind==='duplicate-sequence')rows[index].sequence=rows[index-1].sequence;
    if(kind==='omitted-sequence')rows[index].sequence=String(BigInt(rows[index].sequence)+1n);
    if(kind==='reversed-middle')[rows[index],rows[index+1]]=[rows[index+1],rows[index]];
    if(kind==='same-transition-retired')rows[index].retired='1';if(kind==='wrong-required')rows[index].required=false;
    const writer=await store.writer('reader-coordinate-mutant');let ref;try{ref=await put(writer,json(rows));}finally{await writer.release();}
    m.events[chunkIndex].content=ref;
    try{await raw('sessions',count.id,{...saved,manifest:json(m)});await refused(kind,()=>unopened(count.id),/Corrupt|Index|Order|Range|Authentication|retired/);}finally{await raw('sessions',count.id,saved);}
   }
   await candidate('unfinished-witness',async m=>{const c=witnessCommitment(m);c.finished=false;m.extensions[1]=witnessExtension(c);},/finish|Unfinished|Authentication/);
   // The required commitment and initial native-frame witness cannot be forged by a URL.
   {const saved=await raw('sessions',count.id),m=structuredClone(manifest),c=witnessCommitment(m);c.count++;m.extensions[1]=witnessExtension(c);try{await raw('sessions',count.id,{...saved,manifest:json(m)});await refused('invalid-witness-commitment',()=>unopened(count.id),/Corrupt|Witness|witness|page|Authentication/);}finally{await raw('sessions',count.id,saved);}}
   for(const kind of ['foreign-wasm','fake-current-renderer-stamp','changed-topology','changed-provider']){
    await candidate(kind,async(m,writer)=>{const config=structuredClone(count.configuration);
     if(kind==='foreign-wasm'){const ref=await put(writer,Uint8Array.of(0,97,115,109,1,0,0,0));config.wasm={...config.wasm,...ref};m.machine.wasm_build=ref.sha256;m.assets.find(a=>a.role==='wasm').content=ref;}
     if(kind==='fake-current-renderer-stamp'){const ref=await put(writer,json({GPU_CHECKPOINT_BUILD_ID:config.renderer.buildId}));config.renderer={...config.renderer,...ref};m.machine.gpu.renderer_build=ref.sha256;m.assets.find(a=>a.role==='gpu-renderer').content=ref;}
     if(kind==='changed-topology'){config.devices[0].irq++;m.machine.devices=structuredClone(config.devices);}
     if(kind==='changed-provider')config.networkPolicy.replay='live';
     await bindRuntime(m,writer,config);
    },/Identity|RendererStamp|provider|Authentication/);
   }
   await candidate('coherent-changed-profile',async(m,writer)=>{
    const config=structuredClone(count.configuration);need(config.profile.formatRoles.length>2,'profile roles');config.profile.formatRoles.splice(-2,2);
    m.machine.gpu.profile=checkpointHash(encodeCheckpointData(config.profile));await bindRuntime(m,writer,config);
   },/renderer profile|Authentication/);
   // Reposition two genuine control-observation records into one storage-valid
   // atomic scope. This is a derived admission control, never a native execution.
   {const physical=proof.physical,base=physical.saved.manifest;let selected,records,indices;
    for(let i=0;i<base.events.length;i++){const rows=parse(await readCheckpointObject(store,base.events[i].content,4*1048576)),found=rows.map((r,j)=>r.kind==='gpu'&&r.phase==='observe'?j:-1).filter(j=>j>=0);if(found.length>=2){selected=i;records=rows;indices=found.slice(0,2);break;}}
    need(selected!==undefined,'two real observations in one captured chunk');
    for(const gap of [false,true])await candidate(gap?'same-observe-ticket-gap':'same-observe-contiguous-control',async(m,writer)=>{
      const rows=structuredClone(records),a=rows[indices[0]],b=rows[indices[1]],intent=parse(Uint8Array.from(b.intent)),first=parse(Uint8Array.from(a.intent));
      need(indices[1]===indices[0]+1,'adjacent source observations');b.transition=a.transition;b.retired=a.retired;b.ordinal=a.ordinal+1;intent.ticket=gap?'50000':String(BigInt(first.ticket)+1n);b.intent=[...json(intent)];const bytes=json(rows);await put(writer,bytes);m.events[selected]=parse(sessionIndexEventChunk(bytes));
     },/ObservationTicketOrder/,base,!gap);
   }
   // The real shared session lock prevents append/deletion/GC during the read.
   await SessionGpuHistoryReader.withOpen(store,count.id,{},async reader=>{
    await refused('same-session-writer-busy',()=>store.writer(count.id),/WriterBusy/);await refused('same-session-delete-busy',()=>store.deleteSession(count.id),/MaintenanceBusy/);await refused('gc-busy',()=>store.collectGarbage(),/MaintenanceBusy/);
    const other=await store.writer('reader-other-writer');await other.release();report.checks.push({name:'other-session-writer-allowed'});
    // Change a durable middle chunk AFTER preflight; the next fetch must rehash.
    const ref=manifest.events[0].content,d=await raw('objects',ref.sha256),part=d.parts[0],saved=await raw('chunks',part.sha256),bad=new Uint8Array(await saved.arrayBuffer());bad[0]^=1;
    try{await raw('chunks',part.sha256,new Blob([bad]));await refused('fetch-time-corruption-poisons-reader',()=>reader.nextReceiptWindow(reader.initialEventCursor),/Corrupt|Authentication/);await refused('poisoned-cursor',()=>reader.nextWitnessWindow(reader.initialWitnessCursor),/ReaderRevoked/);}finally{await raw('chunks',part.sha256,saved);}
   });
   {const physical=proof.physical,ref=physical.payloads.find(p=>p.length===16384),descriptor=await raw('objects',ref.sha256),part=descriptor.parts[0],saved=await raw('chunks',part.sha256);
    await SessionGpuHistoryReader.withOpen(store,physical.id,{},async reader=>{const bad=new Uint8Array(await saved.arrayBuffer());bad[bad.length>>1]^=1;await raw('chunks',part.sha256,new Blob([bad]));let cursor=reader.initialEventCursor,windowsBefore=0;
     try{await refused('gpu-body-fetch-time-corruption',async()=>{while(cursor){const w=await reader.nextReceiptWindow(cursor);windowsBefore++;cursor=w.nextCursor;}},/Corrupt|Authentication/,part.sha256);report.checks.push({name:'gpu-body-failed-window-not-published',windowsBefore});}
     finally{await raw('chunks',part.sha256,saved);}
    });
   }
   const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
   for(const mode of ['abort','close']){
    const local=await SessionStore.open(proof.database),abort=new AbortController(),entered=deferred(),hold=deferred();let escaped,token;
    const reading=SessionGpuHistoryReader.withOpen(local,count.id,{signal:abort.signal},async reader=>{escaped=reader;token=reader.initialEventCursor;entered.resolve();await hold.promise;return 'late';});
    void reading.catch(()=>{});await entered.promise;if(mode==='abort')abort.abort();else await local.close();await refused(mode+'-pending-callback',()=>reading,/Cancelled|Closed/);
    await refused(mode+'-escaped-cursor',()=>escaped.nextReceiptWindow(token),/ReadLeaseRevoked|Closed|ReaderRevoked/);const writer=await store.writer(count.id);await writer.release();report.checks.push({name:mode+'-releases-writer'});hold.resolve();await Promise.resolve();await local.close();
   }
   // Both v2 and unsupported v1 scan storage before reader admission. Stop the
   // entire losing open, including every legacy metadata helper, after release.
   for(const [format,id] of [['v2',count.id],['v1',count.smallV1.id]])for(const mode of ['abort','close']){
    const local=await SessionStore.open(proof.database),abort=new AbortController(),blocked=deferred(),resume=deferred(),settled=deferred(),stream=local.stream.bind(local),open=local.openSession.bind(local);let first=true,monitor=false,lateTransactions=0,signalForwarded=false;
    const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(monitor)lateTransactions++;return transaction.apply(this,args);};
    local.openSession=async(...args)=>{try{return await open(...args);}finally{settled.resolve();}};
    local.stream=async function*(ref,options){if(first){first=false;signalForwarded=options?.signal===abort.signal;blocked.resolve();await resume.promise;}yield*stream(ref,options);};
    const reading=SessionGpuHistoryReader.withOpen(local,id,{signal:abort.signal},async()=>{report.consumerCallbacks++;throw Error('initial cancelled scan exposed callback');});void reading.catch(()=>{});
    try{await blocked.promise;if(mode==='abort')abort.abort();else await local.close();await refused(mode+'-'+format+'-initial-directory-scan',()=>reading,/Cancelled|Closed/);const writer=await store.writer(id);await writer.release();monitor=true;resume.resolve();await settled.promise;monitor=false;need(signalForwarded,format+' scan dropped signal');need(lateTransactions===0,mode+' '+format+' losing scan read after release');report.checks.push({name:mode+'-'+format+'-initial-scan-no-late-transactions',lateTransactions,signalForwarded});}
    finally{monitor=false;IDBDatabase.prototype.transaction=transaction;resume.resolve();await local.close();}
   }
   // Abort while an authenticated fetch is suspended, not only an idle callback.
   {const local=await SessionStore.open(proof.database),abort=new AbortController(),blocked=deferred(),resume=deferred(),entered=deferred();let escaped,readingWindow;
    const stream=local.stream.bind(local);let suspend=false;local.stream=async function*(ref,options){if(suspend&&ref.sha256===manifest.events[0].content.sha256){blocked.resolve();await resume.promise;}yield*stream(ref,options);};
    const reading=SessionGpuHistoryReader.withOpen(local,count.id,{signal:abort.signal},async reader=>{escaped=reader;suspend=true;readingWindow=reader.nextReceiptWindow(reader.initialEventCursor);void readingWindow.catch(()=>{});entered.resolve();return readingWindow;});void reading.catch(()=>{});await entered.promise;await blocked.promise;abort.abort();await refused('abort-suspended-fetch',()=>reading,/Cancelled/);
    const writer=await store.writer(count.id);await writer.release();resume.resolve();await refused('late-fetch-cannot-publish-window',()=>readingWindow,/ReadLeaseRevoked|ReaderRevoked|Authentication/);await refused('late-fetch-poisoned-owner',()=>escaped.nextWitnessWindow(escaped.initialWitnessCursor),/ReaderRevoked/);await local.close();
   }
   // A hostile thenable starts a read, resolves immediately and queues another
   // use. Callback settlement revokes both; no data may escape late.
   {let escaped,reading,queued,latePublished=0,callbackThen=0;const value=await SessionGpuHistoryReader.withOpen(store,count.id,{},reader=>{escaped=reader;return {then(resolve){callbackThen++;reading=reader.nextReceiptWindow(reader.initialEventCursor);reading.then(()=>{latePublished++;},()=>{});resolve('settled');queueMicrotask(()=>{queued=(async()=>reader.nextWitnessWindow(reader.initialWitnessCursor))();void queued.catch(()=>{});});}};});
    need(value==='settled'&&callbackThen===1,'thenable settlement');await refused('hostile-thenable-inflight-read',()=>reading,/ReaderRevoked|Authentication/);if(queued)await refused('hostile-thenable-microtask',()=>queued,/ReaderRevoked|ReaderBusy|Authentication/);need(latePublished===0,'late hostile callback result');await refused('hostile-thenable-escaped-reader',()=>escaped.nextReceiptWindow({}),/ReaderRevoked/);report.checks.push({name:'hostile-thenable-no-late-result',latePublished});
   }
   {let escaped;await refused('callback-rejection',()=>SessionGpuHistoryReader.withOpen(store,count.id,{},reader=>{escaped=reader;throw Error('intentional callback rejection');}),/intentional callback rejection/);await refused('rejected-callback-escaped-reader',()=>escaped.nextReceiptWindow({}),/ReaderRevoked/);const writer=await store.writer(count.id);await writer.release();}
   // A version change revokes the store and the escaped reader before returning a cursor.
   {const local=await SessionStore.open(proof.database),entered=deferred(),hold=deferred();let escaped,token;const reading=SessionGpuHistoryReader.withOpen(local,count.id,{},async reader=>{escaped=reader;token=reader.initialEventCursor;entered.resolve();await hold.promise;});void reading.catch(()=>{});await entered.promise;const nextVersion=rawDb.version+1;rawDb.close();
    const upgrade=new Promise((resolve,reject)=>{const request=indexedDB.open(proof.database,nextVersion);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
    await refused('version-change-pending-reader',()=>reading,/Closed/);await upgrade;await refused('version-change-escaped-cursor',()=>escaped.nextReceiptWindow(token),/Closed|ReaderRevoked/);hold.resolve();await local.close();
   }
   need(report.consumerCallbacks===0&&report.candidates===0,'unsafe callback/candidate ran');return report;
  }finally{module.WasmLinux.newExactGpuSession=original;rawDb.close();await store.close();}
 },proof);
}

export async function checkGpuReaderBoundaryCodecs(page,proof){
 return page.evaluate(async proof=>{
  const {SessionStore}=await import('/session-store.js'),{inspectGpuFrame}=await import('/session-gpu-frame-inspection.js'),{readCheckpointObject}=await import('/session-checkpoints.js'),{sessionValidateDiskRoot}=await import('/session-pkg/wasm_vm_session.js'),m=await import('/pkg/wasm_vm_wasm.js');
  const store=await SessionStore.open(proof.database),manifest=proof.cases[0].saved.manifest,point=manifest.checkpoints[0],bytes=await readCheckpointObject(store,point.machine,2*1048576),root=JSON.parse(new TextDecoder().decode(sessionValidateDiskRoot(await readCheckpointObject(store,await store.objectReference(point.disk_root),12*1048576)))),identity=JSON.parse(m.sessionExactGpuIdentity()),report={checks:[],candidates:0};
  const original=m.WasmLinux.newExactGpuSession;m.WasmLinux.newExactGpuSession=()=>{report.candidates++;throw Error('unexpected candidate');};
  const need=(ok,detail)=>{if(!ok)throw Error('Reader codec: '+detail);},reject=async(name,call,pattern)=>{let error;try{await call();}catch(e){error=e.message;}need(error&&pattern.test(error),name+': '+error);report.checks.push({name,error});};
  const inspect=async(input,chunk=13)=>{const metrics={storeChunkBytes:0,clockSectionBytes:0};const result=await inspectGpuFrame({async *stream(){for(let at=0;at<input.length;at+=chunk)yield input.slice(at,at+chunk);}},point.machine,{point,manifest,root,coreHash:identity.coreHash,full:true,active:()=>{},metrics});return {result,metrics};};
  try{
   const exact=await inspect(bytes);need(exact.metrics.storeChunkBytes===13&&exact.result.origin.position.sequence==='0','split frame');report.checks.push({name:'actual-native-frame-in-13-byte-chunks',metrics:exact.metrics,origin:exact.result.origin});
   await reject('split-frame-premature-eof',()=>inspect(bytes.subarray(0,-1)),/stream chunk|range|trailing/);
   const extra=new Uint8Array(bytes.length+1);extra.set(bytes);await reject('split-frame-trailing-data',()=>inspect(extra),/trailing/);
   const v=new DataView(bytes.buffer),native=32+v.getUint32(12,true),bad=bytes.slice();bad[native+100]^=1;await reject('split-native-middle-digest',()=>inspect(bad),/digest|section|build|clock/);
   const section=new Uint8Array(58),clock=new DataView(section.buffer);section.set(new TextEncoder().encode('WVCLK001'));clock.setUint32(8,1,true);for(const [offset,value]of [[12,4n],[20,3n],[28,7n],[36,9n],[44,12n]])clock.setBigUint64(offset,value,true);
   const origin=JSON.parse(m.sessionInspectClockOrigin(section));need(origin.position.ordinal===7&&origin.nextTicket==='12'&&origin.pending.length===0,'native nonzero Before origin');report.checks.push({name:'nonzero-before-origin',origin});
   const malformed=new Uint8Array(59);malformed.set(section);await reject('origin-trailing-byte',()=>m.sessionInspectClockOrigin(malformed),/MalformedSnapshot/);
   const shared=new Uint8Array(new SharedArrayBuffer(58));shared.set(section);await reject('origin-shared-before-copy',()=>m.sessionInspectClockOrigin(shared),/ownership/);Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(58)});Object.defineProperty(shared,'length',{value:0});await reject('origin-shadowed-shared-before-copy',()=>m.sessionInspectClockOrigin(shared),/ownership/);
   const large=new Uint8Array(4*1048576+256*32+65);Object.defineProperty(large,'length',{value:1});await reject('origin-shadowed-oversize-before-copy',()=>m.sessionInspectClockOrigin(large),/bound/);
   let getterCalls=0;const proxy=new Proxy(section,{get(){getterCalls++;throw Error('user getter');}});await reject('origin-proxy-no-getter',()=>m.sessionInspectClockOrigin(proxy),/ownership/);need(getterCalls===0&&report.candidates===0,'unsafe native boundary');return report;
  }finally{m.WasmLinux.newExactGpuSession=original;await store.close();}
 },proof);
}
