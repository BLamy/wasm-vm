import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Recording-server transport only. Missing objects and wrong bytes are never retried.
export async function fetchPinnedChunk(url,digest){
  for(let attempt=0;attempt<3;attempt++){
    let bytes;
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      assert.equal(response.status,200,url+' production status');
      bytes=Buffer.from(await response.arrayBuffer());
    }catch(error){
      if(error.code==='ERR_ASSERTION'||attempt===2)throw error;
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
      continue;
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,url+' chunk digest');
    return bytes;
  }
  throw Error(url+' production transport unavailable');
}
