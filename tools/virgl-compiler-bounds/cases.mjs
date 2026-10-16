// Independent resource-bound witnesses. No compiler parser/IR is used here.
export const ENVELOPE=Object.freeze({textBytes:49152,tokens:8192,glslBytes:262144,instructions:768,registerIndex:7,temporaryRegisterIndex:511,constantRegisterIndex:45,ordinaryVertexConstantRegisterIndex:127,immediateRegisterIndex:31,conditionalDepth:16,lines:1536,lineBytes:512});
export const SEEDS=[0x2317509d,0x834baa1f,0xfa1836c7];
export function source(stage,body,{temps=511,immediates=32,extra=[],counter=0}={}) {
  const vertex=stage==='vertex';
  return [vertex?'VERT':'FRAG',
    ...(vertex?['DCL IN[0]','DCL IN[1]','DCL IN[2]','DCL IN[3]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']:['DCL IN[0], GENERIC[0], PERSPECTIVE','DCL IN[1], GENERIC[1], PERSPECTIVE','DCL IN[2], GENERIC[2], PERSPECTIVE','DCL OUT[0], COLOR']),
    `DCL TEMP[0..${temps}]`,...extra,
    ...Array.from({length:immediates},(_,i)=>`IMM[${i}] UINT32 {${i===31?`0, 2147483648, 1, ${counter}`:'0, 0, 0, 0'}}`),
    ...body.map((line,i)=>`${i}: ${line}`),`${body.length}: END`,''].join('\n');
}
const out=stage=>stage==='vertex'?['MOV OUT[0], IN[0]','MOV OUT[1], TEMP[511]']:['MOV OUT[0], TEMP[511]'];
export function longSource(stage,{count=768,depth=0,temps=511,immediates=32,missingJoin=false}={}) {
  const a=stage==='vertex'?1:0,b=stage==='vertex'?2:1,condition=stage==='vertex'?3:2;
  const body=Array.from({length:512},(_,i)=>`MOV TEMP[${i}], IMM[${i%32}]`);
  // The long private chain remains a dependency of the visible selector.
  const suffix=[`AND TEMP[509].x, IN[${condition}].xxxx, IMM[31].yyyy`,
    'AND TEMP[509].x, TEMP[509].xxxx, TEMP[507].xxxx',
    `ADD TEMP[511], IN[${a}], IMM[0]`,`ADD TEMP[510], IN[${b}], IMM[0]`];
  if(depth){
    for(let i=0;i<depth;i++)suffix.push(i===depth-1?'UIF TEMP[509].xxxx':'UIF IMM[31].zzzz');
    suffix.push(`MOV TEMP[511], IN[${a}]`,'ELSE');
    if(!missingJoin)suffix.push(`MOV TEMP[511], IN[${b}]`);
    suffix.push('ENDIF',...Array(depth-1).fill('ENDIF'));
  }else suffix.push(`UCMP TEMP[511], TEMP[509].xxxx, TEMP[511], TEMP[510]`);
  suffix.push(...out(stage));
  const steps=count-body.length-suffix.length-1;
  if(steps<0)throw new Error('witness budget too short');
  body.push(...Array(steps).fill('UADD TEMP[508].x, TEMP[508].xxxx, IMM[31].zzzz'));
  body.push('USEQ TEMP[507].x, TEMP[508].xxxx, IMM[31].wwww');
  body.push(...suffix);
  if(body.length!==count)throw new Error('exact non-END instruction budget');
  return source(stage,body,{temps,immediates,counter:steps});
}
export function compactSource(stage,{depth=0,temps=511,immediates=32,missingJoin=false,targets=false}={}) {
  const a=stage==='vertex'?1:0,b=stage==='vertex'?2:1,condition=stage==='vertex'?3:2;
  const body=[`AND TEMP[509].x, IN[${condition}].xxxx, IMM[31].yyyy`,
    `ADD TEMP[510], IN[${b}], IMM[0]`];
  if(depth){
    if(!missingJoin)body.push(`ADD TEMP[511], IN[${b}], IMM[0]`);
    for(let i=0;i<depth;i++)body.push(i===depth-1?'UIF TEMP[509].xxxx':'UIF IMM[31].zzzz');
    body.push(`MOV TEMP[511], IN[${a}]`,'ELSE');
    if(!missingJoin)body.push(`MOV TEMP[511], IN[${b}]`);
    body.push('ENDIF',...Array(depth-1).fill('ENDIF'));
  }else body.push(`ADD TEMP[511], IN[${a}], IMM[0]`,`UCMP TEMP[511], TEMP[509].xxxx, TEMP[511], TEMP[510]`);
  body.push(...out(stage));
  if(targets){
    const opens=[];for(let i=0;i<body.length;i++){
      if(body[i].startsWith('UIF '))opens.push({open:i});
      else if(body[i]==='ELSE'){const f=opens.at(-1);f.otherwise=i;body[f.open]+=` :${i}`;}
      else if(body[i]==='ENDIF'){const f=opens.pop();if(f.otherwise!==undefined)body[f.otherwise]+=` :${i}`;else body[f.open]+=` :${i}`;}
    }
  }
  return source(stage,body,{temps,immediates});
}
export function getCases(){
  const cases=[];const add=(name,stage,text,ok,kind,codes=[])=>cases.push({name,stage,text,ok,kind,codes});
  for(const stage of ['vertex','fragment']){
    const small=compactSource(stage),deep=compactSource(stage,{depth:16}),long=longSource(stage);
    add('high-'+stage,stage,small,true,'high');
    add('long-'+stage,stage,long,true,'long');
    add('deep-'+stage,stage,deep,true,'deep');
    add('combined-'+stage,stage,longSource(stage,{depth:16}),true,'combined');
    add('targets-'+stage,stage,compactSource(stage,{depth:16,targets:true}),true,'targets');
    const lane=stage==='vertex'?1:0,rasterBody=['AND TEMP[509].x, IMM[31], IMM[0]','MOV TEMP[0].x, CONST[45].xxxx'];
    for(let i=1;i<512;i++)rasterBody.push(`MOV TEMP[${i}].x, TEMP[${i-1}].xxxx`);
    while(rasterBody.length<768-(stage==='vertex'?3:2))rasterBody.push('MOV TEMP[511].x, TEMP[511].xxxx');
    rasterBody.push(...(stage==='vertex'?['MOV OUT[0], IN[0]']:[]),`MOV OUT[${lane}], IN[${stage==='vertex'?1:0}]`,`MOV OUT[${lane}].w, TEMP[511].xxxx`);
    add('raster-long-'+stage,stage,source(stage,rasterBody,{extra:['DCL CONST[0..45]']}),true,'raster');
    const rasterDeep=[`AND TEMP[509].x, IN[${stage==='vertex'?3:2}].xxxx, IMM[31].yyyy`,'MOV TEMP[511].x, CONST[45].xxxx'];
    rasterDeep.push(...Array(15).fill('UIF IMM[31].zzzz'),'UIF TEMP[509].xxxx',
      'MOV TEMP[511].x, CONST[0].xxxx','ELSE','MOV TEMP[511].x, CONST[45].xxxx',...Array(16).fill('ENDIF'));
    rasterDeep.push(...(stage==='vertex'?['MOV OUT[0], IN[0]']:[]),`MOV OUT[${lane}], IN[${stage==='vertex'?1:0}]`,`MOV OUT[${lane}].w, TEMP[511].xxxx`);
    add('raster-deep-'+stage,stage,source(stage,rasterDeep,{extra:['DCL CONST[0..45]']}),true,'raster-deep');
    const legacyBody=Array.from({length:512},(_,i)=>`MOV TEMP[${i}], IN[0]`);
    while(legacyBody.length<768-out(stage).length)legacyBody.push('MOV TEMP[511], TEMP[511]');
    legacyBody.push(...out(stage));
    add('legacy-long-'+stage,stage,source(stage,legacyBody,{immediates:0}),true,'legacy');
    const last=stage==='vertex'?['MOV OUT[0], IN[0]','MOV OUT[1], IMM[31]']:['MOV OUT[0], IMM[31]'];
    const immediate=source(stage,last,{immediates:0}).replace(/^0:/m,Array.from({length:32},(_,i)=>`IMM[${i}] FLT32 {0.25,0.5,0.75,1}`).join('\n')+'\n0:');
    add('legacy-imm-'+stage,stage,immediate,true,'legacy-imm');
    add('text-limit-'+stage,stage,small+'\n'.repeat(49152-small.length),true,'text');
    add('text-one-past-'+stage,stage,small+'\n'.repeat(49153-small.length),false,'text',['input-too-large']);
    add('instruction-one-past-'+stage,stage,longSource(stage,{count:769}),false,'instructions');
    add('temp-one-past-'+stage,stage,small.replace('TEMP[0..511]','TEMP[0..512]'),false,'temp',['unsupported-feature']);
    add('temp-source-one-past-'+stage,stage,small.replace('TEMP[510]','TEMP[512]'),false,'temp',['unsupported-feature']);
    add('imm-one-past-'+stage,stage,compactSource(stage,{immediates:33}),false,'imm',['unsupported-feature']);
    add('imm-gap-'+stage,stage,small.replace('IMM[30]','IMM[29]'),false,'imm');
    add('imm-source-one-past-'+stage,stage,small.replace('IMM[31].yyyy','IMM[32].yyyy'),false,'imm',['unsupported-feature']);
    add('depth-one-past-'+stage,stage,compactSource(stage,{depth:17}),false,'depth',['unsupported-feature']);
    add('join-initialization-'+stage,stage,compactSource(stage,{depth:16,missingJoin:true}),false,'join',['unsupported-feature','parse-error']);
    add('line-limit-'+stage,stage,small.replace('0: AND',' '.repeat(512-'0: AND TEMP[509].x, IN['.length)+'0: AND'),false,'line');
    add('missing-end-'+stage,stage,small.replace(/\d+: END\n$/,''),false,'syntax');
    add('after-end-'+stage,stage,small+'DCL TEMP[0]\n',false,'syntax');
    add('wrong-target-'+stage,stage,compactSource(stage,{depth:16,targets:true}).replace(/ :\d+\n/,' :767\n'),false,'targets');
    add('target-one-past-'+stage,stage,deep.replace('UIF IMM[31].zzzz','UIF IMM[31].zzzz :768'),false,'targets',['unsupported-feature']);
    for(const spelling of ['0511','512','4294967295','-1','+511','0x1ff'])
      add('noncanonical-temp-'+spelling+'-'+stage,stage,small.replace('TEMP[0..511]',`TEMP[0..${spelling}]`),false,'canonical');
    for(const spelling of ['0767','1000','-1'])
      add('noncanonical-label-'+spelling+'-'+stage,stage,small.replace('0: AND',spelling+': AND'),false,'canonical');
    for(const [file,index] of [['IN',8],['OUT',8],['SAMP',8],['SVIEW',8],['CONST',46]])
      add('interface-'+file+'-'+stage,stage,small.replace('DCL TEMP[0..511]',`DCL TEMP[0..511]\nDCL ${file}[${index}]`),false,'interface',['unsupported-feature']);
    add('late-undefined-'+stage,stage,small.replace('ADD TEMP[511]', 'ADD TEMP[511]')
      .replace(`ADD TEMP[510], IN[${stage==='vertex'?2:1}], IMM[0]`, 'ADD TEMP[510], TEMP[511], IMM[0]'),false,'initialization');
    // A valid large numerical program can exceed the independent emitted cap.
    const tail=out(stage),body=['AND TEMP[508].x, IMM[31], IMM[0]','ADD TEMP[511], IN[0], IMM[0]',...Array(768-tail.length-2).fill('MAD TEMP[511], TEMP[511], TEMP[511], TEMP[511]'),...tail];
    add('glsl-truncation-'+stage,stage,source(stage,body),false,'glsl',['translation-error']);
  }
  add('partner-vertex','vertex','VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[1]\nMOV OUT[2], IN[2]\nMOV OUT[3], IN[3]\nEND\n',true,'partner');
  add('partner-fragment','fragment','FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n',true,'partner');
  return cases;
}
export function getPairs(cases=getCases()){
  const index=name=>cases.findIndex(c=>c.name===name),v=index('partner-vertex'),f=index('partner-fragment');
  return cases.map((c,i)=>c.ok&&c.kind!=='partner'?{name:'pair-'+c.name,vertex:c.stage==='vertex'?i:v,fragment:c.stage==='fragment'?i:f,ok:true}:null).filter(Boolean)
    .concat([{name:'incompatible-high-originals',vertex:index('high-vertex'),fragment:index('high-fragment'),ok:false},
      {name:'pair-oversize-vertex',vertex:index('text-one-past-vertex'),fragment:f,ok:false},
      {name:'pair-oversize-fragment',vertex:v,fragment:index('text-one-past-fragment'),ok:false}]);
}
