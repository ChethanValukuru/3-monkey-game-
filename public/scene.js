// Low-poly 3D kitchen for Three Cooks. A shared stage: three goofy monkey-chefs
// standing behind a counter, a shelf of jars, a pot on a stove. All input still
// comes from the HUD (client.js) — this module is the visual world and the gags.
import * as THREE from './vendor/three.module.js';

const ROLE_COLOR = { deaf: 0xff914d, blind: 0x6c7a89, mute: 0x2fa39b };
const SKIN = 0x7a4a2b, MUZZLE = 0xd9a874, HAT = 0xf4efe6, DARK = 0x241c16;
const INGREDIENT_COLOR = {
  flour: 0xefe3c8, egg: 0xf3c646, milk: 0xf2f4f7, sugar: 0xffffff,
  butter: 0xffd98a, salt: 0xdfe7ee, cocoa: 0x5b3a29, banana: 0xffe135, cheese: 0xffc64a,
};
// where each monkey stands (facing +Z, toward the camera)
const STANDS = { blind: -3.2, mute: 0, deaf: 3.2 };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.05, ...opts });
}

function jarGridPos(pos) {
  const col = (pos - 1) % 3, row = Math.floor((pos - 1) / 3);
  return { x: (col - 1) * 1.9, y: 4.3 - row * 1.15, z: -5.2 };
}

export class Kitchen3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.role = 'mute';
    this.monkeys = {};
    this.jars = {};
    this.potBlobs = [];
    this.clock = new THREE.Clock();
    this.labelsVisible = false;
    this._potCount = 0;
  }

  mount() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = false;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a211b);
    scene.fog = new THREE.Fog(0x2a211b, 14, 30);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff2e0, 0x30241a, 0.9));
    const key = new THREE.DirectionalLight(0xffd9a8, 1.1);
    key.position.set(4, 9, 7);
    scene.add(key);
    const warm = new THREE.PointLight(0xff7a3a, 0.8, 16);
    warm.position.set(0, 2.6, -0.5);
    scene.add(warm);
    this.warmLight = warm;

    this._buildRoom();
    this._buildStoveAndPot();
    this._buildShelf();
    for (const role of ['blind', 'mute', 'deaf']) {
      const m = this._buildMonkey(role);
      m.position.set(STANDS[role], 0, -3.1);
      m.userData.phase = Math.random() * Math.PI * 2;
      scene.add(m);
      this.monkeys[role] = m;
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
    floor.position.set(0, -0.2, -4);
    this.scene.add(floor);
    // checker tiles for a bit of fun
    for (let i = -5; i <= 5; i++) for (let j = -4; j <= 3; j++) {
      if ((i + j) % 2) continue;
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 1.9), mat(0x7d5a40));
      t.position.set(i * 2, 0.02, -4 + j * 2);
      this.scene.add(t);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 0.4), mat(0x8f5d3a));
    back.position.set(0, 5, -6);
    this.scene.add(back);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14, 20), mat(0x7a4f32));
    sideL.position.set(-12, 5, -4); this.scene.add(sideL);
    const sideR = sideL.clone(); sideR.position.x = 12; this.scene.add(sideR);
    // counter the monkeys stand behind
    const counter = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.6), mat(0xcdb48c));
    counter.position.set(0, 0.7, -1.0);
    this.scene.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.2, 1.8), mat(0xe6d4ad));
    top.position.set(0, 1.45, -1.0);
    this.scene.add(top);
    // a decorative chalkboard behind
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 0.2), mat(0x24302a));
    board.position.set(-8.4, 4.4, -5.7);
    this.scene.add(board);
  }

  _buildStoveAndPot() {
    const stove = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.4), mat(0x3b3b44));
    stove.position.set(0, 1.75, -1.0);
    this.scene.add(stove);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 0.85, 12), mat(0x30333a, { metalness: 0.4, roughness: 0.5 }));
    pot.position.set(0, 2.4, -1.0);
    this.scene.add(pot);
    this.pot = pot;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.07, 6, 16), mat(0x5a5f68, { metalness: 0.5 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(0, 2.82, -1.0);
    this.scene.add(rim);
    this.potContents = new THREE.Group();
    this.potContents.position.set(0, 2.55, -1.0);
    this.scene.add(this.potContents);
    // flames (hidden until heat)
    this.flames = new THREE.Group();
    this.flames.position.set(0, 2.0, -1.0);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.4, flatShading: true }));
      f.position.set((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.5);
      this.flames.add(f);
    }
    this.flames.visible = false;
    this.scene.add(this.flames);
  }

  _buildShelf() {
    const shelfMat = mat(0x9a6a44);
    for (let row = 0; row < 3; row++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.18, 0.7), shelfMat);
      plank.position.set(0, 3.72 - row * 1.15, -5.5);
      this.scene.add(plank);
    }
    this.shelfGroup = new THREE.Group();
    this.scene.add(this.shelfGroup);
    for (let pos = 1; pos <= 9; pos++) {
      const p = jarGridPos(pos);
      const jar = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.62, 10), mat(0x8891a0, { transparent: true, opacity: 0.92 }));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10), mat(0x53392a));
      lid.position.y = 0.37;
      jar.add(body, lid);
      jar.position.set(p.x, p.y, p.z);
      jar.userData = { body, basePos: jar.position.clone() };
      // floating label (Mute only)
      const label = this._makeLabel('');
      label.position.set(p.x, p.y + 0.75, p.z + 0.1);
      label.visible = false;
      this.scene.add(label);
      jar.userData.label = label;
      this.shelfGroup.add(jar);
      this.jars[pos] = jar;
    }
  }

  _makeLabel(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const ctx = c.getContext('2d');
    const draw = (t) => {
      ctx.clearRect(0, 0, 256, 96);
      ctx.fillStyle = 'rgba(20,16,12,0.85)';
      ctx.roundRect(8, 8, 240, 80, 16); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 54px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, 128, 50);
    };
    draw(text);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    spr.scale.set(1.5, 0.56, 1);
    spr.userData = { ctx, tex, draw };
    return spr;
  }

  // ---------------------------------------------------------------- monkey chef
  _buildMonkey(role) {
    const g = new THREE.Group();
    const skin = mat(SKIN);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.0, 10), mat(ROLE_COLOR[role]));
    body.position.y = 1.1; g.add(body);
    // apron bib
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), mat(0xefe7da));
    bib.position.set(0, 1.25, 0.6); g.add(bib);

    const head = new THREE.Group();
    head.position.y = 2.15;
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 0), skin);
    head.add(skull);
    const muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(MUZZLE));
    muzzle.position.set(0, -0.18, 0.62); muzzle.scale.set(1.1, 0.8, 0.8); head.add(muzzle);
    const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(DARK));
    nose.position.set(0, -0.1, 0.98); head.add(nose);
    // ears
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), skin);
      ear.position.set(sx * 0.74, 0.1, 0); ear.scale.set(0.6, 1, 0.5);
      head.add(ear);
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), mat(MUZZLE));
      inner.position.set(sx * 0.8, 0.1, 0.06); inner.scale.set(0.5, 0.9, 0.4);
      head.add(inner);
      ear.userData.isEar = true;
    }
    // eyes
    const eyes = [];
    for (const sx of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat(0xffffff, { roughness: 0.4 }));
      white.position.set(sx * 0.26, 0.12, 0.64); head.add(white);
      const pup = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(DARK));
      pup.position.set(sx * 0.26, 0.12, 0.78); head.add(pup);
      eyes.push(white, pup);
    }
    // chef hat
    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.58, 0.28, 12), mat(HAT));
    hatBand.position.y = 0.66; head.add(hatBand);
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), mat(HAT));
    puff.position.y = 0.95; head.add(puff);

    // role feature
    if (role === 'deaf') {
      const bandTop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 6, 16, Math.PI), mat(DARK));
      bandTop.rotation.x = Math.PI / 2; bandTop.rotation.z = Math.PI; bandTop.position.y = 0.2; head.add(bandTop);
      for (const sx of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 10), mat(0x3a2d22));
        cup.rotation.z = Math.PI / 2; cup.position.set(sx * 0.82, 0.05, 0); head.add(cup);
      }
    } else if (role === 'blind') {
      const blind = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.3), mat(0x1b1f26));
      blind.position.set(0, 0.14, 0.6); head.add(blind);
      // little shine
      const shine = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.02), mat(0x4a5565, { emissive: 0x222a33 }));
      shine.position.set(-0.3, 0.2, 0.76); head.add(shine);
    } else if (role === 'mute') {
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.2), mat(0xd65a4a));
      tape.position.set(0, -0.26, 0.82); tape.rotation.z = 0.12; head.add(tape);
      const tape2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.18), mat(0xe8776a));
      tape2.position.set(0, -0.26, 0.83); tape2.rotation.z = 0.12; head.add(tape2);
    }
    g.add(head);

    // arms (pivoted at shoulder)
    const arms = {};
    for (const side of ['left', 'right']) {
      const sx = side === 'left' ? -1 : 1;
      const arm = new THREE.Group();
      arm.position.set(sx * 0.56, 1.5, 0);
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.8, 8), skin);
      limb.position.y = -0.4; arm.add(limb);
      const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), mat(MUZZLE));
      hand.position.y = -0.82; arm.add(hand);
      g.add(arm); arms[side] = arm;
    }
    // legs
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 8), skin);
      leg.position.set(sx * 0.25, 0.3, 0); g.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.5), mat(MUZZLE));
      foot.position.set(sx * 0.25, 0.08, 0.12); g.add(foot);
    }
    // tail
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 6, 12, Math.PI * 1.2), skin);
    tail.position.set(0, 0.8, -0.5); tail.rotation.x = Math.PI / 2; tail.rotation.z = 0.5; g.add(tail);

    g.userData = { role, head, arms, baseY: 0, anim: null };
    return g;
  }

  // ---------------------------------------------------------------- per role view
  setRole(role) {
    this.role = role;
    this.labelsVisible = role === 'mute';
    for (const pos in this.jars) {
      const jar = this.jars[pos];
      jar.userData.label.visible = this.labelsVisible && !!jar.userData.label.userData.hasText;
      // Deaf/Blind see identical grey jars; Mute sees ingredient colours (set in update)
      if (role !== 'mute') jar.userData.body.material.color.setHex(0x8891a0);
    }
    // camera framing
    if (role === 'deaf') { this.camera.position.set(0.5, 4.2, 10); this._look = new THREE.Vector3(0, 2.3, -1); }
    else if (role === 'blind') { this.camera.position.set(0, 4, 9.5); this._look = new THREE.Vector3(0, 2.2, -1.5); }
    else { this.camera.position.set(0, 4.6, 10.5); this._look = new THREE.Vector3(0, 2.1, -2); }
  }

  // Called on every server state. `view` is role-specific (see server.js).
  update(view) {
    // Jars: only the Mute view carries labels/positions.
    if (view.shelf) {
      for (const slot of view.shelf) {
        const jar = this.jars[slot.pos]; if (!jar) continue;
        const key = slot.label.toLowerCase();
        jar.userData.body.material.color.setHex(INGREDIENT_COLOR[key] ?? 0xd9c7a0);
        const lbl = jar.userData.label;
        lbl.userData.draw(`${slot.pos}  ${slot.emoji}`);
        lbl.userData.tex.needsUpdate = true;
        lbl.userData.hasText = true;
        lbl.visible = this.labelsVisible;
      }
    }
    // Pot contents (Mute knows exactly; others approximate via results)
    if (view.pot) this._setPot(view.pot.map((p) => p.label.toLowerCase()));
    // Heat
    if (typeof view.heat === 'string') this._setHeat(view.heat);
    // progress flash handled by HUD
  }

  _setPot(labels) {
    this._potCount = labels.length;
    while (this.potContents.children.length > labels.length) {
      this.potContents.remove(this.potContents.children[this.potContents.children.length - 1]);
    }
    labels.forEach((key, i) => {
      let blob = this.potContents.children[i];
      const color = INGREDIENT_COLOR[key] ?? 0xcbb68a;
      if (!blob) {
        blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(color));
        blob.userData.drop = 1; // animate drop-in
        this.potContents.add(blob);
      } else blob.material.color.setHex(color);
      const a = (i / Math.max(1, labels.length)) * Math.PI * 2;
      blob.userData.target = new THREE.Vector3(Math.cos(a) * 0.28, (i % 2) * 0.12, Math.sin(a) * 0.2);
    });
  }

  clearPot() {
    while (this.potContents.children.length) {
      this.potContents.remove(this.potContents.children[0]);
    }
    this._potCount = 0;
  }

  // Approximate add for non-Mute clients (generic blob)
  addGenericBlob() {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(0xcbb68a));
    blob.userData.drop = 1;
    const i = this.potContents.children.length;
    const a = i * 1.1;
    blob.userData.target = new THREE.Vector3(Math.cos(a) * 0.28, (i % 2) * 0.12, Math.sin(a) * 0.2);
    this.potContents.add(blob);
  }

  _setHeat(level) {
    const map = { off: 0, low: 1, med: 2, high: 3 };
    const n = map[level] ?? 0;
    this.flames.visible = n > 0;
    this.flames.userData = { intensity: n };
    this.warmLight.intensity = 0.8 + n * 0.5;
  }

  // ---------------------------------------------------------------- reactions
  react(role, kind) {
    const m = this.monkeys[role]; if (!m) return;
    m.userData.anim = { type: kind === 'happy' ? 'happy' : 'oops', start: this.clock.elapsedTime };
  }

  // acting monkey reaches toward the shelf
  reach(role) {
    const m = this.monkeys[role]; if (!m) return;
    m.userData.anim = { type: 'reach', start: this.clock.elapsedTime };
  }

  // ---------------------------------------------------------------- loop
  _tick() {
    const t = this.clock.getElapsedTime();
    for (const role in this.monkeys) {
      const m = this.monkeys[role];
      const u = m.userData;
      const ph = u.phase;
      // idle
      let y = 0.03 * Math.sin(t * 2 + ph);
      m.position.y = u.baseY + y;
      u.head.rotation.z = 0.06 * Math.sin(t * 1.4 + ph);
      u.head.rotation.x = 0.04 * Math.sin(t * 1.1 + ph);
      u.arms.left.rotation.x = 0.18 * Math.sin(t * 2 + ph);
      u.arms.right.rotation.x = -0.18 * Math.sin(t * 2 + ph);
      m.rotation.set(0, 0, 0);
      // reactions
      const a = u.anim;
      if (a) {
        const dur = a.type === 'reach' ? 0.9 : a.type === 'happy' ? 0.9 : 1.1;
        const p = (t - a.start) / dur;
        if (p >= 1) { u.anim = null; }
        else if (a.type === 'happy') {
          m.position.y = u.baseY + Math.sin(p * Math.PI) * 1.4;
          m.rotation.y = p * Math.PI * 2;
          u.arms.left.rotation.x = -2.4 * Math.sin(p * Math.PI);
          u.arms.right.rotation.x = -2.4 * Math.sin(p * Math.PI);
        } else if (a.type === 'oops') {
          const f = Math.sin(Math.min(p * 1.6, 1) * Math.PI);
          m.rotation.x = -1.5 * f;
          m.position.z = -3.1 + 0.6 * f;
          m.position.y = u.baseY - 0.2 * f;
        } else if (a.type === 'reach') {
          const f = Math.sin(p * Math.PI);
          u.arms.right.rotation.x = -2.6 * f;
          u.arms.left.rotation.x = -2.0 * f;
          u.head.rotation.x = 0.3 * f;
        }
      }
    }
    // pot blobs settle
    for (const blob of this.potContents.children) {
      if (blob.userData.target) {
        blob.position.lerp(blob.userData.target, 0.15);
      }
    }
    // flames flicker
    if (this.flames.visible) {
      const n = this.flames.userData.intensity || 1;
      this.flames.children.forEach((f, i) => {
        f.scale.y = (0.5 + n * 0.3) * (0.8 + 0.4 * Math.sin(t * 12 + i));
        f.scale.x = f.scale.z = 0.7 + 0.3 * n;
      });
    }
    if (this._look) this.camera.lookAt(this._look);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
