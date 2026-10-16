import {checks} from './standard-packed-depth-consumer-rig.mjs';
import * as wire from '../decoder.mjs';
import {packet,join,face,faceWord,dsa,clear,refs} from '../../../tools/virgl-stencil/fixtures.mjs';
export function runWireAcceptance(){
 const c=checks(),assert={equal:(a,b,label='original stencil wire')=>c.same(a,b,label),deepEqual:(a,b)=>c.same(a,b,'every original stencil field')};
 const hex=bytes=>[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
 const rows=[],selected=wire.decodeStandardStencilSubmission,prior=Object.entries(wire).filter(([name])=>/^decode.*Submission$/.test(name)&&name!=='decodeStandardStencilSubmission');
 for(const front of [face(),face({enabled:false,func:3,writeMask:170,valueMask:85,zpass:7})])for(const back of [face(),face({enabled:false,func:1,writeMask:15,valueMask:240,zfail:6})]){
  const bytes=dsa(30,front,back,{alphaFunc:4,alphaRef:.25}),result=selected(bytes);assert.equal(result.ok,true);assert.equal(result.profile,wire.STANDARD_STENCIL_PROFILE);
  const fields=result.commands[0].fields;assert.deepEqual(fields.stencil,[front,back].map(f=>({enabled:f.enabled,function:f.func,failOperation:f.fail,depthPassOperation:f.zpass,depthFailOperation:f.zfail,valueMask:f.valueMask,writeMask:f.writeMask})));assert.equal(fields.alphaEnable,false);assert.equal(fields.alphaReference,.25);assert.equal(fields.alphaFunction,4);
  const refusals=prior.map(([name,decode])=>{const r=decode(bytes);assert.equal(r.ok,false);return {name,result:r};});rows.push({kind:'DSA',hex:hex(bytes),result,refusals});
 }
 for(const buffers of [2,3,6,7,63]){const bytes=clear(buffers,173),result=selected(bytes);assert.equal(result.ok,true);const refusals=prior.map(([name,decode])=>{const r=decode(bytes);assert.equal(r.ok,false);return {name,result:r};});rows.push({kind:'CLEAR',hex:hex(bytes),result,refusals});}
 for(const value of [256,0x123456a5,0x80000001,0xffffffff]){const bytes=clear(6,value),result=selected(bytes);assert.equal(result.ok,true);assert.equal(result.commands[0].fields.stencil,value);const refusals=prior.map(([name,decode])=>{const r=decode(clear(4,value));assert.equal(r.ok,false);return {name,result:r};});rows.push({kind:'wide-CLEAR',hex:hex(bytes),result,refusals});}
 for(const [name,bytes,index,value]of [['reserved-depth',packet(1,3,[30,0,0,0,0]),2,32],['reserved-front',packet(1,3,[30,0,0,0,0]),3,1<<29],['reserved-back',packet(1,3,[30,0,0,0,0]),4,1<<31],['active-alpha',packet(1,3,[30,0,0,0,0]),2,256],['nonfinite-alpha',packet(1,3,[30,0,0,0,0]),5,0x7fc00000],['unqualified-plane',clear(2),1,64],['empty-clear',clear(2),1,0]]){
  new DataView(bytes.buffer).setUint32(index*4,value,true);const result=selected(bytes);assert.equal(result.ok,false);rows.push({kind:'refusal',name,hex:hex(bytes),result});
 }
 const held=selected(join(packet(1,3,[30,28,0,0,0]),clear(4,255),refs(13,29)));assert.equal(held.ok,true);
 for(const [name,decode]of prior)assert.equal(decode(new Uint8Array()).ok,true,name);
 return {status:'passed',rows,held};
}
