// Three.js web-line art: shared materials, an orb-web generator, the chat backdrop and the login orb.
import * as THREE from "three";
import { motionReduced, readTokens } from "./theme.js";

THREE.ColorManagement.enabled = false; // theme colours are sRGB hex; draw them as-is
const gsap = window.gsap;

// ---------- shaders ----------
const THREAD_VERT = /* glsl */ `
attribute float aT;
attribute float aShade;
uniform float uTime, uAmp, uScale, uReach;
uniform vec2 uOrigin;
uniform vec2 uDepth; // (near z, far z) in view space; equal values turn depth fading off
varying float vT;
varying float vShade;
void main() {
  vec3 p = position;
  vec2 d = p.xy - uOrigin;
  float r = length(d);
  if (uAmp > 0.0001 && r > 0.0001) {
    float wave = sin(uTime * 11.0 - r / uReach * 18.0) * (0.6 + 0.4 * sin(uTime * 5.0 + p.x * 0.05));
    float k = wave * uAmp * uScale * smoothstep(0.0, uReach * 0.6, r);
    p.xy += (d / r) * k;
    p.z += k * 0.5;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vT = aT;
  vShade = aShade;
  if (uDepth.x != uDepth.y) vShade *= mix(0.2, 1.0, smoothstep(uDepth.y, uDepth.x, mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const THREAD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uReveal;
varying float vT;
varying float vShade;
void main() {
  if (vT > uReveal) discard;
  float front = smoothstep(uReveal - 0.035, uReveal, vT) * step(uReveal, 0.999);
  gl_FragColor = vec4(uColor * (1.0 + front * 0.8), clamp(uOpacity * vShade * (1.0 + front * 1.5), 0.0, 1.0));
}`;

const NODE_VERT = /* glsl */ `
attribute float aSize;
attribute float aKind;
attribute float aAlpha;
attribute float aT;
attribute float aPhase;
uniform float uTime, uPixelRatio, uReveal, uTwinkle, uPerspective, uScale;
uniform vec3 uC0, uC1, uC2, uC3;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float show = smoothstep(aT, aT + 0.08, uReveal);
  float tw = 1.0 + uTwinkle * 0.3 * sin(uTime * 2.2 + aPhase * 6.2831);
  float persp = uPerspective > 0.5 ? uScale / -mv.z : 1.0;
  gl_PointSize = aSize * uPixelRatio * tw * show * persp;
  vColor = aKind < 0.5 ? uC0 : aKind < 1.5 ? uC1 : aKind < 2.5 ? uC2 : uC3;
  vAlpha = aAlpha * show;
  gl_Position = projectionMatrix * mv;
}`;

const NODE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.42, d);
  float halo = (1.0 - smoothstep(0.0, 1.0, d)) * 0.35;
  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * (1.0 + core * 0.35), clamp(a, 0.0, 1.0));
}`;

export const KIND = { web: 0, accent: 1, accentHi: 2, text: 3 };

export function threadMaterial({ opacity = 1, reveal = 1, scale = 1, reach = 1, depth = [0, 0], additive = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#ffffff") },
      uOpacity: { value: opacity },
      uReveal: { value: reveal },
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uScale: { value: scale },
      uReach: { value: reach },
      uOrigin: { value: new THREE.Vector2() },
      uDepth: { value: new THREE.Vector2(depth[0], depth[1]) },
    },
    vertexShader: THREAD_VERT,
    fragmentShader: THREAD_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export function nodeMaterial({ perspective = false, scale = 30, twinkle = 0, reveal = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(devicePixelRatio, 2) },
      uReveal: { value: reveal },
      uTwinkle: { value: twinkle },
      uPerspective: { value: perspective ? 1 : 0 },
      uScale: { value: scale },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
    },
    vertexShader: NODE_VERT,
    fragmentShader: NODE_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Push the current theme colours into thread/node materials. */
export function paint({ threads = [], nodes = [], renderer, threadKind = "web" }) {
  const t = readTokens();
  renderer?.setClearColor(t.bg);
  const byKind = { web: t.web, accent: t.accent, accentHi: t.accentHi, text: t.text };
  for (const m of threads) m.uniforms.uColor.value.set(byKind[m.userData.kind || threadKind]);
  for (const m of nodes) {
    m.uniforms.uC0.value.set(t.web);
    m.uniforms.uC1.value.set(t.accent);
    m.uniforms.uC2.value.set(t.accentHi);
    m.uniforms.uC3.value.set(t.text);
  }
  return t;
}

// ---------- geometry helpers ----------
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects line segments with a reveal time (aT) and a brightness (aShade) per vertex. */
export class Threads {
  constructor() {
    this.p = [];
    this.t = [];
    this.s = [];
  }
  seg(a, b, ta = 0, tb = ta, sa = 1, sb = sa) {
    this.p.push(a[0], a[1], a[2] || 0, b[0], b[1], b[2] || 0);
    this.t.push(ta, tb);
    this.s.push(sa, sb);
  }
  line(points, t0 = 0, t1 = 1, shade = 1) {
    const n = points.length - 1;
    const sh = (p) => (typeof shade === "function" ? shade(p) : shade);
    for (let i = 0; i < n; i++) {
      this.seg(points[i], points[i + 1], t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n, sh(points[i]), sh(points[i + 1]));
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute("aShade", new THREE.Float32BufferAttribute(this.s, 1));
    return g;
  }
}

/** Collects glowing points. */
export class Nodes {
  constructor() {
    this.p = [];
    this.size = [];
    this.kind = [];
    this.alpha = [];
    this.t = [];
    this.phase = [];
  }
  add([x, y, z = 0], { size = 4, kind = KIND.web, alpha = 1, t = 0, phase = Math.random() } = {}) {
    this.p.push(x, y, z);
    this.size.push(size);
    this.kind.push(kind);
    this.alpha.push(alpha);
    this.t.push(t);
    this.phase.push(phase);
    return this.size.length - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(this.alpha, 1));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(this.phase, 1));
    return g;
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * An orb web: radial spokes plus sagging capture rings, spun from the hub outward.
 * Returns the spoke angles so callers can hang things on them.
 */
export function orbWeb(b, {
  cx = 0, cy = 0, z = 0, R, spokes = 24, rings = 16, rand = Math.random, rotation = 0,
  broken = 0, sag = 0.05, shade = () => 1, t0 = 0, t1 = 1, ringScale = (k) => k, angles,
}) {
  const span = t1 - t0;
  const spokeAngles = angles || Array.from({ length: spokes }, (_, i) =>
    rotation + (i / spokes) * Math.PI * 2 + (rand() - 0.5) * ((Math.PI * 2) / spokes) * 0.35);
  const n = spokeAngles.length;
  const reach = spokeAngles.map(() => R * (0.94 + rand() * 0.16));
  const at = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];

  spokeAngles.forEach((a, i) => {
    const inner = at(a, R * 0.03);
    const outer = at(a, reach[i]);
    b.seg(inner, outer, t0, t0 + span * 0.4, shade(R * 0.03), shade(reach[i]));
  });

  for (let k = 1; k <= rings; k++) {
    const f = ringScale(k / rings);
    const r = R * (0.07 + 0.88 * f ** 1.12);
    for (let i = 0; i < n; i++) {
      if (rand() < broken) continue;
      const a0 = spokeAngles[i];
      const a1 = spokeAngles[(i + 1) % n] + (i + 1 === n ? Math.PI * 2 : 0);
      const r0 = r * (1 + (rand() - 0.5) * 0.04);
      const r1 = r * (1 + (rand() - 0.5) * 0.04);
      const mid = at((a0 + a1) / 2, ((r0 + r1) / 2) * Math.cos((a1 - a0) / 2) * (1 - sag));
      const t = t0 + span * (0.3 + 0.62 * f + 0.06 * (i / n));
      b.line([at(a0, r0), mid, at(a1, r1)], t, t + span * 0.02, shade(r));
    }
  }
  return spokeAngles;
}

// ---------- shared renderer plumbing ----------
function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  return renderer;
}

function sizeOf(canvas) {
  const r = canvas.getBoundingClientRect();
  return [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))];
}

// ---------- chat backdrop ----------
export function mountAmbientWeb(canvas) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
  const lines = threadMaterial({ opacity: 0.22, reveal: motionReduced() ? 1 : 0 });
  const dots = nodeMaterial({ reveal: motionReduced() ? 1 : 0 });
  let meshes = [];
  let dirty = true;
  let time = 0;

  function build() {
    const [w, h] = sizeOf(canvas);
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: 0, right: w, top: 0, bottom: -h });
    camera.updateProjectionMatrix();
    meshes.forEach((m) => {
      scene.remove(m);
      m.geometry.dispose();
    });

    const rand = rng(7);
    const R = Math.max(w, h) * 0.62;
    const A = [w * 0.97, -h * 0.03];
    const B = [w * 0.01, -h * 1.02];
    const b = new Threads();
    const fade = (cx, cy, r0, r1) => (p) => 1 - 0.8 * smooth(r0, r1, Math.hypot(p[0] - cx, p[1] - cy));
    orbWeb(b, { cx: A[0], cy: A[1], R, spokes: 28, rings: 20, rand, rotation: 0.2, broken: 0.1,
      shade: (r) => 1 - 0.78 * smooth(R * 0.4, R * 1.05, r) });
    orbWeb(b, { cx: B[0], cy: B[1], R: R * 0.42, spokes: 18, rings: 11, rand, rotation: 1.1, broken: 0.2,
      shade: (r) => 0.7 - 0.55 * smooth(R * 0.15, R * 0.45, r), t0: 0.15 });
    // shattered-glass cracks around the main hub
    for (let i = 0; i < 16; i++) {
      let a = rand() * Math.PI * 2;
      let r = R * 0.02;
      const pts = [[A[0] + Math.cos(a) * r, A[1] + Math.sin(a) * r]];
      for (let k = 0; k < 5; k++) {
        a += (rand() - 0.5) * 0.7;
        r += R * (0.02 + rand() * 0.05);
        pts.push([A[0] + Math.cos(a) * r, A[1] + Math.sin(a) * r]);
      }
      b.line(pts, 0, 0.3, fade(A[0], A[1], R * 0.1, R * 0.4));
    }
    // stray threads anchoring the web to the page edges
    for (let i = 0; i < 5; i++) {
      const p = [rand() * w * 0.6, -h * (0.05 + rand() * 0.2)];
      const q = [w * (0.3 + rand() * 0.7), -h * (0.7 + rand() * 0.4)];
      b.seg(p, q, 0.2, 0.75, 0.45, 0.12);
    }
    const web = new THREE.LineSegments(b.geometry(), lines);

    const n = new Nodes();
    const step = 11;
    for (const [cx, cy, rr, scale] of [[A[0], A[1], R * 0.55, 4.6], [B[0], B[1], R * 0.28, 3.4]]) {
      for (let x = cx - rr; x <= cx + rr; x += step) {
        for (let y = cy - rr; y <= cy + rr; y += step) {
          const d = Math.hypot(x - cx, y - cy) / rr;
          if (d >= 1 || x < -step || x > w + step || y > step || y < -h - step) continue;
          n.add([x, y], { size: scale * (1 - d) ** 1.6, kind: KIND.web, alpha: 0.5, t: d * 0.8 });
        }
      }
    }
    const halftone = new THREE.Points(n.geometry(), dots);

    lines.uniforms.uOrigin.value.set(A[0], A[1]);
    lines.uniforms.uScale.value = 7;
    lines.uniforms.uReach.value = R;
    meshes = [halftone, web];
    scene.add(halftone, web);
    dirty = true;
  }

  const recolor = () => {
    paint({ threads: [lines], nodes: [dots], renderer });
    dirty = true;
  };

  const tick = (_, delta) => {
    time += delta / 1000;
    const moving = lines.uniforms.uAmp.value > 0.001;
    if (moving) lines.uniforms.uTime.value = time;
    if (moving || dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  };

  let resizeTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 120);
  });

  build();
  recolor();
  ro.observe(canvas);
  gsap.ticker.add(tick);
  window.addEventListener("arachne:theme", recolor);

  const markDirty = () => (dirty = true);
  if (!motionReduced()) {
    gsap.to([lines.uniforms.uReveal, dots.uniforms.uReveal], { value: 1, duration: 2.4, ease: "power2.out", onUpdate: markDirty });
    const qx = gsap.quickTo(camera.position, "x", { duration: 1.2, ease: "power3.out", onUpdate: markDirty });
    const qy = gsap.quickTo(camera.position, "y", { duration: 1.2, ease: "power3.out", onUpdate: markDirty });
    window.addEventListener("pointermove", (e) => {
      if (motionReduced()) return;
      qx((e.clientX / innerWidth - 0.5) * -14);
      qy((e.clientY / innerHeight - 0.5) * 10);
    });
  }

  return {
    /** The web trembles while Arachne is working on an answer. */
    tremor(on) {
      if (motionReduced()) return;
      gsap.to(lines.uniforms.uAmp, { value: on ? 1 : 0, duration: on ? 0.5 : 1.4, ease: on ? "power2.out" : "power3.out", overwrite: true, onUpdate: markDirty });
    },
  };
}

// ---------- login orb: a Gleason-style ball of web strands around the arachne ----------
export function mountOrb(canvas) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  const group = new THREE.Group();
  group.rotation.x = 0.35;
  scene.add(group);

  const reduced = motionReduced();
  const R = 2.2;
  const rand = rng(11);
  const strands = new Threads();
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let s = 0; s < 170; s++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    dir.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    dir.sub(v.clone().multiplyScalar(dir.dot(v))).normalize();
    const radius = R * (0.95 + rand() * 0.12);
    const steps = 25 + Math.floor(rand() * 70);
    const pts = [];
    for (let k = 0; k < steps; k++) {
      pts.push([v.x * radius, v.y * radius, v.z * radius]);
      axis.crossVectors(v, dir).normalize();
      v.applyAxisAngle(axis, 0.045 + rand() * 0.035);
      dir.applyAxisAngle(v, (rand() - 0.5) * 0.55);
      dir.sub(v.clone().multiplyScalar(dir.dot(v))).normalize();
    }
    const t0 = rand() * 0.55;
    strands.line(pts, t0, t0 + 0.28 + rand() * 0.15, 1);
  }
  // threads hanging the orb to the edges of the frame
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.4;
    const d = [Math.cos(a), Math.sin(a), (rand() - 0.5) * 0.4];
    strands.seg(d.map((x) => x * R), d.map((x) => x * R * 7), 0.05, 0.45, 0.8, 0.05);
  }
  const strandMat = threadMaterial({ opacity: 0.55, reveal: reduced ? 1 : 0, depth: [-7.6, -12.4] });
  group.add(new THREE.LineSegments(strands.geometry(), strandMat));

  // HUD rings: dashed orbits around the orb
  const hud = new Threads();
  for (const [r, tilt] of [[R * 1.38, 0.2], [R * 1.62, -0.35]]) {
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * Math.cos(tilt), Math.sin(a) * r * Math.sin(tilt)]);
    }
    for (let i = 0; i < pts.length - 1; i += 2) hud.seg(pts[i], pts[i + 1], 0.55 + (i / pts.length) * 0.35, 0.56 + (i / pts.length) * 0.35, 0.5);
  }
  const hudMat = threadMaterial({ opacity: 0.45, reveal: reduced ? 1 : 0 });
  hudMat.userData.kind = "accentHi";
  group.add(new THREE.LineSegments(hud.geometry(), hudMat));

  const n = new Nodes();
  n.add([0, 0, 0], { size: 150, kind: KIND.accent, alpha: 0.9, t: 0.35 });
  n.add([0, 0, 0], { size: 34, kind: KIND.text, alpha: 1, t: 0.4 });
  for (let i = 0; i < 110; i++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(R * (0.97 + rand() * 0.08));
    n.add([v.x, v.y, v.z], { size: 3 + rand() * 5, kind: KIND.accentHi, alpha: 0.85, t: 0.3 + rand() * 0.6, phase: rand() });
  }
  const nodeMat = nodeMaterial({ perspective: true, scale: 10, twinkle: reduced ? 0 : 1, reveal: reduced ? 1 : 0 });
  group.add(new THREE.Points(n.geometry(), nodeMat));

  const resize = () => {
    const [w, h] = sizeOf(canvas);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 0.9 ? 12.5 : 10;
    camera.updateProjectionMatrix();
    if (reduced) renderer.render(scene, camera);
  };
  const recolor = () => {
    paint({ threads: [strandMat, hudMat], nodes: [nodeMat], renderer });
    if (motionReduced()) renderer.render(scene, camera);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  recolor();
  window.addEventListener("arachne:theme", recolor);

  let playing = !reduced;
  const controls = {
    get playing() {
      return playing;
    },
    setPlaying(on) {
      playing = on && !motionReduced();
    },
  };
  if (reduced) {
    renderer.render(scene, camera);
    return controls;
  }
  gsap.timeline()
    .to(strandMat.uniforms.uReveal, { value: 1, duration: 3, ease: "power2.out" })
    .to(nodeMat.uniforms.uReveal, { value: 1, duration: 2.2, ease: "power2.out" }, 0.4)
    .to(hudMat.uniforms.uReveal, { value: 1, duration: 1.8, ease: "power1.inOut" }, 1);
  const tiltX = gsap.quickTo(group.rotation, "x", { duration: 1.4, ease: "power3.out" });
  const tiltZ = gsap.quickTo(group.rotation, "z", { duration: 1.4, ease: "power3.out" });
  window.addEventListener("pointermove", (e) => {
    tiltX(0.35 + (e.clientY / innerHeight - 0.5) * 0.4);
    tiltZ((e.clientX / innerWidth - 0.5) * -0.25);
  });
  let time = 0;
  gsap.ticker.add((_, delta) => {
    if (playing) {
      time += delta / 1000;
      group.rotation.y += (delta / 1000) * 0.12;
      nodeMat.uniforms.uTime.value = time;
    }
    renderer.render(scene, camera);
  });
  return controls;
}
