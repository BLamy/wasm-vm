import {compilerCases as oldCases} from '../virgl-instance-base/cases.mjs';
import {zeroSelectors,shadowText,pairTexts,shadowFixtures,passFragment} from './fixtures.mjs';
export function compilerCases(){
 const historical=oldCases(),cases=historical.map(c=>({...c,name:'historical/'+c.name}));
 for(const c of historical.filter(c=>c.kind>=22))cases.push({...c,name:'selected/'+c.name,kind:c.kind+7});
 const add=(name,kind,a,b='',selectors=zeroSelectors(),okay=true,code=okay?null:'unsupported-feature')=>cases.push({name,kind,a,b,selectors,okay,code});
 for(const stage of ['vertex','fragment'])for(const opcode of ['TEX','TXL','TXD','TXB','TXP','TXQ'])for(const slot of [0,7,15])
  for(const declaration of ['2D','SHADOW2D'])for(const type of ['FLOAT','FLOAT, FLOAT, FLOAT, FLOAT'])
   add(`${stage}/${opcode}/${slot}/${declaration}/${type}`,stage==='vertex'?29:30,shadowText(stage,{opcode,slot,declaration,type}),'',zeroSelectors(),!(stage==='vertex'&&opcode==='TXB'));
 for(const f of shadowFixtures())add('hardware/'+f.name,31,f.vertexText,f.fragmentText,f.selectors);
 for(const stage of ['vertex','fragment']){
  for(const opcode of ['TEX','TXL','TXD','TXP'])for(const suffix of ['_SAT','_PRECISE','_SAT_PRECISE']){
   const text=shadowText(stage,{opcode:opcode+suffix});add(`qualifier/${stage}/${opcode}${suffix}`,stage==='vertex'?29:30,text);
  }
  for(const target of ['1D','3D','CUBE','2D_ARRAY','SHADOW1D','SHADOWCUBE','SHADOW2D_ARRAY','BUFFER'])add('bad-target/'+stage+'/'+target,stage==='vertex'?29:30,shadowText(stage,{target}),'',zeroSelectors(),false);
  for(const type of ['SINT','UINT','FLOAT, SINT','UNORM'])add('bad-shadow-return/'+stage+'/'+type,stage==='vertex'?29:30,shadowText(stage,{type}),'',zeroSelectors(),false);
  add('bad-shadow-fetch/'+stage,stage==='vertex'?29:30,shadowText(stage,{opcode:'TXF'}),'',zeroSelectors(),false);
  for(const declaration of ['2D','SHADOW2D'])add('unused/'+stage+'/'+declaration,stage==='vertex'?29:30,shadowText(stage,{declaration,unused:true}));
  for(const query of ['before','after','before-shadow','after-shadow']){
   const pair=pairTexts(stage,{query});add('same-slot-query/'+stage+'/'+query,31,pair.vertexText,pair.fragmentText,{...zeroSelectors(),unsignedColorMask:1});
  }
  const good=shadowText(stage);
  for(const [label,text]of [
   ['shadow-then-ordinary',good.replace('SAMP[0], SHADOW2D\n', 'SAMP[0], SHADOW2D\n'+(stage==='vertex'?'3':'2')+': TEX TEMP[0], IN[1], SAMP[0], 2D\n').replace((stage==='vertex'?'3':'2')+': MOV',(stage==='vertex'?'4':'3')+': MOV').replace((stage==='vertex'?'4':'3')+': END',(stage==='vertex'?'5':'4')+': END')],
   ['integer-declared-shadow',good.replace('2D, FLOAT','SHADOW2D, UINT')],
   ['bad-slot',good.replaceAll('[0], SHADOW2D','[16], SHADOW2D')],
   ['guest-control',good.replace('2D, FLOAT','2D, FLOAT, SHADOW_MASK')],
  ])add('refusal/'+stage+'/'+label,stage==='vertex'?29:30,text,'',zeroSelectors(),false);
 }
 for(const stage of ['vertex','fragment']){
  const text=shadowText(stage,{target:'2D',opcode:'TXP'});add('ordinary-projective/'+stage,stage==='vertex'?29:30,text);
 }
 add('pair-mismatch',31,shadowText('vertex'),passFragment.replace('GENERIC[0]','GENERIC[7]'),zeroSelectors(),false,'incompatible-interface');
 for(const stage of ['vertex','fragment']){
  const kind=stage==='vertex'?29:30,good=shadowText(stage),number=text=>{
   const at=text.indexOf('0:');return text.slice(0,at)+text.slice(at).trim().split('\n').map((s,i)=>i+': '+s.replace(/^\d+: /,'')).join('\n')+'\n';
  };
  add('bad-shadow-declaration-separator/'+stage,kind,good.replace('SVIEW[0], 2D, FLOAT','SVIEW[0], SHADOW2D FLOAT'),'',zeroSelectors(),false);
  add('bad-shadow-register-separator/'+stage,kind,good.replace('SVIEW[0], 2D, FLOAT','SVIEW[0] SHADOW2D, FLOAT'),'',zeroSelectors(),false);
  add('multiple-owned-shadow-slots/'+stage,kind,number(good.replace('IMM[0]','DCL SAMP[15]\nDCL SVIEW[15], SHADOW2D, FLOAT\nIMM[0]').replace(/(\d+): MOV OUT\[[01]\], TEMP\[0\]/,'0: TEX TEMP[1], IN[1], SAMP[15], SHADOW2D\n$&')));
  add('independent-float-integer-shadow-slots/'+stage,kind,number(good.replace('IMM[0]','DCL SAMP[7]\nDCL SVIEW[7], 2D, UINT\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nIMM[0]').replace(/(\d+): MOV OUT\[[01]\], TEMP\[0\]/,'0: TXF TEMP[1], IMM[1], SAMP[7], 2D\n0: TEX TEMP[1], IN[1], SAMP[15], 2D\n$&')));
  add('ordinary-then-shadow-conflict/'+stage,kind,number(good.replace(/(\d+): TEX TEMP\[0\]/,'0: TEX TEMP[1], IN[1], SAMP[0], 2D\n$&')),'',zeroSelectors(),false);
 }
 return cases;
}
