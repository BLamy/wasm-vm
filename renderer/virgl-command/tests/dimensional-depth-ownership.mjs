// Exercise exported conversion ownership with real immutable native objects.
import {createDimensionalDepthGpuAccess} from '../dimensional-depth-images.mjs';
import {createFloatingDepthPacker} from '../floating-depth-gpu.mjs';
export function runOwnership({recorded,c}){
 const gl=recorded.gl,start=recorded.calls.length,vao=gl.createVertexArray();c.truth(vao,'owned conversion vertex array');
 const check=()=>c.equal(gl.getError(),gl.NO_ERROR,'owned conversion native error'),require=(condition,code,message)=>{if(!condition)throw Error(code+': '+message);};
 const helper=createFloatingDepthPacker(gl,check,require,vao,null),access=createDimensionalDepthGpuAccess(gl,check,require,()=>({internal:gl.DEPTH_COMPONENT32F}),()=>helper);
 const meta={target:4,format:18},layout={box:{x:0,y:0,z:0,width:2,height:2,depth:1},layerCount:1,level:0},first=access.createConversion(meta,layout);
 c.equal(recorded.live.size,3,'one real stage, one packer plane, one vertex array');access.release(first);c.equal(recorded.live.size,1,'release both real texture planes');
 const released=recorded.calls.length;access.release(first);c.equal(recorded.calls.length,released,'duplicate conversion release issues no native call');
 c.throws(()=>access.read(first,{},meta,layout),'retired conversion cannot read a native image');c.equal(recorded.calls.length,released,'retired conversion refuses before GL');
 access.createConversion(meta,layout);c.equal(recorded.live.size,3,'second conversion owns two real texture planes');access.dispose();c.equal(recorded.live.size,1,'dispose releases an outstanding conversion');access.dispose();c.equal(recorded.live.size,1,'repeat disposal owns no texture');
 helper.dispose();gl.deleteVertexArray(vao);c.equal(recorded.live.size,0,'exported conversion terminal native objects zero');check();return{nativeCallsStart:start,nativeCallsEnd:recorded.calls.length,duplicateReleaseNoNativeCalls:true,disposedOutstandingConversion:true};
}
