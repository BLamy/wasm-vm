// Exercise unchanged base obligations under the new compiler-owned wrapper.
// Original accepted shader bodies are retained; only one dead private F2I
// instruction and a fresh TEMP declaration are appended before END.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const choices=[['bounded-loop-cases','loop-small-vertex'],['radial-domain-cases','plain-vertex'],
  ['raster-bank-cases','copy-x-direct-vertex'],['precise-arithmetic-cases','arithmetic-add-x-direct-vertex']];
export function getCombinedCases(){
  return choices.map(([file,name])=>{
    const path=`renderer/virgl-shader/tests/${file}.json`,raw=fs.readFileSync(path),fixture=JSON.parse(raw),cases=Array.isArray(fixture)?fixture:fixture.cases;
    const base=cases.find(c=>c.name===name);if(!base?.ok)throw new Error('verified base missing: '+name);
    const match=/DCL CONST\[(\d+)/.exec(base.text),index=match?Number(match[1]):0;
    let text=base.text.replace(/^(VERT|FRAG)\n/,`$1\nDCL TEMP[511]\n${match?'':'DCL CONST[0]\n'}`);
    text=text.replace(/(?:\d+:\s*)?END\s*$/,`F2I TEMP[511], CONST[${index}]\nEND\n`);
    return {name:'combined-'+name,stage:base.stage,text,ok:true,primary:false,base:{path,name,text:base.text,fixtureSha256:createHash('sha256').update(raw).digest('hex')}};
  });
}
