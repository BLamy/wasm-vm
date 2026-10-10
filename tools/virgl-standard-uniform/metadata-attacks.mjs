import assert from 'node:assert/strict';
import {normalizeStandardUniformShaderPair,normalizeStandardUniformShaderResult,parseStandardUniformShaderMetadata,
  deriveStandardUniformShaderInterface,STANDARD_UNIFORM_SHADER_PROFILE} from '../../renderer/virgl-command/constant-domain.mjs';
export function metadataAttacks(pair,selectors) {
  const records=[],saved=JSON.stringify(pair),copy=()=>JSON.parse(saved),test=(name,value,host=selectors)=> {
    const result=normalizeStandardUniformShaderPair(value,host);assert.equal(result.ok,false,name);records.push({name,input:value,host,result});
  };
  for(const stage of ['vertex','fragment']) {
    for(const [key,value]of [['profile','virgl-webgl2-standard-gles3-v1'],['stage','geometry'],['guestUniformBlocks',null]]) {
      const input=copy();input[stage].metadata[key]=value;test(stage+'-'+key,input);
    }
    for(const [key,values]of [['name',['bad','VirglBlock']],['stage',['geometry',stage==='vertex'?'fragment':'vertex']],
      ['slot',[-1,13,1.5,'1']],['byteLength',[0,16383,16385,'16384']],['encoding',['float32','raw-words']]])
      for(const value of values) {const input=copy();input[stage].metadata.guestUniformBlocks[1][key]=value;test(stage+'-block-'+key+'-'+value,input);}
    for(const [key,values]of [['name',['bad']],['type',['vec4[]']],['count',[0,1025,1.5,'1024']],['offset',[16,-1]],['arrayStride',[0,4,32,'16']]])
      for(const value of values) {const input=copy();input[stage].metadata.guestUniformBlocks[1].members[0][key]=value;test(stage+'-member-'+key+'-'+value,input);}
    for(const name of ['missing-member','extra-member','missing-slot-zero','duplicate-slot','unsorted-slot','extra-field','member-extra-field','extra-bank']) {
      const input=copy(),blocks=input[stage].metadata.guestUniformBlocks;
      if(name==='missing-member')blocks[1].members=[];
      else if(name==='extra-member')blocks[1].members.push({...blocks[1].members[0]});
      else if(name==='missing-slot-zero')blocks.shift();
      else if(name==='duplicate-slot')blocks.splice(2,0,blocks[1]);
      else if(name==='unsorted-slot')[blocks[1],blocks[2]]=[blocks[2],blocks[1]];
      else if(name==='extra-field')blocks[1].certificate=true;
      else if(name==='member-extra-field')blocks[1].members[0].certificate=true;
      else blocks.push({...blocks[12],slot:13});
      test(stage+'-'+name,input);
    }
    const tooLarge=copy();tooLarge[stage].metadata.guestUniformBlocks[0].members[0].count=513;tooLarge[stage].metadata.guestUniformBlocks[0].byteLength=8208;test(stage+'-slot-zero-over',tooLarge);
    const inline=copy();inline[stage].metadata.uniforms=[{name:stage==='vertex'?'vsconst0':'fsconst0',type:'uvec4[]',count:512,encoding:'raw-32bit-words'}];test(stage+'-mixed-zero-storage',inline);
    assert.equal(normalizeStandardUniformShaderResult({ok:true,...pair[stage]},stage).ok,false,'stage admission has no implicit slot zero selector');
    assert.equal(parseStandardUniformShaderMetadata(pair[stage].metadata,stage).ok,false);
  }
  for(const host of [null,[],{...selectors,bufferZeroMask:0},{...selectors,bufferZeroMask:4},
    {...selectors,signedMask:2,unsignedMask:2},{...selectors,packedSignedMask:2,packedNormalizedMask:4},
    {...selectors,signedMask:65536},{...selectors,packedSignedMask:32768},{...selectors,key:'guest'}])test('host-'+records.length,copy(),host);
  for(const value of [null,[],{...copy(),ok:0},{...copy(),extra:true},{ok:false,error:{code:'',message:''}},
    {ok:false,error:{code:'failed',message:1}}, {...copy(),interfaceKey:'guest-key'}])test('response-'+records.length,value);
  let getters=0;
  for(const target of ['root','metadata','block','member','host']) {
    const value=copy(),host={...selectors},record=target==='root'?value:target==='metadata'?value.vertex.metadata:
      target==='block'?value.vertex.metadata.guestUniformBlocks[1]:target==='member'?value.vertex.metadata.guestUniformBlocks[1].members[0]:host,
      key=target==='root'?'vertex':target==='metadata'?'guestUniformBlocks':target==='block'?'slot':target==='member'?'count':'bufferZeroMask';
    Object.defineProperty(record,key,{get(){++getters;return 0;},enumerable:true});
    const result=normalizeStandardUniformShaderPair(value,host);assert.equal(result.ok,false,target+' accessor');records.push({name:target+'-accessor',result});
  }
  const proxy=new Proxy(copy(),{ownKeys(){throw Error('trap');}});assert.equal(normalizeStandardUniformShaderPair(proxy,selectors).ok,false);
  const nested=copy();nested.vertex.metadata.guestUniformBlocks[1]=new Proxy(nested.vertex.metadata.guestUniformBlocks[1],{getOwnPropertyDescriptor(){throw Error('trap');}});
  assert.equal(normalizeStandardUniformShaderPair(nested,selectors).ok,false);assert.equal(getters,0);
  const stable=normalizeStandardUniformShaderPair(pair,selectors);assert.equal(stable.ok,true);const canonical=JSON.stringify(stable);
  const caller=copy(),owned=normalizeStandardUniformShaderPair(caller,selectors);caller.vertex.metadata.guestUniformBlocks[1].members[0].count=0;assert.equal(JSON.stringify(owned),canonical);
  assert.ok(Object.isFrozen(owned.vertex.metadata.guestUniformBlocks[1].members[0]));assert.equal(JSON.stringify(pair),saved);
  assert.equal(deriveStandardUniformShaderInterface(null,pair.fragment.metadata,selectors).ok,false);
  assert.equal(deriveStandardUniformShaderInterface(pair.vertex.metadata,pair.fragment.metadata,null).ok,false);
  return {status:'passed',profile:STANDARD_UNIFORM_SHADER_PROFILE,records,getters,ownedCopies:true,proxyTrapsRejected:true};
}
