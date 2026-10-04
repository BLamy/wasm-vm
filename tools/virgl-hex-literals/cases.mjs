// Literal input/oracle equations; this module never consumes compiler output.
export const SEEDS = [0x34a8c291, 0x98217ef3, 0xe6194bd7];
export const EDGE_WORDS = [0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,
  0x3f000000,0xbf000000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,
  0x7fc00001,0xffc00001,0x7f800001,0xff800001,0x7fffffff,0xffffffff,0x12345678,0xabcdef01];
export const hex = w => '0x'+(w>>>0).toString(16).padStart(8,'0');
export function groups(seed=SEEDS[0],exponents=true) {
  const result=[];
  for(let i=0;i<EDGE_WORDS.length;i+=4) result.push({name:'edge-'+i/4,words:EDGE_WORDS.slice(i,i+4)});
  if(exponents) for(let e=0;e<256;e++) result.push({name:'exponent-'+e,
    words:[(e<<23)>>>0,((e<<23)|0x7fffff)>>>0,((e<<23)|0x80000000)>>>0,((e<<23)|0x80000001)>>>0]});
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let i=0;i<16;i++) result.push({name:'random-'+i,words:Array.from({length:4},next)});
  return result;
}
const immediate=(words,kind='FLT32',spell=null)=>`IMM[0] ${kind} {${spell??words.map(kind==='UINT32'?w=>String(w>>>0):hex).join(',')}}\n`;
export function carrier(words,kind='FLT32',spell=null) {
  return 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL TEMP[0..1]\n'+immediate(words,kind,spell)+
    'IMM[1] UINT32 {8388607,1056964608,23,0}\n'+
    '0: AND TEMP[0], IMM[0], IMM[1].xxxx\n1: OR TEMP[0], TEMP[0], IMM[1].yyyy\n'+
    '2: USHR TEMP[1], IMM[0], IMM[1].zzzz\n3: OR TEMP[1], TEMP[1], IMM[1].yyyy\n'+
    '4: MOV OUT[0], IN[0]\n5: MOV OUT[1], TEMP[0]\n6: MOV OUT[2], TEMP[1]\n7: END\n';
}
export function bitplane(words,plane,kind='FLT32',spell=null) {
  return 'FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\n'+immediate(words,kind,spell)+
    `IMM[1] UINT32 {${plane},1,1065353216,0}\n`+
    '0: USHR TEMP[0], IMM[0], IMM[1].xxxx\n1: AND TEMP[0], TEMP[0], IMM[1].yyyy\n'+
    '2: UCMP OUT[0], TEMP[0], IMM[1].zzzz, IMM[1].wwww\n3: END\n';
}
export const PARTNER_FRAGMENT='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const copy=(words,kind='FLT32',spell=null,raw=false,consumer='MOV')=>
  'FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\n'+immediate(words,kind,spell)+
  (raw?'IMM[1] UINT32 {0,0,0,0}\n0: OR TEMP[0], IMM[0], IMM[1]\n': '0: MOV TEMP[0], IMM[0]\n')+
  `1: ${consumer} OUT[0], TEMP[0]${consumer==='MUL'?', TEMP[0]':''}\n2: END\n`;
export function getCases() {
  const result=[];
  const add=(name,stage,text,ok,immediates=null,equivalent=null,equivalentMode='exact')=>result.push({name,stage,text,ok,immediates,equivalent,equivalentMode});
  for(const seed of SEEDS) for(const g of groups(seed)) {
    if(seed!==SEEDS[0]&&!g.name.startsWith('random-'))continue;
    add(`carrier-${seed}-${g.name}`,'vertex',carrier(g.words),true,[g.words,[8388607,1056964608,23,0]],carrier(g.words,'UINT32'));
  }
  for(const g of groups(SEEDS[0],false)) for(const plane of [0,7,23,31])
    add(`${g.name}-plane-${plane}`,'fragment',bitplane(g.words,plane),true,[g.words,[plane,1,1065353216,0]],bitplane(g.words,plane,'UINT32'));
  const safe=[0,0x3e800000,0x3f000000,0x3f800000];
  add('canonical-upper-digits','vertex',carrier([0xabcdef01,0xABCDEFAB,0xCDEFABCD,0xDEADBEEF],'FLT32','0xABCDEF01, 0xABCDEFAB,0xCDEFABCD,0xDEADBEEF'),true,
    [[0xabcdef01,0xabcdefab,0xcdefabcd,0xdeadbeef],[8388607,1056964608,23,0]],carrier([0xabcdef01,0xabcdefab,0xcdefabcd,0xdeadbeef],'UINT32'));
  add('literal-whitespace','vertex',carrier(safe,'FLT32','0x00000000 \t, 0x3e800000 ,0x3f000000\t,0x3f800000 '),true,[safe,[8388607,1056964608,23,0]],carrier(safe,'UINT32'));
  for(const [name,spelling] of [['decimal','0,0.25,0.5,1'],['signed-decimal','+0.0,2.5e-1,5E-1,1.0']])
    add(name,'vertex',carrier(safe,'FLT32',spelling),true,[safe,[8388607,1056964608,23,0]],carrier(safe,'UINT32'));
  add('legacy-hex-safe','fragment',copy(safe),true,[safe],copy(safe,'UINT32'),'metadata');
  add('legacy-decimal-safe','fragment',copy(safe,'FLT32','0,0.25,0.5,1'),true,[safe],copy(safe,'UINT32'),'metadata');
  // Domain restrictions come from prior UINT32 behavior; private bits grant no
  // numerical or raster authority. Test every exceptional lane, both profiles.
  for(const w of [1,0x80000001,0x007fffff,0x807fffff,0x7f800000,0xff800000,0x7fc00001,0xff800001,0x7f7fffff])
    for(let lane=0;lane<4;lane++) for(const raw of [false,true]) {
      const words=safe.slice();words[lane]=w;
      add(`domain-copy-${hex(w)}-${lane}-${raw}`,'fragment',copy(words,'FLT32',null,raw),raw&&w===0x7f7fffff,[words,...(raw?[[0,0,0,0]]:[])],copy(words,'UINT32',null,raw));
      if(raw)add(`domain-mul-${hex(w)}-${lane}`,'fragment',copy(words,'FLT32',null,true,'MUL'),w===0x7f7fffff,[words,[0,0,0,0]],copy(words,'UINT32',null,true,'MUL'));
    }
  const bad=['0x','0x0','0x0000000','0x000000000','0x100000000','0xFFFFFFFFF','0X3f800000','+0x3f800000','-0x3f800000',
    '0x1p+0','0x3f800000p0','0x3f800000.0','0x 3f800000','0x3f80 0000','0x3f80000g','0xGf800000','0x3f800000u','0x3f800000/','0x3f800000x'];
  for(const spelling of bad)for(let lane=0;lane<4;lane++)for(const stage of ['vertex','fragment']) {
    const literals=safe.map(hex);literals[lane]=spelling;const text=stage==='vertex'?carrier(safe,'FLT32',literals.join(',')):copy(safe,'FLT32',literals.join(','));
    add(`malformed-${spelling}-${lane}-${stage}`,stage,text,false);
  }
  for(let n=0;n<8;n++)add('terminal-truncation-'+n,'vertex',carrier(safe).split('IMM[0]')[0]+'IMM[0] FLT32 {0x'+'0'.repeat(n),false);
  add('uint32-still-decimal-only','vertex',carrier(safe,'UINT32',safe.map(hex).join(',')),false);
  add('immediate-gap','vertex',carrier(safe).replace('IMM[0] FLT32','IMM[1] FLT32'),false);
  add('immediate-duplicate','vertex',carrier(safe).replace('IMM[1] UINT32','IMM[0] UINT32'),false);
  add('immediate-upper-index','vertex',carrier(safe).replace('IMM[1] UINT32','IMM[32] UINT32'),false);
  return result;
}
