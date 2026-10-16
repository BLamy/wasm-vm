export {runWireAcceptance} from './standard-packed-normalized-consumer-wire.mjs';
export async function runAcceptance(options={}){
 const mode=options.mode??'matrix';
 if(mode==='samples'||mode==='sample-boundaries')return(await import('./standard-packed-normalized-consumer-samples.mjs')).runSamples({...options,boundaries:mode==='sample-boundaries'});
 if(mode==='boundaries')return(await import('./standard-packed-normalized-consumer-boundaries.mjs')).runBoundaries(options);
 return(await import('./standard-packed-normalized-consumer-targets.mjs')).runTargets(options);
}
