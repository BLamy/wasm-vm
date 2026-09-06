// Offline replay of the preserved real screenshot; not a replacement for a
// live guest/client-survival run. Keeps the antialias false-negative reproducible.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { sha256 } from "./e5-t18e-publication.mjs";
import { inspectResizeContent } from "./e5-t22c-observations.mjs";
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
} finally {await browser.close();}
