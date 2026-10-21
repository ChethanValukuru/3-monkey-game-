import { Kitchen3D } from './scene.js';

/* global io */
const socket = io();

// Stable identity so a dropped/suspended socket (phones background tabs!) can
// transparently rejoin its room and keep its role.
let PID = localStorage.getItem('tc_pid');
if (!PID) { PID = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('tc_pid', PID); }
socket.on('connect', () => {
  if (ui.code) socket.emit('resume', { pid: PID, code: ui.code, name: ui.name });
});
const app = document.getElementById('app');
const hud = document.getElementById('hud');
const stage = document.getElementById('stage');
const toastWrap = document.getElementById('toast');

const ui = {
  screen: 'home',
  name: localStorage.getItem('tc_name') || '',
  code: localStorage.getItem('tc_code') || null,
  state: null,
  log: [],
  gestures: [],
  speak: localStorage.getItem('tc_speak') !== '0',
  kitchen: null,
  role3d: null,
  prevStep: 0,
};

const CAP_ICONS = { deaf: '🙉', blind: '🙈', mute: '🙊' };

// ---------------------------------------------------------------- pixel cooks (2D UI)
const PX_BASE = { '1': '#f6efe6', '2': '#2a211b', '3': '#e3bd95', '4': '#cc9a6c', '6': '#2a211b', '8': '#efe7da' };
const PX_ACCENT = {
  deaf:  { '5': '#ff914d', '7': '#3a2d22' },
  blind: { '5': '#6c7a89', '7': '#20242c' },
  mute:  { '5': '#2fa39b', '7': '#d65a4a' },
};
const PIXELS = {
  deaf: ['0000011111100000','0000111111110000','0001111111111000','0002222222222000','0003333333333000','0073333333333700','0073363333633700','0073333333333700','0003333223333000','0000333333330000','0000003333000000','0055555555555500','0555555555555550','0555888888885550','0555888888885550','0555888888885550'],
  blind: ['0000011111100000','0000111111110000','0001111111111000','0002222222222000','0003333333333000','0003333333333000','0007777777777000','0003333333333000','0003333223333000','0000333333330000','0000003333000000','0055555555555500','0555555555555550','0555888888885550','0555888888885550','0555888888885550'],
  mute: ['0000011111100000','0000111111110000','0001111111111000','0002222222222000','0003333333333000','0003333333333000','0003363333633000','0003333333333000','0003777777773000','0000333333330000','0000003333000000','0055555555555500','0555555555555550','0555888888885550','0555888888885550','0555888888885550'],
};
function pixelSVG(role, size = 48, cls = '') {
  const grid = PIXELS[role]; const pal = { ...PX_BASE, ...PX_ACCENT[role] };
  let rects = '';
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const col = pal[grid[y][x]];
    if (col) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col}"/>`;
  }
  return `<svg class="px ${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
function pixelTrio() {
  return `<div class="hero-trio">${['blind','deaf','mute'].map((r) =>
    `<div class="ch">${pixelSVG(r, 60)}<span>${CAP_ICONS[r]} ${r.toUpperCase()}</span></div>`).join('')}</div>`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text; toastWrap.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
function say(text) {
  if (!ui.speak || !('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(text); speechSynthesis.speak(u); } catch {}
}

// ---------------------------------------------------------------- socket
socket.on('joined', ({ code }) => { ui.code = code; localStorage.setItem('tc_code', code); ui.screen = 'lobby'; render(); });
socket.on('error_msg', (m) => toast(m, 'bad'));
socket.on('state', (view) => {
  ui.state = view;
  ui.screen = view.phase === 'lobby' ? 'lobby' : view.phase === 'won' ? 'won' : 'game';
  render();
});
socket.on('event', (ev) => {
  const myRole = ui.state?.role;
  if (ev.kind === 'voice') {
    ui.log.unshift({ who: ev.fromLabel, text: ev.text, heard: true });
    ui.log = ui.log.slice(0, 12);
    if (myRole === 'blind') say(ev.text);
    render();
    if (myRole === 'blind') {
      const v = document.querySelector('.blind-void');
      if (v) { v.classList.add('pulse'); setTimeout(() => v.classList.remove('pulse'), 1000); }
    }
  } else if (ev.kind === 'gesture') {
    ui.gestures.unshift({ token: ev.token, t: ev.t });
    ui.gestures = ui.gestures.slice(0, 6);
    render();
  } else if (ev.kind === 'result') {
    toast(ev.note, ev.ok ? 'good' : 'bad');
    if (myRole === 'blind') say(ev.ok ? 'Good.' : 'Wrong.');
    const k = ui.kitchen;
    if (k) {
      k.reach('blind');
      if (ev.ok) { k.react('mute', 'happy'); k.react('deaf', 'happy'); setTimeout(() => k.react('blind', 'happy'), 260); }
      else { k.react('blind', 'oops'); }
    }
  }
});

// ---------------------------------------------------------------- send
function emitVoice() {
  const input = document.getElementById('voiceInput'); if (!input) return;
  const text = input.value.trim(); if (!text) return;
  socket.emit('voice', { text });
  ui.log.unshift({ who: 'You', text, heard: false }); ui.log = ui.log.slice(0, 12);
  input.value = ''; render();
}
function sendGesture(token) { socket.emit('gesture', { token }); toast('Signalled ' + token); }
function doAction(action) { socket.emit('action', action); }

// ---------------------------------------------------------------- layers / 3D
function ensureKitchen() {
  if (ui.kitchen) return ui.kitchen;
  ui.kitchen = new Kitchen3D(stage);
  ui.kitchen.mount();
  return ui.kitchen;
}
function showLayer(mode, role) {
  const game = mode === 'game';
  app.style.display = game ? 'none' : 'block';
  hud.style.display = game ? 'block' : 'none';
  stage.style.display = game && role !== 'blind' ? 'block' : 'none';
}
function applyKitchen(v) {
  const k = ensureKitchen();
  if (ui.role3d !== v.role) { k.setRole(v.role); ui.role3d = v.role; }
  if (v.stepIndex < ui.prevStep) k.clearPot();         // new game started
  if (v.role === 'deaf' && v.steps) {
    for (let i = ui.prevStep; i < v.stepIndex; i++) {
      if ((v.steps[i]?.text || '').startsWith('Add')) k.addGenericBlob();
    }
  }
  ui.prevStep = v.stepIndex;
  k.update(v);
  requestAnimationFrame(() => k.resize());
}

// ---------------------------------------------------------------- render
function render() {
  if (ui.screen === 'game' && ui.state?.phase === 'playing') {
    showLayer('game', ui.state.role);
    applyKitchen(ui.state);
    // Preserve scroll + any in-progress typing across HUD rebuilds (state/events
    // arrive constantly, and we must not yank the sheet back to the top).
    const sc = hud.scrollTop;
    const active = document.activeElement;
    const typing = active && active.id === 'voiceInput' ? { val: active.value, caret: active.selectionStart } : null;
    renderHUD(ui.state);
    hud.scrollTop = sc;
    if (typing) {
      const inp = document.getElementById('voiceInput');
      if (inp) { inp.value = typing.val; inp.focus(); try { inp.setSelectionRange(typing.caret, typing.caret); } catch {} }
    }
    return;
  }
  showLayer('app');
  if (ui.screen === 'home') return renderHome();
  if (ui.screen === 'lobby') return renderLobby();
  if (ui.screen === 'won') return renderWon();
}

function renderHome() {
  app.innerHTML = `
    <div class="center">
      <div class="title">🍳 Three Cooks</div>
      <p class="sub">One can't see. One can't hear. One can't speak.<br/>Cook the dish together — if you can.</p>
      ${pixelTrio()}
    </div>
    <div class="card stack">
      <div><label>Your name</label><input id="nameInput" type="text" maxlength="16" placeholder="e.g. Alex" value="${esc(ui.name)}" /></div>
      <button class="primary full" data-act="create">Create a kitchen</button>
    </div>
    <div class="card stack">
      <div><label>Join with a code</label><input id="codeInput" class="code" type="text" maxlength="4" placeholder="ABCD" /></div>
      <button class="full" data-act="join">Join kitchen</button>
    </div>
    <p class="hint center">Best with 3 people on 3 phones on the same Wi-Fi. One person creates the kitchen and shares the 4-letter code.</p>`;
}

function roster(view) {
  return view.roster.map((r) => {
    const mine = view.role === r.role;
    const cls = 'role' + (mine ? ' mine' : '') + (r.taken && !mine ? ' taken' : '');
    const tag = r.taken ? `<span class="pill">${mine ? 'YOU' : esc(r.name || 'taken')}</span>` : `<span class="pill">tap to pick</span>`;
    return `<button class="${cls}" data-act="role" data-role="${r.role}" ${r.taken && !mine ? 'disabled' : ''}>
        ${pixelSVG(r.role, 52, 'role-av')}
        <span class="meta"><b>${r.label}</b><small>${esc(r.blurb)}</small></span>${tag}</button>`;
  }).join('');
}
function renderLobby() {
  const v = ui.state;
  const allFilled = v && v.roster.every((r) => r.taken);
  const recipeOpts = (v?.recipes || []).map((r) =>
    `<button class="recipe-opt full" data-act="start" data-recipe="${r.id}" ${!allFilled ? 'disabled' : ''}>${r.emoji} ${esc(r.name)}</button>`).join('');
  app.innerHTML = `
    <div class="center"><p class="sub" style="margin-bottom:6px">Share this code</p><div class="code-badge">${esc(ui.code || '----')}</div></div>
    <div class="card"><h3>Pick your cook</h3><div class="roles">${v ? roster(v) : ''}</div></div>
    ${v?.isHost ? `<div class="card stack"><h3>Start cooking</h3>
        <p class="hint">${allFilled ? 'All three roles are filled. Choose a dish to begin.' : 'Waiting for all three roles to be taken…'}</p>
        <div class="stack">${recipeOpts}</div></div>` : `<p class="hint center">Waiting for the host to start…</p>`}
    <p class="foot">Roles reset if someone leaves mid-game.</p>`;
}

function voiceComposer(placeholder) {
  return `<div class="composer"><input id="voiceInput" type="text" maxlength="140" placeholder="${placeholder}" autocomplete="off" /><button class="primary" data-act="voice">Say</button></div>`;
}
function logBlock(title, big) {
  const items = ui.log.length
    ? ui.log.map((m) => `<div class="msg ${m.heard ? 'heard' : ''} ${big ? 'big' : ''}"><div class="who">${esc(m.who)}</div>${esc(m.text)}</div>`).join('')
    : `<p class="hint">Nothing yet.</p>`;
  return `<div class="card"><h3>${title}</h3><div class="log">${items}</div></div>`;
}
function hudTop(v) {
  const pct = Math.round((v.stepIndex / v.totalSteps) * 100);
  return `<div class="topbar">
    <div class="stat"><b>${v.recipeEmoji}</b><small>dish</small></div>
    <div style="flex:1;pointer-events:auto">
      <div style="font-weight:800;font-size:.92rem">${esc(v.recipeName)} · <span class="muted">${CAP_ICONS[v.role]} ${v.role}</span></div>
      <div class="progress" style="margin:5px 0 0"><i style="width:${pct}%"></i></div>
    </div>
    <div class="stat"><b>${v.stepIndex}/${v.totalSteps}</b><small>steps</small></div>
    <div class="stat"><b>${v.mistakes}</b><small>oops</small></div>
  </div>`;
}

function renderHUD(v) {
  if (v.role === 'deaf') return renderDeafHUD(v);
  if (v.role === 'blind') return renderBlindHUD(v);
  return renderMuteHUD(v);
}

function renderDeafHUD(v) {
  const steps = v.steps.map((s) =>
    `<li class="${s.done ? 'done' : ''} ${s.current ? 'current' : ''}"><span class="dot">${s.done ? '✓' : ''}</span><span class="t">${esc(s.text)}</span></li>`).join('');
  const gest = ui.gestures.length
    ? ui.gestures.slice(0, 4).map((g, i) => `<span class="big-token" style="opacity:${1 - i * 0.22}">${esc(g.token)}</span>`).join('')
    : `<p class="hint">🙊 Mute will signal positions / ✅ ❌ here.</p>`;
  hud.innerHTML = `<div class="hud-inner">
    ${hudTop(v)}
    <div class="viewport-spacer"></div>
    <div class="sheet stack">
      <div class="hint-badge">🙉 You direct the kitchen. Speak to the cooks; you can't hear a thing.</div>
      <div class="callout">👉 ${esc(v.currentInstruction)}</div>
      <div class="card"><h3>Signals from 🙊 Mute</h3><div class="gest-in">${gest}</div></div>
      <div class="card"><h3>Recipe</h3><ul class="steps">${steps}</ul></div>
      <div class="card"><h3>Speak <small class="muted">(Blind &amp; Mute hear you)</small></h3>${voiceComposer('Tell the Blind cook what to do…')}</div>
    </div></div>`;
}

function renderMuteHUD(v) {
  const nums = [1,2,3,4,5,6,7,8,9].map((n) => `<button data-act="gesture" data-token="${n}">${n}</button>`).join('');
  hud.innerHTML = `<div class="hud-inner">
    ${hudTop(v)}
    <div class="viewport-spacer"></div>
    <div class="sheet stack">
      <div class="hint-badge">🙊 You see the kitchen in 3D — jar numbers &amp; the pot. Signal 🙉, you can't speak.</div>
      <div class="card"><h3>Signal the 🙉 Deaf cook</h3>
        <div class="gest-pad">${nums}</div>
        <div class="gest-wide">
          <button data-act="gesture" data-token="✅">✅</button>
          <button data-act="gesture" data-token="❌">❌</button>
          <button data-act="gesture" data-token="🔼">🔼</button>
          <button data-act="gesture" data-token="🔽">🔽</button>
        </div></div>
      ${logBlock('👂 What you hear', false)}
    </div></div>`;
}

function renderBlindHUD(v) {
  const jars = [1,2,3,4,5,6,7,8,9].map((n) =>
    `<button class="jar" data-act="grab" data-pos="${n}"><span class="em">🫙</span><span class="lbl">${n}</span></button>`).join('');
  const heat = ['off','low','med','high'].map((lv) =>
    `<button data-act="heat" data-level="${lv}" class="${v.heat === lv ? 'active' : ''}">${lv.toUpperCase()}</button>`).join('');
  const heard = ui.log[0] ? `${esc(ui.log[0].who)}: ${esc(ui.log[0].text)}` : 'Listen for the Deaf cook…';
  const speakToggle = ('speechSynthesis' in window)
    ? `<button class="ghost" data-act="toggleSpeak">${ui.speak ? '🔊 Voice ON' : '🔇 Voice OFF'}</button>` : '';
  hud.innerHTML = `<div class="hud-inner">
    ${hudTop(v)}
    <div class="blind-void"><span class="ring"></span><span class="ring"></span><div class="bf-heard">${heard}</div></div>
    <div class="sheet stack">
      <div class="hint-badge">🙈 You can't see. Do exactly what you're told. ${speakToggle}</div>
      <div class="card"><h3>Jars — tap the number you're told</h3><div class="grid3">${jars}</div></div>
      <div class="card stack"><h3>Pot &amp; stove</h3>
        <button class="full" data-act="stir">🥄 Stir</button>
        <div class="heat-row">${heat}</div>
        <button class="full ${v.canServe ? 'primary' : ''}" data-act="serve">🍽️ Serve</button></div>
      <div class="card"><h3>Speak <small class="muted">(only Mute hears you)</small></h3>${voiceComposer('Ask something out loud…')}</div>
    </div></div>`;
}

function renderWon() {
  const v = ui.state;
  app.innerHTML = `
    <div class="center"><div class="title">🎉</div>
      <h2>${esc(v.recipeName)} ${v.recipeEmoji} — served!</h2>
      <p class="sub">You pulled it off together.</p>${pixelTrio()}</div>
    <div class="card row center">
      <div class="stat"><b>${v.elapsed}s</b><small>time</small></div>
      <div class="stat"><b>${v.mistakes}</b><small>mistakes</small></div>
      <div class="stat"><b>${v.totalSteps}</b><small>steps</small></div></div>
    ${v.isHost ? `<button class="primary full" data-act="again">Back to lobby</button>` : `<p class="hint center">Waiting for the host to restart…</p>`}`;
}

// ---------------------------------------------------------------- input
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'create') {
    ui.name = document.getElementById('nameInput').value.trim() || 'Host';
    localStorage.setItem('tc_name', ui.name); socket.emit('create', { name: ui.name, pid: PID });
  } else if (act === 'join') {
    ui.name = document.getElementById('nameInput')?.value.trim() || ui.name || 'Cook';
    localStorage.setItem('tc_name', ui.name);
    const code = (document.getElementById('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Enter the 4-letter code', 'bad');
    ui.code = code;
    socket.emit('join', { code, name: ui.name, pid: PID });
  } else if (act === 'role') { socket.emit('pickRole', { role: btn.dataset.role }); }
  else if (act === 'start') { socket.emit('start', { recipeId: btn.dataset.recipe }); }
  else if (act === 'voice') { emitVoice(); }
  else if (act === 'gesture') { sendGesture(btn.dataset.token); }
  else if (act === 'grab') { doAction({ kind: 'grab', pos: Number(btn.dataset.pos) }); }
  else if (act === 'stir') { doAction({ kind: 'stir' }); }
  else if (act === 'heat') { doAction({ kind: 'heat', level: btn.dataset.level }); }
  else if (act === 'serve') { doAction({ kind: 'serve' }); }
  else if (act === 'again') { socket.emit('playAgain'); }
  else if (act === 'toggleSpeak') {
    ui.speak = !ui.speak; localStorage.setItem('tc_speak', ui.speak ? '1' : '0'); render();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'voiceInput') { e.preventDefault(); emitVoice(); }
  if (e.key === 'Enter' && e.target.id === 'codeInput') {
    e.preventDefault();
    const code = (e.target.value || '').trim().toUpperCase();
    if (code.length === 4) { ui.code = code; socket.emit('join', { code, name: ui.name || 'Cook', pid: PID }); }
  }
});

render();
