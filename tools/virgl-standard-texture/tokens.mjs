// Literal text and pinned ABI enums supply this oracle, independently of the emitter.
import assert from 'node:assert/strict';
export function enumValues(header,name) {
  const body=header.match(new RegExp('enum '+name+'\\s*\\{([\\s\\S]*?)\\};'));
  assert.ok(body,'pinned original enum '+name);let next=0;const values={};
  for(const entry of body[1].replace(/\/\*[\s\S]*?\*\//g,'').split(',')) {
    const match=entry.trim().match(/^(\w+)(?:\s*=\s*(\d+))?/);
    if(match){if(match[2])next=Number(match[2]);values[match[1]]=next++;}
  }
  return values;
}
function words(type,values) {
  return values.map(value=>{const bytes=Buffer.alloc(4);
    if(type==='FLT32'&&!/^[-+]?0x/i.test(value))bytes.writeFloatLE(Number(value));
    else bytes.writeUInt32LE(Number(value)>>>0);
    return bytes.readUInt32LE();});
}
function operand(text,files) {
  const match=text.trim().match(/^(-)?(\|)?(IMM|IN|TEMP|CONST|SAMP|SV)\[(\d+)\](?:\[(\d+)\])?(?:\.([xyzw]+))?(\|)?$/);
  assert.ok(match,'literal original texture operand '+text);
  assert.equal(Boolean(match[2]),Boolean(match[7]));
  const file={IMM:'IMMEDIATE',IN:'INPUT',TEMP:'TEMPORARY',CONST:'CONSTANT',SAMP:'SAMPLER',SV:'SYSTEM_VALUE'}[match[3]],swizzle=match[6]??'xyzw';
  assert.ok(swizzle.length===1||swizzle.length===4);
  return {file:files['TGSI_FILE_'+file],index:Number(match[5]??match[4]),slot:match[5]?Number(match[4]):0,
    negate:Number(Boolean(match[1])),absolute:Number(Boolean(match[2])),
    swizzle:[...swizzle.padEnd(4,swizzle)].slice(0,4).map(lane=>'xyzw'.indexOf(lane)),indirect:0};
}
export function checkOriginalTextureTokens(text,record,header) {
  const opcodes=enumValues(header,'tgsi_opcode'),files=enumValues(header,'tgsi_file_type'),targets=enumValues(header,'tgsi_texture_type'),types=enumValues(header,'tgsi_imm_type');
  const immediates=[...text.matchAll(/^IMM\[(\d+)\] (FLT32|UINT32|INT32) \{([^}]+)\}$/gm)].map(match=>({
    index:Number(match[1]),type:types[{FLT32:'TGSI_IMM_FLOAT32',UINT32:'TGSI_IMM_UINT32',INT32:'TGSI_IMM_INT32'}[match[2]]],
    words:words(match[2],match[3].split(',').map(value=>value.trim()))}));
  assert.deepEqual(record.immediates,immediates,'complete original immediate types and raw words');
  const listed=[...text.matchAll(/^(\d+): (TEX|TXL|TXF|TXD|TXB|TXQ)(_SAT)?(_PRECISE)? ([^\n]+)$/gm)],expected=[];
  for(const match of listed) {
    const terms=match[5].split(',').map(value=>value.trim()),destination=terms.shift(),target=terms.pop();
    assert.equal(target,'2D');
    const mask=destination.match(/\.([xyzw]+)$/)?.[1]??'xyzw';
    expected.push({instruction:Number(match[1]),opcode:opcodes['TGSI_OPCODE_'+match[2]],target:targets.TGSI_TEXTURE_2D,
      writeMask:[...mask].reduce((bits,lane)=>bits|(1<<'xyzw'.indexOf(lane)),0),saturate:Number(Boolean(match[3])),precise:Number(Boolean(match[4])),offsets:0,
      sources:terms.map(term=>operand(term,files))});
  }
  assert.deepEqual(record.textureInstructions,expected,'literal original texture operands, masks, modifiers and native target');
  return expected;
}
