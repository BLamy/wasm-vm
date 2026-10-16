// Literal input geometry and shader programs. No hardware observation supplies predictions.
export const SEEDS=[0x9e3779b9,0x243f6a88,0x85a308d3];
export const HEADER=['FRAG','PROPERTY FS_COORD_ORIGIN LOWER_LEFT','PROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER','DCL IN[0], POSITION, LINEAR'];
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[1]\nEND\n';
export const PARTNER_FRAGMENT='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,1,1,1}\nMOV OUT[0], IMM[0]\nEND\n';
const imm=(i,words)=>`IMM[${i}] UINT32 {${words.join(',')}}`;
export const suffix=mask=>[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('');
export function bytesFragment(lane,variant='direct',swizzle='xyzw',mask=15,interpolation='PERSPECTIVE'){
 const body=variant==='alias'?['MOV TEMP[0], IN[0]',`MOV TEMP[0].${suffix(mask)}, TEMP[0].${swizzle}`]:
  variant==='saved'?['MOV TEMP[4], IN[0]',`MOV TEMP[0].${suffix(mask)}, TEMP[4].${swizzle}`,'MOV TEMP[4], IMM[0]']:
  variant==='numeric'?['ADD TEMP[0], IN[0], IN[1]']:
  variant==='multiply'?['MUL TEMP[0], IN[0], IMM[0]']:
  variant==='negation'?['ADD TEMP[0], -IN[0], IMM[0]']:
  variant==='raw'?['AND TEMP[0], IN[0], IMM[3]','OR TEMP[0], TEMP[0], IMM[4]']:
  variant==='join'?['UIF IN[1].xxxx','MOV TEMP[0], IN[0]','ELSE','ADD TEMP[0], IN[0], IMM[0]','ENDIF']:
  [`MOV TEMP[0].${suffix(mask)}, IN[0].${swizzle}`];
 return [...HEADER,`DCL IN[1], GENERIC[0], ${interpolation}`,'DCL OUT[0], COLOR','DCL TEMP[0..4]',
  imm(0,[0x3f800000,0x40000000,0x40400000,0x40800000]),imm(1,[0,8,16,24]),imm(2,Array(4).fill(255)),
  imm(3,Array(4).fill(0x7fffffff)),imm(4,Array(4).fill(0x3f000000)),
  'MOV TEMP[0], IMM[0]',...body,`USHR TEMP[1], TEMP[0].${'xyzw'[lane].repeat(4)}, IMM[1]`,
  'AND TEMP[1], TEMP[1], IMM[2]','I2F TEMP[2], TEMP[1]','I2F TEMP[3], IMM[2]',
  'DIV OUT[0], TEMP[2], TEMP[3]','END',''].join('\n');
}
export function geometries(seed=SEEDS[0]){
 const quad=(width,height,viewport,w,z,depthRange=[0,1])=>({width,height,viewport,depthRange,vertices:[[-w,-w,z*w,w],[w,-w,z*w,w],[-w,w,z*w,w],[-w,w,z*w,w],[w,-w,z*w,w],[w,w,z*w,w]],indices:[0,1,2,3,4,5],exactZW:true});
 return [
  {name:'full-odd',...quad(7,5,[0,0,7,5],1,0)},
  {name:'offset-even',...quad(12,10,[2,3,8,6],2,.25)},
  {name:'partial-odd',...quad(11,9,[1,2,5,3],4,-.5)},
  {name:'depth-offset',...quad(9,8,[3,1,4,6],2,0,[.25,.75])},
  {name:'varying-w-clipped-triangle',width:13,height:11,viewport:[2,1,9,7],depthRange:[0,1],vertices:[[-1,-1,-.5,1],[6,-2,0,2],[-4,12,2,4]],indices:[0,1,2],exactZW:false},
  {name:'seeded-offset-'+seed,...quad(13+(seed%3)*2,11+((seed>>>8)%3)*2,[1+(seed%3),2+((seed>>>4)%2),5+((seed>>>16)%3),3+((seed>>>20)%3)],2,.5)}];
}
export function physicalPlan(seed=SEEDS[0]){
 const probes=[];
 for(const geometry of geometries(seed))for(const variant of ['direct','alias','saved','numeric','multiply','negation','raw','join'])
  for(const lane of [0,1,2,3])for(const backend of ['owned','mesa']){
   if(variant==='raw'&&!geometry.exactZW)continue;
   const generic=variant==='join'?Array(4).fill(geometry.name.includes('odd')?0:1):[.25,.5,.75,1];
   probes.push({geometry,variant,lane,swizzle:variant==='alias'?'wzyx':'xyzw',mask:15,interpolation:variant==='saved'?'CONSTANT':'PERSPECTIVE',generic,backend,
    text:bytesFragment(lane,variant,variant==='alias'?'wzyx':'xyzw',15,variant==='saved'?'CONSTANT':'PERSPECTIVE')});
  }
 // Mask and swizzle behavior is independently predicted per source/destination lane.
 for(let mask=1;mask<=15;mask++)for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])for(let lane=0;lane<4;lane++)for(const backend of ['owned','mesa'])
  probes.push({geometry:geometries(seed)[1],variant:'direct',lane,swizzle,mask,interpolation:'PERSPECTIVE',generic:[.25,.5,.75,1],backend,text:bytesFragment(lane,'direct',swizzle,mask)});
 return probes;
}
export function getCases(){
 const cases=[],add=(name,text,ok=true,primary=ok,fields={})=>cases.push({name,stage:'fragment',text,ok,primary,partner:PARTNER_VERTEX,pairOk:ok,...fields});
 add('direct-original-position',[...HEADER,'DCL OUT[0], COLOR','MOV OUT[0], IN[0]','END',''].join('\n'));
 add('reordered-properties',cases[0].text.replace(HEADER[1]+'\n'+HEADER[2],HEADER[2]+'\n'+HEADER[1]));
 add('color-property',cases[0].text.replace('DCL OUT[0]', 'PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nDCL OUT[0]'));
 for(const variant of ['direct','alias','saved','numeric','multiply','negation','raw','join'])for(let lane=0;lane<4;lane++)add(`${variant}-bytes-${lane}`,bytesFragment(lane,variant,variant==='alias'?'wzyx':'xyzw'));
 for(let mask=1;mask<=15;mask++)for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])for(let lane=0;lane<4;lane++)add(`mask-${mask}-${swizzle}-bytes-${lane}`,bytesFragment(lane,'direct',swizzle,mask));
 add('flat-neighbor',bytesFragment(0,'numeric','xyzw',15,'CONSTANT'));
 for(let lane=0;lane<4;lane++)add('saved-flat-bytes-'+lane,bytesFragment(lane,'saved','xyzw',15,'CONSTANT'));
 const base=cases[0].text;
 for(const [name,change]of [
  ['missing-origin',t=>t.replace(HEADER[1]+'\n','')],['missing-center',t=>t.replace(HEADER[2]+'\n','')],['missing-properties',t=>t.replace(HEADER[1]+'\n','').replace(HEADER[2]+'\n','')],
  ['upper-left',t=>t.replace('LOWER_LEFT','UPPER_LEFT')],['integer-center',t=>t.replace('HALF_INTEGER','INTEGER')],['numeric-origin',t=>t.replace('LOWER_LEFT','1')],['numeric-center',t=>t.replace('HALF_INTEGER','0')],
  ['duplicate-origin',t=>t.replace(HEADER[1],HEADER[1]+'\n'+HEADER[1])],['duplicate-center',t=>t.replace(HEADER[2],HEADER[2]+'\n'+HEADER[2])],
  ['late-origin',t=>t.replace(HEADER[1]+'\n','').replace('END',HEADER[1]+'\nEND')],['late-center',t=>t.replace(HEADER[2]+'\n','').replace('END',HEADER[2]+'\nEND')],
  ['no-position',t=>t.replace('POSITION, LINEAR','GENERIC[0], PERSPECTIVE')],['position-index1',t=>t.replaceAll('IN[0]','IN[1]')],['position-index8',t=>t.replaceAll('IN[0]','IN[8]')],
  ['position-semantic-index',t=>t.replace('POSITION,','POSITION[0],')],['position-mask',t=>t.replace('DCL IN[0]','DCL IN[0].xy')],['perspective-position',t=>t.replace('LINEAR','PERSPECTIVE')],['constant-position',t=>t.replace('LINEAR','CONSTANT')],
  ['missing-interpolation',t=>t.replace(', LINEAR','')],['duplicate-position',t=>t.replace(HEADER[3],HEADER[3]+'\n'+HEADER[3])],['range-position',t=>t.replace('DCL IN[0]','DCL IN[0..1]')],
  ['unproven-F2I',t=>t.replace('MOV OUT[0], IN[0]','DCL TEMP[0]\nF2I TEMP[0], IN[0]\nI2F OUT[0], TEMP[0]')],
  ...['EX2','LG2','SIN','POW','UARL'].map(op=>['unproven-'+op,t=>t.replace('MOV OUT[0], IN[0]',`DCL TEMP[0]\n${op} TEMP[0], IN[0]${op==='POW'?', IN[0]':''}\nMOV OUT[0], IN[0]`)]),
  ['kill',t=>t.replace('END','KILL_PRECISE\nEND')],['kill-if',t=>t.replace('END','KILL_IF_PRECISE IN[0]\nEND')]
 ])add(name,change(base),false,false);
 add('vertex-stage-properties',base.replace('FRAG','VERT'),false,false,{stage:'vertex',partner:PARTNER_FRAGMENT});
 add('missing-generic-producer',bytesFragment(0,'numeric'),true,true,{partner:PARTNER_VERTEX.replace('DCL OUT[1], GENERIC[0]\n','').replace('MOV OUT[1], IN[1]\n',''),pairOk:false});
 return cases;
}
