import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {wranglerProxy,MAX_MANIFEST_BYTES} from '../publish-omarchy-chunks-proxy.mjs';
const [modulePath,configPath]=process.argv.slice(2);
assert.equal(typeof process.send,'function','owned IPC process only');
assert.equal(Number(execFileSync('ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim()),process.pid,'owned private process group');
process.once('disconnect',()=>{process.kill(-process.pid,'SIGKILL');});
const send=message=>new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
let proxy;
try{
  proxy=await wranglerProxy({modulePath,configPath,record:event=>send({kind:'event',event})});
  await send({kind:'ready'});
}catch(error){await send({kind:'startup-error',code:error.code||error.name||'unknown'});process.exit(1);}
process.on('message',async({id,method,args})=>{
  try{
    if(method==='dispose'){await proxy.dispose();await send({id,result:true});return;}
    assert.match(args.key,/^chunked-omarchy\/(?:chunks\/[0-9a-f]{64}\.bin|manifest-[0-9a-f]{64}\.json)$/);
    let result;
    if(method==='put'){
      assert.ok(args.bytes.length>0&&args.bytes.length<=MAX_MANIFEST_BYTES);
      assert.equal(args.options.onlyIf.etagDoesNotMatch,'*');assert.match(args.options.sha256,/^[0-9a-f]{64}$/);
      const object=await proxy.env.ASSETS.put(args.key,args.bytes,args.options);
      result=object?{key:object.key,size:object.size,version:object.version}:null;
    }else{
      assert.equal(method,'read');assert.ok(Number.isSafeInteger(args.limit)&&args.limit>0&&args.limit<=MAX_MANIFEST_BYTES);
      const object=await proxy.env.ASSETS.get(args.key);
      result=object?{size:object.size,bytes:object.size<=args.limit?Buffer.from(await object.arrayBuffer()):null}:null;
    }
    await send({id,result});
  }catch(error){await send({id,error:'R2 '+method+' failed: '+(error.code||error.name||'unknown')});}
});
