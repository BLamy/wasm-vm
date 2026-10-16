import {checks} from './standard-packed-normalized-rig.mjs';
import {originalFormats,source,transfer} from '../../../tools/virgl-command/standard-packed-normalized-fixtures.mjs';
import {command,syntheticBackend as oldBackend} from './standard-integer-images.mjs';
import * as resources from '../resources.mjs';
import {packedNormalizedColorFormat} from '../packed-normalized-images.mjs';
const backend=()=>({...oldBackend(),packedNormalizedProfile:'virgl-standard-packed-normalized-transfers-v1'});
export function runWireAcceptance(){
 const c=checks(),records=[];
 const oldOwners=['createResourceStore','createStandardUniformResourceStore','createStandardBufferResourceStore','createStandardTextureResourceStore','createStandardImageResourceStore','createStandardColorResourceStore','createStandardFloatColorResourceStore','createStandardPackedFloatColorResourceStore','createStandardSharedExponentResourceStore','createStandardIntegerColorResourceStore'];
 const oldLayouts=['computeTransferLayout','computeStandardUniformTransferLayout','computeStandardBufferTransferLayout','computeStandardTextureTransferLayout','computeStandardColorTransferLayout','computeStandardFloatColorTransferLayout','computeStandardPackedFloatColorTransferLayout','computeStandardSharedExponentTransferLayout','computeStandardIntegerColorTransferLayout'];
 for(const f of originalFormats){
  const actual=packedNormalizedColorFormat(f.originalFormat);
  for(const [key,value] of Object.entries({name:f.originalName,pixelBytes:f.guestPixelBytes,nativePixelBytes:f.plannedNativePixelBytes,readPixelBytes:4,internal:f.plannedNativeInternal,upload:f.plannedUploadFormat,type:f.plannedUploadType,readType:f.plannedReadType,implicitAlpha:f.implicitAlpha}))c.same(actual[key],value,'pinned packed normalized descriptor '+key);
  c.same(Object.isFrozen(actual)&&Object.isFrozen(actual.fields)&&actual.fields.every(Object.isFrozen),true,'immutable private packed descriptor');
  for(const lastLevel of [0,4])for(const bind of [8,2,10]){
   const src=source(f.originalFormat,17,9,lastLevel,0x35a17,{bind}),fields=command(transfer(6,src.planes[0])).fields,logical=src.planes.reduce((n,p)=>n+p.input.length,0);
   const store=c.ok(resources.createStandardPackedNormalizedResourceStore({backend:backend()}),'selected packed owner').store;
   const resource=c.ok(store.createResource(src.metadata),'original packed allocation').resource;
   c.same([resource.byteLength,resource.gpuByteLength,resource.packedNormalized],[logical,logical,true],'complete original and physical packed byte budgets');
   for(const name of oldOwners){const owner=c.ok(resources[name]({backend:backend()}),'historical owner').store,result=owner.createResource(src.metadata);c.same(result.ok,false,'historical owner refuses '+name);records.push({kind:'old-owner',name,metadata:src.metadata,result});c.ok(owner.dispose(),'historical disposal');}
   for(const name of oldLayouts){const result=resources[name](src.metadata,fields,src.backing.length);c.same(result.ok,false,'historical layout refuses '+name);records.push({kind:'old-layout',name,metadata:src.metadata,fields,result});}
   for(const p of src.planes)for(const direction of [1,2]){
    const fields=command(transfer(6,p,direction)).fields,result=c.ok(resources.computeStandardPackedNormalizedTransferLayout(src.metadata,fields,src.backing.length),'original packed layout'),l=result.layout;
    c.same(l.tightBytes,p.input.length,'original packed dense words');c.same(l.scratchBytes,p.width*p.height*(direction===2?4:f.guestPixelBytes),'native packed conversion scratch charged');c.same(l.stagingBytes,direction===2?p.width*p.height*4:0,'packed native PBO staging charged');records.push({kind:'layout',metadata:src.metadata,fields,result});
   }
   const rowBytes=17*f.guestPixelBytes,required=fields.dataOffset+8*fields.stride+rowBytes,footprint=required-fields.dataOffset;
   for(const short of [0,1])for(const mode of ['backing','transfer']){const backingBytes=mode==='backing'?required-short:src.backing.length,limits=mode==='transfer'?{transferBytes:footprint-short}:{},result=resources.computeStandardPackedNormalizedTransferLayout(src.metadata,fields,backingBytes,limits);c.same(result.ok,!short,'original padded packed footprint at/over bound');records.push({kind:'transfer-bound',metadata:src.metadata,fields,limits,backingBytes,result});}
   for(const short of [0,1])for(const mode of ['resourceBytes','gpuBytes']){let allocations=0;const bounded=c.ok(resources.createStandardPackedNormalizedResourceStore({backend:{...backend(),allocate(){allocations++;return{};}},limits:{[mode]:logical-short}}),'bounded packed owner').store,result=bounded.createResource(src.metadata);c.same(result.ok,!short,'complete packed allocation at/over bound');c.same(allocations,short?0:1,'packed allocation refusal precedes native mutation');records.push({kind:'allocation-bound',metadata:src.metadata,limits:{[mode]:logical-short},result,allocations});c.ok(bounded.dispose(),'bounded packed disposal');}
   for(const patch of [{format:99998},{format:99999},{target:3},{bind:0},{bind:1},{depth:2},{arraySize:2},{nrSamples:1},{lastLevel:5},{flags:1},{width:0},{height:0},{width:0xffffffff}]){const m={...src.metadata,id:7,...patch},result=store.createResource(m);c.same(result.ok,false,'invalid original packed metadata');records.push({kind:'invalid-metadata',metadata:m,result});}
   for(const patch of [{box:{...fields.box,x:1}},{level:lastLevel+1},{stride:rowBytes-1},{layerStride:1},{resourceHandle:7},{dataOffset:src.backing.length}]){const input={...fields,...patch},result=resources.computeStandardPackedNormalizedTransferLayout(src.metadata,input,src.backing.length);c.same(result.ok,false,'invalid original packed transfer');records.push({kind:'invalid-transfer',metadata:src.metadata,fields:input,result});}
   for(const mutation of ['getter','unknown','prototype','trap']){let calls=0,m={...src.metadata,id:7};if(mutation==='getter')Object.defineProperty(m,'width',{get(){calls++;return 17;},enumerable:true});if(mutation==='unknown')m.packedNormalized=true;if(mutation==='prototype')m=Object.create(m);if(mutation==='trap')m=new Proxy(m,{ownKeys(){throw Error('hostile metadata');}});const result=store.createResource(m);c.same(result.ok,false,'hostile packed own record');c.same(calls,0,'packed metadata accessors never execute');records.push({kind:'hostile-metadata',mutation,result,calls});}
   c.ok(store.dispose(),'selected packed disposal');
  }
  const bad=backend();delete bad.packedNormalizedProfile;const result=resources.createStandardPackedNormalizedResourceStore({backend:bad});c.same(result.ok,false,'selected packed backend identity is required');records.push({kind:'backend-profile',format:f.originalFormat,result});
 }
 for(const value of [0,'5',4,233,410,NaN,Infinity,-1])c.same(packedNormalizedColorFormat(value),null,'packed map keeps unknown and historical identities closed');
 for(const limits of [{gpuBytes:33554433},{scratchBytes:8388609},{newField:1}]){const result=resources.createStandardPackedNormalizedResourceStore({backend:backend(),limits});c.same(result.ok,false,'packed budgets cannot expand');records.push({kind:'invalid-config',limits,result});}
 return{status:'passed',authority:'synthetic-layout-only',records,predictions:c.rows};
}
