import {compilerCases as historicalCases} from '../virgl-integer-image-shader/cases.mjs';
import {zeroSelectors,vertexText,fragmentText,instanceFixtures} from './fixtures.mjs';
export function compilerCases(){
 const historical=historicalCases(),cases=historical.map(c=>({...c,name:'historical/'+c.name}));
 for(const c of historical.filter(c=>c.kind>=15))cases.push({...c,name:'selected/'+c.name,kind:c.kind+7});
 const add=(name,kind,a,b='',selectors=zeroSelectors(),okay=true,code=okay?null:'unsupported-feature')=>cases.push({name,kind,a,b,selectors,okay,code});
 for(const variant of ['both01','both10','instance1','vertex1','absent','unused','negabs']){
  const text=vertexText(variant);add(`system/${variant}/stage`,22,text);
  add(`system/${variant}/pair`,24,text,fragmentText,{...zeroSelectors(),unsignedColorMask:1});
 }
 const good=vertexText(),selectors={...zeroSelectors(),unsignedColorMask:1};
 for(const source of ['SV[1]','SV[1].wzyx','-SV[1]','|SV[1]|','-|SV[1].yxwz|'])add('source/'+source,24,good.replace('SV[1].wzyx',source),fragmentText,selectors);
 for(const [name,text]of [
  ['duplicate-instance',good.replace('DCL SV[0], VERTEXID','DCL SV[0], INSTANCEID')],
  ['duplicate-slot',good.replace('DCL SV[1], INSTANCEID','DCL SV[0], INSTANCEID')],
  ['slot2',good.replaceAll('SV[1]','SV[2]')],
  ['undeclared',good.replace('DCL SV[1], INSTANCEID\n','')],
  ['semantic-index',good.replace('INSTANCEID\n','INSTANCEID[1]\n')],
  ['guest-offset-field',good.replace('INSTANCEID\n','INSTANCEID, INSTANCE_BASE\n')],
  ['instance-range',good.replace('SV[1], INSTANCEID','SV[0..1], INSTANCEID')]
 ])add('refusal/'+name,24,text,fragmentText,selectors,false);
 for(const semantic of ['INSTANCEID','VERTEXID'])add('fragment-refusal/'+semantic,23,'FRAG\nDCL SV[0], '+semantic+'\nDCL OUT[0], COLOR\n0: MOV OUT[0], SV[0]\n1: END\n','',zeroSelectors(),false);
 add('mismatched-interface',24,good,fragmentText.replace('GENERIC[0]','GENERIC[1]'),selectors,false,'incompatible-interface');
 add('selected-empty',22,'','',zeroSelectors(),false,'unsupported-feature');
 const padded=(text,length)=>{let out=text;while(out.length<length){const n=Math.min(255,length-out.length);out+=n===1?'\n':' '.repeat(n-1)+'\n';}return out;};
 for(const length of [49151,49152]){
  add('selected-vertex-text-boundary/'+length,22,padded(good,length));
  add('selected-fragment-text-boundary/'+length,23,padded(fragmentText,length),'',{...zeroSelectors(),unsignedColorMask:1});
  add('selected-pair-text-boundary/'+length,24,padded(good,length),padded(fragmentText,length),selectors);
 }
 add('selected-text-size',22,' '.repeat(49153),'',zeroSelectors(),false,'input-too-large');
 add('selected-nonascii',22,'VERT\n\u00e9','',zeroSelectors(),false,'invalid-input');
 for(const f of instanceFixtures())add('hardware/'+f.name,24,f.vertexText,f.fragmentText,f.selectors);
 return cases;
}
