// Fresh critic inputs. Image words and shader operands do not use the worker fixtures.
const zero = () => ({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0});
const positions = () => new Float32Array([-1,-1,0,1, 1,-1,0,1, -1,1,0,1, -1,1,0,1, 1,-1,0,1, 1,1,0,1]);
const vertexPass = 'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
const fragmentPass = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const small = (n,level) => Math.max(1,Math.floor(n/2**level));
function imageWords(seed,width,height,levels) {
  let state = seed >>> 0;
  const next = () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0;};
  return Array.from({length:levels},(_,level) => {
    const w=small(width,level),h=small(height,level),bytes=new Uint8Array(w*h*4);
    for(let at=0;at<bytes.length;at++) bytes[at]=(next() >>> 19) & 255;
    return {level,width:w,height:h,bytes};
  });
}
function literalSources(text) {
  const immediate = new Map([...text.matchAll(/^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$/gm)].map(m =>
    [Number(m[1]),m[3].split(',').map(v => m[2]==='FLT32'?Math.fround(Number(v)):Number(v))]));
  const take = term => {
    const negative=term.startsWith('-'); term=term.replace(/^-/,'');
    const absolute=term.startsWith('|'); if(absolute) term=term.slice(1,-1);
    const m=term.match(/^IMM\[(\d+)\](?:\.([xyzw]+))?$/); if(!m) throw Error('critic immediate operand '+term);
    let swizzle=m[2]??'xyzw'; if(swizzle.length===1)swizzle=swizzle.repeat(4);
    return [...swizzle].map(lane => {let v=immediate.get(Number(m[1]))['xyzw'.indexOf(lane)];if(absolute)v=Math.abs(v);return negative?-v:v;});
  };
  return {immediate,take};
}
function prediction(f,text) {
  if(f.opcode==='CONSTANT')return () => [.125,.25,.5,.875];
  const {immediate,take}=literalSources(text),match=text.match(/^\d+: (TXL|TXF|TXD|TXB|TXQ) (.*)$/m);
  const terms=match[2].split(',').map(x=>x.trim()),destination=terms.shift();terms.pop();terms.pop();
  const texel=(level,x,y)=>{const p=f.planes[level],at=(y*p.width+x)*4;return [...p.bytes.subarray(at,at+4)].map(v=>v/255);};
  return (x,y) => {
    if(f.opcode==='TXQ') {
      const lod=take(terms[0])[0],result=[...immediate.get(1)],mask=destination.split('.')[1];
      const value=[small(f.width,lod),small(f.height,lod),undefined,f.levels];
      for(const lane of mask)result['xyzw'.indexOf(lane)]=value['xyzw'.indexOf(lane)];
      return result;
    }
    if(f.opcode==='TXF'){const [ix,iy,,level]=take(terms[0]);return texel(level,ix,iy);}
    let u,v,lod;
    if(f.opcode==='TXB'){u=(y+.5)/f.frameHeight;v=(x+.5)/f.frameWidth;lod=Math.log2(Math.max(f.width/f.frameHeight,f.height/f.frameWidth))+1;}
    else {
      [u,v,,lod]=take(terms[0]);
      if(f.opcode==='TXD'){const dx=take(terms[1]),dy=take(terms[2]);lod=Math.log2(Math.max(Math.hypot(dx[0]*f.width,dx[1]*f.height),Math.hypot(dy[0]*f.width,dy[1]*f.height)));}
    }
    const level=Math.max(0,Math.min(f.levels-1,Math.floor(lod+.5))),p=f.planes[level];
    return texel(level,Math.max(0,Math.min(p.width-1,Math.floor(u*p.width))),Math.max(0,Math.min(p.height-1,Math.floor(v*p.height))));
  };
}
export function adversarialTextureFixtures(seed) {
  const fixtures=[];
  for(const stage of ['vertex','fragment']) {
    const slot=stage==='vertex'?7:14;
    const modes=['TXL-negate-swizzle','TXL-absolute-swizzle','TXD-gradient-modifiers','TXF-negate-swizzle','TXQ-xyw','TXQ-x','TXQ-w'];
    if(stage==='fragment')modes.push('TXB-absolute-swizzle');
    if(stage==='vertex')modes.push('CONSTANT-unused-samplers');
    for(const [index,mode] of modes.entries()) {
      const opcode=mode.split('-')[0],f={name:`critic/${stage}/${mode}/slot${slot}/seed${seed}`,stage,opcode,slot,
        range:'restricted',kind:'unorm',linear:false,resourceWidth:23,resourceHeight:11,firstLevel:1,lastLevel:4,width:11,height:5,levels:4,
        frameWidth:8,frameHeight:8,queryMask:opcode==='TXQ'?mode.split('-')[1]:'xyw',selectors:zero(),positions:positions(),needsCoordinates:opcode==='TXB'};
      f.planes=imageWords((seed ^ (slot*0x9e3779b9) ^ (index*0x85ebca6b))>>>0,f.width,f.height,f.levels);
      f.coordinates=new Float32Array([0,0,0,1, 1,0,0,1, 0,1,0,1, 0,1,0,1, 1,0,0,1, 1,1,0,1]);
      let declaration=(stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n')+`DCL TEMP[0]\nDCL SAMP[${slot}]\nDCL SVIEW[${slot}], 2D, FLOAT\n`;
      let instructions=[];
      if(opcode==='TXL') {
        declaration+='IMM[0] FLT32 {-0.6875,-0.3125,-9.0,-1.75}\n';
        instructions.push(`TXL TEMP[0], ${mode.includes('negate')?'-IMM[0].yxzw':'|IMM[0].yxzw|'}, SAMP[${slot}], 2D`);
      } else if(opcode==='TXD') {
        declaration+=`IMM[0] FLT32 {-0.6875,-0.3125,-9.0,-1.75}\nIMM[1] FLT32 {0.0,${Math.fround(-4/f.width)},0.0,0.0}\nIMM[2] FLT32 {${Math.fround(-4/f.height)},0.0,0.0,0.0}\n`;
        instructions.push(`TXD TEMP[0], |IMM[0].yxzw|, -|IMM[1].yxzw|, -IMM[2].yxzw, SAMP[${slot}], 2D`);
      } else if(opcode==='TXF') {
        declaration+='IMM[0] INT32 {0,-1,0,-2}\n';instructions.push(`TXF TEMP[0], -IMM[0].yxzw, SAMP[${slot}], 2D`);
      } else if(opcode==='TXQ') {
        declaration+='IMM[0] INT32 {-7,-1,0,0}\nIMM[1] UINT32 {71,83,97,109}\n';
        instructions.push('MOV TEMP[0], IMM[1]',`TXQ TEMP[0].${f.queryMask}, -IMM[0].yxzw, SAMP[${slot}], 2D`,'U2F TEMP[0], TEMP[0]');
      } else if(opcode==='TXB')instructions.push(`TXB TEMP[0], |IN[0].yxzw|, SAMP[${slot}], 2D`);
      else {
        declaration+='IMM[0] FLT32 {0.125,0.25,0.5,0.875}\n';instructions.push('MOV TEMP[0], IMM[0]');f.checkUnusedDeclarations=true;
      }
      if(stage==='vertex')instructions.push('MOV OUT[0], IN[0]');
      instructions.push(`MOV OUT[${stage==='vertex'?1:0}], TEMP[0]`,'END');
      const original=declaration+instructions.map((v,i)=>i+': '+v+'\n').join('');
      f.vertexText=stage==='vertex'?original:vertexPass;f.fragmentText=stage==='fragment'?original:fragmentPass;
      f.expected=prediction(f,original);fixtures.push(f);
    }
  }
  return fixtures;
}
