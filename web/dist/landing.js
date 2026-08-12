// wasm-vm landing hero — a self-contained WebGL background (core three.js only, no examples/jsm
// addons so it vendors as one file): a full-screen raymarched-feel fragment shader with an fbm
// nebula and pulsing hex compute-lattice in the brand cyan/teal/green.
// Respects prefers-reduced-motion (renders a single calm frame) and falls back to a CSS gradient if
// WebGL is unavailable. Nothing here loads from the network — three is imported from the local vendor.
import * as THREE from "three";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Mobile / touch: fewer particles + a lower pixel-ratio cap so the shader stays smooth and easy on the
// battery on phones (the fragment shader is the cost driver — halving the pixel ratio ~halves its work).
const MOBILE = matchMedia("(max-width: 820px), (pointer: coarse)").matches;

export function initHero(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, alpha: true, powerPreference: "high-performance" });
  } catch {
    document.body.classList.add("no-webgl");
    return () => {};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);

  // Full-screen shader backdrop (a plane locked to the far view).
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
  canvas.dataset.heroBackground = "shader-active";
  canvas.dataset.heroForeground = "none";

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
    bg.material.uniforms.uRes.value.set(w, h);
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
    renderer.render(bgScene, bgCam);
    if (!REDUCED) raf = requestAnimationFrame(frame);
  }
  frame();
  if (REDUCED) cancelAnimationFrame(raf);

  return () => { cancelAnimationFrame(raf); renderer.dispose(); };
}
