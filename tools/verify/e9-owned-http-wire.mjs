// Independent TCP stream reconstruction from the retained owned Ethernet tape.
// Duplicated segments must agree byte-for-byte; counts alone cannot prove a body.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyCapturedHttp(receipts) {
 const flows=new Map();
 let network=0;
 for(const row of receipts){
  if(row.channel!==20)continue;network++;
  const envelope=Buffer.from(row.bytes);assert.equal(envelope.subarray(0,8).toString(),'WVNETE01');
  let frame,direction;
  if(envelope[8]===1){if(envelope[9]!==0)continue;assert.equal(envelope.length,22+envelope.readUInt32LE(18));frame=envelope.subarray(22);direction='request';}
  else if(envelope[8]===2){assert.equal(envelope.length,13+envelope.readUInt32LE(9));frame=envelope.subarray(13);direction='response';}
  else continue;
  if(frame.length<34||frame.readUInt16BE(12)!==0x0800||frame[23]!==6)continue;
  const ip=frame.subarray(14),ipHeader=(ip[0]&15)*4,ipLength=ip.readUInt16BE(2);
  assert(ip[0]>>>4===4&&ipHeader>=20&&ipLength>=ipHeader+20&&ipLength<=ip.length);
  const tcp=ip.subarray(ipHeader,ipLength),src=tcp.readUInt16BE(0),dst=tcp.readUInt16BE(2);
  if((direction==='request'?dst:src)!==9191)continue;
  assert.deepEqual([...ip.subarray(12,16)],direction==='request'?[10,0,2,15]:[10,0,2,2]);
  assert.deepEqual([...ip.subarray(16,20)],direction==='request'?[10,0,2,2]:[10,0,2,15]);
  const port=direction==='request'?src:dst;
  if(!flows.has(port))flows.set(port,{request:{bytes:new Map(),segments:0},response:{bytes:new Map(),segments:0}});
  const flow=flows.get(port),stream=flow[direction],sequence=tcp.readUInt32BE(4),syn=!!(tcp[13]&2);
  if(syn){const base=(sequence+1)>>>0;if(stream.base!==undefined)assert.equal(stream.base,base);stream.base=base;}
  const header=(tcp[12]>>>4)*4;assert(header>=20&&header<=tcp.length);
  const payload=tcp.subarray(header);if(!payload.length)continue;
  assert(stream.base!==undefined,'data without recorded TCP handshake');
  const offset=(((sequence+Number(syn))>>>0)-stream.base)>>>0;
  assert(offset+payload.length<=8192,'bounded HTTP stream');stream.segments++;
  if(direction==='response')assert(flow.request.bytes.size>0,'response body preceded original guest request');
  for(let i=0;i<payload.length;i++){
   const at=offset+i;if(stream.bytes.has(at))assert.equal(stream.bytes.get(at),payload[i],'TCP retransmit changed bytes');
   stream.bytes.set(at,payload[i]);
  }
 }
 const materialize=stream=>{
  const bytes=Buffer.alloc(stream.bytes.size);for(let i=0;i<bytes.length;i++){assert(stream.bytes.has(i),'TCP stream gap');bytes[i]=stream.bytes.get(i);}return bytes;
 };
 assert.equal(flows.size,10,'ten independently opened real TCP connections');
 const seen=new Set(),witnesses=[];
 for(const [port,flow] of flows){
  const request=materialize(flow.request),response=materialize(flow.response);
  const match=/^GET \/e9\/(10|[1-9]) HTTP\/1\.[01]\r\n/.exec(request.toString());assert(match,'exact original HTTP request');
  const index=Number(match[1]);assert(!seen.has(index),'duplicate HTTP index');seen.add(index);
  assert(request.toString().includes('\r\nHost: 10.0.2.2:9191\r\n'),'original authority');
  const split=response.indexOf('\r\n\r\n');assert(split>0,'actual HTTP response header');
  assert(response.subarray(0,split).toString().startsWith('HTTP/1.0 200 OK\r\nContent-Length: 1024\r\n'));
  const body=response.subarray(split+4);assert.deepEqual(body,Buffer.alloc(1024,17+index),'wire body independently matches fixed contract');
  witnesses.push({index,clientPort:port,requestBytes:request.length,responseBytes:response.length,bodyBytes:body.length,
   requestSha256:sha(request),responseSha256:sha(response),bodySha256:sha(body),requestSegments:flow.request.segments,responseSegments:flow.response.segments});
 }
 assert.deepEqual([...seen].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10]);
 return {networkEvents:network,connections:flows.size,streams:witnesses.sort((a,b)=>a.index-b.index)};
}
