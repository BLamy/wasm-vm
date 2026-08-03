// wasm-vm landing hero — a self-contained WebGL scene (core three.js only, no examples/jsm addons so
// it vendors as one file). Two layers composited additively for a AAA "silicon compute" feel:
//   1. a full-screen raymarched-feel fragment shader: an fbm nebula + a pulsing hex compute-lattice
//      in the brand cyan/teal/green, with mouse parallax and a soft vignette;
//   2. an instanced GPU particle "instruction pipeline": ~9k points swept along a twisting torus-knot
//      flow, additively blended so they bloom without a post pass, twinkling and drifting on scroll.
// Respects prefers-reduced-motion (renders a single calm frame) and falls back to a CSS gradient if
// WebGL is unavailable. Nothing here loads from the network — three is imported from the local vendor.
import * as THREE from "three";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initHero(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    document.body.classList.add("no-webgl");
    return () => {};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  // --- Layer 1: full-screen shader backdrop (a plane locked to the far view) ---
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uScroll: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; uniform float uScroll;

      // hash / value-noise / fbm
      float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5; mat2 m = mat2(1.6,1.2,-1.2,1.6);
        for(int i=0;i<6;i++){ v += a*noise(p); p = m*p; a *= 0.5; }
        return v;
      }
      // hex distance for the compute lattice
      float hexGrid(vec2 p){
        p *= 1.0;
        vec2 h = vec2(1.0, 1.7320508);
        vec2 a = mod(p, h) - h*0.5;
        vec2 b = mod(p + h*0.5, h) - h*0.5;
        vec2 g = dot(a,a) < dot(b,b) ? a : b;
        return length(g);
      }
      void main(){
        vec2 uv = vUv;
        vec2 p = (uv - 0.5); p.x *= uRes.x/uRes.y;
        vec2 par = uMouse * 0.06;                       // gentle parallax
        float t = uTime*0.03;

        // drifting nebula
        vec2 q = p*1.4 + par + vec2(t, -t*0.6);
        float n = fbm(q + fbm(q*1.7 + t)*0.8);
        float n2 = fbm(q*2.3 - t*1.4);

        // brand ramp: deep space -> teal -> cyan -> mint
        vec3 space = vec3(0.020, 0.028, 0.045);
        vec3 teal  = vec3(0.043, 0.176, 0.243);
        vec3 cyan  = vec3(0.325, 0.831, 1.000);        // #53d4ff
        vec3 mint  = vec3(0.180, 0.627, 0.263);        // #2ea043
        vec3 col = space;
        col = mix(col, teal, smoothstep(0.35, 0.85, n));
        col += cyan * pow(smoothstep(0.55, 1.0, n), 2.2) * 0.5;
        col += mint * pow(smoothstep(0.6, 1.0, n2), 3.0) * 0.28;

        // compute lattice: faint pulsing hex cells, denser toward center
        float hx = hexGrid((p*6.0) + par*2.0);
        float cell = smoothstep(0.06, 0.0, hx);
        float pulse = 0.5 + 0.5*sin(uTime*1.2 - length(p)*6.0);
        col += cyan * cell * (0.10 + 0.16*pulse) * smoothstep(1.1, 0.1, length(p));

        // scanning sweep of light
        float sweep = smoothstep(0.0, 0.15, abs(fract(uv.y*0.5 - uTime*0.05) - 0.5));
        col *= 0.9 + 0.1*(1.0-sweep);

        // vignette + subtle grain, fade as the page scrolls
        float vig = smoothstep(1.25, 0.25, length(p));
        col *= vig;
        col += (hash(uv+uTime)*0.03 - 0.015);
        col *= mix(1.0, 0.35, clamp(uScroll,0.0,1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }));
  const bgScene = new THREE.Scene();
  bgScene.add(bg);
  const bgCam = new THREE.Camera();

  // --- Layer 2: the "instruction pipeline" — points swept along a torus knot ---
  const COUNT = 9000;
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);       // per-particle phase
  const rad = new Float32Array(COUNT);        // tube radius offset
  for (let i = 0; i < COUNT; i++) {
    seed[i] = Math.random();
    rad[i] = Math.pow(Math.random(), 0.6);
    pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0; // set in shader
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aRad", new THREE.BufferAttribute(rad, 1));

  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uSize: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute float aRad;
      uniform float uTime; uniform float uScroll; uniform float uSize;
      varying float vGlow;
      // p,q torus knot
      vec3 knot(float u, float r){
        float pK = 2.0, qK = 3.0;
        float cu = cos(u), su = sin(u);
        float c2 = cos(qK*u), s2 = sin(qK*u);
        float R = 2.2 + 0.9*cos(pK*u);
        vec3 base = vec3(R*cu, R*su, 0.9*sin(pK*u));
        // fatten into a glowing tube using the per-particle radius + a swirl
        float a = u*3.0 + aSeed*6.2831;
        vec3 off = vec3(cos(a), sin(a), cos(a*0.5)) * r * 0.55;
        return base + off;
      }
      void main(){
        float speed = mix(0.12, 0.5, 1.0-uScroll);
        float u = (aSeed*6.2831) + uTime*speed*0.35;        // travel along the knot
        vec3 p = knot(u, aRad);
        // pull the whole flow apart slightly as you scroll (a "boot" bloom)
        p *= 1.0 + uScroll*0.5;
        vGlow = 0.4 + 0.6*pow(fract(aSeed + uTime*0.2), 3.0); // twinkle
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (18.0/-mv.z) * (0.5 + aRad) * (0.6 + vGlow);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vGlow;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float core = smoothstep(0.5, 0.0, r);
        float glow = pow(core, 2.5);
        vec3 cyan = vec3(0.325, 0.831, 1.0);
        vec3 mint = vec3(0.35, 0.85, 0.55);
        vec3 col = mix(mint, cyan, vGlow) * (0.6 + vGlow);
        gl_FragColor = vec4(col, glow);
      }
    `,
  }));
  scene.add(points);

  // --- interaction + resize ---
  const mouse = new THREE.Vector2(0, 0);
  const target = new THREE.Vector2(0, 0);
  let scroll = 0;
  addEventListener("pointermove", (e) => {
    target.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
  }, { passive: true });
  addEventListener("scroll", () => {
    scroll = Math.min(1, scrollY / (innerHeight * 0.9));
  }, { passive: true });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    bg.material.uniforms.uRes.value.set(w, h);
    points.material.uniforms.uSize.value = Math.min(devicePixelRatio, 2);
  }
  addEventListener("resize", resize); resize();

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    const t = clock.getElapsedTime();
    mouse.lerp(target, 0.05);
    bg.material.uniforms.uTime.value = t;
    bg.material.uniforms.uMouse.value.copy(mouse);
    bg.material.uniforms.uScroll.value = scroll;
    points.material.uniforms.uTime.value = t;
    points.material.uniforms.uScroll.value = scroll;

    // camera: slow auto-orbit + mouse parallax + scroll dolly
    const orbit = t * 0.06;
    camera.position.x = Math.sin(orbit) * 7 + mouse.x * 1.2;
    camera.position.y = Math.cos(orbit * 0.7) * 1.2 + mouse.y * 1.0;
    camera.position.z = 7 - scroll * 2.5;
    camera.lookAt(0, 0, 0);
    points.rotation.y = t * 0.05;
    points.rotation.z = t * 0.02;

    renderer.autoClear = false;
    renderer.clear();
    renderer.render(bgScene, bgCam);   // backdrop first
    renderer.render(scene, camera);    // additive pipeline on top
    if (!REDUCED) raf = requestAnimationFrame(frame);
  }
  frame();
  if (REDUCED) cancelAnimationFrame(raf);

  return () => { cancelAnimationFrame(raf); renderer.dispose(); };
}
