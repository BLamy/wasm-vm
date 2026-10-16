import assert from 'node:assert/strict';
import {direct as oldDirect} from '../virgl-shadow-shaders/abi.mjs';
import {selectorKeys} from './fixtures.mjs';
export function direct(module,c){
 if(c.kind<36)return oldDirect(module,c);
 const pointers=[];
 try{
  for(const text of [c.a,c.b]){const p=module._malloc(text.length+1);assert.ok(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+text.length]=0;pointers.push(p);}
  const [a,b]=pointers,m=selectorKeys.map(k=>c.selectors[k]),selected=c.kind>=36,kind=selected?c.kind-21:c.kind;
  const stage=selected?module._bridge_translate_standard_dimensional_texture:module._bridge_translate_standard_integer_image;
  const pair=selected?module._bridge_translate_standard_dimensional_texture_pair:module._bridge_translate_standard_integer_image_pair;
  const output=kind<17?stage(kind-15,a,c.a.length,m[5],m[6]):kind<20?pair(kind===18?0:a,c.a.length,kind===19?0:b,c.b.length,...m):stage(kind===21?-1:0,kind===20?0:a,c.a.length,m[5],m[6]);
  return module.UTF8ToString(output);
 }finally{pointers.reverse().forEach(p=>module._free(p));}
}
