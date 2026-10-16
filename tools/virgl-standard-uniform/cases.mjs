// Independent original TGSI and literal acceptance expectations. No emitter imports.
export const selectorKeys = ['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask'];
export const zeroSelectors = Object.freeze(Object.fromEntries(selectorKeys.map(key=>[key,0])));
export const program = (stage,declarations,instructions) => (stage==='vertex'?'VERT':'FRAG')+'\n'+declarations+'\n'+
  [...instructions,'END'].map((line,index)=>index+': '+line+'\n').join('');
export const basicVertex = program('vertex','DCL IN[0]\nDCL OUT[0], POSITION',['MOV OUT[0], IN[0]']);
export const basicFragment = program('fragment','DCL OUT[0], COLOR\nIMM[0] FLT32 {0.25,0.5,0.75,1.0}',['MOV OUT[0], IMM[0]']);
export function slotProgram(stage,slot,first=0,last=slot?1023:511,read=last,extra='') {
  return program(stage,(stage==='vertex'?'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]':'DCL OUT[0], COLOR')+
    '\nDCL CONST['+slot+']['+first+'..'+last+']'+(extra?'\n'+extra:''),
    [...(stage==='vertex'?['MOV OUT[0], IN[0]']:[]),'MOV OUT['+(stage==='vertex'?1:0)+'], CONST['+slot+']['+read+']']);
}
export function allBanks(stage) {
  const declarations=(stage==='vertex'?'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]':
    'DCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR')+'\nDCL TEMP[0]\n'+
    Array.from({length:13},(_,slot)=>'DCL CONST['+slot+'][0..'+(slot?1023:511)+']').join('\n');
  const body=[...(stage==='vertex'?['MOV OUT[0], IN[0]']:[]),'MOV TEMP[0], CONST[0][511]',
    ...Array.from({length:12},(_,index)=>'ADD TEMP[0], TEMP[0], CONST['+(index+1)+'][1023]')];
  body.push(stage==='vertex'?'MOV OUT[1], TEMP[0]':'ADD OUT[0], TEMP[0], IN[0]');
  return program(stage,declarations,body);
}
export function compilerCases() {
  const cases=[],add=(name,kind,a,b=basicFragment,selectors=zeroSelectors,okay=true,code=null)=>
    cases.push({name,kind,a,b,selectors:{...selectors},okay,code});
  for(const [kind,stage]of [[0,'vertex'],[1,'fragment']]) {
    for(let slot=0;slot<=12;++slot)for(const at of [0,slot?1023:511])
      add(stage+'-slot-'+slot+'-read-'+at,kind,slotProgram(stage,slot,0,slot?1023:511,at));
    for(const slot of [0,1,12]) {
      const end=slot?1023:511;
      add(stage+'-sparse-'+slot,kind,slotProgram(stage,slot,7,end,7));
      add(stage+'-sparse-hole-'+slot,kind,slotProgram(stage,slot,7,end,6),'',zeroSelectors,false,'unsupported-feature');
      for(const offset of ['', ' +1',' -1',' +'+end,' -'+end,' +'+(end+1),' -'+(end+1),' +32767',' -32768'])
        add(stage+'-dynamic-'+slot+'-'+offset,kind,slotProgram(stage,slot,0,end,'ADDR[0].x'+offset,
          'DCL ADDR[0]\nIMM[0] UINT32 {1,1,1,1}').replace(/\n(\d+): /g,(_,index)=>'\n'+(Number(index)+1)+': ')
          .replace('\n1: ', '\n0: UARL ADDR[0].x, IMM[0].xxxx\n1: '));
      for(const [label,change]of [
        ['vector-over',s=>s.replace('..'+end+']','..'+(end+1)+']')],
        ['read-over',s=>s.replace('CONST['+slot+']['+end+']','CONST['+slot+']['+(end+1)+']')],
        ['range-descending',s=>s.replace('[0..'+end+']','[8..7]')],
        ['bank-range',s=>s.replace('CONST['+slot+'][0..','CONST['+slot+'..'+slot+'][0..')],
        ['duplicate',s=>s.replace('\n0:', '\nDCL CONST['+slot+'][0..'+end+']\n0:')],
        ['positive-offset-over',s=>s.replace('CONST['+slot+']['+end+']','CONST['+slot+'][ADDR[0].x +32768]')
          .replace('\n0:','\nDCL ADDR[0]\n0:')],
        ['negative-offset-over',s=>s.replace('CONST['+slot+']['+end+']','CONST['+slot+'][ADDR[0].x -32769]')
          .replace('\n0:','\nDCL ADDR[0]\n0:')],
      ]) add(stage+'-'+slot+'-'+label,kind,change(slotProgram(stage,slot)),'',zeroSelectors,false,'unsupported-feature');
    }
    for(const slot of [13,1023,1024,0xffffffff])add(stage+'-bank-over-'+slot,kind,slotProgram(stage,slot,0,0,0),'',zeroSelectors,false,'unsupported-feature');
    for(const source of ['CONST[ADDR[0].x][0]','CONST[ADDR[0].x + 1][0]','CONST[1][ADDR[1].x]',
      'CONST[1][ADDR[0].y]','CONST[1][ADDR[0].x + -1]','CONST[1][ADDR[0].x + 1]','CONST[1][0][0]','CONST[1][-1]'])
      add(stage+'-malformed-'+source,kind,slotProgram(stage,1).replace('CONST[1][1023]',source)
        .replace('\n0:','\nDCL ADDR[0]\n0:'),'',zeroSelectors,false,'unsupported-feature');
    const io=stage==='vertex'?'DCL IN[0]\nDCL OUT[0], POSITION':'DCL OUT[0], COLOR';
    for(const offset of [512,-512,32767,-32768,32768,-32769]) {
      const okay=offset>=-32768&&offset<=32767,relative=(offset>0?'+':'')+offset;
      add(stage+'-plain-offset-'+offset,kind,program(stage,io+'\nDCL CONST[0..511]\nDCL ADDR[0]\n'+
        'IMM[0] FLT32 {'+[-offset,-offset,-offset,-offset].map(value=>value+'.0').join(',')+'}',
        ['ARL ADDR[0].x, IMM[0].xxxx','MOV OUT[0], CONST[ADDR[0].x '+relative+']']),
        '',zeroSelectors,okay,okay?null:'unsupported-feature');
    }
    for(const declarations of ['DCL CONST[0][9]\nDCL CONST[0]','DCL CONST[9]\nDCL CONST[0][0]',
      'DCL CONST[12][0..1023]\nDCL CONST[0][9]\nDCL CONST[0][0]','DCL CONST[9]\nDCL CONST[0]',
      'DCL CONST[0][0]\nDCL CONST[9]'])
      add(stage+'-zero-alias-order-'+cases.length,kind,program(stage,io+'\n'+declarations,['MOV OUT[0], CONST[0]']));
    add(stage+'-zero-alias-overlap',kind,program(stage,io+'\nDCL CONST[0..9]\nDCL CONST[0][9]',['MOV OUT[0], CONST[0]']),
      '',zeroSelectors,false,'unsupported-feature');
    for(const declaration of ['DCL CONST[511]','DCL CONST[0][511]'])
      add(stage+'-zero-end-'+declaration,kind,program(stage,io+'\n'+declaration,['MOV OUT[0], CONST[511]']));
    add(stage+'-unused-banks',kind,program(stage,io+'\nDCL CONST[1][7..1023]\nDCL CONST[12][0]',
      stage==='vertex'?['MOV OUT[0], IN[0]']:['MOV OUT[0], CONST[12][0]']));
  }
  const both={a:allBanks('vertex'),b:allBanks('fragment')};
  for(const bufferZeroMask of [0,1,2,3])add('all-banks-zero-'+bufferZeroMask,2,both.a,both.b,{...zeroSelectors,bufferZeroMask});
  const typed=program('vertex','DCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL IN[4]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0][0]\nDCL CONST[12][0..1023]\nDCL TEMP[0]',
    ['MOV OUT[0], IN[0]','MOV TEMP[0], IN[1]','XOR TEMP[0], TEMP[0], IN[2]',
      'ADD TEMP[0], TEMP[0], IN[3]','ADD TEMP[0], TEMP[0], IN[4]','XOR TEMP[0], TEMP[0], CONST[0][0]',
      'XOR OUT[1], TEMP[0], CONST[12][1023]']);
  const fs=program('fragment','DCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0][0]\nDCL OUT[0], COLOR',
    ['XOR OUT[0], IN[0], CONST[0][0]']);
  for(const bufferZeroMask of [0,1,2,3])add('four-formats-zero-'+bufferZeroMask,2,typed,fs,
    {signedMask:2,unsignedMask:4,packedSignedMask:24,packedNormalizedMask:16,bufferZeroMask});
  for(const bufferZeroMask of [1,2,3,4,0xffffffff])add('invalid-zero-'+bufferZeroMask,2,basicVertex,basicFragment,
    {...zeroSelectors,bufferZeroMask},false,'invalid-input');
  for(const values of [[2,2,0,0],[2,0,2,0],[0,2,2,2],[0,0,0,2],[0,0,2,4],[0,0,32768,0],
    [65536,0,0,0],[0,65536,0,0],[0,0,65536,0],[0,0,0,65536]])
    add('invalid-masks-'+values.join('-'),2,basicVertex,basicFragment,
      {...Object.fromEntries(selectorKeys.slice(0,4).map((key,i)=>[key,values[i]])),bufferZeroMask:0},false,'invalid-input');
  add('null-vs',3,basicVertex,basicFragment,zeroSelectors,false,'invalid-input');
  add('null-fs',4,basicVertex,basicFragment,zeroSelectors,false,'invalid-input');
  add('null-stage',5,basicVertex,'',zeroSelectors,false,'invalid-input');
  add('bad-stage',6,basicVertex,'',zeroSelectors,false,'unsupported-stage');
  for(const [label,a,b]of [['nul-vs','\0',basicFragment],['nul-fs',basicVertex,'\0'],
    ['huge-vs',' '.repeat(49153),basicFragment],['huge-fs',basicVertex,' '.repeat(49153)]])
    add(label,2,a,b,zeroSelectors,false,label.startsWith('huge')?'input-too-large':'invalid-input');
  for(const [kind,stage]of [[7,'vertex'],[8,'fragment']]) {
    add('old-stage-isolated-'+stage,kind,slotProgram(stage,1),'',zeroSelectors,false,'unsupported-feature');
    add('old-stage-compatible-'+stage,kind,stage==='vertex'?basicVertex:basicFragment);
  }
  for(const kind of [9,10,11]) {
    add('old-pair-isolated-'+kind,kind,both.a,both.b,zeroSelectors,false,'unsupported-feature');
    add('old-pair-compatible-'+kind,kind,basicVertex,basicFragment);
  }
  return cases;
}
