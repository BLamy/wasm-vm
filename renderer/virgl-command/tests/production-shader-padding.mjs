// Literal Mesa/Chromium counterexamples and independent wire-boundary mutations.
// Runs unchanged in Node and the browser against its actual decoder module.
import {decodeProductionSubmission, decodeStandardStreamOutputSubmission} from '../decoder.mjs';

export function runProductionShaderPadding(fixtures) {
  let assertions=0, variants=0;
  const check=(value,label)=>{assertions++;if(!value)throw Error(label);};
  const same=(actual,expected,label)=>check(JSON.stringify(actual)===JSON.stringify(expected),label);
  const unhex=text=>Uint8Array.from(text.match(/../g),byte=>parseInt(byte,16));
  const reject=(bytes,label)=>{const result=decodeProductionSubmission(bytes);check(result.ok===false,label);check(!Object.hasOwn(result,'commands'),label+' has no partial admission');};
  const cloneWord=(bytes,index,value)=>{const copy=bytes.slice();new DataView(copy.buffer).setUint32(index*4,value,true);return copy;};
  const accepted=(bytes,text,label)=>{
    const result=decodeProductionSubmission(bytes);check(result.ok,label+': '+JSON.stringify(result.error));
    check(result.commands.length===1,label+' one exact packet');
    check(result.commands[0].fields.text===text,label+' preserves only declared text');
    check(result.commands[0].byteLength===bytes.length,label+' exact packet extent');return result.commands[0];
  };
  const packet=(text,streamOutput=false)=>{
    const length=text.length+1,extra=streamOutput?6:0,payload=5+extra+Math.ceil(length/4);
    const bytes=new Uint8Array((payload+1)*4),view=new DataView(bytes.buffer);
    [1+4*256+payload*65536,77,0,length,32,streamOutput?1:0].forEach((word,index)=>view.setUint32(index*4,word,true));
    if(streamOutput)view.setUint32(24,4,true);
    const start=24+extra*4;
    for(let index=0;index<text.length;index++)bytes[start+index]=text.charCodeAt(index);
    return {bytes,start,length};
  };
  check(fixtures.schema==='omarchy-chromium-shader-padding-v1','literal fixture schema');
  check(fixtures.packets.length===2&&fixtures.jobs.length===2,'both original failures retained');
  const jobs=[];
  for(const fixture of fixtures.jobs){
    const result=decodeProductionSubmission(unhex(fixture.commandsHex));check(result.ok,'original complete job '+fixture.traceLine+': '+JSON.stringify(result.error));
    check(result.commands.length===fixture.commandCount,'complete original command count');
    same(result.commands.filter(command=>command.opcode===1&&command.objectType===4).map(command=>({handle:command.fields.handle,text:command.fields.text})),fixture.shaders,'all original shader bodies');
    jobs.push({traceLine:fixture.traceLine,commands:result.commands.length});
  }
  for(const fixture of fixtures.packets){
    const bytes=unhex(fixture.packetHex),command=accepted(bytes,fixture.text,'literal shader '+fixture.handle);
    check(command.fields.handle===fixture.handle&&command.fields.stage===fixture.stage,'literal shader identity');
    check(command.fields.declaredTextBytes===fixture.declaredTextBytes&&command.fields.tokenCount===fixture.tokenCount,'literal lengths');
    same([...bytes.slice(24+fixture.declaredTextBytes)],fixture.padding,'literal nonzero padding');
    check(decodeStandardStreamOutputSubmission(bytes).ok===false,'private canonical facet retains strict padding');
    const zeroed=bytes.slice();zeroed.fill(0,24+fixture.declaredTextBytes);
    const canonical=decodeStandardStreamOutputSubmission(zeroed);check(canonical.ok,'private zero-padding packet remains valid');
    same(command.fields,canonical.commands[0].fields,'alignment cannot alter admitted semantics');
    for(const offset of [1,7,13]){const envelope=new Uint8Array(bytes.length+offset+5).fill(0xc7);envelope.set(bytes,offset);accepted(envelope.subarray(offset,offset+bytes.length),fixture.text,'nonzero byte view '+offset);}
    for(let value=1;value<=255;value++){
      const invalid=bytes.slice();invalid[24+fixture.declaredTextBytes-1]=value;reject(invalid,'nonzero declared terminal '+value);variants++;
    }
    for(const at of [0,4,fixture.text.length-1]){const invalid=bytes.slice();invalid[24+at]=0;reject(invalid,'embedded NUL '+at);}
    const nonascii=bytes.slice();nonascii[24]=0x80;reject(nonascii,'non-ASCII declared text');
    reject(bytes.slice(0,-4),'truncated final dword');
    reject(cloneWord(bytes,3,fixture.declaredTextBytes-1),'short declared string');
    reject(cloneWord(bytes,3,fixture.declaredTextBytes+1),'long declared string');
    reject(cloneWord(bytes,3,0x80000000+fixture.declaredTextBytes),'continuation remains unsupported');
    reject(cloneWord(bytes,3,49154),'shader text ceiling');
    for(const tokens of [0,8193])reject(cloneWord(bytes,4,tokens),'token bound '+tokens);
    reject(cloneWord(bytes,2,2),'unsupported shader stage');
    const overlong=new Uint8Array(bytes.length+4);overlong.set(bytes);new DataView(overlong.buffer).setUint32(0,new DataView(bytes.buffer).getUint32(0,true)+65536,true);reject(overlong,'extra payload dword');
  }
  const residues=[];
  for(let added=0;added<4;added++){
    const text=fixtures.packets[0].text+' '.repeat(added),{bytes,start,length}=packet(text);
    const padding=bytes.length-start-length;
    accepted(bytes,text,'canonical residue '+length%4);residues.push(length%4);
    for(let index=0;index<padding;index++)for(let value=0;value<=255;value++){
      const variant=bytes.slice();variant[start+length+index]=value;
      accepted(variant,text,'alignment residue '+length%4+' byte '+index+' value '+value);variants++;
    }
    // Header 28/one dword is independently transcribed SET_SUB_CTX, after the
    // exact shader extent. Padding must never consume its first byte.
    const combined=new Uint8Array(bytes.length+8);combined.set(bytes);const next=new DataView(combined.buffer);next.setUint32(bytes.length,28+65536,true);next.setUint32(bytes.length+4,0x1234abcd,true);
    const result=decodeProductionSubmission(combined);check(result.ok&&result.commands.length===2,'following packet survives residue '+length%4);check(result.commands[1].byteOffset===bytes.length,'no padding extent bleed');
    const so=packet(text,true);so.bytes.fill(0xa5,so.start+so.length);const decoded=accepted(so.bytes,text,'streamout offset residue '+length%4);check(decoded.fields.streamOutputCount===1,'streamout header preserved');
    const badSo=so.bytes.slice();badSo[so.start+so.length-1]=0xff;reject(badSo,'streamout terminal remains required');
  }
  same(residues.sort(),[0,1,2,3],'all four declared-length residues');
  return {status:'passed',assertions,variants,jobs,literalShaderHandles:fixtures.packets.map(row=>row.handle),residues};
}
