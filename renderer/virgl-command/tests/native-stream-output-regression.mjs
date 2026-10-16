import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {runAcceptance} from './native-dimensional-depth-surfaces.mjs';
export async function runCapture(options){
 const compiler=await createVirglStandardStreamOutputShaderBridge();
 const result=await runAcceptance({...options,smoke:true,seeds:options.seeds,
  createVirglStandardDimensionalDepthSurfaceSubmitBridge:config=>options.createVirglStandardStreamOutputSubmitBridge({...config,shaderBridge:compiler})});
 return result;
}
