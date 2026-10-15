// "Your Web": the user's knowledge as an orb web. Documents anchor the spokes, the capture
// spiral grows with every question, chats hang on it as dewdrops, and the sections they
// cited light up.
import * as THREE from "three";
import { motionReduced } from "./theme.js";
import { KIND, Nodes, Threads, nodeMaterial, orbWeb, paint, rng, threadMaterial } from "./threads.js";

const gsap = window.gsap;
const R = 10;

export function mountConstellation(canvas, data, { labels, avoid = [], onHover, onSelect } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const HOME = { z: 31, tilt: -0.42 };
  camera.position.set(0, 0, HOME.z);
  const group = new THREE.Group();
  group.rotation.x = HOME.tilt;
  scene.add(group);

  const rand = rng(42);
  const reduced = motionReduced();
  const start = reduced ? 1 : 0;
  const questions = data.stats.questions;
  const docs = data.documents;

  // ---- spokes: one per document, with frame spokes between them ----
  const nd = Math.max(docs.length, 1);
  const between = nd < 6 ? 3 : nd < 12 ? 2 : 1;
  const docAngle = (i) => -Math.PI / 2 + (i / nd) * Math.PI * 2;
  const angles = [];
  for (let i = 0; i < nd; i++) {
    for (let k = 0; k <= between; k++) angles.push(docAngle(i) + (k / (between + 1)) * ((Math.PI * 2) / nd));
  }
  const rings = Math.max(3, Math.min(22, 3 + Math.round(questions * 0.7)));

  const web = new Threads();
  orbWeb(web, { R, rings, angles, rand, broken: 0.04, sag: 0.06, shade: (r) => 0.95 - 0.45 * (r / R) });
  // frame threads and long anchor lines out into the dark
  angles.forEach((a, i) => {
    const b = angles[(i + 1) % angles.length];
    const p = [Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1, 0];
    const q = [Math.cos(b) * R * 1.1, Math.sin(b) * R * 1.1, 0];
    web.seg(p, q, 0.42, 0.46, 0.55);
    if (i % (between + 1) === 0 && rand() < 0.7) web.seg(p, [p[0] * 3.2, p[1] * 3.2, (rand() - 0.5) * 8], 0.4, 0.55, 0.4, 0);
  });
  const webMat = threadMaterial({ opacity: 0.5, reveal: start });
  group.add(new THREE.LineSegments(web.geometry(), webMat));

  // ---- nodes: hub, document anchors, sections ----
  const nodes = new Nodes();
  const picks = []; // index in `nodes` -> what it is
  nodes.add([0, 0, 0], { size: 40, kind: KIND.accent, alpha: 0.95, t: 0 });
  picks.push(null);
  nodes.add([0, 0, 0], { size: 14, kind: KIND.text, alpha: 1, t: 0 });
  picks.push(null);

  const sectionPos = new Map(); // "title|locator" -> Vector3
  const anchors = [];
  docs.forEach((doc, i) => {
    const a = docAngle(i);
    const anchor = new THREE.Vector3(Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1, 0);
    anchors.push({ doc, pos: anchor });
    nodes.add(anchor.toArray(), { size: 18, kind: KIND.text, alpha: 0.9, t: 0.38 });
    picks.push({ type: "doc", doc });
    const m = doc.sections.length;
    doc.sections.forEach((s, j) => {
      const r = R * (0.3 + (0.62 * (j + 1)) / (m + 1));
      const aj = a + (rand() - 0.5) * 0.06;
      const pos = new THREE.Vector3(Math.cos(aj) * r, Math.sin(aj) * r, (rand() - 0.5) * 0.3);
      sectionPos.set(`${doc.title}|${s.locator}`, pos);
      const lit = s.visits > 0;
      nodes.add(pos.toArray(), {
        size: lit ? 11 + 6 * Math.log2(1 + s.visits) : 5,
        kind: lit ? KIND.accentHi : KIND.web,
        alpha: lit ? 1 : 0.4,
        t: 0.25 + (r / R) * 0.55,
        phase: rand(),
      });
      picks.push({ type: "section", doc, section: s });
    });
  });
  const nodeMat = nodeMaterial({ perspective: true, scale: 30, twinkle: 0, reveal: start });
  const nodePoints = new THREE.Points(nodes.geometry(), nodeMat);
  group.add(nodePoints);

  // ---- chats: dewdrops along the spiral, tied to the sections they cited ----
  const chats = data.chats;
  const dew = new Nodes();
  const chatPos = new Map();
  const turns = Math.max(1, rings / 4);
  chats.forEach((chat, k) => {
    const f = (k + 1) / (chats.length + 1);
    const a = -Math.PI / 2 + f * turns * Math.PI * 2;
    const r = R * (0.16 + 0.76 * f);
    const pos = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.35 + rand() * 0.4);
    chatPos.set(chat.id, pos);
    dew.add(pos.toArray(), { size: 10, kind: KIND.text, alpha: 0.95, t: 0.3 + 0.6 * f, phase: rand() });
  });
  const dewMat = nodeMaterial({ perspective: true, scale: 30, twinkle: reduced ? 0 : 1, reveal: start });
  const dewPoints = new THREE.Points(dew.geometry(), dewMat);
  group.add(dewPoints);

  const tied = new Threads();
  chats.forEach((chat) => {
    const from = chatPos.get(chat.id);
    for (const key of chat.cited) {
      const to = sectionPos.get(key);
      if (to) tied.seg(from.toArray(), to.toArray(), 1, 1, 1);
    }
  });
  const tiedMat = threadMaterial({ opacity: reduced ? 0.14 : 0 });
  tiedMat.userData.kind = "accent";
  group.add(new THREE.LineSegments(tied.geometry(), tiedMat));

  // co-citations: sections cited in the same answer, joined by a strand bowed toward the hub
  const bonds = new Threads();
  const maxW = Math.max(1, ...data.edges.map((e) => e.weight));
  for (const e of data.edges) {
    const a = sectionPos.get(e.a);
    const b = sectionPos.get(e.b);
    if (!a || !b) continue;
    const c = a.clone().add(b).multiplyScalar(0.3);
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push(new THREE.Vector3().copy(a).multiplyScalar((1 - t) ** 2).add(c.clone().multiplyScalar(2 * (1 - t) * t)).add(b.clone().multiplyScalar(t * t)).toArray());
    }
    bonds.line(pts, 0.55, 0.95, 0.35 + 0.65 * (e.weight / maxW));
  }
  const bondMat = threadMaterial({ opacity: 0.8, reveal: start });
  bondMat.userData.kind = "accentHi";
  group.add(new THREE.LineSegments(bonds.geometry(), bondMat));

  // highlighted strands for the hovered chat
  const focusMat = threadMaterial({ opacity: 0.95 });
  focusMat.userData.kind = "accentHi";
  const focus = new THREE.LineSegments(new THREE.BufferGeometry(), focusMat);
  group.add(focus);

  // stars
  const stars = new Nodes();
  for (let i = 0; i < 420; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(45 + rand() * 60);
    stars.add(v.toArray(), { size: 1.4 + rand() * 2.2, kind: rand() < 0.15 ? KIND.accentHi : KIND.web, alpha: 0.3 + rand() * 0.5, t: 0, phase: rand() });
  }
  const starMat = nodeMaterial({ perspective: false, twinkle: reduced ? 0 : 1 });
  scene.add(new THREE.Points(stars.geometry(), starMat));

  // ---- labels for document anchors (DOM, so they stay crisp & readable) ----
  const labelEls = anchors.map(({ doc }) => {
    const el = document.createElement("div");
    el.className = "anchor-label";
    const lit = doc.sections.filter((s) => s.visits > 0).length;
    el.innerHTML = `<span class="anchor-title"></span><span class="anchor-meta">${lit}/${doc.sections.length} sections</span>`;
    el.firstChild.textContent = doc.title;
    el.classList.toggle("lit", lit > 0);
    labels?.append(el);
    return el;
  });

  // ---- render loop ----
  const all = { threads: [webMat, tiedMat, bondMat, focusMat], nodes: [nodeMat, dewMat, starMat], renderer };
  let playing = !reduced;
  let dirty = true;
  let time = 0;
  const v = new THREE.Vector3();

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  function placeLabels() {
    const rect = canvas.getBoundingClientRect();
    const blocked = avoid.filter((el) => el && !el.hidden).map((el) => el.getBoundingClientRect());
    group.updateMatrixWorld();
    anchors.forEach(({ pos }, i) => {
      v.copy(pos).multiplyScalar(1.2).applyMatrix4(group.matrixWorld).project(camera);
      let x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      const el = labelEls[i];
      const w = (el.offsetWidth || 120) / 2;
      const h = (el.offsetHeight || 34) / 2;
      x = Math.min(Math.max(x, w + 6), rect.width - w - 6); // keep labels on screen on narrow phones
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      const box = { left: rect.left + x - w, right: rect.left + x + w, top: rect.top + y - h, bottom: rect.top + y + h };
      // fade labels drifting under the title, legend or controls so text never collides
      el.style.opacity = v.z >= 1 ? "0" : blocked.some((b) => overlaps(box, b)) ? "0.12" : "";
    });
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = r.width / Math.max(1, r.height);
    const fit = camera.aspect < 0.8 ? 50 : camera.aspect < 1.3 ? 41 : 35;
    if (camera.position.z === HOME.z) camera.position.z = fit;
    HOME.z = fit;
    group.position.set(camera.aspect >= 1.3 ? 2.2 : 0, camera.aspect >= 1.3 ? -1 : 0, 0); // clear the title overlay
    camera.updateProjectionMatrix();
    dirty = true;
  }

  gsap.ticker.add((_, delta) => {
    const dt = delta / 1000;
    if (playing) {
      time += dt;
      group.rotation.z += dt * 0.035;
      for (const m of all.nodes) m.uniforms.uTime.value = time;
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      placeLabels();
      dirty = false;
    }
  });
  const markDirty = () => (dirty = true);

  // ---- intro: the web spins itself out ----
  let intro;
  function replay() {
    intro?.kill();
    if (motionReduced()) {
      for (const m of [webMat, nodeMat, dewMat, bondMat]) m.uniforms.uReveal.value = 1;
      tiedMat.uniforms.uOpacity.value = 0.14;
      dirty = true;
      return;
    }
    intro = gsap.timeline({ onUpdate: markDirty })
      .fromTo(camera.position, { z: HOME.z + 14 }, { z: HOME.z, duration: 3.2, ease: "power3.out" }, 0)
      .fromTo(webMat.uniforms.uReveal, { value: 0 }, { value: 1, duration: 3.2, ease: "power2.inOut" }, 0)
      .fromTo(nodeMat.uniforms.uReveal, { value: 0 }, { value: 1, duration: 2.6, ease: "power2.out" }, 0.5)
      .fromTo(dewMat.uniforms.uReveal, { value: 0 }, { value: 1, duration: 2.2, ease: "power2.out" }, 1.2)
      .fromTo(bondMat.uniforms.uReveal, { value: 0 }, { value: 1, duration: 1.8, ease: "power1.inOut" }, 1.8)
      .fromTo(tiedMat.uniforms.uOpacity, { value: 0 }, { value: 0.14, duration: 1.2 }, 2.4);
  }

  // ---- interaction: hover, click, drag, wheel, keys ----
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.5;
  const ndc = new THREE.Vector2();
  let hovered = null;

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([dewPoints, nodePoints], false);
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay);
    for (const h of hits) {
      if (h.object === dewPoints) return { type: "chat", chat: chats[h.index] };
      const p = picks[h.index];
      if (p) return p;
    }
    return null;
  }

  function highlightChat(id) {
    focus.geometry.dispose();
    const t = new Threads();
    const from = chatPos.get(id);
    const chat = chats.find((c) => c.id === id);
    if (from && chat) for (const key of chat.cited) if (sectionPos.has(key)) t.seg(from.toArray(), sectionPos.get(key).toArray());
    focus.geometry = t.geometry();
    dirty = true;
  }

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, rz: group.rotation.z, rx: group.rotation.x, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      group.rotation.z = drag.rz + dx * 0.006;
      group.rotation.x = Math.max(-1.1, Math.min(0.3, drag.rx + dy * 0.004));
      dirty = true;
      return;
    }
    const hit = pick(e);
    const same = hit && hovered && hit.type === hovered.type && (hit.chat || hit.section || hit.doc) === (hovered.chat || hovered.section || hovered.doc);
    if (!same) {
      hovered = hit;
      highlightChat(hit?.type === "chat" ? hit.chat.id : null);
      canvas.style.cursor = hit?.type === "chat" ? "pointer" : "";
    }
    onHover?.(hit, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerup", (e) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (!wasDrag) {
      const hit = pick(e);
      if (hit) onSelect?.(hit, e);
    }
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    highlightChat(null);
    onHover?.(null);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    camera.position.z = Math.max(16, Math.min(60, camera.position.z + e.deltaY * 0.02));
    dirty = true;
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.3 : 0.1;
    const keys = {
      ArrowLeft: () => (group.rotation.z -= step),
      ArrowRight: () => (group.rotation.z += step),
      ArrowUp: () => (group.rotation.x = Math.max(-1.1, group.rotation.x - step)),
      ArrowDown: () => (group.rotation.x = Math.min(0.3, group.rotation.x + step)),
      "+": () => (camera.position.z = Math.max(16, camera.position.z - 2)),
      "=": () => (camera.position.z = Math.max(16, camera.position.z - 2)),
      "-": () => (camera.position.z = Math.min(60, camera.position.z + 2)),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      dirty = true;
    }
  });

  new ResizeObserver(resize).observe(canvas);
  resize();
  paint(all);
  window.addEventListener("arachne:theme", () => {
    paint(all);
    dirty = true;
  });
  replay();

  return {
    replay,
    highlightChat,
    get playing() {
      return playing;
    },
    setPlaying(on) {
      playing = on && !motionReduced();
      dirty = true;
    },
    resetView() {
      gsap.to(group.rotation, { x: HOME.tilt, z: 0, duration: motionReduced() ? 0 : 0.8, ease: "power3.inOut", onUpdate: markDirty });
      gsap.to(camera.position, { z: HOME.z, duration: motionReduced() ? 0 : 0.8, ease: "power3.inOut", onUpdate: markDirty });
    },
  };
}
