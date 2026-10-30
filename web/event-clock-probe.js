// A real bare-metal guest exercises the common clock on the shipped interpreter and browser JIT.
// This is a live mechanism check; the Linux library still exposes saved checkpoints.
const BASE=0x80000000n,DATA=BASE+0x4000n;
const check=(ok,why)=>{if(!ok)throw Error(`event clock: ${why}`);};
const addi=(rd,rs,n)=>((n<<20)|(rs<<15)|(rd<<7)|0x13)>>>0;
const jal=n=>{const o=n>>>0;return (((o>>>20)&1)<<31|((o>>>1)&0x3ff)<<21|((o>>>11)&1)<<20|((o>>>12)&0xff)<<12|0x6f)>>>0;};
const word=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
function same(a,b,label){check(a.length===b.length,`${label} length`);const at=a.findIndex((v,i)=>v!==b[i]);check(at<0,`${label} differs at byte ${at}`);}

export function eventClockElf(timer=false){
  const bytes=new Uint8Array(0x1000+0x2008),v=new DataView(bytes.buffer);
  bytes.set([0x7f,69,76,70,2,1,1]);v.setUint16(16,2,true);v.setUint16(18,243,true);v.setUint32(20,1,true);
  v.setBigUint64(24,BASE,true);v.setBigUint64(32,64n,true);v.setUint16(52,64,true);v.setUint16(54,56,true);v.setUint16(56,1,true);
  v.setUint32(64,1,true);v.setUint32(68,7,true);v.setBigUint64(72,0x1000n,true);v.setBigUint64(80,BASE,true);v.setBigUint64(88,BASE,true);
  v.setBigUint64(96,0x2008n,true);v.setBigUint64(104,0x5000n,true);v.setBigUint64(112,4096n,true);
  const program=timer?[
    0x00002297,0x30529073,addi(5,0,128),0x30429073,addi(5,0,8),0x30029073,
    0x02004e37,addi(29,0,1000),0x01de3023,0x10500073,addi(4,4,1),jal(0),
  ]:[addi(1,1,1),addi(2,2,3),addi(3,3,5),addi(4,4,7),addi(5,5,11),jal(-20)];
  program.forEach((n,i)=>v.setUint32(0x1000+i*4,n,true));v.setUint32(0x3000,addi(10,10,1),true);v.setUint32(0x3004,jal(0),true);
  return bytes;
}

function patchClock(source,{transition=0n,retired=transition,ordinal=0n,sequence=0n,ticket=sequence}={}){
  const bytes=source.slice(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let found=false;
  for(let at=84;at<bytes.length;){const tag=v.getUint32(at,true),n=v.getUint32(at+4,true),p=at+8;check(p+n<=bytes.length,'native section bounds');
    if(tag===18){check(n===58,'empty clock fixture');for(const [offset,value] of [[12,transition],[20,retired],[28,ordinal],[36,sequence],[44,ticket]])v.setBigUint64(p+offset,value,true);found=true;}
    at=p+n;
  }
  check(found,'clock section present');return bytes;
}

export async function runEventClockProbe(WasmMachine){
  const report={status:'running',cases:[],frames:[],traces:[],refusals:[]};
  const capture=(name,m)=>{const bytes=m.saveEventCheckpoint();report.frames.push({name,bytes});return bytes;};
  const fresh=(jit=false,timer=false)=>{const m=new WasmMachine(1);m.loadElf(eventClockElf(timer));m.startEventClock(1,3);if(jit)m.enableJit(1);else m.setTrace(true);return m;};
  const runTo=(m,target,quantum)=>{while(BigInt(m.eventPosition().transition)<BigInt(target)){check(m.runEventUntil(String(target),quantum).kind==='max','bounded run result');}};
  const deliveries=m=>m.takeEventDeliveries().map(row=>({...row,bytes:Array.from(row.bytes)}));
  const refused=(name,run,pattern)=>{let error;try{run();}catch(value){error=value;}check(error&&pattern.test(String(error)),`${name} refusal`);report.refusals.push({name,message:String(error)});};
  for(const target of [600,601,605])for(const quantum of [1,7,64]){
    const plain=fresh(),jit=fresh(true);
    try{
      const callbackOrder=quantum===1?['later','first','second']:quantum===7?['first','second','later']:['second','later','first'];
      for(const m of [plain,jit]){
        runTo(m,384,384);
        for(const name of callbackOrder){
          const callback=()=>{const payload=new Uint8Array([name==='later'?33:name==='first'?11:22]);m.stageEventWrite(String(name==='later'?target+2:target),String(name==='later'?DATA+1n:DATA),payload);payload.fill(255);};
          if(name==='second')await new Promise(resolve=>setTimeout(()=>{callback();resolve();},0));else await Promise.resolve().then(callback);
        }
        check(m.eventPosition().transition==='384'&&m.eventPosition().mtime==='128','host callbacks only stage owned data');
      }
      const before=jit.jitStats().executedBlocks;runTo(plain,target,quantum);runTo(jit,target,quantum);
      same(plain.saveEventCheckpoint(),capture(`jit-${target}-q${quantum}-before`,jit),'interpreter/JIT pre-delivery state');
      check(jit.eventPosition().pending===3&&jit.eventPosition().sequence==='0','events still pending at exact stop');
      const compiled=jit.jitStats().executedBlocks-before;if(quantum>=6)check(compiled>0,'real compiled execution before fence');
      for(const m of [plain,jit])check(m.run(1).kind==='max','delivery run result');
      const a=deliveries(plain),b=deliveries(jit);check(JSON.stringify(a)===JSON.stringify(b),'delivery bytes/order agree');
      check(b.length===2&&b[0].transition===String(target)&&b[0].ordinal===1&&b[1].ordinal===2&&b[1].sequence==='2','same-boundary tie order');
      check(b[0].bytes[0]===(quantum===64?22:11)&&b[1].bytes[0]===(quantum===64?11:22),'recorded callback order and owned payload bytes');
      runTo(plain,target+4,quantum);runTo(jit,target+4,quantum);check(JSON.stringify(deliveries(plain))===JSON.stringify(deliveries(jit)),'later callback placement');
      same(plain.saveEventCheckpoint(),capture(`jit-${target}-q${quantum}-after`,jit),'interpreter/JIT post-delivery state');
      report.cases.push({kind:'compiled-fence',target:String(target),quantum,callbackOrder,compiled,position:jit.eventPosition(),deliveries:b,jit:jit.jitStats()});
      report.traces.push({name:`jit-${target}-q${quantum}`,text:plain.takeTrace()});
    }finally{plain.free();jit.free();}
  }
  for(const quantum of [1,7,128]){
    const plain=fresh(),jit=fresh(true);
    try{
      for(const m of [plain,jit]){runTo(m,384,384);m.stageEventWrite('601',String(BASE+4n),word(addi(2,2,19)));m.stageEventWrite('605',String(DATA),new TextEncoder().encode('later'));
        while(BigInt(m.eventPosition().transition)<1000n){const n=Math.min(quantum,1000-Number(m.eventPosition().transition));check(m.run(n).kind==='max','mailbox-only bounded run');}
      }
      const a=deliveries(plain),b=deliveries(jit);check(JSON.stringify(a)===JSON.stringify(b)&&b[0].transition==='601'&&b[1].transition==='605','mailbox itself fences compiled work');
      same(plain.saveEventCheckpoint(),capture(`jit-mailbox-q${quantum}`,jit),'mailbox-only interpreter/JIT state');check(jit.registers()[3]===1573n,'guest executes the newly delivered instruction');
      report.cases.push({kind:'mailbox-fence',quantum,position:jit.eventPosition(),deliveries:b,jit:jit.jitStats()});report.traces.push({name:`jit-mailbox-q${quantum}`,text:plain.takeTrace()});
    }finally{plain.free();jit.free();}
  }
  const timer=fresh(true,true);
  try{
    runTo(timer,10,128);check(timer.eventPosition().retired==='10'&&timer.eventPosition().mtime==='3','stop after WFI before idle advance');
    const saved=capture('wfi-before-idle',timer);timer.stageEventPending('10',false);timer.stageEventWrite('10',String(DATA),new Uint8Array([41]));timer.stageEventWrite('11',String(DATA+1n),new Uint8Array([42]));
    const held=fresh(false,true);try{held.restoreEventCheckpoint(saved);held.stageEventPending('10',true);runTo(held,11,1);check(held.eventPosition().retired==='11'&&held.eventPosition().mtime==='3'&&held.registers()[5]===1n,'owned external-pending state inhibits idle advance');const receipt=deliveries(held);capture('wfi-held',held);report.cases.push({kind:'external-pending',position:held.eventPosition(),delivery:receipt[0]});}finally{held.free();}
    runTo(timer,11,128);check(timer.eventPosition().retired==='10'&&timer.eventPosition().mtime==='1000','idle is a nonretiring transition');
    const first=deliveries(timer);check(first.length===2&&first[1].ordinal===2,'idle boundary tie order');capture('wfi-after-idle',timer);
    runTo(timer,12,128);check(timer.eventPosition().retired==='10'&&timer.registers()[0]===BASE+0x2000n,'interrupt is a nonretiring transition');
    const irq=deliveries(timer);check(irq.length===1&&irq[0].transition==='11','control arrives before timer interrupt');capture('wfi-after-interrupt',timer);
    const restored=fresh(false,true);try{restored.restoreEventCheckpoint(saved);runTo(restored,12,1);check(restored.eventPosition().retired==='10'&&restored.eventPosition().mtime==='1000'&&restored.registers()[0]===BASE+0x2000n,'restored WFI boundary');}finally{restored.free();}
    report.cases.push({kind:'timer-wfi',position:timer.eventPosition(),beforeIdle:first,beforeIrq:irq});
  }finally{timer.free();}
  const wide=fresh();try{
    const initial=wide.saveEventCheckpoint(),n=9007199254740993n;wide.restoreEventCheckpoint(patchClock(initial,{transition:n,sequence:n}));
    wide.stageEventWrite(String(n+2n),String(DATA),new Uint8Array([91]));const queued=capture('wide-queued',wide);
    wide.restoreEventCheckpoint(queued);runTo(wide,n+2n,32);check(wide.eventPosition().transition===String(n+2n)&&wide.eventPosition().pending===1,'lossless wide stop');
    wide.run(1);const receipt=deliveries(wide)[0];check(receipt.transition===String(n+2n)&&receipt.sequence===String(n+1n),'lossless wide event sequence');capture('wide-delivered',wide);
    report.cases.push({kind:'wide-counter',position:wide.eventPosition(),delivery:receipt});
    wide.restoreEventCheckpoint(patchClock(initial,{sequence:18446744073709551615n}));refused('sequence exhaustion',()=>wide.stageEventPending('0',true),/SequenceExhausted/);
    wide.restoreEventCheckpoint(patchClock(initial,{ordinal:4294967295n,sequence:4294967295n}));refused('ordinal exhaustion',()=>wide.stageEventPending('0',true),/OrdinalExhausted/);
    wide.restoreEventCheckpoint(patchClock(initial,{transition:18446744073709551615n,retired:0n}));refused('transition exhaustion',()=>wide.run(1),/TransitionExhausted/);
    wide.restoreEventCheckpoint(initial);refused('noncanonical position',()=>wide.runEventUntil('01',1),/canonical/);refused('active ELF replacement',()=>wide.loadElf(eventClockElf()),/active session/);
    wide.stageEventWrite('0',String(DATA),new Uint8Array([1]));wide.deliverEventBoundary();const paused=deliveries(wide);check(wide.eventPosition().transition==='0'&&paused[0].ordinal===1,'paused control does not execute guest');capture('paused-control',wide);
    report.cases.push({kind:'paused-control',position:wide.eventPosition(),delivery:paused[0]});
  }finally{wide.free();}
  const invalid=new WasmMachine(1);try{invalid.loadElf(eventClockElf());for(const [harts,divider] of [[2,3],[4294967297,3],[1,0],[1,1.5],[1,NaN]])refused(`scheduling ${harts}/${divider}`,()=>invalid.startEventClock(harts,divider),/UnsupportedScheduling/);}finally{invalid.free();}
  report.status='passed';return report;
}
