import assert from "node:assert/strict";

export function decodeEdid(hex) {
  assert.match(hex,/^[a-f0-9]{256}$/i,"complete guest EDID");
  const bytes=Buffer.from(hex,"hex");
  assert.equal(bytes.subarray(0,8).toString("hex"),"00ffffffffffff00");
  assert.equal(bytes.reduce((a,b)=>a+b,0)&255,0,"guest EDID checksum");
  return {width:bytes[56]+16*(bytes[58]&240),height:bytes[59]+16*(bytes[61]&240),bytes:[...bytes]};
}

export function displayObservations(serial) {
  return [...serial.matchAll(/^WV_DISPLAY ns=(\d+) id=(\d+) name=([^ ]+) width=(\d+) height=(\d+) refresh=(\d+) scale=(\d+) edid_width=(-?\d+) edid_height=(-?\d+) edid=([^\r\n]+)\r?$/gm)].map(match=>({
    ns:match[1],id:Number(match[2]),name:match[3],width:Number(match[4]),height:Number(match[5]),
    refresh:Number(match[6]),scale:Number(match[7]),edid:decodeEdid(match[10]),
  }));
}

export function assertDisplayAgreement({guest,gpu,state,width,height,outputId}) {
  const observation=displayObservations(guest).at(-1);
  assert.ok(observation,"real Wayland observer returned a current mode");
  assert.deepEqual([observation.width,observation.height],[width,height],"Wayland current mode");
  assert.deepEqual([observation.edid.width,observation.edid.height],[width,height],"independently decoded DRM EDID");
  assert.deepEqual([gpu.scanoutWidth,gpu.scanoutHeight],[width,height],"actual GPU scanout");
  assert.deepEqual(gpu.edid,observation.edid.bytes,"guest kernel and host EDID agree");
  assert.deepEqual([state.presentation.width,state.presentation.height],[width,height],"canvas backing");
  assert.equal(state.presentation.sizeMismatch,false,"requested pixels actually painted");
  if(outputId!==undefined)assert.equal(observation.id,outputId,"wl_output global preserved");
  return observation;
}

// Serialized into the real page. The fixed terminal command prints text with
// these two explicit RGB colors; the oracle only reads rendered canvas pixels.
export function inspectResizeContent() {
  const canvas=document.getElementById("desktop-canvas");
  const {data}=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);
  let left=canvas.width,right=-1,top=canvas.height,bottom=-1,background=0,foreground=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const i=4*(y*canvas.width+x);
    if(data[i]===20&&data[i+1]===40&&data[i+2]===80){
      background++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
  }
  if(background<100)return {visible:false,background,foreground};
  // Small glyphs may have almost no fully covered foreground pixels. Count
  // antialiased mixtures of the two explicit terminal colors, only INSIDE the
  // located background. Unrelated panel text cannot supply the glyph count.
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
    const i=4*(y*canvas.width+x);
    const r=(data[i]-20)/225,g=(data[i+1]-40)/191,b=(data[i+2]-80)/110;
    if(r>=.25&&r<=1.01&&Math.abs(r-g)<.12&&Math.abs(r-b)<.12)foreground++;
  }
  if(foreground<50)return {visible:false,background,foreground};
  const width=right-left+1,height=bottom-top+1,rgba=[];
  for(let y=top;y<=bottom;y++)rgba.push(...data.subarray(4*(y*canvas.width+left),4*(y*canvas.width+right+1)));
  return {visible:true,left,top,width,height,background,foreground,rgba};
}
