// Offline replay of the preserved real screenshot; not a replacement for a
// live guest/client-survival run. Keeps the antialias false-negative reproducible.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { sha256 } from "./e5-t18e-publication.mjs";
import { inspectResizeContent, inspectDesktopEdges } from "./e5-t22c-observations.mjs";
const source="evidence/e5-t22c/rejected-oracle-v4/failure.png";
const png=await readFile(source);
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage();
  await page.setContent('<canvas id="desktop-canvas"></canvas>');
  await page.evaluate(async url=>{
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.getElementById("desktop-canvas");
    canvas.width=img.width;canvas.height=img.height;canvas.getContext("2d").drawImage(img,0,0);
  },"data:image/png;base64,"+png.toString("base64"));
  const {rgba,...observed}=await page.evaluate(inspectResizeContent);
  assert.equal(observed.visible,true);
  assert.equal(observed.foreground,477);
  assert.equal(observed.background,1090);
  const result={source,sourceSha256:sha256(png),observed,markerSha256:sha256(Buffer.from(rgba)),
    claim:"offline antialias detector regression only; not live resize acceptance"};
  await mkdir("evidence/e5-t22c/oracle-replay",{recursive:true});
  await writeFile("evidence/e5-t22c/oracle-replay/result.json",JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result));

  // Reconstruct only the captured page layout (scripts removed), then read the
  // old recording's native canvas pixels. No guest is running in this replay.
  const edgeSource="evidence/e5-t22c/iteration-v5/2560x1600.png";
  const edgePng=await readFile(edgeSource);
  await page.setViewportSize({width:2800,height:1900});
  await page.setContent((await readFile("web/desktop-resize.html","utf8")).replace(/<script[^>]*>[\s\S]*?<\/script>/g,""));
  const bounds=await page.evaluate(async url=>{
    const viewport=document.getElementById("viewport");viewport.style.width="2560px";viewport.style.height="1600px";
    const canvas=document.getElementById("desktop-canvas");canvas.width=2560;canvas.height=1600;
    const rect=canvas.getBoundingClientRect(),image=new Image();image.src=url;await image.decode();
    // Integer source offset preserves exact PNG pixels; probes stay four pixels
    // away from the fractional CSS box boundary and its shadow.
    const x=Math.ceil(rect.x),y=Math.ceil(rect.y);
    canvas.getContext("2d").drawImage(image,-x,-y);
    return {x,y,width:canvas.width,height:canvas.height,imageWidth:image.width,imageHeight:image.height};
  },"data:image/png;base64,"+edgePng.toString("base64"));
  const edges=await page.evaluate(inspectDesktopEdges);
  assert.equal(edges.complete,false,"real old-size desktop must fail full-edge coverage");
  assert.ok(edges.samples.some(s=>s.painted===16),"original desktop region remains painted");
  assert.ok(edges.samples.some(s=>s.painted===0),"new desktop region is black");
  const edgeResult={source:edgeSource,sourceSha256:sha256(edgePng),bounds,edges,
    claim:"offline detection of recorded black padding only; not a live guest test"};
  await writeFile("evidence/e5-t22c/oracle-replay/edges.json",JSON.stringify(edgeResult,null,2)+"\n");
  console.log(JSON.stringify(edgeResult));
} finally {await browser.close();}
