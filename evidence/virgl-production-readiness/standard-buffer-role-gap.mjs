import {createResourceStore,createStandardUniformResourceStore} from '../../renderer/virgl-command/resources.mjs';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const repo=process.cwd(), records=[];
const backend={maxTextureSize:16384,allocate:()=>({}),destroy(){},upload(){},readback:(_s,_m,l)=>new Uint8Array(l.tightBytes),dispose(){}};
for(const [name,factory] of [['historical',createResourceStore],['uniform',createStandardUniformResourceStore]])for(const bind of [0,16,32,48,64,80,96,112]){
const owner=factory({backend});if(!owner.ok)throw Error(JSON.stringify(owner));const {store}=owner;store.createContext(1);
const metadata={id:1,target:0,format:64,bind,width:64,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}, create=store.createResource(metadata), roles={};
if(create.ok){store.attachContext(1,1);for(const role of ['vertex','index','uniform']){const r=store.retainStorage(1,1,role);roles[role]=r.ok?{ok:true}:{ok:false,error:r.error};if(r.ok)store.releaseStorage(r.lease);}}
records.push({factory:name,metadata,create,roles});store.dispose();}
const source='renderer/virgl-command/resources.mjs', bytes=await fs.readFile(repo+'/'+source);
const report={schema:1,task:'production-readiness-buffer-role-gap',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),source:{path:source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},guestExecution:false,productionNegotiation:false,records};
await fs.writeFile(process.argv[2]??'/tmp/wasmvm-standard-buffer-role-gap.json',JSON.stringify(report,null,2)+'\n');console.log(records.map(r=>({factory:r.factory,bind:r.metadata.bind,create:r.create.ok,roles:Object.fromEntries(Object.entries(r.roles).map(([k,v])=>[k,v.ok]))})));
