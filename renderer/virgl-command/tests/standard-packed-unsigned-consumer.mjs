export {runWireAcceptance} from './standard-packed-unsigned-consumer-wire.mjs';
export async function runAcceptance(options={}){
 const mode=options.mode??'matrix';
 if(mode==='samples'||mode==='sample-boundaries')return(await import('./standard-packed-unsigned-consumer-samples.mjs')).runSamples({...options,boundaries:mode==='sample-boundaries'});
 if(mode==='boundaries')return(await import('./standard-packed-unsigned-consumer-boundaries.mjs')).runBoundaries(options);
 return(await import('./standard-packed-unsigned-consumer-targets.mjs')).runTargets(options);
}
