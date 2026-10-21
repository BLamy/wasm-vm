import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fetchPinnedChunk} from './pinned-chunk.mjs';

test('pinned recording chunks retry transport faults and fail closed on status or digest',async()=>{
  const bytes=Buffer.from('original immutable chunk'),digest=createHash('sha256').update(bytes).digest('hex');
  const requests=new Map();
  const server=createServer((request,response)=>{
    const route=request.url,count=(requests.get(route)??0)+1;requests.set(route,count);
    if(route==='/offline'||route==='/retry'&&count===1){request.socket.destroy();return;}
    response.writeHead(route==='/missing'?404:200,{'Content-Type':'application/octet-stream'});
    response.end(route==='/corrupt'?Buffer.from('wrong bytes'):bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.deepEqual(await fetchPinnedChunk(base+'/retry',digest),bytes);assert.equal(requests.get('/retry'),2);
    await assert.rejects(fetchPinnedChunk(base+'/missing',digest),/production status/);assert.equal(requests.get('/missing'),1);
    await assert.rejects(fetchPinnedChunk(base+'/corrupt',digest),/chunk digest/);assert.equal(requests.get('/corrupt'),1);
    await assert.rejects(fetchPinnedChunk(base+'/offline',digest),/fetch failed/);assert.equal(requests.get('/offline'),3);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
