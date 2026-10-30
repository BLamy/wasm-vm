import { build } from "../web/node_modules/esbuild/lib/main.js";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
execFileSync("python3",["tools/build-docs-corpus.py"],{cwd:repo,stdio:"inherit"});
const out=path.join(repo,"web/docs-bundle");
const corpusRev=createHash("sha256").update(await readFile(path.join(repo,"web/docs-content/catalog.json"))).digest("hex").slice(0,12);
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
// The reader also renders the shared site nav and library controls (web/ui/src), compiled into
// this bundle so a docs page loads one React. Two accommodations mirror tools/build-ui.mjs:
// optional peers reached only by unused @brett_lamy/ui modules stay external, and CSS that
// @brett_lamy/ui's own package JS imports as a side effect (its nested Docstream/KaTeX copies)
// is stubbed, failing the build if any such importer contributes code. The reader's own
// Docstream 1.9.1 and its CSS are untouched.
const stubbedCss=[];
// With splitting, esbuild turns every scanned dynamic import() into a chunk, even inside modules
// that tree-shaking later removes. @brett_lamy/ui lazy-loads syntax lexers, its nested Docstream
// copy and other heavy parts that way; none of it is used by the nav and controls compiled in
// here. Keep those dynamic imports external, then fail below if any of them survived into live
// code (a bare specifier the browser could not load) or if nested package code ships at all.
const nestedLibraryCode=/node_modules\/@brett_lamy\/(?:ui\/node_modules|docstream-editor)\//;
const libraryOnlyCode=/node_modules\/@brett_lamy\/(?:ui|docstream-editor)\//;
const dropUnusedLibraryCss={name:"drop-unused-library-css",setup(b){
  b.onResolve({filter:/.*/},args=>args.kind==="dynamic-import"&&libraryOnlyCode.test(args.importer)?{path:args.path,external:true}:undefined);
  b.onResolve({filter:/\.css$/},args=>{
    if(args.kind!=="import-statement"||!/node_modules\/@brett_lamy\/(?:ui|docstream-editor)\/.+\.m?js$/.test(args.importer))return undefined;
    stubbedCss.push({css:args.path,importer:path.relative(path.join(repo,"web"),args.importer)});
    return {path:`${args.importer}::${args.path}`,namespace:"stubbed-css"};
  });
  b.onLoad({filter:/.*/,namespace:"stubbed-css"},()=>({contents:"",loader:"css"}));
}};
const result=await build({
  external:["@electric-sql/pglite","@electric-sql/pglite-tools","@agent-wasm/tailscale-connect"],
  entryPoints:[path.join(repo,"web/docs-src/app.jsx")],outdir:out,bundle:true,format:"esm",splitting:true,minify:true,target:["es2022"],jsx:"automatic",metafile:true,
  entryNames:"reader",chunkNames:"features/[name]-[hash]",assetNames:"assets/[name]-[hash]",logLevel:"warning",define:{"process.env.NODE_ENV":"\"production\"","__DOCS_CORPUS_REV__":JSON.stringify(corpusRev)},loader:{".woff":"file",".woff2":"file",".ttf":"file"},
  plugins:[dropUnusedLibraryCss,{name:"raw-source",setup(b){b.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.replace(/\?raw$/,"")),namespace:"source-text"}));b.onLoad({filter:/.*/,namespace:"source-text"},async args=>({contents:await readFile(args.path,"utf8"),loader:"text"}));}}],
});
const shippedInputs=Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs)).filter(([,info])=>info.bytesInOutput>0).map(([input])=>path.resolve(input));
const liveStubs=stubbedCss.filter(({importer})=>shippedInputs.includes(path.join(repo,"web",importer)));
if(liveStubs.length)throw new Error(`stubbed library CSS belongs to bundled modules: ${JSON.stringify(liveStubs)}`);
const nestedShipped=shippedInputs.filter(input=>nestedLibraryCode.test(input));
if(nestedShipped.length)throw new Error(`@brett_lamy/ui's nested packages reached the reader bundle: ${nestedShipped.slice(0,5).join(", ")}`);
// An external dynamic import that survived tree-shaking would be a bare specifier the browser
// cannot load; none may remain in the shipped chunks.
for(const file of Object.keys(result.metafile.outputs).filter(f=>f.endsWith(".js"))){
  const code=await readFile(path.resolve(file),"utf8");
  const bare=[...code.matchAll(/import\(\s*["']((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.@-]+)*)["']\s*\)/g)].map(m=>m[1]);
  if(bare.length)throw new Error(`bare dynamic import left in ${file}: ${bare.join(", ")}`);
}
const buildReports=path.join(repo,"target/docs-build");
await mkdir(buildReports,{recursive:true});
await writeFile(path.join(buildReports,"bundle-metafile.json"),JSON.stringify(result.metafile,null,2)+"\n");
const scriptRev=createHash("sha256").update(await readFile(path.join(out,"reader.js"))).digest("hex").slice(0,12);
const styleRev=createHash("sha256").update(await readFile(path.join(out,"reader.css"))).digest("hex").slice(0,12);
for(const name of ["docs.html","docs-embedding.html","docs-guest.html","docs-containers.html","docs-verification.html","docs-explainers.html"]){
  const file=path.join(repo,"web",name);
  const html=(await readFile(file,"utf8")).replace(/\.\/docs-bundle\/reader\.js(?:\?rev=[a-f0-9]+)?/g,`./docs-bundle/reader.js?rev=${scriptRev}`).replace(/\.\/docs-bundle\/reader\.css(?:\?rev=[a-f0-9]+)?/g,`./docs-bundle/reader.css?rev=${styleRev}`);
  await writeFile(file,html);
}
// Source previews can already be controlled by the app's development service worker.
// Give marketing modules the same content-derived cache boundary as the reader.
const hashFile=async name=>createHash("sha256").update(await readFile(path.join(repo,"web",name))).digest("hex").slice(0,12);
const heroVersions={"./hero-scene.js":await hashFile("hero-scene.js")};
const pageModule=path.join(repo,"web/landing-page.js");
await writeFile(pageModule,(await readFile(pageModule,"utf8")).replace(/(\.\/hero-scene\.js)(?:\?rev=[a-f0-9]+)?/g,(_,name)=>`${name}?rev=${heroVersions[name]}`));
const pageRevision=await hashFile("landing-page.js"),benchmarkRevision=await hashFile("landing-benchmarks.js");
for(const name of ["landing.html","products.html","work-market.html","security.html","roadmap.html"]){
  const file=path.join(repo,"web",name);
  const html=(await readFile(file,"utf8")).replace(/\.\/landing-page\.js(?:\?rev=[a-f0-9]+)?/g,`./landing-page.js?rev=${pageRevision}`).replace(/\.\/landing-benchmarks\.js(?:\?rev=[a-f0-9]+)?/g,`./landing-benchmarks.js?rev=${benchmarkRevision}`);
  await writeFile(file,html);
}
console.log("Docstream reader bundled locally; heavy renderers keep their dynamic chunks.");
