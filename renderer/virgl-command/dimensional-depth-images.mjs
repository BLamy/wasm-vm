/** Selected original cube/array depth storage and one-plane GPU conversion. */
import {floatingDepthFormat} from './floating-depth-images.mjs';
import {unormDepthFormat,packedDepthFormat} from './unorm-depth-images.mjs';
export const STANDARD_DIMENSIONAL_DEPTH_TRANSFER_PROFILE = 'virgl-standard-dimensional-depth-transfer-v1';
const depthFormat = format => floatingDepthFormat(format) || unormDepthFormat(format) || packedDepthFormat(format);

export function dimensionalDepthMetadata(meta,limits,require,product) {
  const color = depthFormat(meta.format);
  require(color && [4,7].includes(meta.target) && [1,8,9].includes(meta.bind) && meta.nrSamples === 0 && meta.flags === 0,
    'unsupported-resource','Only original single-sample cube/array depth roles are selected.');
  require(meta.depth === 1 && (meta.target !== 4 || meta.arraySize === 6 && meta.width === meta.height),
    'unsupported-resource','Original depth cube/array shape is inconsistent.');
  const size = meta.target === 4 ? limits.cubeTextureSize : limits.textureSize;
  require(meta.width <= size && meta.height <= size && (meta.target !== 7 || meta.arraySize <= limits.arrayLayers),
    'limit-exceeded','Dimensional depth storage exceeds selected host limits.');
  require(meta.lastLevel <= Math.floor(Math.log2(Math.max(meta.width,meta.height))),
    'unsupported-resource','Depth mip chain extends beyond its final level.');
  const levels=[];let width=meta.width,height=meta.height,byteLength=0,gpuByteLength=0;
  for(let level=0;level<=meta.lastLevel;level++) {
    const pixels=product(product(width,height,limits.resourceBytes,'Depth plane exceeds byte limit.'),meta.arraySize,limits.resourceBytes,'Depth level exceeds byte limit.');
    const bytes=product(pixels,color.pixelBytes,limits.resourceBytes,'Public depth level exceeds byte limit.');
    const native=product(pixels,color.allocationPixelBytes,limits.resourceBytes,'Owned native depth level exceeds byte limit.');
    require(bytes<=limits.resourceBytes-byteLength && native<=limits.resourceBytes-gpuByteLength,
      'limit-exceeded','Complete dimensional depth chain exceeds resource limit.');
    levels.push({level,width,height,layers:meta.arraySize,byteLength:bytes,gpuByteLength:native});
    byteLength+=bytes;gpuByteLength+=native;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));
  }
  return {...meta,kind:'dimensional-depth-texture',pixelBytes:color.pixelBytes,byteLength,gpuByteLength,levels,
    ...(color.floatingDepth?{floatingDepth:true}:color.unormDepth?{unormDepth:true}:{packedDepth:true})};
}

export function dimensionalDepthTransferCosts(meta,layout,limits,product) {
  const color=depthFormat(meta.format),planePixels=product(layout.box.width,layout.box.height,limits.scratchBytes,'Depth transfer plane exceeds scratch limit.');
  const pixels=product(planePixels,layout.layerCount,limits.scratchBytes,'Depth transfer exceeds scratch limit.');
  if(layout.direction==='upload')return {scratchBytes:product(pixels,color.pixelBytes,limits.scratchBytes,'Depth upload exceeds scratch limit.'),stagingBytes:0};
  const nativeReadBytes=product(pixels,color.readPixelBytes,limits.scratchBytes,'Layered depth read exceeds scratch limit.');
  const scratchBytes=product(pixels,color.floatingDepth&&color.stencil?16:color.readPixelBytes,limits.scratchBytes,'Layered depth serialization exceeds scratch limit.');
  const conversionBytes=product(planePixels,color.nativePixelBytes+color.conversionPixelBytes,limits.gpuBytes,'Depth conversion plane exceeds GPU limit.');
  return {scratchBytes,nativeReadBytes,conversionBytes,stagingBytes:nativeReadBytes+conversionBytes};
}

export function createDimensionalDepthGpuAccess(gl,check,require,nativeFormat,getHelper) {
  const conversions=new Set();
  const targetFor = meta => meta.target===4?gl.TEXTURE_CUBE_MAP:gl.TEXTURE_2D_ARRAY;
  const release = converted => {
    if(!conversions.delete(converted))return;
    getHelper().releaseScratch(converted.pair);gl.deleteTexture(converted.stage);
  };
  return Object.freeze({
    allocate(meta) {
      require(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision>=23,
        'unsupported-host','Faithful depth reconstruction requires highp binary32.');
      const texture=gl.createTexture();require(texture,'backend-error','Dimensional depth texture allocation failed.');
      const target=targetFor(meta),profile=nativeFormat(meta);let depthUploadBuffer=null;
      try {
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(target,texture);
        if(meta.target===4)gl.texStorage2D(target,meta.lastLevel+1,profile.internal,meta.width,meta.height);
        else gl.texStorage3D(target,meta.lastLevel+1,profile.internal,meta.width,meta.height,meta.arraySize);
        gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(target,axis,gl.CLAMP_TO_EDGE);
        if(meta.format===126) {
          depthUploadBuffer=gl.createBuffer();require(depthUploadBuffer,'backend-error','Layered depth upload buffer allocation failed.');
          const previous=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
          try{gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,depthUploadBuffer);gl.bufferData(gl.PIXEL_UNPACK_BUFFER,meta.byteLength,gl.DYNAMIC_DRAW);check();}
          finally{gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,previous);}
        }
        check();return Object.freeze({kind:'texture',dimensionalDepth:true,texture,target,...(depthUploadBuffer?{depthUploadBuffer}:{})});
      }catch(error){gl.deleteTexture(texture);if(depthUploadBuffer)gl.deleteBuffer(depthUploadBuffer);throw error;}
    },
    upload(storage,meta,layout,native) {
      const profile=nativeFormat(meta),box=layout.box,planeBytes=layout.rowBytes*layout.rowCount;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(storage.target,storage.texture);
      const previous=storage.depthUploadBuffer?gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING):null;
      try {
        if(storage.depthUploadBuffer){gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,storage.depthUploadBuffer);gl.bufferSubData(gl.PIXEL_UNPACK_BUFFER,0,native);}
        if(storage.target===gl.TEXTURE_CUBE_MAP)for(let layer=0;layer<layout.layerCount;layer++) {
          const payload=storage.depthUploadBuffer?layer*planeBytes:native.subarray(layer*planeBytes/native.BYTES_PER_ELEMENT,(layer+1)*planeBytes/native.BYTES_PER_ELEMENT);
          gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+box.z+layer,layout.level,box.x,box.y,box.width,box.height,profile.upload,profile.type,payload);
        }
        else gl.texSubImage3D(storage.target,layout.level,box.x,box.y,box.z,box.width,box.height,box.depth,profile.upload,profile.type,storage.depthUploadBuffer?0:native);
        check();
      }finally{if(storage.depthUploadBuffer)gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,previous);}
    },
    createConversion(meta,layout) {
      const active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);
      const binding=gl.getParameter(gl.TEXTURE_BINDING_2D),profile=nativeFormat(meta);let stage=null,pair=null;
      try {
        stage=gl.createTexture();require(stage,'backend-error','Layered depth conversion allocation failed.');
        gl.bindTexture(gl.TEXTURE_2D,stage);gl.texStorage2D(gl.TEXTURE_2D,1,profile.internal,layout.box.width,layout.box.height);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);check();
        pair=getHelper().createScratch(layout.box.width,layout.box.height,depthFormat(meta.format).stencil,profile.internal);
        const converted=Object.freeze({stage,pair});conversions.add(converted);return converted;
      }catch(error){if(stage)gl.deleteTexture(stage);throw error;}
      finally{gl.bindTexture(gl.TEXTURE_2D,binding);gl.activeTexture(active);}
    },
    read(converted,storage,meta,layout,destination=null) {
      require(conversions.has(converted),'backend-error','Foreign layered depth conversion.');
      const helper=getHelper(),planeBytes=layout.box.width*layout.box.height*4;
      const box={x:0,y:0,width:layout.box.width,height:layout.box.height};
      for(let layer=0;layer<layout.layerCount;layer++) {
        helper.copyRegion(storage.texture,converted.stage,depthFormat(meta.format).stencil,layout.level,0,layout.box,storage.target,layout.box.z+layer);
        helper.pack(converted.pair,converted.stage,0,box);
        helper.read(converted.pair,destination,layer*planeBytes,layout.layerCount*planeBytes);
      }
      check();
    },
    release,
    dispose(){for(const converted of [...conversions])release(converted);},
  });
}
