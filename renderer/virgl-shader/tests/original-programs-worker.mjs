import {runPhysicalAcceptance} from './original-programs.mjs';

self.onmessage=async({data})=>{
 try{
  const report=await runPhysicalAcceptance(data);
  self.postMessage({report:JSON.stringify(report)});
 }catch(error){
  self.postMessage({error:error.message});
 }
};
