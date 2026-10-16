import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseMarkdown, serializeMarkdown, documentOutline, readDocumentProperties, getTaskState } from "../web/node_modules/@brett_lamy/docstream/dist/index.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=rel=>readFile(path.join(root,rel),"utf8");
const sha=s=>createHash("sha256").update(s).digest("hex");
const require=(value,message)=>{if(!value)throw new Error(message);};
const catalog=JSON.parse(await read("web/docs-content/catalog.json"));
const ledger=JSON.parse(await read("web/docs-content/migration-ledger.json"));
const version=JSON.parse(await read("web/node_modules/@brett_lamy/docstream/package.json")).version;
require(version==="1.9.1"&&catalog.docstreamVersion===version,"Docstream exact release drift");
require(JSON.parse(await read("web/package.json")).dependencies["@brett_lamy/docstream"]===version,"Docstream package pin drift");
const tracked=execFileSync("git",["ls-tree","-r","--name-only",ledger.sourceRevision],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024}).split("\n").filter(Boolean);
const baseline=tracked.filter(p=>/\.(md|mdx|rst|adoc)$/i.test(p));
const auxiliary=ledger.documents.filter(d=>d.role==="auxiliary-record").map(d=>d.path);
const prosePaths=new Set(baseline);
const expectedAuxiliary=tracked.filter(p=>!prosePaths.has(p)&&(/\.(txt|pdf)$/i.test(p)||path.basename(p).toUpperCase()==="README"||/^(LICENSE|LICENCE|COPYING|NOTICE)/.test(path.basename(p).toUpperCase())));
require(JSON.stringify(auxiliary)===JSON.stringify(expectedAuxiliary),"Auxiliary legal/specification/trace inventory is incomplete");
require(catalog.counts.auxiliaryRecords===auxiliary.length&&catalog.counts.totalDocuments===ledger.documents.length,"Archive count disagrees with actual inventory");
const sources=[...baseline,...auxiliary];
const sourceBytes=execFileSync("git",["cat-file","--batch"],{cwd:root,input:sources.map(p=>`${ledger.sourceRevision}:${p}\n`).join(""),maxBuffer:128*1024*1024});
const originals=new Map();let offset=0;
for(const file of sources){const end=sourceBytes.indexOf(10,offset);const [blob,type,size]=sourceBytes.subarray(offset,end).toString().split(" ");require(blob&&type==="blob",`Missing baseline source: ${file}`);offset=end+1;originals.set(file,sourceBytes.subarray(offset,offset+Number(size)));offset+=Number(size)+1;}
const indexed=new Map(ledger.documents.map(d=>[d.path,d]));
require(baseline.length===catalog.counts.baselineProse,"Baseline inventory count drift");
for(const file of sources){require(indexed.has(file),`Unaccounted source: ${file}`);const item=indexed.get(file);require(["rewritten","preserved","obsolete"].includes(item.status)&&item.reason.length>12,`Missing disposition: ${file}`);require(sha(originals.get(file))===item.sourceSha256,`Immutable baseline source disagrees with ledger: ${file}`);if(item.status==="rewritten")require(item.page&&item.replacement,`No rendered rewrite for ${file}`);}
const ids=new Set(catalog.pages.map(p=>p.id));
require(ids.size===catalog.pages.length,"Duplicate document IDs");
const roundtrip=[],links=[],commands=[],properties=[];let contentRefs=0,namedFences=0;
const expectedTaskStates=["pending","in-progress","implemented","blocked","parked","refuted","verified","cancelled"];
let verificationStates=[];
function taskStates(node,result=[]){if(!node||typeof node!=="object")return result;if(node.type==="listItem"&&(node.state!==undefined||node.checked!==undefined))result.push(getTaskState(node));for(const value of Object.values(node)){if(Array.isArray(value))for(const child of value)taskStates(child,result);else if(value&&typeof value==="object")taskStates(value,result);}return result;}
function codeBlocks(node,result=[]){if(!node||typeof node!=="object")return result;if(node.type==="code")result.push(node.code);for(const value of Object.values(node)){if(Array.isArray(value))for(const child of value)codeBlocks(child,result);else if(value&&typeof value==="object")codeBlocks(value,result);}return result;}
for(const page of catalog.pages){
  const markdown=await read(`web/docs-content/${page.id}.md`);
  require(sha(markdown)===page.sha256,`Published digest mismatch: ${page.id}`);
  const parsed=parseMarkdown(markdown);
  require(parsed.properties,`Missing native document properties: ${page.id}`);
  const metadata=readDocumentProperties(parsed.properties);
  require(!metadata.error&&metadata.values.source===page.source&&metadata.values.kind&&metadata.values.scope,`Invalid publication properties: ${page.id}`);
  if(page.kind==="reference")require(metadata.values.source_revision===ledger.sourceRevision&&metadata.values.source_sha256===page.sourceSha256,`Reference properties drift: ${page.id}`);
  properties.push({id:page.id,keys:Object.keys(metadata.values),sourceRevision:metadata.values.source_revision});
  if(page.id==="verification"){verificationStates=taskStates(parsed);require(JSON.stringify(verificationStates)===JSON.stringify(expectedTaskStates),"Native task-state examples are incomplete or misparsed");}
  require(parsed.children.length>1,`Empty document: ${page.id}`);
  require(documentOutline(parsed).some(h=>h.level===1),`Missing title: ${page.id}`);
  const serialized=serializeMarkdown(parsed);
  if(serialized!==markdown)roundtrip.push({id:page.id,sourceSha256:page.sha256,serializedSha256:sha(serialized)});
  if(page.kind==="reference"){
    const original=parseMarkdown(originals.get(page.source).toString());
    const before=codeBlocks(original),after=codeBlocks(parsed);
    require(JSON.stringify(before)===JSON.stringify(after),`Code or command lost in migration: ${page.source}`);
    commands.push({source:page.source,codeBlocks:before.length});
  }
  const localTargets=[...markdown.matchAll(/\]\((\.\/[^\s)]+)\)/g)].map(match=>match[1]);
  const refs=[...markdown.matchAll(/\{%\s*content-ref\s+url="(\.\/[^"\s]+)"\s*%\}/g)].map(match=>match[1]);
  contentRefs+=refs.length;namedFences+=[...markdown.matchAll(/^`{3,}[^\n]*title="/gm)].length;
  for(const target of [...localTargets,...refs]){
    const url=new URL(target,"https://local.test/");
    if(url.pathname==="/docs.html")require(ids.has(url.searchParams.get("page")||"overview"),`Broken reader route ${target} in ${page.id}`);
    else {const localPath=["/app","/app.html"].includes(url.pathname)?"index.html":decodeURIComponent(url.pathname);try{await stat(path.join(root,"web",localPath));}catch{throw new Error(`Missing local resource ${target} in ${page.id}`);}}
    links.push({page:page.id,target});
  }
}
// Evidence-backed acceptance: the exact existing shader algorithm must survive.
const oldShader=execFileSync("git",["show",`${ledger.sourceRevision}:web/landing.js`],{cwd:root,encoding:"utf8"});
const currentShader=await read("web/landing.js");
const fragment=s=>s.match(/fragmentShader:\s*\/\* glsl \*\/\s*`([\s\S]*?)`/)[1];
require(fragment(oldShader)===fragment(currentShader),"Background fragment shader was replaced or changed");
for(const asset of ["web/landing.html","web/landing-page.js","web/hero-scene.js","web/landing.js","web/landing-benchmarks.js","web/docs-bundle/reader.js","web/docs-bundle/reader.css"])require((await stat(path.join(root,asset))).size>0,`Missing browser asset ${asset}`);
const receipt={schema:1,docstreamVersion:version,sourceRevision:ledger.sourceRevision,baselineProse:baseline.length,auxiliaryRecords:auxiliary.length,ledgerDocuments:ledger.documents.length,renderedPages:catalog.pages.length,dispositions:ledger.counts,localLinks:links.length,docstreamContentRefs:contentRefs,namedCodeFences:namedFences,referenceCodeBlocks:commands.reduce((s,p)=>s+p.codeBlocks,0),shaderFragmentSha256:sha(fragment(currentShader)),nativeProperties:properties,nativeTaskStates:verificationStates,roundtripExceptions:roundtrip,commands};
await mkdir(path.join(root,"target/docs-build"),{recursive:true});
await writeFile(path.join(root,"target/docs-build/docs-validation.json"),JSON.stringify(receipt,null,2)+"\n");
require(roundtrip.length===0,`Docstream round-trip changed ${roundtrip.length} pages; see target/docs-build/docs-validation.json`);
console.log(`Docs checks passed: ${baseline.length} source documents accounted for; ${catalog.pages.length} pages parsed/round-tripped; ${links.length} local links; ${receipt.referenceCodeBlocks} unchanged code blocks; original shader SHA-256 ${receipt.shaderFragmentSha256}.`);
