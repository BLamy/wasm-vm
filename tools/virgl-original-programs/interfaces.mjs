import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';

const root='evidence/virgl-workload-inventory/captures/es2gears/shaders/';
const vertexText=fs.readFileSync(root+'7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e.tgsi','utf8');
const fragmentText=fs.readFileSync(root+'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba.tgsi','utf8');
const geometry=new Uint8Array(fs.readFileSync('target/evidence/virgl-92cb-raster/geometry.bin'));
const drawState={viewportX:0,viewportY:0,viewportWidth:1024,viewportHeight:768,
  samples:0,colorFormat:34836,mode:5,first:0,count:4};
const request=()=>({vertexText,fragmentText,geometry:new Uint8Array(geometry),bank:0,drawState:{...drawState}});
const bridge=await createVirglShaderBridge();
const baseline=bridge.translateOriginal92cbComplete(request());
assert.equal(baseline.ok,true);
const cases=[];
function rejected(name,value){
  const result=bridge.translateOriginal92cbComplete(value);
  assert.equal(result.ok,false,name);
  assert.equal(result.error.code,'invalid-input',name);
  assert.equal(Object.hasOwn(result,'vertex'),false,name);
  assert.equal(Object.hasOwn(result,'fragment'),false,name);
  cases.push({name,result});
}
rejected('null',null);rejected('array',[]);
rejected('extra-field',{...request(),extra:0});
rejected('missing-field',(({geometry,...rest})=>rest)(request()));
rejected('source-type',{...request(),vertexText:new String(vertexText)});
rejected('non-ascii',{...request(),fragmentText:fragmentText+'\u2603'});
rejected('over-limit',{...request(),fragmentText:'x'.repeat(49153)});
rejected('negative-bank',{...request(),bank:-1});rejected('fraction-bank',{...request(),bank:.5});
rejected('short-geometry',{...request(),geometry:geometry.slice(1)});
rejected('wrong-geometry-type',{...request(),geometry:[...geometry]});
rejected('extra-state',{...request(),drawState:{...drawState,extra:0}});
rejected('bad-state',{...request(),drawState:{...drawState,count:NaN}});
rejected('accessor',Object.defineProperty(request(),'vertexText',{get(){throw new Error('must not execute');}}));
rejected('reflection-failure',new Proxy(request(),{ownKeys(){throw new Error('hostile reflection');}}));
rejected('state-accessor',{...request(),drawState:Object.defineProperty({...drawState},'samples',
  {get(){throw new Error('must not execute');}})});
for(const key of Object.keys(drawState))rejected('state-'+key,{...request(),drawState:{...drawState,[key]:drawState[key]^1}});
const seeds=[0x13579bdf,0x9e3779b9,0xdeadbeef];
for(const seed of seeds){
  let state=seed;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let i=0;i<16;i++){
    const altered=request();const at=next()%altered.geometry.length;altered.geometry[at]^=1<<(next()%8);
    rejected(`geometry-${seed}-${i}`,altered);
    const pc=next()%fragmentText.length;
    rejected(`source-${seed}-${i}`,{...request(),fragmentText:fragmentText.slice(0,pc)+
      String.fromCharCode(fragmentText.charCodeAt(pc)^1)+fragmentText.slice(pc+1)});
  }
}
const owned=request();let mutated=false;
owned.drawState=new Proxy(owned.drawState,{getOwnPropertyDescriptor(target,key){
  if(!mutated){owned.geometry[136]^=1;mutated=true;}
  return Reflect.getOwnPropertyDescriptor(target,key);
}});
assert.deepEqual(bridge.translateOriginal92cbComplete(owned),baseline,
  'geometry snapshot precedes later draw-state reflection callbacks');
assert.equal(mutated,true);
rejected('stale-owned-geometry',owned);
assert.deepEqual(bridge.translateOriginal92cbComplete(request()),baseline,
  'rejected requests cannot change later complete translation');
let runtime;
const allocated=await createVirglShaderBridge({onRuntimeInitialized(){runtime=this;}});
assert.equal(typeof runtime._malloc,'function');
const realMalloc=runtime._malloc,realFree=runtime._free,allocations=[];
for(let failure=1;failure<=4;failure++){
  let calls=0;const live=new Set();
  runtime._malloc=size=>{
    if(++calls===failure)return 0;
    const pointer=realMalloc(size);if(pointer)live.add(pointer);return pointer;
  };
  runtime._free=pointer=>{assert.equal(live.delete(pointer),true);realFree(pointer);};
  const result=allocated.translateOriginal92cbComplete(request());
  assert.equal(result.ok,false);assert.equal(result.error.code,'allocation-failed');
  assert.equal(live.size,0,'each real allocated input is released on later failure');
  allocations.push({failure,calls,result,remaining:live.size});
}
runtime._malloc=realMalloc;runtime._free=realFree;
assert.deepEqual(allocated.translateOriginal92cbComplete(request()),baseline,
  'real Wasm input allocation failures recover without changing compilation');
console.log(JSON.stringify({status:'passed',seeds,cases,allocations,ownedGeometry:true,
  completeSource:true,productionDrawAuthority:false},null,2));
