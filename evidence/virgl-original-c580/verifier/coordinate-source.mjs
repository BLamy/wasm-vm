import { createVirglShaderBridge } from '../index.mjs';
import { createProgram, bindSystemBlocks, digest } from '../tests/browser.mjs';

const require = (value, reason) => { if (!value) throw new Error(reason); };
const float = word => new Float32Array(new Uint32Array([word]).buffer)[0];
const vertexId = '403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c';
const fragmentId = 'c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f';
const root = '/evidence/virgl-workload-inventory/captures/es2gears/shaders/';
const bankPath = '/target/evidence/virgl-original-c580/banks.bin';

// Handwritten equation for the surviving original pc98 -> pc163 -> pc165..193
// path. These literal coefficients are the captured TGSI IMM6..10 bit words;
// no generated GLSL, compiler metadata or GPU output contributes to the oracle.
const coefficients = {
  six: [1053486281,1046281129,1082291371,1055439406].map(float),
  seven: [1037578380,1031980538,1035420539,1067798374].map(float),
  eight: [1079226764,1051640170,1060377406].map(float),
  nine: [1047298914,1076299332,1071289118].map(float),
  ten: [1067605037,998866771].map(float),
};

function survivorColor(words) {
  const c = words.slice(12,16).map(float); // CONST[3]
  const {six,seven,eight,nine,ten} = coefficients;
  const sum = c[0] + c[1]*six[0] + c[2]*six[1];
  const alternate = c[0] - c[1]*(seven[0]+seven[2]) - c[2]*(seven[1]+seven[3]);
  const cube = sum*sum*sum, alternateCube = alternate*alternate*alternate;
  const linear = [
    cube*six[2] - alternateCube*eight[0] + alternateCube*nine[0],
    -cube*ten[0] + alternateCube*nine[1] - alternateCube*eight[1],
    -cube*ten[1] - alternateCube*eight[2] + alternateCube*nine[2],
  ];
  const opacity = c[3] * float(words[28*4]) * 1; // CONST[28].x and pc79 TEMP[17].x
  return linear.map(value => Math.pow(Math.max(value,0),six[3])*opacity).concat(opacity);
}

function expectedPixel(words, edge, x, y) {
  const width = float(words[0]), height = float(words[1]);
  const sx = (edge==='near'?0:width-4)+x+0.5;
  const sy = (edge==='near'?0:height-4)+y+0.5;
  const distance = Math.min(sx,width-sx,sy,height-sy);
  return distance <= 1 ? survivorColor(words) : [0,0,1,1];
}

function pairedBanks(binary) {
  const view = new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
  require(binary.length===8+3*148*4 && String.fromCharCode(...binary.subarray(0,4))==='VOB1' &&
    view.getUint32(4,true)===3,'three complete paired bank records');
  return Array.from({length:3},(_,bank) => {
    const at = 8+bank*148*4;
    const words = Array.from({length:148},(_,i)=>view.getUint32(at+4*i,true));
    return {vertex:words.slice(0,12),fragment:words.slice(12)};
  });
}

function geometry(bank,edge) {
  const width=float(bank.fragment[0]),height=float(bank.fragment[1]);
  const sx=float(bank.vertex[0]),sy=float(bank.vertex[5]);
  const ox=float(bank.vertex[8]),oy=float(bank.vertex[9]);
  const near=edge==='near';
  const out=[];
  for(const [x,y] of [[-1,-1],[3,-1],[-1,3]]) {
    out.push((x-ox)/sx,(y-oy)/sy,0,1,
      ((near?0:width-4)+(x+1)*2)/width,
      ((near?0:height-4)+(y+1)*2)/height,0,0);
  }
  return out;
}

export async function runAcceptance({fault=null}={}) {
  require(fault===null||fault==='discard'||fault==='output'||fault==='coordinate','known physical fault');
  const report={schema:'virgl-original-c580-physical-v1',status:'running',guestExecution:false,
    productionNegotiation:false,fault,frames:[],pairs:[],rejections:[],renderer:null};
  window.__originalC580Report=report;
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=4;
  const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,
    failIfMajorPerformanceCaveat:true});
  require(gl instanceof WebGL2RenderingContext,'physical WebGL2 context');
  require(gl.getExtension('EXT_color_buffer_float'),'float color attachment');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  require(debug,'renderer identity extension');
  report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer),'hardware renderer');
  const responses=await Promise.all([fetch(root+vertexId+'.tgsi'),fetch(root+fragmentId+'.tgsi'),fetch(bankPath)]);
  require(responses.every(response=>response.ok),'served exact originals and paired banks');
  const vertexText=await responses[0].text(),fragmentText=await responses[1].text();
  const bytes=new Uint8Array(await responses[2].arrayBuffer()),banks=pairedBanks(bytes);
  report.inputs={vertexSha256:await digest(vertexText),fragmentSha256:await digest(fragmentText),
    banksSha256:await digest(bytes)};
  require(report.inputs.vertexSha256===vertexId&&report.inputs.fragmentSha256===fragmentId,
    'literal full shader identities');
  const bridge=await createVirglShaderBridge();
  const components=words=>words.map((word,i)=>({register:i>>2,component:i&3,word}));
  try {
    for (const [index,bank] of banks.entries()) {
      const request={vertexText,fragmentText,vertexComponents:components(bank.vertex),
        fragmentComponents:components(bank.fragment)};
      const pair=bridge.translatePairExact(request);
      require(pair.ok,`whole original pair ${index}: ${JSON.stringify(pair)}`);
      require(bank.fragment[23*4]===1&&bank.fragment[24*4]===0&&
        bank.fragment[28*4]===0x3f800000&&bank.fragment[3*4+3]===0x3f800000,
        'captured pc94/163 constant branches and output opacity');
      require(pair.vertex.metadata.profile==='virgl-webgl2-straight-line-v5'&&
        pair.fragment.metadata.profile==='virgl-webgl2-raw-bits-v42',
        'exact private fragment and unchanged ordinary vertex');
      require(pair.fragment.metadata.constantExactDomains?.[0]?.components?.length===136,
        'complete fragment exact bank metadata');
      require(pair.interfaceKey.includes('tgsi-fragment-discard-v1'),
        'whole paired discard interface');
      const ordinary=bridge.translatePair({vertexText,fragmentText});
      require(!ordinary.ok,'default whole original remains gated');
      report.pairs.push({bank:index,result:pair,ordinary});
      if(index===0){
        const altered={...request,fragmentComponents:components(bank.fragment.map((word,i)=>
          i===29*4?0x3f800000:word))};
        const changed=bridge.translatePairExact(altered);
        require(!changed.ok,'positive cap cannot inherit original zero-branch proof');
        report.rejections.push({name:'positive-cap',error:changed.error});
        const short=bridge.translatePairExact({...request,
          fragmentComponents:request.fragmentComponents.slice(0,-1)});
        require(!short.ok,'partial captured bank cannot inherit full proof');
        report.rejections.push({name:'short-bank',error:short.error});
        const source=bridge.translatePairExact({...request,
          fragmentText:fragmentText.replace('28: MIN TEMP[44].x, TEMP[43].xxxx, CONST[29].xxxx',
            '28: MIN TEMP[44].x, TEMP[43].xxxx, CONST[28].xxxx')});
        require(!source.ok,'altered full source cannot inherit captured proof');
        report.rejections.push({name:'altered-source',error:source.error});
      }
      let glsl=pair.fragment.glsl;
      if(fault==='coordinate'&&index===0){
        require(glsl.includes('vso_g0.x'),'original coordinate fault site');
        glsl=glsl.replace('vso_g0.x','vso_g0.y');
      }
      if(fault==='discard'&&index===0){
        require(glsl.includes('discard;'),'original discard fault site');
        glsl=glsl.replace('discard;','; /* omitted original discard */');
      }
      if(fault==='output'&&index===0){
        const site='fsout_c0.x = float_out[0].x;';
        require(glsl.includes(site),'original output fault site');
        glsl=glsl.replace(site,'fsout_c0.x = 0.0;');
      }
      const built=createProgram(gl,pair.vertex,{...pair.fragment,glsl});
      const program=built.program,vao=gl.createVertexArray(),texture=gl.createTexture(),
        framebuffer=gl.createFramebuffer(),buffers=[];
      require(vao&&texture&&framebuffer,'physical graphics objects');
      try {
        gl.useProgram(program);
        const systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
        const reflection=[];
        for(const [name,words,metadata] of [
          ['vsconst0',bank.vertex,pair.vertex.metadata],
          ['fsconst0',bank.fragment,pair.fragment.metadata]]) {
          const uniform=metadata.uniforms.find(entry=>entry.name===name);
          require(uniform&&uniform.count*4===words.length,'complete bank metadata');
          const active=`${name}[0]`,location=gl.getUniformLocation(program,active);
          require(location!==null,`${active} active`);
          const uniformIndex=gl.getUniformIndices(program,[active])[0];
          require(uniformIndex!==gl.INVALID_INDEX,`${active} reflected`);
          const type=gl.getActiveUniforms(program,[uniformIndex],gl.UNIFORM_TYPE)[0];
          const count=gl.getActiveUniforms(program,[uniformIndex],gl.UNIFORM_SIZE)[0];
          require(type===gl.UNSIGNED_INT_VEC4&&count===uniform.count,
            `${active} complete physical reflection`);
          gl.uniform4uiv(location,new Uint32Array(words));
          reflection.push({name:active,type,count,words});
        }
        gl.bindVertexArray(vao);
        const vertexBuffer=gl.createBuffer();require(vertexBuffer,'vertex buffer');
        buffers.push(vertexBuffer);
        gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
        for(const [name,offset] of [['in_0',0],['in_1',16]]){
          const location=gl.getAttribLocation(program,name);
          require(location>=0,`${name} active attribute`);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location,4,gl.FLOAT,false,32,offset);
        }
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,4,4,0,gl.RGBA,gl.FLOAT,null);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'float framebuffer');
        for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,
          gl.SCISSOR_TEST,gl.STENCIL_TEST]) gl.disable(cap);
        for(const edge of ['near','far']){
          const vertices=geometry(bank,edge);
          gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
          gl.viewport(0,0,4,4);
          gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES,0,3);
          const pixels=new Float32Array(64);
          gl.readPixels(0,0,4,4,gl.RGBA,gl.FLOAT,pixels);
          require(gl.getError()===gl.NO_ERROR,'complete original physical draw');
          const frame={bank:index,edge,logs:built.logs,glslSha256:await digest(glsl),
            sourceSha256:fragmentId,systemBlocks,reflection,vertices,pixels:[]};
          report.frames.push(frame);
          for(let y=0;y<4;y++)for(let x=0;x<4;x++){
            const expected=expectedPixel(bank.fragment,edge,x,y);
            const actual=[...pixels.subarray((y*4+x)*4,(y*4+x+1)*4)];
            const errors=actual.map((value,lane)=>Math.abs(value-expected[lane]));
            frame.pixels.push({x,y,expected,actual,errors});
            require(errors.every(error=>Number.isFinite(error)&&error<=0.02),
              `independent full original pixel bank${index} ${edge} (${x},${y}): `+
              JSON.stringify({expected,actual,errors}));
          }
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
        for(const buffer of buffers)gl.deleteBuffer(buffer);
        gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        require(buffers.every(buffer=>!gl.isBuffer(buffer))&&
          !gl.isFramebuffer(framebuffer)&&!gl.isTexture(texture)&&
          !gl.isVertexArray(vao)&&!gl.isProgram(program),'physical object disposal');
      }
    }
    require(report.frames.length===6&&report.rejections.length===3,'all banks/edges/attacks');
    require(!fault,'deliberate physical fault must contradict oracle');
    report.status='passed';
    document.querySelector('#status').textContent='96 full-original pixels checked on physical WebGL2';
    document.querySelector('#renderer').textContent=report.renderer;
  } catch(error){report.status='failed';report.failure={message:error.message};throw error;}
  return report;
}
