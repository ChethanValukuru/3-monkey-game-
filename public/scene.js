// Low-poly 3D kitchen for Three Cooks. A shared stage with three monkey-chefs
// that actually walk around and cook: grab jars, carry them, pour, stir, light
// the stove, plate the dish — and slap each other when a move goes wrong.
import * as THREE from './vendor/three.module.js';
import * as sfx from './sfx.js';

const ROLE_COLOR = { deaf: 0xff914d, blind: 0x6c7a89, mute: 0x2fa39b };
const SKIN = 0x7a4a2b, MUZZLE = 0xd9a874, HAT = 0xf4efe6, DARK = 0x241c16;
const INGREDIENT_COLOR = {
  flour: 0xefe3c8, egg: 0xf3c646, milk: 0xf2f4f7, sugar: 0xffffff,
  butter: 0xffd98a, salt: 0xdfe7ee, cocoa: 0x5b3a29, banana: 0xffe135, cheese: 0xffc64a,
};
const STANDS = { blind: -3.2, mute: 0, deaf: 3.2 };
const POT = new THREE.Vector3(0, 0, -1.0);

const lerp = (a, b, p) => a + (b - a) * p;
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
}
function jarGridPos(pos) {
  const col = (pos - 1) % 3, row = Math.floor((pos - 1) / 3);
  return { x: (col - 1) * 1.9, y: 4.3 - row * 1.15, z: -5.2 };
}
// position/scale a mesh inline (position & scale are read-only Vector3s in three.js)
function place(mesh, p, s) { mesh.position.set(p[0], p[1], p[2]); if (s) mesh.scale.set(s[0], s[1], s[2]); return mesh; }

export class Kitchen3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.role = 'mute';
    this.monkeys = {};
    this.jars = {};
    this.fx = [];
    this.clock = new THREE.Clock();
    this.labelsVisible = false;
    this.fillCount = 0;
    this.liquidColor = new THREE.Color(0x6b4a33);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  mount() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a211b);
    scene.fog = new THREE.Fog(0x2a211b, 16, 34);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff2e0, 0x30241a, 0.9));
    const key = new THREE.DirectionalLight(0xffd9a8, 1.1); key.position.set(4, 9, 7); scene.add(key);
    const warm = new THREE.PointLight(0xff7a3a, 0.7, 16); warm.position.set(0, 2.6, -0.5); scene.add(warm);
    this.warmLight = warm;

    this._buildRoom();
    this._buildStoveAndPot();
    this._buildShelf();
    for (const role of ['blind', 'mute', 'deaf']) {
      const m = this._buildMonkey(role);
      m.position.set(STANDS[role], 0, -3.1);
      m.userData.homeX = STANDS[role]; m.userData.homeZ = -3.1;
      m.userData.phase = Math.random() * Math.PI * 2;
      scene.add(m); this.monkeys[role] = m;
    }
    this.setRole(this.role);
    this.resize();
    addEventListener('resize', () => this.resize());
    const loop = () => { this._frame = requestAnimationFrame(loop); this._tick(); };
    loop();
  }

  // ---------------------------------------------------------------- static world
  _buildRoom() {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 0.4, 20), mat(0x6b4a33));
    floor.position.set(0, -0.2, -4); this.scene.add(floor);
    for (let i = -5; i <= 5; i++) for (let j = -4; j <= 3; j++) {
      if ((i + j) % 2) continue;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 1.9), mat(0x7d5a40));
      t.position.set(i * 2, 0.02, -4 + j * 2); this.scene.add(t);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 0.4), mat(0x8f5d3a)); back.position.set(0, 5, -6); this.scene.add(back);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 20), mat(0x7a4f32)); sideL.position.set(-12, 5, -4); this.scene.add(sideL);
    const sideR = sideL.clone(); sideR.position.x = 12; this.scene.add(sideR);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.6), mat(0xcdb48c)); counter.position.set(0, 0.7, -1.0); this.scene.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.2, 1.8), mat(0xe6d4ad)); top.position.set(0, 1.45, -1.0); this.scene.add(top);
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 0.2), mat(0x24302a)); board.position.set(-8.4, 4.4, -5.7); this.scene.add(board);
    // hanging pan decor
    for (let i = 0; i < 3; i++) {
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 10), mat(0x3a3b44, { metalness: 0.5, roughness: 0.4 }));
      pan.rotation.x = Math.PI / 2; pan.position.set(6 + i * 1.1, 6.2, -5.6); this.scene.add(pan);
    }
  }

  _buildStoveAndPot() {
    const stove = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.5), mat(0x3b3b44)); stove.position.set(0, 1.75, -1.0); this.scene.add(stove);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 8), mat(0xd94a3b));
    knob.rotation.x = Math.PI / 2; knob.position.set(0.95, 2.0, -0.3); this.scene.add(knob); this.knob = knob;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.62, 0.9, 14), mat(0x30333a, { metalness: 0.4, roughness: 0.5 }));
    pot.position.set(POT.x, 2.42, POT.z); this.scene.add(pot); this.pot = pot;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 6, 18), mat(0x5a5f68, { metalness: 0.5 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(POT.x, 2.86, POT.z); this.scene.add(rim);
    // liquid inside
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.58, 1, 14), mat(0x6b4a33, { roughness: 0.3, metalness: 0.1 }));
    this.liquid.position.set(POT.x, 2.1, POT.z); this.liquid.scale.y = 0.01; this.liquid.visible = false; this.scene.add(this.liquid);
    // steam
    this.steam = new THREE.Group(); this.steam.position.set(POT.x, 2.9, POT.z); this.scene.add(this.steam);
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, flatShading: true }));
      puff.userData.off = i / 6; this.steam.add(puff);
    }
    this.steam.visible = false;
    // flames
    this.flames = new THREE.Group(); this.flames.position.set(POT.x, 2.0, POT.z);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.4, flatShading: true }));
      f.position.set((Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 0.6); this.flames.add(f);
    }
    this.flames.visible = false; this.scene.add(this.flames);
    // plated dish (hidden until serve)
    this.dish = new THREE.Group(); this.dish.position.set(POT.x, 1.6, POT.z + 0.0); this.dish.visible = false; this.scene.add(this.dish);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 0.08, 16), mat(0xf2efe6)); this.dish.add(plate);
  }

  _buildShelf() {
    const shelfMat = mat(0x9a6a44);
    for (let row = 0; row < 3; row++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.18, 0.7), shelfMat);
      plank.position.set(0, 3.72 - row * 1.15, -5.5); this.scene.add(plank);
    }
    for (let pos = 1; pos <= 9; pos++) {
      const p = jarGridPos(pos);
      const jar = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.62, 10), mat(0x8891a0, { transparent: true, opacity: 0.92 }));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10), mat(0x53392a)); lid.position.y = 0.37;
      jar.add(body, lid); jar.position.set(p.x, p.y, p.z);
      body.userData.pos = pos;
      // generous invisible hit-target so tapping near the jar still registers (phones!)
      const pick = new THREE.Mesh(new THREE.SphereGeometry(0.85, 6, 5), new THREE.MeshBasicMaterial({ visible: false }));
      pick.userData.pos = pos; jar.add(pick);
      jar.userData = { body, pos, pick, baseScale: 1, homeY: p.y };
      const label = this._makeLabel(''); label.position.set(p.x, p.y + 0.78, p.z + 0.1); label.visible = false;
      this.scene.add(label); jar.userData.label = label;
      this.scene.add(jar); this.jars[pos] = jar;
    }
    // "pointing" arrow shown over a jar the Mute cook taps (seen by the Deaf cook)
    this.pointArrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.44, 5),
      new THREE.MeshStandardMaterial({ color: 0xff914d, emissive: 0xff5a00, emissiveIntensity: 1.1, flatShading: true }));
    this.pointArrow.rotation.x = Math.PI; this.pointArrow.visible = false;
    this.scene.add(this.pointArrow);
  }

  _makeLabel() {
    const W = 400, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const draw = (num, name) => {
      ctx.clearRect(0, 0, W, H);
      // pill background
      ctx.fillStyle = 'rgba(16,12,8,0.94)'; ctx.beginPath(); ctx.roundRect(6, 22, W - 12, 84, 26); ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = 4; ctx.stroke();
      // number badge
      ctx.fillStyle = '#ff914d'; ctx.beginPath(); ctx.arc(62, 64, 36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a1708'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(num, 62, 66);
      // ingredient name
      ctx.fillStyle = '#ffe9cf'; ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(name, 114, 66);
    };
    draw('', ' ');
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(2.0, 0.64, 1); spr.userData = { ctx, tex, draw };
    return spr;
  }

  // ---------------------------------------------------------------- monkey chef
  _buildMonkey(role) {
    const g = new THREE.Group();
    const skin = mat(SKIN);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.0, 10), mat(ROLE_COLOR[role])); body.position.y = 1.1; g.add(body);
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), mat(0xefe7da)); bib.position.set(0, 1.25, 0.58); g.add(bib);

    const head = new THREE.Group(); head.position.y = 2.15;
    head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 0), skin));
    const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(MUZZLE)); muzzle.position.set(0, -0.18, 0.62); muzzle.scale.set(1.1, 0.8, 0.8); head.add(muzzle);
    head.add(place(new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(DARK)), [0, -0.1, 0.98]));
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), skin); ear.position.set(sx * 0.74, 0.1, 0); ear.scale.set(0.6, 1, 0.5); head.add(ear);
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mat(MUZZLE)); inner.position.set(sx * 0.8, 0.1, 0.06); inner.scale.set(0.5, 0.9, 0.4); head.add(inner);
    }
    const eyes = [];
    for (const sx of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0xffffff, { roughness: 0.4 })); white.position.set(sx * 0.26, 0.12, 0.64); head.add(white);
      const pup = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(DARK)); pup.position.set(sx * 0.26, 0.12, 0.78); head.add(pup);
      eyes.push(white);
    }
    head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.58, 0.28, 12), mat(HAT)), [0, 0.66, 0]));
    head.add(place(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), mat(HAT)), [0, 0.95, 0]));
    if (role === 'deaf') {
      const bandTop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 6, 16, Math.PI), mat(DARK)); bandTop.rotation.x = Math.PI / 2; bandTop.rotation.z = Math.PI; bandTop.position.y = 0.2; head.add(bandTop);
      for (const sx of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 10), mat(0x3a2d22)); cup.rotation.z = Math.PI / 2; cup.position.set(sx * 0.82, 0.05, 0); head.add(cup); }
    } else if (role === 'blind') {
      head.add(place(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.3), mat(0x1b1f26)), [0, 0.14, 0.6]));
    } else {
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.2), mat(0xd65a4a)); tape.position.set(0, -0.26, 0.82); tape.rotation.z = 0.12; head.add(tape);
      const tape2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.18), mat(0xe8776a)); tape2.position.set(0, -0.26, 0.83); tape2.rotation.z = 0.12; head.add(tape2);
    }
    g.add(head);

    const arms = {}; const hands = {};
    for (const side of ['left', 'right']) {
      const sx = side === 'left' ? -1 : 1;
      const arm = new THREE.Group(); arm.position.set(sx * 0.56, 1.5, 0);
      arm.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.8, 8), skin), [0, -0.4, 0]));
      const hand = new THREE.Group(); hand.position.y = -0.82;
      hand.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), mat(MUZZLE)));
      arm.add(hand); g.add(arm); arms[side] = arm; hands[side] = hand;
    }
    const legs = {};
    for (const side of ['left', 'right']) {
      const sx = side === 'left' ? -1 : 1;
      const leg = new THREE.Group(); leg.position.set(sx * 0.25, 0.62, 0);
      leg.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 8), skin), [0, -0.3, 0]));
      leg.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.5), mat(MUZZLE)), [0, -0.56, 0.12]));
      g.add(leg); legs[side] = leg;
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 6, 12, Math.PI * 1.2), skin); tail.position.set(0, 0.8, -0.5); tail.rotation.x = Math.PI / 2; tail.rotation.z = 0.5; g.add(tail);

    g.userData = { role, head, arms, hands, legs, eyes, tail, baseY: 0, seq: null, carried: null, blink: Math.random() * 4, recoil: null, recoilDir: 1 };
    return g;
  }

  // ---------------------------------------------------------------- per role view
  setRole(role) {
    this.role = role; this.labelsVisible = role === 'mute';
    for (const pos in this.jars) {
      const jar = this.jars[pos];
      jar.userData.label.visible = this.labelsVisible && !!jar.userData.label.userData.hasText;
      if (role !== 'mute') jar.userData.body.material.color.setHex(0x8891a0);
    }
    if (role === 'deaf') { this.camera.position.set(0.5, 4.2, 10.5); this._look = new THREE.Vector3(0, 2.3, -1.5); }
    else if (role === 'blind') { this.camera.position.set(0, 4, 10); this._look = new THREE.Vector3(0, 2.2, -2); }
    else { this.camera.position.set(0, 4.6, 11); this._look = new THREE.Vector3(0, 2.1, -2.3); }
  }

  update(view) {
    if (view.shelf) {
      for (const slot of view.shelf) {
        const jar = this.jars[slot.pos]; if (!jar) continue;
        const key = slot.label.toLowerCase();
        jar.userData.body.material.color.setHex(INGREDIENT_COLOR[key] ?? 0xd9c7a0);
        const lbl = jar.userData.label;
        lbl.userData.draw(String(slot.pos), slot.label); lbl.userData.tex.needsUpdate = true;
        lbl.userData.hasText = true; lbl.visible = this.labelsVisible;
      }
    }
    if (typeof view.heat === 'string') this._setHeat(view.heat);
    if (view.won) this._serveDish();
  }

  // Mute taps the canvas -> which jar (position) did they point at?
  pickJarAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = Object.values(this.jars).filter((j) => j.visible).map((j) => j.userData.pick);
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].object.userData.pos : null;
  }

  // Deaf (and Mute) sees the pointed jar glow, lift, and reveal its number + arrow.
  highlightJar(pos) {
    const jar = this.jars[pos]; if (!jar) return;
    jar.userData.highlightUntil = this.clock.elapsedTime + 4.5;
    if (!this.labelsVisible) { // Deaf: reveal just the number on this jar
      const lbl = jar.userData.label;
      lbl.userData.draw(String(pos), ''); lbl.userData.tex.needsUpdate = true;
      lbl.visible = true; lbl.userData.temp = true;
    }
    this.pointArrow.position.set(jar.position.x, jar.position.y + 0.95, jar.position.z + 0.1);
    this.pointArrow.visible = true;
    this.pointArrow.userData.until = this.clock.elapsedTime + 4.5;
  }

  clearPot() {
    this.fillCount = 0; this.liquid.scale.y = 0.01; this.liquid.visible = false;
    this.liquidColor.setHex(0x6b4a33); this.liquid.material.color.copy(this.liquidColor);
    this.dish.visible = false; this.dish.rotation.set(0, 0, 0);
    while (this.dish.children.length > 1) this.dish.remove(this.dish.children[this.dish.children.length - 1]);
    this._setHeat('off');
  }

  _setHeat(level) {
    const n = { off: 0, low: 1, med: 2, high: 3 }[level] ?? 0;
    this.flames.visible = n > 0; this.flames.userData = { intensity: n };
    this.steam.visible = n > 0 && this.fillCount > 0;
    this.warmLight.intensity = 0.7 + n * 0.5;
    this._heat = n;
    if (n > 0 && this.fillCount > 0) sfx.startSizzle(); else sfx.stopSizzle();
  }

  // ---------------------------------------------------------------- results -> actions
  onResult(ev) {
    const act = ev.act || {};
    if (ev.ok) {
      if (act.kind === 'grab') this.doGrab(act.pos, act.ingredient);
      else if (act.kind === 'stir') this.doStir();
      else if (act.kind === 'heat') this.doHeat(act.level);
      else if (act.kind === 'serve') this.doServe();
      else this._cheer();
    } else {
      this.doWrong(act);
    }
  }

  _frontOfJar(pos) { const p = jarGridPos(pos); return { x: p.x, z: -4.2 }; }

  doGrab(pos, ingredient) {
    const m = this.monkeys.blind; if (!m) return;
    const color = INGREDIENT_COLOR[ingredient] ?? 0xd9c7a0;
    const jarSpot = this._frontOfJar(pos);
    const u = m.userData;
    this._queue(m, [
      this._walk(m, jarSpot.x, jarSpot.z, 0.75),
      { dur: 0.45, enter: () => { sfx.play('click'); this._hideShelfJar(pos, true); u.carried = this._makeCarried(color); u.hands.right.add(u.carried); },
        fn: (p) => { u.arms.right.rotation.x = -2.2 * Math.sin(p * Math.PI * 0.5); } },
      this._walk(m, POT.x + 0.1, -2.2, 0.75, true),
      { dur: 0.7, enter: () => sfx.play('pour'),
        fn: (p) => { u.arms.right.rotation.x = -1.7; if (u.carried) u.carried.rotation.z = -1.2 * Math.sin(p * Math.PI); this._pourStream(color, p); },
        exit: () => { if (u.carried) { u.hands.right.remove(u.carried); u.carried = null; } u.arms.right.rotation.x = 0; this._dropIngredient(color); this._hideShelfJar(pos, false); } },
      this._walk(m, u.homeX, u.homeZ, 0.7),
    ]);
    this._cheer(['mute', 'deaf'], 0.2);
  }

  doStir() {
    const m = this.monkeys.blind; if (!m) return; const u = m.userData;
    const spoon = this._makeSpoon();
    this._queue(m, [
      this._walk(m, POT.x - 0.2, -2.2, 0.6),
      { dur: 1.2, enter: () => { u.hands.right.add(spoon); }, fn: (p) => {
          u.arms.right.rotation.x = -1.4 + 0.3 * Math.sin(p * Math.PI * 6);
          u.arms.right.rotation.z = 0.5 * Math.sin(p * Math.PI * 6);
          this.liquid.rotation.y = p * Math.PI * 8;
          if (Math.random() < 0.08) sfx.play('stir');
        }, exit: () => { u.hands.right.remove(spoon); u.arms.right.rotation.set(0, 0, 0); } },
      this._walk(m, u.homeX, u.homeZ, 0.6),
    ]);
  }

  doHeat(level) {
    const m = this.monkeys.blind; if (!m) return; const u = m.userData;
    this._queue(m, [
      this._walk(m, 0.9, -2.3, 0.6),
      { dur: 0.5, enter: () => sfx.play('knob'), fn: (p) => { u.arms.right.rotation.x = -1.3 * Math.sin(p * Math.PI); this.knob.rotation.z = p * Math.PI; },
        exit: () => { u.arms.right.rotation.x = 0; this._setHeat(level); } },
      this._walk(m, u.homeX, u.homeZ, 0.6),
    ]);
    this._cheer(['mute', 'deaf'], 0.1);
  }

  doServe() { this._serveDish(); this._cheer(['blind', 'mute', 'deaf'], 0); }

  _serveDish() {
    if (this.dish.visible) return;
    this.dish.visible = true; this.liquid.visible = false; sfx.play('win');
    const color = this.liquidColor.getHex();
    for (let i = 0; i < 3; i++) {
      const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.4 - i * 0.03, 0.4 - i * 0.03, 0.12, 14), mat(color, { roughness: 0.6 }));
      cake.position.y = 0.1 + i * 0.13; this.dish.add(cake);
    }
    this.dish.userData.pop = this.clock.elapsedTime;
  }

  doWrong(act) {
    sfx.play('buzz');
    const m = this.monkeys.blind;
    if (act && act.kind === 'grab') {
      const jarSpot = this._frontOfJar(act.pos); const u = m.userData;
      this._queue(m, [
        this._walk(m, jarSpot.x, jarSpot.z, 0.7),
        { dur: 0.3, fn: (p) => { u.arms.right.rotation.x = -1.6 * Math.sin(p * Math.PI * 0.5); }, exit: () => { u.arms.right.rotation.x = 0; this.slap('mute', 'blind'); } },
        this._walk(m, u.homeX, u.homeZ, 0.7),
      ]);
    } else {
      this.slap('mute', 'blind');
    }
  }

  // ---------------------------------------------------------------- slap!
  slap(slapperRole, targetRole) {
    const A = this.monkeys[slapperRole], B = this.monkeys[targetRole];
    if (!A || !B) return;
    const dir = Math.sign((B.position.x - A.position.x) || 1);
    const ua = A.userData;
    const lean = dir > 0 ? 'right' : 'left';
    let hit = false;
    this._queue(A, [
      { dur: 0.28, fn: (p) => { ua.arms[lean].rotation.x = -1.2 * p; ua.arms[lean].rotation.z = -dir * 1.4 * p; A.rotation.z = -dir * 0.15 * p; } },
      { dur: 0.18, fn: (p) => {
          ua.arms[lean].rotation.z = -dir * (1.4 - 2.6 * p);
          if (!hit && p > 0.4) { hit = true; this._onSlapHit(B, dir); }
        }, exit: () => { ua.arms[lean].rotation.set(0, 0, 0); A.rotation.z = 0; } },
    ]);
  }

  _onSlapHit(B, dir) {
    sfx.play('slap');
    B.userData.recoil = this.clock.elapsedTime;
    B.userData.recoilDir = dir;
    this._slapSprite(B);
    this._stars(B, dir);
  }

  _slapSprite(B) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 72px Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#2a1708'; ctx.lineWidth = 8;
    ctx.strokeText('SLAP!', 128, 64); ctx.fillText('SLAP!', 128, 64);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    spr.position.set(B.position.x, 3.2, B.position.z + 0.4); spr.scale.set(1.6, 0.8, 1);
    this.scene.add(spr);
    this.fx.push({ obj: spr, t0: this.clock.elapsedTime, dur: 0.7, update: (p) => { spr.scale.setScalar(0.8 + p * 1.2); spr.material.opacity = 1 - p; spr.position.y = 3.2 + p * 0.6; } });
  }

  _stars(B, dir) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.1), new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x332200, flatShading: true }));
      s.position.set(B.position.x + dir * 0.6, 2.9, B.position.z + 0.5);
      const vx = dir * (0.5 + Math.random()), vy = 1 + Math.random(), vz = (Math.random() - 0.5);
      this.scene.add(s);
      this.fx.push({ obj: s, t0: this.clock.elapsedTime, dur: 0.6, update: (p, dt) => { s.position.x += vx * 0.03; s.position.y += (vy - p * 2) * 0.03; s.position.z += vz * 0.03; s.rotation.x += 0.3; s.rotation.y += 0.3; s.material.opacity = 1 - p; } });
    }
  }

  // ---------------------------------------------------------------- cooking bits
  _makeCarried(color) {
    const jar = new THREE.Group();
    jar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 8), mat(color)));
    jar.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 8), mat(0x53392a)), [0, 0.24, 0]));
    jar.position.set(0, -0.1, 0.1);
    return jar;
  }
  _makeSpoon() {
    const sp = new THREE.Group();
    sp.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), mat(0xc9a24a)), [0, -0.3, 0]));
    sp.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xc9a24a)), [0, -0.65, 0], [1, 0.5, 1]));
    return sp;
  }
  _hideShelfJar(pos, hidden) { const j = this.jars[pos]; if (j) j.visible = !hidden; }

  _pourStream(color, p) {
    if (Math.random() > 0.5) return;
    const drop = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), mat(color));
    drop.position.set(POT.x + 0.1 + (Math.random() - 0.5) * 0.1, 2.9, POT.z);
    this.scene.add(drop);
    this.fx.push({ obj: drop, t0: this.clock.elapsedTime, dur: 0.4, update: (pp) => { drop.position.y = 2.9 - pp * 0.9; } });
  }

  _dropIngredient(color) {
    sfx.play('splash');
    this.fillCount = Math.min(this.fillCount + 1, 7);
    this.liquid.visible = true;
    const target = 0.15 + this.fillCount * 0.09;
    this.liquid.userData.target = Math.min(target, 0.85);
    this.liquidColor.lerp(new THREE.Color(color), 0.5);
    this.liquid.material.color.copy(this.liquidColor);
    if (this._heat > 0) { this.steam.visible = true; sfx.startSizzle(); }
    // splash ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), mat(color, { transparent: true }));
    ring.rotation.x = Math.PI / 2; ring.position.set(POT.x, 2.6, POT.z); this.scene.add(ring);
    this.fx.push({ obj: ring, t0: this.clock.elapsedTime, dur: 0.4, update: (p) => { ring.scale.setScalar(1 + p * 4); ring.material.opacity = 0.7 * (1 - p); } });
  }

  _cheer(roles = ['mute', 'deaf', 'blind'], delay = 0) {
    setTimeout(() => {
      for (const r of roles) { const m = this.monkeys[r]; if (m && !m.userData.seq) m.userData.cheer = this.clock.elapsedTime; }
      sfx.play('ding');
    }, delay * 1000);
  }

  // ---------------------------------------------------------------- sequencer
  _queue(m, phases) { m.userData.seq = { phases, i: 0, start: this.clock.elapsedTime, entered: false }; }
  _walk(m, x, z, dur, carry = false) {
    return {
      dur,
      enter: () => { m.userData._from = { x: m.position.x, z: m.position.z }; },
      fn: (p) => {
        const e = easeInOut(p); const f = m.userData._from;
        m.position.x = lerp(f.x, x, e); m.position.z = lerp(f.z, z, e);
        const dx = x - f.x, dz = z - f.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.02) m.rotation.y = Math.atan2(dx, dz);
        const sw = Math.sin(p * Math.PI * 6) * 0.6;
        m.userData.legs.left.rotation.x = sw; m.userData.legs.right.rotation.x = -sw;
        if (carry) { m.userData.arms.left.rotation.x = -1.3; m.userData.arms.right.rotation.x = -1.3; }
        else { m.userData.arms.left.rotation.x = sw * 0.7; m.userData.arms.right.rotation.x = -sw * 0.7; }
        m.position.y = m.userData.baseY + Math.abs(Math.sin(p * Math.PI * 6)) * 0.07;
        const step = Math.floor(p * 6); if (step !== m.userData._step) { m.userData._step = step; sfx.play('step'); }
      },
      exit: () => { m.userData.legs.left.rotation.x = 0; m.userData.legs.right.rotation.x = 0; m.rotation.y = 0; m.position.y = m.userData.baseY; m.userData._step = -1; if (!carry) { m.userData.arms.left.rotation.x = 0; m.userData.arms.right.rotation.x = 0; } },
    };
  }

  // ---------------------------------------------------------------- loop
  _tick() {
    const t = this.clock.getElapsedTime();
    for (const role in this.monkeys) {
      const m = this.monkeys[role]; const u = m.userData;
      const seq = u.seq;
      if (seq) {
        const ph = seq.phases[seq.i];
        if (!seq.entered) { seq.entered = true; ph.enter && ph.enter(); }
        let p = (t - seq.start) / ph.dur;
        if (p >= 1) { ph.fn(1); ph.exit && ph.exit(); seq.i++; seq.start = t; seq.entered = false; if (seq.i >= seq.phases.length) u.seq = null; }
        else ph.fn(p);
      } else {
        // idle: breathing, sway, look-around, blink, tail
        const ph = u.phase;
        m.position.y = u.baseY + 0.03 * Math.sin(t * 2 + ph);
        u.head.rotation.z = 0.06 * Math.sin(t * 1.4 + ph);
        u.head.rotation.y = 0.25 * Math.sin(t * 0.5 + ph);
        u.head.rotation.x = 0.04 * Math.sin(t * 1.1 + ph);
        u.arms.left.rotation.x = 0.16 * Math.sin(t * 2 + ph); u.arms.left.rotation.z = 0;
        u.arms.right.rotation.x = -0.16 * Math.sin(t * 2 + ph); u.arms.right.rotation.z = 0;
        u.tail.rotation.z = 0.5 + 0.3 * Math.sin(t * 3 + ph);
        m.rotation.z = 0;
        // cheer (celebratory hop)
        if (u.cheer != null) {
          const cp = (t - u.cheer) / 0.7;
          if (cp >= 1) u.cheer = null;
          else { m.position.y = u.baseY + Math.sin(cp * Math.PI) * 1.1; m.rotation.y = cp * Math.PI * 2; u.arms.left.rotation.x = -2.2 * Math.sin(cp * Math.PI); u.arms.right.rotation.x = -2.2 * Math.sin(cp * Math.PI); }
        }
        // blink
        u.blink -= 0.016; if (u.blink <= 0) { u.blink = 2 + Math.random() * 3; u._blinkT = t; }
        const bt = t - (u._blinkT || -1); const sy = bt < 0.12 ? Math.abs(Math.sin(bt / 0.12 * Math.PI)) * 0.9 + 0.1 : 1;
        u.eyes.forEach((e) => { e.scale.y = 1 - (1 - sy); });
        // recoil from a slap
        if (u.recoil != null) {
          const rp = (t - u.recoil) / 0.6;
          if (rp >= 1) { u.recoil = null; m.position.x = u.homeX; m.rotation.z = 0; }
          else { const f = Math.sin(rp * Math.PI) * (1 - rp); const d = u.recoilDir || 1; u.head.rotation.z += d * 1.2 * f; m.rotation.z = d * 0.3 * f; m.position.x = u.homeX + d * 0.2 * Math.sin(rp * Math.PI); }
        }
      }
    }
    // liquid rise
    if (this.liquid.userData.target != null) {
      this.liquid.scale.y += (this.liquid.userData.target - this.liquid.scale.y) * 0.12;
      this.liquid.position.y = 2.0 + this.liquid.scale.y * 0.5;
    }
    // bubbles + steam when hot
    if (this._heat > 0 && this.fillCount > 0) {
      this.liquid.position.y += Math.sin(t * 14) * 0.004;
      if (Math.random() < 0.03 * this._heat) sfx.play('bubble');
    }
    if (this.steam.visible) {
      this.steam.children.forEach((pf) => {
        const yy = ((t * 0.4 + pf.userData.off) % 1);
        pf.position.y = yy * 1.6; pf.position.x = Math.sin(yy * 6 + pf.userData.off * 6) * 0.2;
        pf.scale.setScalar(0.4 + yy * 0.8); pf.material.opacity = 0.5 * (1 - yy);
      });
    }
    if (this.flames.visible) {
      const n = this.flames.userData.intensity || 1;
      this.flames.children.forEach((f, i) => { f.scale.y = (0.5 + n * 0.3) * (0.8 + 0.4 * Math.sin(t * 12 + i)); f.scale.x = f.scale.z = 0.7 + 0.3 * n; });
    }
    if (this.dish.visible && this.dish.userData.pop != null) {
      const dp = Math.min((t - this.dish.userData.pop) / 0.5, 1);
      this.dish.scale.setScalar(0.4 + easeInOut(dp) * 0.6); this.dish.rotation.y = t * 0.6;
    }
    // transient effects
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i]; const p = (t - e.t0) / e.dur;
      if (p >= 1) { this.scene.remove(e.obj); e.obj.material && (e.obj.material.transparent = true); this.fx.splice(i, 1); }
      else { if (e.obj.material) e.obj.material.transparent = true; e.update(p); }
    }
    // pointed-jar highlight: lift the jar up above the cooks, glow, float an arrow
    for (const pos in this.jars) {
      const jar = this.jars[pos]; const hu = jar.userData.highlightUntil;
      const lbl = jar.userData.label;
      if (!hu) continue;
      if (t > hu) {
        jar.userData.highlightUntil = 0;
        jar.userData.body.material.emissive.setHex(0x000000);
        jar.scale.setScalar(1);
        jar.position.y = jar.userData.homeY;
        lbl.position.y = jar.userData.homeY + 0.78;
        if (lbl.userData.temp) { lbl.visible = false; lbl.userData.temp = false; }
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(t * 9);
        jar.userData.body.material.emissive.setHex(0xff7a1a);
        jar.userData.body.material.emissiveIntensity = 0.4 + pulse * 0.7;
        jar.scale.setScalar(1 + 0.16 * pulse);
        jar.position.y = jar.userData.homeY + 0.85 + 0.1 * pulse;
        lbl.position.y = jar.position.y + 0.6;
        this.pointArrow.position.set(jar.position.x, jar.position.y + 0.75, jar.position.z + 0.1);
      }
    }
    if (this.pointArrow.visible && t > (this.pointArrow.userData.until || 0)) this.pointArrow.visible = false;
    if (this._look) this.camera.lookAt(this._look);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}
