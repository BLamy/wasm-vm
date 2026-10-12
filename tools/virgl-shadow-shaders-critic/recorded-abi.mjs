import assert from 'node:assert/strict';
export const selectorKeys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
export function call(module,c){
 const pointers=[];
 try{
  for(const text of [c.a,c.b]){const bytes=Buffer.from(text),p=module._malloc(bytes.length+1);assert.ok(p);module.HEAPU8.set(bytes,p);module.HEAPU8[p+bytes.length]=0;pointers.push(p);}
  const [a,b]=pointers,m=selectorKeys.map(k=>c.selectors[k]),n=c.a.length,l=c.b.length,k=c.kind;let result;
  if(k===0||k===1)result=module._bridge_translate_standard_texture(k,a,n);
  else if(k>=2&&k<=4)result=module._bridge_translate_standard_texture_pair(k===3?0:a,n,k===4?0:b,l,...m.slice(0,5));
  else if(k===5||k===6)result=module._bridge_translate_standard_texture(k===6?-1:0,k===5?0:a,n);
  else if(k===7||k===8)result=module._bridge_translate_standard(k-7,a,n);
  else if(k===9)result=module._bridge_translate_standard_pair(a,n,b,l);
  else if(k===10)result=module._bridge_translate_standard_pair_typed(a,n,b,l,...m.slice(0,2));
  else if(k===11)result=module._bridge_translate_standard_pair_vertex_formats(a,n,b,l,...m.slice(0,4));
  else if(k===12||k===13)result=module._bridge_translate_standard_uniform(k-12,a,n);
  else if(k===14)result=module._bridge_translate_standard_uniform_pair(a,n,b,l,...m.slice(0,5));
  else{
   const offset=k<22?15:k<29?22:29,kind=k-offset;
   const entry=offset===15?'integer_image':offset===22?'instance_base':'shadow_texture';
   const stage=module['_bridge_translate_standard_'+entry],pair=module['_bridge_translate_standard_'+entry+'_pair'];
   if(kind<2)result=stage(kind,a,n,m[5],m[6]);
   else if(kind<5)result=pair(kind===3?0:a,n,kind===4?0:b,l,...m);
   else result=stage(kind===6?-1:0,kind===5?0:a,n,m[5],m[6]);
  }
  return module.UTF8ToString(result);
 }finally{for(const p of pointers.reverse())module._free(p);}
}
