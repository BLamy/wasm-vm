// Original sampler views, actual Wasm VirtIO queues, guarded guest RAM and Metal.
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {cases,fixture,keys,metadata,view,setup,draw,expected,localExtent,packet,join,shader,pixelBytes,comparison} from '../../../tools/virgl-dimensional-shadow-samplers/fixtures.mjs';
import {wire} from '../../../tools/virgl-dimensional-depth/fixtures.mjs';
const OK=0x1100,BAD=0x1205;
const hex=bytes=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=value=>JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString(16):v));
const put=(bytes,at,value)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(at,value,true);
function createResource(m){const raw=header(0x204,0,72);keys.forEach((key,i)=>put(raw,24+i*4,m[key]));return raw;}
function sourceTransfer(f,level,direction=1){
  const p=f.levels[level],stride=p.width*pixelBytes(f.format)+7,layerStride=stride*p.height+11;
  const raw=transfer(1,6,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride,0xffffffffffffffffn);put(raw,60,level);return raw;
}
function captureGL(native,c,row,control){
  const handles=new WeakMap(),methods=new Map(),textures=[],calls=[],drawStates=[],faults=[],names=new Map();let next=1;
  const encode=v=>{
    if(ArrayBuffer.isView(v))return {type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(Array.isArray(v))return v.map(encode);
    if(v&&typeof v==='object'){if(!handles.has(v))handles.set(v,next++);return {handle:handles.get(v),type:v.constructor.name};}
    return v===undefined?{undefined:true}:v;
  };
  const snapshot=()=>{
    const program=native.getParameter(native.CURRENT_PROGRAM),active=native.getParameter(native.ACTIVE_TEXTURE),uniforms=[],samplers=[];
    const dimensions=new Map([[native.SAMPLER_3D,[native.TEXTURE_3D,native.TEXTURE_BINDING_3D,3]],
      [native.SAMPLER_CUBE,[native.TEXTURE_CUBE_MAP,native.TEXTURE_BINDING_CUBE_MAP,4]],
      [native.SAMPLER_CUBE_SHADOW,[native.TEXTURE_CUBE_MAP,native.TEXTURE_BINDING_CUBE_MAP,4]],
      [native.SAMPLER_2D_ARRAY,[native.TEXTURE_2D_ARRAY,native.TEXTURE_BINDING_2D_ARRAY,7]],
      [native.SAMPLER_2D_ARRAY_SHADOW,[native.TEXTURE_2D_ARRAY,native.TEXTURE_BINDING_2D_ARRAY,7]],
      [native.SAMPLER_2D,[native.TEXTURE_2D,native.TEXTURE_BINDING_2D,2]],
      [native.SAMPLER_2D_SHADOW,[native.TEXTURE_2D,native.TEXTURE_BINDING_2D,2]]]);
    for(let i=0;i<native.getProgramParameter(program,native.ACTIVE_UNIFORMS);i++){
      const info=native.getActiveUniform(program,i),location=native.getUniformLocation(program,info.name),value=location===null?null:native.getUniform(program,location);
      uniforms.push({...info,name:info.name,size:info.size,type:info.type,value:encode(value)});
      const d=dimensions.get(info.type);if(!d)continue;
      native.activeTexture(native.TEXTURE0+value);const texture=native.getParameter(d[1]),sampler=native.getParameter(native.SAMPLER_BINDING);
      samplers.push({name:info.name,type:info.type,unit:value,originalTarget:d[2],texture:encode(texture),sampler:encode(sampler),
        base:native.getTexParameter(d[0],native.TEXTURE_BASE_LEVEL),last:native.getTexParameter(d[0],native.TEXTURE_MAX_LEVEL),
        parameters:Object.fromEntries(['TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','TEXTURE_WRAP_R','TEXTURE_MIN_LOD','TEXTURE_MAX_LOD','TEXTURE_COMPARE_MODE','TEXTURE_COMPARE_FUNC'].map(key=>[key,native.getSamplerParameter(sampler,native[key])]))});
    }
    native.activeTexture(active);return {program:encode(program),uniforms,samplers};
  };
  const gl=new Proxy(native,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;
    if(!methods.has(name))methods.set(name,(...args)=>{
      const delivered=args.slice(),event={sequence:calls.length,name,arguments:args.map(encode)};calls.push(event);
      const reflection=control.reflectionKind;
      if(reflection){
        const named=(['getUniformLocation','getUniformIndices'].includes(name)&&String(args[1]).includes('shadmask'))||
          (name==='getActiveUniforms'&&/shadmask/.test(native.getActiveUniform(args[0],args[1][0])?.name??''))||
          (name==='getUniform'&&/shadmask/.test(names.get(args[1])??''));
        const component=name==='getParameter'&&args[0]===(control.stage==='vertex'?native.MAX_VERTEX_UNIFORM_COMPONENTS:native.MAX_FRAGMENT_UNIFORM_COMPONENTS);
        if(named||component){
          const actual=method.apply(target,args);let answer=actual;
          if(name==='getUniformLocation'&&reflection==='location')answer=null;
          if(name==='getUniformIndices'&&reflection==='index')answer=[native.INVALID_INDEX];
          if(name==='getUniformIndices'&&reflection==='undefined-index')answer=[];
          if(name==='getActiveUniforms'&&args[2]===native.UNIFORM_TYPE&&reflection==='type')answer=[native.UNSIGNED_INT_VEC4];
          if(name==='getActiveUniforms'&&args[2]===native.UNIFORM_SIZE&&reflection==='size')answer=[2];
          if(name==='getUniform'&&reflection==='default')answer=new Float32Array([1,0,0,0]);
          if(name==='getUniform'&&reflection==='shape')answer=[0,0,0,0];
          if(component&&reflection==='budget')answer=7;
          if(answer!==actual){event.actual=encode(actual);event.result=encode(answer);control.hits++;return answer;}
        }
      }
      if(control.armed&&control.sabotage==='mask'&&name==='uniform4fv'&&/shadmask/.test(names.get(args[0])??'')){
        delivered[1]=new Float32Array(args[1]);delivered[1][0]=0;
        faults.push({sequence:event.sequence,kind:'physical-owned-comparison-mask',uniform:names.get(args[0]),original:encode(args[1]),delivered:encode(delivered[1])});
      }
      if(control.armed&&control.sabotage==='compare'&&/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(name)){
        const program=native.getParameter(native.CURRENT_PROGRAM),active=native.getParameter(native.ACTIVE_TEXTURE);
        for(let i=0;i<native.getProgramParameter(program,native.ACTIVE_UNIFORMS);i++){
          const info=native.getActiveUniform(program,i);if(![native.SAMPLER_CUBE_SHADOW,native.SAMPLER_2D_ARRAY_SHADOW].includes(info.type))continue;
          const unit=native.getUniform(program,native.getUniformLocation(program,info.name));native.activeTexture(native.TEXTURE0+unit);
          const sampler=native.getParameter(native.SAMPLER_BINDING),original=native.getSamplerParameter(sampler,native.TEXTURE_COMPARE_FUNC);
          native.samplerParameteri(sampler,native.TEXTURE_COMPARE_FUNC,native.NEVER);
          faults.push({sequence:event.sequence,kind:'physical-native-comparison-function',name:info.name,sampler:encode(sampler),original,delivered:native.getSamplerParameter(sampler,native.TEXTURE_COMPARE_FUNC)});
        }
        native.activeTexture(active);
      }
      if(control.reflection&&name==='getActiveUniforms'&&args[2]===native.UNIFORM_TYPE){
        const actual=method.apply(target,args);if([...actual].some(v=>[native.SAMPLER_3D,native.SAMPLER_CUBE,native.SAMPLER_2D_ARRAY,native.SAMPLER_CUBE_SHADOW,native.SAMPLER_2D_ARRAY_SHADOW].includes(v))){
          event.actual=encode(actual);event.result=encode([native.SAMPLER_2D]);control.hits++;return [native.SAMPLER_2D];
        }event.result=encode(actual);return actual;
      }
      if(control.nullTexture&&name==='createTexture'){control.nullTexture=false;event.fault='allocation-null';event.result=null;return null;}
      if(control.nullFramebuffer&&name==='createFramebuffer'){control.nullFramebuffer=false;event.fault='allocation-null';event.result=null;return null;}
      if(/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(name)){const state=snapshot();drawStates.push({sequence:event.sequence,state});}
      const value=method.apply(target,delivered);event.delivered=delivered.map(encode);event.result=encode(value);
      if(name==='createTexture'&&value)textures.push(value);
      if(name==='getUniformLocation'&&value)names.set(value,args[1]);
      if(['getBufferSubData','readPixels'].includes(name))event.after=args.map(encode);
      return value;
    });return methods.get(name);
  }});
  return {gl,calls,drawStates,faults,textures,encode};
}
function guestBacking(rig,id,index,c){
  const q=rig.q,length=4096,cuts=[7,17,53,101,3918],entries=cuts.map((n,i)=>[q.base+0x210000n+BigInt(index*0x10000+i*0x2000),n]);
  entries.forEach(([address,n])=>q.write(address-8n,new Uint8Array(n+16).fill(0xa3)));
  const write=bytes=>{c.equal(bytes.length,length,'complete original guarded SG backing');let at=0;for(const[address,n]of entries){q.write(address,bytes.subarray(at,at+n));at+=n;}};
  const read=()=>{const bytes=new Uint8Array(length);let at=0;for(const[address,n]of entries){bytes.set(q.read(address,n),at);at+=n;}return bytes;};
  const guards=()=>entries.map(([address,n])=>{const before=hex(q.read(address-8n,8)),after=hex(q.read(address+BigInt(n),8));c.equal(before,'a3'.repeat(8),'original SG prefix');c.equal(after,'a3'.repeat(8),'original SG suffix');return {address:address.toString(16),length:n,before,after};});
  return {write,read,guards,attach:backing(id,entries),entries};
}
async function initialize(rig,f,c,row){
  await rig.expect('original dimensional view context',context(1));
  const owners=[f.source,...(f.extraTextures??[]).map(v=>v.source),metadata(8,0,64,524288,4096,1),metadata(1,2,196,2,f.grid.width,f.grid.height),...f.inputs.map((bytes,i)=>metadata([3,4,5,7][i],0,64,0,bytes.length,1))],memory=new Map();
  for(const [index,m]of owners.entries()){
    await rig.expect('original create resource '+m.id,createResource(m));const ram=guestBacking(rig,m.id,index,c);memory.set(m.id,ram);
    await rig.expect('original backing '+m.id,ram.attach);await rig.expect('original membership '+m.id,idCommand(0x202,1,m.id));
  }
  row.sourcePlanes=[];
  for(const selected of [f,...(f.extraTextures??[])])for(const p of selected.levels){
    const source=memory.get(selected.source.id);
    const stride=p.width*pixelBytes(selected.format)+7,layerStride=stride*p.height+11,bytes=new Uint8Array(4096).fill(0x8d);
    for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)bytes.set(p.bytes.subarray((z*p.height+y)*p.width*pixelBytes(selected.format),(z*p.height+y+1)*p.width*pixelBytes(selected.format)),5+z*layerStride+y*stride);
    const box={x:0,y:0,z:0,width:p.width,height:p.height,depth:p.layers},producer=['outer205','inline9','staging45'][p.level%3];
    let request;
    if(producer==='outer205'){request=sourceTransfer(selected,p.level);put(request,56,selected.source.id);}
    else if(producer==='inline9'){
      const footprint=(p.layers-1)*layerStride+(p.height-1)*stride+p.width*pixelBytes(selected.format);
      request=submission(1,wire(selected.source.id,p.level,box,{opcode:9,stride,layerStride,data:bytes.subarray(5,5+footprint)}));
    }else{memory.get(8).write(bytes);request=submission(1,wire(selected.source.id,p.level,box,{opcode:45,stride,layerStride,offset:5,stagingId:8,flags:1}));}
    source.write(bytes);const at=rig.exchanges.length,record=await rig.expect('original '+producer+' full dimensional mip '+p.level,request);
    if(producer==='inline9')c.equal(rig.exchanges.length,at,'original inline fields need no guest gather');
    else c.equal(rig.exchanges[at].bytes,hex(p.bytes),'every original dimensional upload byte');source.guards();memory.get(8).guards();
    row.sourcePlanes.push({resource:selected.source.id,producer,level:p.level,width:p.width,height:p.height,layers:p.layers,input:hex(p.bytes),backing:hex(bytes),record});
  }
  for(const [i,bytes]of f.inputs.entries()){
    const id=[3,4,5,7][i],ram=memory.get(id),body=new Uint8Array(4096).fill(0x9b);body.set(bytes,5);ram.write(body);
    await rig.expect('original coordinate/position/derivative words '+id,transfer(1,id,1,[0,0,0,bytes.length,1,1],5n));ram.guards();
  }
  row.setup=await rig.expect('original dimensional shader and output setup',submission(1,setup(f)),f.reflection&&f.reflection!=='pruned'?BAD:OK);
  row.sourceNativeTexture=rig.capture.textures[0];return memory;
}
async function originalPlane(rig,f,c,row,memory,label,wanted=expected(f)){
  const q=rig.q,entry=q.enqueue(label,submission(1,draw(f),0xffffffffffffffffn));q.kick();q.run();
  c.equal(q.usedIndex(),entry.number,'draw admission withholds original used publication');const before=copy(q.vm.submitState());
  await rig.drain();const record=q.collect(entry);q.vm.writeMmio(0x64,1);
  c.equal(rig.trace.syncs.size,0,'original draw completes only after every physical fence retires');
  const ram=memory.get(1),poisoned=new Uint8Array(4096).fill(0xc7),stride=f.grid.width*16+3;ram.write(poisoned);
  const at=rig.exchanges.length,read=await rig.expect(label+'/actual-original-output206',transfer(1,1,2,[0,0,0,f.grid.width,f.grid.height,1],5n,stride,0,0xffffffffffffffffn));
  const observed=new Uint8Array(wanted.length),whole=ram.read(),predicted=poisoned.slice();
  for(let y=0;y<f.grid.height;y++){
    observed.set(whole.subarray(5+y*stride,5+y*stride+f.grid.width*16),y*f.grid.width*16);
    predicted.set(wanted.subarray(y*f.grid.width*16,(y+1)*f.grid.width*16),5+y*stride);
  }
  const plane={label,record,read,before,expected:hex(wanted),observed:hex(observed),wholeBacking:hex(whole),predictedBacking:hex(predicted),exchanges:copy(rig.exchanges.slice(at)),guards:ram.guards(),native:rig.capture.drawStates.at(-1)};
  row.planes.push(plane);
  const a=new DataView(observed.buffer),b=new DataView(wanted.buffer),oracle=[];
  for(let at=0;at<wanted.length;at+=4){
    const lane=at/4%4;
    if((f.ordinary&&f.opcode!=='TXQ'&&(!f.mask||f.mask.includes('xyzw'[lane]))&&f.swizzle[lane]===0||f.sameImage&&lane===1)&&[16,20,21].includes(f.format)){
      const actual=a.getUint32(at,true),expected=b.getUint32(at,true),error=Math.abs(actual-expected);
      c.truth(actual<=0x3f800000&&expected<=0x3f800000&&error<=1,'qualified normalized depth sample within one ULP');
      oracle.push({word:at/4,kind:'normalized-depth-one-ulp',expected,actual,error,budget:1});
    }else{c.equal(a.getUint32(at,true),b.getUint32(at,true),'complete exact original dimensional word '+f.name+' '+at/4);oracle.push({word:at/4,kind:'exact-u32',expected:b.getUint32(at,true)});}
  }
  plane.oracle={words:oracle};
  const imageBytes=new Set();for(let y=0;y<f.grid.height;y++)for(let x=0;x<f.grid.width*16;x++)imageBytes.add(5+y*stride+x);
  for(let at=0;at<whole.length;at++)if(!imageBytes.has(at))c.equal(whole[at],0xc7,'complete dimensional output SG padding '+at);
  const reflected=plane.native.state.samplers;
  for(const sampler of reflected){
    const vertex=sampler.name.startsWith('vs'),slot=Number(sampler.name.replace(/^(?:vs|fs)samp/,''));
    c.equal(sampler.unit,(vertex?16:0)+slot,'same original slot owns separate native stage unit');
    const wanted=f.expectedSamplers?.[sampler.name]??{target:f.source.target,last:f.lastLevel-f.firstLevel};
    c.equal(sampler.originalTarget,wanted.target,'actual reflected native sampler dimension');
    c.equal(sampler.base,0,'owned relative mip base');c.equal(sampler.last,wanted.last,'owned relative last mip');
    c.equal(sampler.parameters.TEXTURE_COMPARE_MODE,(wanted.comparison??comparison(f))?rig.capture.gl.COMPARE_REF_TO_TEXTURE:0,'original comparison mode owns the native sampler');
    c.equal(sampler.parameters.TEXTURE_COMPARE_FUNC,512+(wanted.compareFunction??f.compareFunction),'original comparison function owns the native sampler');
    for(const uniform of plane.native.state.uniforms.filter(u=>u.name===(vertex?'vs':'fs')+'shadmask'+slot||u.name===(vertex?'vs':'fs')+'shadadd'+slot)){
      const swizzle=wanted.swizzle??f.swizzle,values=swizzle.map(k=>uniform.name.includes('shadmask')?Number(k<4):Number(k===5));
      c.equal(uniform.value.bytes,hex(new Uint8Array(new Float32Array(values).buffer)),'original view owns every reflected mask/add component');
    }
  }
  if(f.sameImage||f.crossStage){c.equal(reflected.length,2,'both original bindings reach hardware');c.same(reflected[0].texture,reflected[1].texture,'one retained native image serves both bindings');c.truth(reflected[0].sampler.handle!==reflected[1].sampler.handle,'distinct original native sampler states');}
  if(f.pruned)c.equal(reflected.length,0,'only actual pruned declarations omit native samplers and controls');
  return plane;
}
const selected=Wasm=>class{constructor(callback){return Wasm.standardDimensionalDepth(callback);}};
async function runCase(Wasm,factory,native,bridge,c,spec,seed,report,options){
  const f=fixture({...spec,seed}),row={name:f.name,seed,fixture:copy({...f,levels:f.levels.map(p=>({...p,bytes:hex(p.bytes)})),inputs:f.inputs.map(hex)}),compiler:[],planes:[]};report.runs.push(row);
  const controls={armed:false,reflection:false,reflectionKind:f.reflection==='pruned'?null:f.reflection,stage:f.stage,nullTexture:false,nullFramebuffer:false,hits:0,sabotage:options.sabotage},capture=captureGL(native,c,row,controls),compiler=new Proxy({...bridge},{get(target,key){const method=Reflect.get(target,key,target);if(typeof method!=='function')return method;return request=>{
    const original=method.call(target,request),result=f.reflection==='omitted'?copy(original):original;
    if(f.reflection==='omitted'&&result.ok){if(result.metadata)result.metadata.shadowUniforms=[];if(result.vertex){result.vertex.metadata.shadowUniforms=[];result.fragment.metadata.shadowUniforms=[];}}
    row.compiler.push({method:key,request:copy(request),result:copy(result),...(f.reflection==='omitted'?{original:copy(original),metadataFault:'omitted-active-controls'}:{})});return result;
  };}});
  const nativePixelBytes=f.format===16?2:f.format===126?16:4;
  const sourceCost=f.levels.reduce((n,p)=>n+p.width*p.height*p.layers*nativePixelBytes,0);let baseCost=sourceCost+f.grid.width*f.grid.height*16+f.inputs.reduce((n,b)=>n+b.length,0);
  const privateCost=f.firstLevel===0&&f.lastLevel===2&&f.firstLayer===0&&f.lastLayer===f.source.arraySize-1?0:Array.from({length:f.lastLevel-f.firstLevel+1},(_,level)=>localExtent(f,level)).reduce((n,p)=>n+p.width*p.height*p.layers*nativePixelBytes,0),budget=baseCost+privateCost-1;
  const rig=makeRig(selected(Wasm),f.attack==='budget'?input=>factory({...input,resourceLimits:{gpuBytes:budget}}):factory,capture.gl,compiler,c,seed,true,false,true);rig.capture=capture;let memory;
  window.__desktopActive=()=>({records:rig.q.records,events:rig.events,native:copy(rig.q.vm.inspect()),submit:copy(rig.q.vm.submitState()),host:copy(rig.host.bridge.inspect())});
  try{
    memory=await initialize(rig,f,c,row);
    if(f.reflection&&f.reflection!=='pruned'){
      c.equal(capture.drawStates.length,0,'invalid actual native controls refuse before every hardware draw');c.truth(controls.hits>0||f.reflection==='omitted','native reflection or actual compiler-metadata fault exercised');row.status='passed';return;
    }
    row.costPrediction={sourceCost,baseCost,privateCost,nativePixelBytes};c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,baseCost,'literal native source, output and buffer allocation costs');
    const refuse=async(label,commands,code=BAD)=>{
      const before=capture.drawStates.length;const result=await rig.expect(label,submission(1,commands),code);
      c.equal(capture.drawStates.length,before,'invalid dimensional state refuses before every native draw');
      (row.refusals??=[]).push({label,result,host:copy(rig.host.bridge.inspect())});return result;
    };
    if(f.attack==='target')await refuse('original target/storage mismatch',view(f,{target:3,firstLayer:0,lastLayer:0}));
    if(f.attack==='feedback')await refuse('original dimensional sampler cannot alias bound output storage',view(f,{resource:1}));
    if(f.attack==='levels')await refuse('original range exceeds actual allocation',view(f,{last:3}));
    if(f.attack==='layers')await refuse('original array layers exceed actual allocation',view(f,{lastLayer:f.arraySize}));
    if(f.attack==='cube-range')await refuse('original incomplete cube faces',view(f,{lastLayer:4}));
    if(f.attack==='format')await refuse('original dimensional non-RGBA8 format',view(f,{format:196}));
    if(f.attack==='role'){
      await rig.expect('depth-render-only dimensional allocation',createResource({...f.source,id:9,bind:1}));
      await rig.expect('render-only dimensional membership',idCommand(0x202,1,9));
      await refuse('original view without sampler allocation role',view(f,{resource:9}));
      await rig.expect('retire depth-render-only original name',idCommand(0x102,0,9));
    }
    if(f.attack==='twoD-depth-surface'){
      const meta=metadata(9,2,f.format,1,f.grid.width,f.grid.height);row.twoDDepthControl={metadata:meta};
      await rig.expect('unchanged original2D depth allocation',createResource(meta));await rig.expect('original2D depth membership',idCommand(0x202,1,9));
      await rig.expect('original2D depth surface and framebuffer',submission(1,join(packet(1,8,[21,9,f.format,0,0]),packet(5,0,[1,21,20]))));
      const cost=f.grid.width*f.grid.height*nativePixelBytes;baseCost+=cost;row.costPrediction.baseCost=baseCost;row.costPrediction.twoDDepthSurfaceCost=cost;
    }
    if(f.attack==='allocation'){
      const before=rig.host.bridge.inspect().store.budgets;
      controls.nullTexture=true;await refuse('actual private texture allocation failure',view(f,{handle:55,stateHandle:54}),0x1201);
      c.same(rig.host.bridge.inspect().store.budgets,before,'failed private texture leaves original budgets exact');
    }
    if(f.attack==='budget'){
      await refuse('private range exhausts explicit native byte budget',view(f),0x1201);row.status='passed';return;
    }
    for(const object of rig.host.bridge.inspect().renderer.contexts[0].subContexts[0].objects)if(object.type===7&&[50,54].includes(object.handle))await rig.expect('retire original partially applied sampler creation',submission(1,packet(3,7,[object.handle])));
    row.beforeView=copy(rig.host.bridge.inspect());row.view=await rig.expect('original dimensional sampler view',submission(1,view(f)));
    row.afterView=copy(rig.host.bridge.inspect());c.equal(row.afterView.store.budgets.gpuBytes,baseCost+privateCost,'literal native private view cost, including owned126 upload PBO');
    for(const extra of f.extraViews??[])await rig.expect('independent original stage/range binding',submission(1,view(extra.fixture,extra)));
    if(['mode','ordinary-mode','query-mode'].includes(f.attack)){
      await rig.expect('original contradictory comparison mode',submission(1,view(f,{handle:55,stateHandle:54,mode:comparison(f)?0:1})));
      await refuse('original mode must agree with the actual native sampler type',draw(f));
      await rig.expect('restore original comparison mode and view',submission(1,join(packet(10,0,[f.stage==='vertex'?0:1,f.slot,51]),packet(18,0,[f.stage==='vertex'?0:1,f.slot,50]))));
    }
    if(f.attack==='missing-state'){
      await rig.expect('unbind original sampler state',submission(1,packet(18,0,[f.stage==='vertex'?0:1,f.slot,0])));
      await refuse('original comparison draw needs its owned sampler state',draw(f));
      await rig.expect('restore original sampler state',submission(1,packet(18,0,[f.stage==='vertex'?0:1,f.slot,50])));
    }
    if(f.attack==='reflection'){
      controls.reflection=true;await refuse('actual native sampler type contradicts checked metadata',join(packet(3,4,[11]),shader(11,1,f.fragmentText),packet(31,0,[11,1])));controls.reflection=false;
      await rig.expect('native dimensional reflection recovery',submission(1,packet(31,0,[11,1])));
      c.truth(controls.hits>0,'native dimensional reflection fault executed');
    }
    if(f.attack==='framebuffer'){
      controls.nullFramebuffer=true;await refuse('actual private copy framebuffer allocation failure',draw(f),0x1201);
    }
    if(f.attack==='type-SINT'||f.attack==='type-UINT'){
      const type=f.attack.slice(5),stage=f.stage==='vertex'?0:1,handle=stage===0?10:11,text=stage===0?f.vertexText:f.fragmentText;
      await refuse('original typed dimensional shader binding',join(packet(3,4,[handle]),shader(handle,stage,text.replace(', FLOAT',', '+type)),packet(31,0,[handle,stage])));
      const exists=rig.host.bridge.inspect().renderer.contexts[0].subContexts[0].objects.some(object=>object.type===4&&object.handle===handle&&object.public);
      // A refused create leaves the preceding DELETE applied; only a later
      // binding failure leaves a new public typed object to retire. A deleted
      // shader may still appear in inspect() while a binding retains it.
      await rig.expect('restore original float dimensional shader',submission(1,join(...(exists?[packet(3,4,[handle])]:[]),shader(handle,stage,text),packet(31,0,[handle,stage]))));
    }
    if(f.attack==='filter'){await refuse('incomplete ordinary depth filtering refuses before native draw',draw(f));row.status='passed';return;}
    await originalPlane(rig,f,c,row,memory,'original-dimensional-baseline',f.expectedPlane??expected(f));
    if(f.attack==='gpu-refresh'){
      const gpu=capture.gl,texture=capture.textures[0],fb=gpu.createFramebuffer(),previous=gpu.getParameter(gpu.DRAW_FRAMEBUFFER_BINDING),scissor=gpu.isEnabled(gpu.SCISSOR_TEST);
      c.truth(fb,'GPU-only original source writer');gpu.bindFramebuffer(gpu.DRAW_FRAMEBUFFER,fb);gpu.disable(gpu.SCISSOR_TEST);gpu.drawBuffers([gpu.NONE]);gpu.depthMask(true);gpu.stencilMask(255);
      f.gpuOverride={};row.gpuOnlyWrites=[];
      try{for(const p of f.levels)for(let layer=0;layer<p.layers;layer++){
        if(f.target==='CUBE')gpu.framebufferTexture2D(gpu.DRAW_FRAMEBUFFER,([20,126].includes(f.format)?gpu.DEPTH_STENCIL_ATTACHMENT:gpu.DEPTH_ATTACHMENT),gpu.TEXTURE_CUBE_MAP_POSITIVE_X+layer,texture,p.level);
        else gpu.framebufferTextureLayer(gpu.DRAW_FRAMEBUFFER,([20,126].includes(f.format)?gpu.DEPTH_STENCIL_ATTACHMENT:gpu.DEPTH_ATTACHMENT),texture,p.level,layer);
        c.equal(gpu.checkFramebufferStatus(gpu.DRAW_FRAMEBUFFER),gpu.FRAMEBUFFER_COMPLETE,'GPU-only original dimensional source plane');
        const z=[16,20,21].includes(f.format)?(p.level+layer)%2:((p.level+layer)%4)/4,value=[z,0,0,1];
        if([20,126].includes(f.format))gpu.clearBufferfi(gpu.DEPTH_STENCIL,0,z,(p.level*73+layer*29)&255);
        else gpu.clearBufferfv(gpu.DEPTH,0,new Float32Array([z]));
        f.gpuOverride[p.level+':'+layer]=value;row.gpuOnlyWrites.push({level:p.level,layer,value});
      }}finally{gpu.bindFramebuffer(gpu.DRAW_FRAMEBUFFER,previous);gpu.deleteFramebuffer(fb);if(scissor)gpu.enable(gpu.SCISSOR_TEST);}
      const ram=memory.get(6);ram.write(new Uint8Array(4096).fill(0xbd));const uploads=capture.calls.filter(v=>/^texSubImage/.test(v.name)).length;
      await originalPlane(rig,f,c,row,memory,'GPU-only-source-refresh');
      c.equal(capture.calls.filter(v=>/^texSubImage/.test(v.name)).length,uploads,'private refresh never uploads a CPU texture mirror');
      c.equal(hex(ram.read()),'bd'.repeat(4096),'GPU-only source never rewrites guest CPU backing');ram.guards();
    }
    if(options.fault){controls.armed=true;await originalPlane(rig,f,c,row,memory,'physically-corrupted-comparison');}
    if(options.boundaries){
      const beforePrograms=rig.host.bridge.inspect().renderer.work.programLinks;
      row.rebind=await rig.expect('same original range new owned objects',submission(1,view(f,{handle:53,stateHandle:52})));
      await originalPlane(rig,f,c,row,memory,'original-dimensional-rebound');
      c.equal(rig.host.bridge.inspect().renderer.work.programLinks,beforePrograms,'equivalent original range retains checked program cache');
      await rig.expect('destroy original bound view/sampler names',submission(1,join(packet(3,6,[53]),packet(3,7,[52]))));
      await rig.expect('destroyed sampler cannot draw',submission(1,draw(f)),BAD);
      await rig.expect('reuse original names new generations',submission(1,view(f,{handle:53,stateHandle:52})));
      await originalPlane(rig,f,c,row,memory,'original-new-generations');
      await rig.expect('same source new shader generation',submission(1,join(packet(3,4,[11]),shader(11,1,f.fragmentText),packet(31,0,[11,1]))));
      await originalPlane(rig,f,c,row,memory,'original-new-shader-generation');
      const retainedBefore=copy(rig.host.bridge.inspect());
      c.equal(retainedBefore.store.budgets.gpuBytes,baseCost+2*privateCost,'both live original view names own their private native ranges');
      await rig.expect('outer unref original public depth name',idCommand(0x102,0,6));
      row.retainedUnref={before:retainedBefore,after:copy(rig.host.bridge.inspect()),sourceTexture:capture.encode(row.sourceNativeTexture)};
      await originalPlane(rig,f,c,row,memory,'original-retained-after-unref');
      await rig.expect('reuse original depth resource ID with new storage',createResource(f.source));
      const replacementTexture=capture.textures.at(-1);c.truth(replacementTexture!==row.sourceNativeTexture,'same original resource ID owns a distinct native image');
      const replacement=guestBacking(rig,6,0,c);await rig.expect('replacement original backing',replacement.attach);await rig.expect('replacement original context membership',idCommand(0x202,1,6));
      row.replacementUploads=[];
      for(const p of f.levels){
        const bytes=new Uint8Array(4096).fill(0x6f),stride=p.width*pixelBytes(f.format)+7,layerStride=stride*p.height+11,zero=new Uint8Array(p.width*p.height*p.layers*pixelBytes(f.format));
        for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)bytes.fill(0,5+z*layerStride+y*stride,5+z*layerStride+y*stride+p.width*pixelBytes(f.format));
        replacement.write(bytes);const at=rig.exchanges.length,record=await rig.expect('original replacement depth-zero mip '+p.level,sourceTransfer(f,p.level));
        c.equal(rig.exchanges[at].bytes,hex(zero),'every replacement original depth byte is zero');replacement.guards();row.replacementUploads.push({level:p.level,input:hex(zero),record});
      }
      row.retainedUnref.replacementTexture=capture.encode(replacementTexture);row.retainedUnref.replacement=copy(rig.host.bridge.inspect());
      c.equal(row.retainedUnref.replacement.store.budgets.gpuBytes,baseCost+2*privateCost+sourceCost,'both retained old comparison views and the new public chain are charged');
      await originalPlane(rig,f,c,row,memory,'original-retained-after-resource-name-reuse');
      const q=rig.q,entry=q.enqueue('cancel actual pending dimensional draw',submission(1,draw(f)));q.kick();q.run();
      let turns=0;while(rig.trace.syncs.size===0){c.truth(++turns<50,'dimensional draw reaches actual fence');await rig.step();}
      c.equal(q.usedIndex(),entry.number,'pending dimensional draw has no used publication');q.reset();
      c.equal(rig.host.bridge.inspect().resources.length,0,'reset revokes all dimensional owners');c.equal(rig.trace.syncs.size,0,'reset retires pending dimensional native fences');
      row.cancelled={entry:copy(entry),host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect())};
    }
    row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
  finally{
    row.records=rig.q.records;row.events=rig.events;row.exchanges=rig.exchanges;row.completions=rig.completions;row.physical=rig.trace.events;row.nativeCalls=capture.calls;row.drawStates=capture.drawStates;row.faults=capture.faults;
    row.commandTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.hostBeforeDispose=copy(rig.host.bridge.inspect());row.nativeBeforeDispose=copy(rig.q.vm.inspect());
    delete row.sourceNativeTexture;window.__desktopActive=null;rig.dispose();row.cleaned=rig.trace.snapshot();
    if(window.__recordDimensionalViewRun){const index=report.runs.indexOf(row);report.runs[index]={name:row.name,seed:row.seed,...await window.__recordDimensionalViewRun(index,JSON.stringify(row))};}
  }
}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalShadowSubmitBridge,seeds=[27467,82021,164033],smoke=false,fault=false,boundaries=false,attacks=false,states=false,controls=false,bindings=false,inherited=false,sabotage='compare'}={}){
  const c=checker(),native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});c.truth(native,'actual WebGL2 dimensional view context');
  const info=native.getExtension('WEBGL_debug_renderer_info'),gpu=native.getParameter(info.UNMASKED_RENDERER_WEBGL);c.truth(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/.test(gpu),'actual M4 Max Metal dimensional views');
  const bridge=await createVirglStandardDimensionalShadowTextureShaderBridge(),report={schema:'original-dimensional-shadow-sampler-native-v1',status:'running',gpu,seeds,actualLinuxGuest:false,productionAuthority:false,runs:[]};window.__dimensionalShadowSamplerReport=report;
  let fixtures=cases({smoke});if(fault)fixtures=cases({smoke:true}).filter(f=>f.stage==='fragment'&&f.target==='CUBE'&&f.format===18).slice(0,1);
  if(states)fixtures=fixtures.filter(f=>f.endpoint||f.linear);
  if(boundaries)fixtures=cases({smoke:true}).filter(f=>f.bind!==8);
  if(attacks)fixtures=cases({smoke:true}).filter(f=>f.stage==='fragment'&&f.bind!==8).flatMap(f=>['target','feedback','levels','format','role','allocation','budget','reflection','framebuffer','type-SINT','type-UINT','gpu-refresh','twoD-depth-surface','mode','ordinary-mode','query-mode','missing-state','filter',...(f.target==='CUBE'?['cube-range']:['layers'])].map(attack=>({...f,attack,ordinary:attack==='ordinary-mode'||attack==='filter',opcode:attack==='query-mode'?'TXQ':'TEX',linear:attack==='filter',name:'attack/'+f.target+'/depth-'+f.format+'/'+attack})));
  if(controls)fixtures=cases({smoke:true}).filter(f=>f.format===18).flatMap(f=>['location','index','undefined-index','type','size','default','shape','budget','omitted','pruned'].map(reflection=>({...f,reflection,pruned:reflection==='pruned',name:'controls/'+f.stage+'/'+f.target+'/'+reflection})));
  if(bindings)fixtures=['vertex','fragment'].flatMap(stage=>['CUBE','2D_ARRAY'].flatMap(target=>[16,18,20,21,126].map(format=>({name:'same-image/'+stage+'/'+target+'/'+format,stage,target,format,opcode:'TEX',slot:7,swizzle:[0,4,5,3],sameImage:true})))).concat(['CUBE','2D_ARRAY'].flatMap(target=>[16,18,20,21,126].map(format=>({name:'cross-stage/'+target+'/'+format,stage:'fragment',target,format,opcode:'TEX',slot:7,swizzle:[0,4,5,3],crossStage:true}))));
  if(inherited)fixtures=['vertex','fragment'].flatMap(stage=>[false,true].map(ordinary=>({name:'inherited/'+stage+'/2D/'+ordinary,stage,target:'2D',format:18,arraySize:1,opcode:'TEX',slot:7,swizzle:[0,1,2,3],ordinary})));
  try{
    c.truth(fixtures.length>0,'selected original dimensional fixtures');
    for(const seed of fault?seeds.slice(0,1):seeds)for(const f of fixtures)await runCase(WasmVirglSubmitProof,createVirglStandardDimensionalShadowSubmitBridge,native,bridge,c,f,seed,report,{fault,boundaries,sabotage});

    c.equal(native.getError(),native.NO_ERROR,'zero final dimensional view native errors');report.status='passed';
    report.summary={status:'passed',gpu,runs:report.runs.length,schedules:seeds,assertions:c.assertions};return report;
  }finally{report.assertions=c.assertions;report.attacks=c.attacks;}
}
