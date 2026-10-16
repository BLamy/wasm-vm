import {captureFixtures,zeroSelectors,fragmentText,text,entry,layout} from './fixtures.mjs';
export function cases(){
 const rows=[],add=(name,patch={},okay=true,code=null)=>rows.push({name,kind:2,capture:0,words:layout([4,0,0,0],[entry(1,0,4,0,0)]),nullWords:false,selectors:zeroSelectors(),a:text(1),b:fragmentText,okay,code,...patch});
 for(const f of captureFixtures()){
  add('pair/'+f.name,{a:f.vertexText,b:f.fragmentText,words:f.words,capture:f.buffer});
  add('stage/'+f.name,{kind:0,a:f.vertexText,b:'',words:f.words,capture:f.buffer});
 }
 for(let capture=0;capture<4;capture++)for(const words of [[0],[]])for(const kind of [0,1,2])add(`empty/${capture}/${words.length}/${kind}`,{kind,capture,words,a:kind===1?fragmentText:text(1),b:kind===2?fragmentText:''});
 add('null-empty',{words:[],nullWords:true});add('null-with-word',{nullWords:true},false,'invalid-input');
 for(const capture of [4,5,0xffffffff])add('capture/'+capture,{capture},false,'invalid-input');
 add('fragment-with-outputs',{kind:1,a:fragmentText,b:''},false,'unsupported-feature');
 add('unknown-stage',{kind:8,a:text(1),b:''},false,'unsupported-stage');
 for(const words of [[0,0],[1],[1,4,0,0,0],[1,4,0,0,0,4<<10],[1,4,0,0,0,4<<10,0,0],[129]])add('length/'+words.join('/'),{words},false,words[0]===129?'limit-exceeded':'invalid-input');
 for(const stride of [0,3,65536,0xffffffff])add('stride/'+stride,{words:layout([stride,0,0,0],[entry(1,0,4,0,0)])},false,'invalid-input');
 for(const reg of [2,30,32,63,255])add('register/'+reg,{words:layout([4,0,0,0],[entry(reg,0,4,0,0)])},false,reg<32?'unsupported-feature':'invalid-input');
 for(const num of [0,5,6,7])add('count/'+num,{words:layout([8,0,0,0],[entry(1,0,num,0,0)])},false,'invalid-input');
 for(let start=1;start<4;start++)add('range/'+start,{words:layout([8,0,0,0],[entry(1,start,5-start,0,0)])},false,'invalid-input');
 for(const buffer of [4,5,6,7])add('buffer/'+buffer,{words:layout([8,8,8,8],[entry(1,0,4,buffer,0)])},false,'invalid-input');
 for(const stream of [1,2,3,4,0xffffffff])add('stream/'+stream,{words:layout([4,0,0,0],[entry(1,0,4,0,0,stream)])},false,'unsupported-feature');
 for(const offset of [1,3,4,65535])add('destination/'+offset,{words:layout([4,0,0,0],[entry(1,0,4,0,offset)])},false,'invalid-input');
 for(const offset of [0,1,2,3])add('overlap/'+offset,{words:layout([8,0,0,0],[entry(1,0,4,0,0),entry(1,0,4,0,offset)])},false,'invalid-input');
 add('abutting',{words:layout([8,0,0,0],[entry(1,0,4,0,0),entry(1,0,4,0,4)])});
 add('components65',{words:layout([65,0,0,0],[...Array.from({length:16},(_,i)=>entry(1,0,4,0,i*4)),entry(1,0,1,0,64)])},false,'limit-exceeded');
 for(const stage of [0,1]){
  const a=stage?fragmentText:text(1),words=stage?[0]:layout([4,0,0,0],[entry(1,0,4,0,0)]);
  for(const bad of ['',a+'\0','not TGSI\n','VERT\nDCL OUT[0], POSITION\n0: END\n garbage'])add('text/'+stage+'/'+rows.length,{kind:stage,a:bad,b:'',words},false,bad.includes('\0')?'invalid-input':(bad.startsWith('not')||stage===1&&bad.startsWith('VERT'))?'unsupported-stage':'unsupported-feature');
 }
 return rows;
}
