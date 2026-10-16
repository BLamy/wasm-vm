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
const result=await build({
  entryPoints:[path.join(repo,"web/docs-src/app.jsx")],outdir:out,bundle:true,format:"esm",splitting:true,minify:true,target:["es2022"],jsx:"automatic",metafile:true,
  entryNames:"reader",chunkNames:"features/[name]-[hash]",assetNames:"assets/[name]-[hash]",logLevel:"warning",define:{"process.env.NODE_ENV":"\"production\"","__DOCS_CORPUS_REV__":JSON.stringify(corpusRev)},loader:{".woff":"file",".woff2":"file",".ttf":"file"},
  plugins:[{name:"raw-source",setup(b){b.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.replace(/\?raw$/,"")),namespace:"source-text"}));b.onLoad({filter:/.*/,namespace:"source-text"},async args=>({contents:await readFile(args.path,"utf8"),loader:"text"}));}}],
});
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
const heroVersions={"./landing.js":await hashFile("landing.js"),"./hero-scene.js":await hashFile("hero-scene.js")};
const pageModule=path.join(repo,"web/landing-page.js");
await writeFile(pageModule,(await readFile(pageModule,"utf8")).replace(/(\.\/(?:landing|hero-scene)\.js)(?:\?rev=[a-f0-9]+)?/g,(_,name)=>`${name}?rev=${heroVersions[name]}`));
const pageRevision=await hashFile("landing-page.js"),benchmarkRevision=await hashFile("landing-benchmarks.js");
for(const name of ["landing.html","products.html","work-market.html","security.html","roadmap.html"]){
  const file=path.join(repo,"web",name);
  const html=(await readFile(file,"utf8")).replace(/\.\/landing-page\.js(?:\?rev=[a-f0-9]+)?/g,`./landing-page.js?rev=${pageRevision}`).replace(/\.\/landing-benchmarks\.js(?:\?rev=[a-f0-9]+)?/g,`./landing-benchmarks.js?rev=${benchmarkRevision}`);
  await writeFile(file,html);
}
console.log("Docstream reader bundled locally; heavy renderers keep their dynamic chunks.");
