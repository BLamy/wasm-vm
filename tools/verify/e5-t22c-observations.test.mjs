import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {decodeEdid,displayObservations,assertDisplayAgreement,inspectResizeContent,inspectDesktopEdges} from "./e5-t22c-observations.mjs";
const baseline=JSON.parse(readFileSync(new URL("../../evidence/e5-t22c/baseline/baseline.json",import.meta.url)));
const edid=baseline.samples.at(-1).gpu.edid;
const hex=Buffer.from(edid).toString("hex");
const line=`WV_DISPLAY ns=123456789 id=17 name=Virtual-1 width=803 height=603 refresh=59992 scale=1 edid_width=803 edid_height=603 edid=${hex}\r\n`;
const good={guest:line,gpu:{scanoutWidth:803,scanoutHeight:603,edid},state:{presentation:{width:803,height:603,sizeMismatch:false}},width:803,height:603,outputId:17};
test("independent recorded kernel EDID and Wayland current mode",()=>{
  assert.equal(decodeEdid(hex).width,803);assert.equal(decodeEdid(hex).height,603);
  assert.equal(displayObservations(line)[0].ns,"123456789");assertDisplayAgreement(good);
});
test("reject stale/current target substitutions, incomplete EDID and checksum sabotage",()=>{
  for(const bad of [hex.slice(2),hex.slice(0,-2)+"00","unavailable"])assert.throws(()=>decodeEdid(bad));
  assert.throws(()=>assertDisplayAgreement({...good,guest:line.replace("width=803","width=1280")}));
  assert.throws(()=>assertDisplayAgreement({...good,gpu:{...good.gpu,scanoutWidth:1280}}));
  assert.throws(()=>assertDisplayAgreement({...good,outputId:18}));
  assert.throws(()=>assertDisplayAgreement({...good,state:{presentation:{width:803,height:603,sizeMismatch:true}}}));
  assert.throws(()=>assertDisplayAgreement({...good,guest:""}));
});
test("content oracle reads native pixels, rejects absence and locates moved text",()=>{
  const width=100,height=80,bytes=new Uint8ClampedArray(width*height*4);
  globalThis.document={getElementById:()=>({width,height,getContext:()=>({getImageData:()=>({data:bytes})})})};
  try{
    assert.equal(inspectResizeContent().visible,false);
    for(let y=10;y<20;y++)for(let x=7;x<27;x++)bytes.set((x+y)%3?[20,40,80,255]:[245,231,190,255],4*(y*width+x));
    const found=inspectResizeContent();assert.equal(found.visible,true);assert.equal(found.left,7);assert.equal(found.top,10);
    assert.deepEqual([found.width,found.height],[20,10]);assert.equal(found.rgba.length,800);
    // Actual small foot glyphs contain antialiased strokes, not fifty fully
    // covered pixels. A 50% foreground/background blend is still visible text.
    for(let y=10;y<20;y++)for(let x=7;x<27;x++)if((x+y)%3===0)bytes.set([133,136,135,255],4*(y*width+x));
    assert.equal(inspectResizeContent().visible,true);
    // A solid marker-colored rectangle, even with unrelated foreground text
    // elsewhere, must not pass the content check.
    for(let y=10;y<20;y++)for(let x=7;x<27;x++)bytes.set([20,40,80,255],4*(y*width+x));
    for(let x=0;x<100;x++)bytes.set([245,231,190,255],4*x);
    assert.equal(inspectResizeContent().visible,false);
    for(let y=10;y<20;y++)for(let x=7;x<27;x++)if((x+y)%3===0)bytes.set([245,40,80,255],4*(y*width+x));
    assert.equal(inspectResizeContent().visible,false,"unrelated red strokes are not the requested foreground");
    bytes.fill(0);assert.equal(inspectResizeContent().visible,false);
  }finally{delete globalThis.document;}
});
test("matching-size canvas with old-size desktop and black padding is incomplete",()=>{
  let fillWidth=901,fillHeight=701;
  globalThis.document={getElementById:()=>({width:2560,height:1600,getContext:()=>({getImageData:(x,y,w,h)=>{
    const data=new Uint8ClampedArray(w*h*4);
    for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){
      const rgb=x+dx<fillWidth&&y+dy<fillHeight?90:0;
      data.set([rgb,rgb,rgb,255],4*(dy*w+dx));
    }
    return {data};
  }})})};
  try{
    assert.equal(inspectDesktopEdges().complete,false);
    fillWidth=2560;assert.equal(inspectDesktopEdges().complete,false,"black bottom is incomplete");
    fillHeight=1600;assert.equal(inspectDesktopEdges().complete,true);
    fillWidth=901;assert.equal(inspectDesktopEdges().complete,false,"black right is incomplete");
  }finally{delete globalThis.document;}
});
