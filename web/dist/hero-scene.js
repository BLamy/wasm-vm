// An actual 3D architecture model: perspective projection, solid meshes, lights,
// material shading and explorable layers. This illustrates the VM; it does not run it.
import * as THREE from "three";

const descriptions = {
  cpu: ["RV64GC core.", "Guest instructions retire through a Rust interpreter; a JIT accelerates supported blocks.", "architecture", "Inspect the architecture"],
  memory: ["Guest memory.", "WebAssembly linear memory holds guest RAM. Linux translates virtual addresses through the emulated MMU.", "architecture", "Read the memory boundary"],
  devices: ["Virtual devices.", "Interrupt controllers, UART and virtio devices connect the guest to explicit browser-side storage and network providers.", "storage", "Read the device boundary"],
  linux: ["Unmodified Linux.", "The kernel and userland run as RISC-V binaries above the virtual platform. Boot images and modes are chosen by the loader.", "quickstart", "Read the boot guide"],
};

function describeLayer(figure, button) {
  const selected = button.dataset.layer;
  if (!descriptions[selected]) return null;
  const [title, body, page, link] = descriptions[selected];
  figure.querySelector("[data-model-label]").textContent = {
    cpu:"01 / RV64GC core", memory:"02 / Guest RAM", devices:"03 / Virtual devices", linux:"04 / Linux guest",
  }[selected];
  figure.querySelectorAll("[data-layer]").forEach(control=>control.setAttribute("aria-pressed",String(control===button)));
  const strong=document.createElement("strong");strong.textContent=title;
  const anchor=document.createElement("a");anchor.href=`./docs.html?page=${page}`;anchor.textContent=`${link} →`;
  figure.querySelector("figcaption").replaceChildren(strong,document.createTextNode(` ${body} `),anchor);
  return selected;
}

export function initMachineModel(canvas) {
  if (!canvas) return () => {};
  const figure = canvas.closest("figure");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: !mobile, powerPreference: "low-power"});
  } catch {
    figure.querySelector(".model-fallback").hidden = false;
    canvas.hidden = true;
    figure.querySelector(".model-motion").hidden = true;
    figure.querySelector(".model-kind").textContent = "Architecture overview";
    const onTextLayer = event => { const button=event.target.closest("[data-layer]");if(button)describeLayer(figure,button); };
    figure.querySelector(".model-controls").addEventListener("click",onTextLayer);
    return () => figure.querySelector(".model-controls").removeEventListener("click",onTextLayer);
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 40);
  camera.position.set(5.8, 4.8, 6.6);
  camera.lookAt(0, .15, 0);
  scene.add(new THREE.HemisphereLight(0xf1e6d3, 0x2a2219, 2.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 4);
  key.position.set(-4, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe4a853, 2.6);
  rim.position.set(6, 2, -3); scene.add(rim);
  const model = new THREE.Group(); scene.add(model);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mats = {
    board: new THREE.MeshStandardMaterial({color:0x2b2721, roughness:.64, metalness:.25}),
    graphite: new THREE.MeshStandardMaterial({color:0x3d3933, roughness:.4, metalness:.7}),
    chip: new THREE.MeshStandardMaterial({color:0xc8b38c, roughness:.26, metalness:.85}),
    silicon: new THREE.MeshStandardMaterial({color:0x1d1a16, roughness:.3, metalness:.5}),
    contact: new THREE.MeshStandardMaterial({color:0xb88f4f, roughness:.32, metalness:.8}),
    line: new THREE.MeshStandardMaterial({color:0x8a7656, roughness:.4, metalness:.6}),
    glass: new THREE.MeshPhysicalMaterial({color:0xe9d6b2, roughness:.2, metalness:.3, transparent:true, opacity:.16, depthWrite:false}),
  };
  const layers = {};
  const slab = (group, material, size, position) => {
    const mesh = new THREE.Mesh(box, material); mesh.scale.set(...size); mesh.position.set(...position); group.add(mesh); return mesh;
  };
  for (const name of ["devices", "memory", "cpu", "linux"]) {
    const layer = new THREE.Group(); layer.name = name; layers[name] = layer; model.add(layer);
  }
  layers.devices.position.y = -.85;
  slab(layers.devices, mats.board, [4,.12,2.75], [0,0,0]);
  // Thin, physically placed conductor traces on the lower virtual-device board.
  for (let i=0;i<12;i++) {
    slab(layers.devices,mats.line,[.016,.012,1.8],[i*.22-1.35,.068,.18]);
    slab(layers.devices,mats.line,[1.1,.012,.016],[i*.06-.7,.07,i*.135-.7]);
  }
  for (let i=0;i<5;i++) slab(layers.devices,mats.graphite,[.42,.18,.38],[-1.65,.16,i*.42-.9]);
  for (let i=0;i<4;i++) slab(layers.devices,mats.contact,[.42,.25,.25],[1.6,.17,i*.6-.88]);
  layers.memory.position.y = -.23;
  slab(layers.memory,mats.graphite,[3.32,.07,1.94],[0,0,0]);
  for(let i=0;i<8;i++) slab(layers.memory,mats.silicon,[.59,.12,.61],[(i%4)*.75-1.13,.09,Math.floor(i/4)*.83-.42]);
  layers.cpu.position.y = .5;
  slab(layers.cpu,mats.silicon,[2.5,.1,1.9],[0,-.03,0]);
  slab(layers.cpu,mats.chip,[1.65,.2,1.3],[0,.1,0]);
  // Instanced pins keep the mobile scene to a bounded number of draw calls.
  const pins = new THREE.InstancedMesh(box,mats.contact,80); const transform = new THREE.Object3D();
  for(let i=0;i<80;i++) {
    const side=Math.floor(i/20),p=(i%20)*.068-.65;
    transform.scale.set(side%2?.12:.026,.035,side%2?.026:.12);
    transform.position.set(side===1?.91:side===3?-.91:p,0,side===0?-.74:side===2?.74:p);
    transform.updateMatrix(); pins.setMatrixAt(i,transform.matrix);
  }
  layers.cpu.add(pins);
  layers.linux.position.y = 1.48;
  slab(layers.linux,mats.glass,[3.8,.045,2.6],[0,0,0]);
  // These textures label the solid model, rather than simulate a terminal screen.
  const labelTextures=[];
  function label(group,text,width,depth,x=0,z=0,color="#e9dcc4") {
    const bitmap=document.createElement("canvas"); bitmap.width=1024; bitmap.height=180;
    const context=bitmap.getContext("2d");
    context.fillStyle=color; context.font="500 65px monospace"; context.textAlign="center";
    context.fillText(text,512,108);
    const texture=new THREE.CanvasTexture(bitmap); texture.colorSpace=THREE.SRGBColorSpace; labelTextures.push(texture);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));
    mesh.rotation.x=-Math.PI/2; mesh.position.set(x,.212,z); group.add(mesh);
  }
  label(layers.cpu,"RV64GC",1.3,.28,0,0,"#2a2016");
  label(layers.linux,"LINUX / riscv64",3.05,.55,0,0);
  label(layers.memory,"RAM",.65,.14,0,0);
  label(layers.devices,"VIRTIO / INTERRUPTS / UART",2.3,.15,0,1.18);
  const homes=Object.fromEntries(Object.entries(layers).map(([k,v])=>[k,v.position.y]));
  // A physical annotation rail follows the selected layer in the 3D cutaway.
  // Selection uses both position and a bright edge so labels and color are not the only cues.
  const highlightMaterial = new THREE.LineBasicMaterial({color:0xe4a853,transparent:true,opacity:.9});
  const highlightGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(4.08,.15,2.84));
  const highlight = new THREE.LineSegments(highlightGeometry,highlightMaterial); model.add(highlight);
  let selected="cpu", stopped=reduced.matches, visible=true, alive=true, yaw=0, desiredYaw=0, dragging=false, previousX=0, raf=0, last=0;
  const motionButton=figure.querySelector(".model-motion");
  function updateMotionLabel(){motionButton.textContent=stopped?"Resume motion":"Pause motion";motionButton.setAttribute("aria-pressed",String(stopped));canvas.dataset.motion=stopped?"paused":"animated";}
  function draw(time=0) {
    if(!alive)return;
    if(visible&&!document.hidden&&(stopped||time-last>1000/30)) {
      last=time;
      yaw+= (desiredYaw-yaw)*.12;
      model.rotation.y=yaw+(stopped?0:Math.sin(time*.00012)*.05);
      model.rotation.z=-.035;
      for(const [name,layer] of Object.entries(layers))layer.position.y=homes[name]+(name===selected?.27:0);
      highlight.position.y=layers[selected].position.y;
      highlight.scale.set(selected==="cpu"?.62:selected==="memory"?.83:1,selected==="cpu"?1.8:1,selected==="cpu"?.68:selected==="memory"?.73:1);
      renderer.render(scene,camera);
      canvas.dataset.modelReady="true";
      canvas.dataset.selectedLayer=selected;
      canvas.dataset.meshDrawCalls=String(renderer.info.render.calls);
      canvas.dataset.modelTriangles=String(renderer.info.render.triangles);
    }
    if(!stopped&&visible&&!document.hidden)raf=requestAnimationFrame(draw);
  }
  function restart(){cancelAnimationFrame(raf);draw(performance.now());}
  function resize(){const {width,height}=canvas.getBoundingClientRect();if(width&&height){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();restart();}}
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(canvas);
  const visibilityObserver=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;restart();});visibilityObserver.observe(canvas);
  const onVisibility=()=>restart();document.addEventListener("visibilitychange",onVisibility);
  const onReduced=()=>{stopped=reduced.matches;updateMotionLabel();window.dispatchEvent(new CustomEvent("marketing-motion-change",{detail:{paused:stopped}}));restart();};reduced.addEventListener("change",onReduced);
  const onMotion=()=>{stopped=!stopped;updateMotionLabel();window.dispatchEvent(new CustomEvent("marketing-motion-change",{detail:{paused:stopped}}));restart();};motionButton.addEventListener("click",onMotion);
  const onLayer=(event)=>{
    const button=event.target.closest("[data-layer]");if(!button)return;
    const layer=describeLayer(figure,button);if(!layer)return;
    selected=layer;desiredYaw={cpu:0,memory:.13,devices:-.14,linux:.07}[selected];restart();
  };
  figure.querySelector(".model-controls").addEventListener("click",onLayer);
  const pointerDown=e=>{if(e.pointerType==="touch")return;dragging=true;previousX=e.clientX;canvas.setPointerCapture(e.pointerId);};
  const pointerMove=e=>{if(!dragging)return;desiredYaw=Math.max(-.45,Math.min(.45,desiredYaw+(e.clientX-previousX)*.004));previousX=e.clientX;restart();};
  const pointerUp=()=>{dragging=false;};
  canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);
  canvas.dataset.heroForeground="three-mesh-cutaway";updateMotionLabel();resize();
  return ()=>{alive=false;cancelAnimationFrame(raf);sizeObserver.disconnect();visibilityObserver.disconnect();document.removeEventListener("visibilitychange",onVisibility);reduced.removeEventListener("change",onReduced);motionButton.removeEventListener("click",onMotion);figure.querySelector(".model-controls").removeEventListener("click",onLayer);canvas.removeEventListener("pointerdown",pointerDown);canvas.removeEventListener("pointermove",pointerMove);canvas.removeEventListener("pointerup",pointerUp);canvas.removeEventListener("pointercancel",pointerUp);const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.isMesh||o.isLine){geometries.add(o.geometry);materials.add(o.material);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());labelTextures.forEach(t=>t.dispose());renderer.dispose();};
}
