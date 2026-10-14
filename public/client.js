/* global io */
const socket = io();
const app = document.getElementById('app');
const toastWrap = document.getElementById('toast');

const ui = {
  screen: 'home',          // home | lobby | game | won
  name: localStorage.getItem('tc_name') || '',
  code: null,
  state: null,             // latest server view
  log: [],                 // heard voice / my sent voice
  gestures: [],            // gestures seen (Deaf)
  speak: localStorage.getItem('tc_speak') !== '0',
};

const CAP_ICONS = { deaf: '🙉', blind: '🙈', mute: '🙊' };

// ---------------------------------------------------------------- pixel cooks
// Each cook is a 16x16 pixel chef. '0' = transparent; other digits map to a
// colour below. Shared colours + a per-role accent (apron '5' and feature '7').
const PX_BASE = {
  '1': '#f6efe6', // hat
  '2': '#2a211b', // outline
  '3': '#e3bd95', // skin
  '4': '#cc9a6c', // skin shadow
  '6': '#2a211b', // eye
  '8': '#efe7da', // apron
};
const PX_ACCENT = {
  deaf:  { '5': '#ff914d', '7': '#3a2d22' }, // orange apron, headphones
  blind: { '5': '#6c7a89', '7': '#20242c' }, // slate apron, dark glasses
  mute:  { '5': '#2fa39b', '7': '#d65a4a' }, // teal apron, mouth tape
};
const PIXELS = {
  deaf: [
    '0000011111100000', '0000111111110000', '0001111111111000', '0002222222222000',
    '0003333333333000', '0073333333333700', '0073363333633700', '0073333333333700',
    '0003333223333000', '0000333333330000', '0000003333000000', '0055555555555500',
    '0555555555555550', '0555888888885550', '0555888888885550', '0555888888885550',
  ],
  blind: [
    '0000011111100000', '0000111111110000', '0001111111111000', '0002222222222000',
    '0003333333333000', '0003333333333000', '0007777777777000', '0003333333333000',
    '0003333223333000', '0000333333330000', '0000003333000000', '0055555555555500',
    '0555555555555550', '0555888888885550', '0555888888885550', '0555888888885550',
  ],
  mute: [
    '0000011111100000', '0000111111110000', '0001111111111000', '0002222222222000',
    '0003333333333000', '0003333333333000', '0003363333633000', '0003333333333000',
    '0003777777773000', '0000333333330000', '0000003333000000', '0055555555555500',
    '0555555555555550', '0555888888885550', '0555888888885550', '0555888888885550',
  ],
};

function pixelSVG(role, size = 48, cls = '') {
  const grid = PIXELS[role];
  const pal = { ...PX_BASE, ...PX_ACCENT[role] };
  let rects = '';
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const ch = grid[y][x];
      const col = pal[ch];
      if (col) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col}"/>`;
    }
  }
  return `<svg class="px ${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" `
    + `shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

function pixelTrio() {
  return `<div class="hero-trio">
    ${['blind', 'deaf', 'mute'].map((r) =>
      `<div class="ch">${pixelSVG(r, 60)}<span>${CAP_ICONS[r]} ${r.toUpperCase()}</span></div>`).join('')}
  </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function say(text) {
  if (!ui.speak || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------------------------------------------------------------- socket events
socket.on('joined', ({ code }) => {
  ui.code = code;
  ui.screen = 'lobby';
  render();
});

socket.on('error_msg', (m) => toast(m, 'bad'));

socket.on('state', (view) => {
  ui.state = view;
  if (view.phase === 'lobby') ui.screen = 'lobby';
  else if (view.phase === 'won') ui.screen = 'won';
  else ui.screen = 'game';
  render();
});

socket.on('event', (ev) => {
  const myRole = ui.state?.role;
  if (ev.kind === 'voice') {
    ui.log.unshift({ who: ev.fromLabel, text: ev.text, heard: true });
    ui.log = ui.log.slice(0, 12);
    if (myRole === 'blind') say(ev.text);  // the Blind cook literally hears it
    render();
  } else if (ev.kind === 'gesture') {
    ui.gestures.unshift({ token: ev.token, t: ev.t });
    ui.gestures = ui.gestures.slice(0, 6);
    render();
  } else if (ev.kind === 'result') {
    toast(ev.note, ev.ok ? 'good' : 'bad');
    if (myRole === 'blind') say(ev.ok ? 'Good.' : 'Wrong.');
    ui.reaction = ev.ok ? 'happy' : 'oops';
    render();
    clearTimeout(ui._reactionT);
    ui._reactionT = setTimeout(() => { ui.reaction = null; render(); }, 700);
  }
});

// ---------------------------------------------------------------- actions
function emitVoice() {
  const input = document.getElementById('voiceInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('voice', { text });
  ui.log.unshift({ who: 'You', text, heard: false });
  ui.log = ui.log.slice(0, 12);
  input.value = '';
  render();
}

function sendGesture(token) {
  socket.emit('gesture', { token });
  toast('Signalled ' + token);
}

function doAction(action) { socket.emit('action', action); }

// ---------------------------------------------------------------- render
function render() {
  if (ui.screen === 'home') return renderHome();
  if (ui.screen === 'lobby') return renderLobby();
  if (ui.screen === 'won') return renderWon();
  return renderGame();
}

function renderHome() {
  app.innerHTML = `
    <div class="center">
      <div class="title">🍳 Three Cooks</div>
      <p class="sub">One can't see. One can't hear. One can't speak.<br/>Cook the dish together — if you can.</p>
      ${pixelTrio()}
    </div>
    <div class="card stack">
      <div>
        <label>Your name</label>
        <input id="nameInput" type="text" maxlength="16" placeholder="e.g. Alex" value="${esc(ui.name)}" />
      </div>
      <button class="primary full" data-act="create">Create a kitchen</button>
    </div>
    <div class="card stack">
      <div>
        <label>Join with a code</label>
        <input id="codeInput" class="code" type="text" maxlength="4" placeholder="ABCD" />
      </div>
      <button class="full" data-act="join">Join kitchen</button>
    </div>
    <p class="hint center">Best with 3 people on 3 phones on the same Wi-Fi. One person creates the kitchen and shares the 4-letter code.</p>
  `;
}

function roster(view) {
  return view.roster.map((r) => {
    const mine = view.role === r.role;
    const cls = 'role' + (mine ? ' mine' : '') + (r.taken && !mine ? ' taken' : '');
    const tag = r.taken ? `<span class="pill">${mine ? 'YOU' : esc(r.name || 'taken')}</span>` : `<span class="pill">tap to pick</span>`;
    return `
      <button class="${cls}" data-act="role" data-role="${r.role}" ${r.taken && !mine ? 'disabled' : ''}>
        ${pixelSVG(r.role, 52, 'role-av')}
        <span class="meta"><b>${r.label}</b><small>${esc(r.blurb)}</small></span>
        ${tag}
      </button>`;
  }).join('');
}

function renderLobby() {
  const v = ui.state;
  const allFilled = v && v.roster.every((r) => r.taken);
  const recipeOpts = (v?.recipes || []).map((r, i) =>
    `<button class="recipe-opt" data-act="start" data-recipe="${r.id}" ${!allFilled ? 'disabled' : ''}>${r.emoji} ${esc(r.name)}</button>`
  ).join('');
  app.innerHTML = `
    <div class="center">
      <p class="sub" style="margin-bottom:6px">Share this code</p>
      <div class="code-badge">${esc(ui.code || '----')}</div>
    </div>
    <div class="card">
      <h3>Pick your cook</h3>
      <div class="roles">${v ? roster(v) : ''}</div>
    </div>
    ${v?.isHost ? `
      <div class="card stack">
        <h3>Start cooking</h3>
        <p class="hint">${allFilled ? 'All three roles are filled. Choose a dish to begin.' : 'Waiting for all three roles to be taken…'}</p>
        <div class="stack">${recipeOpts}</div>
      </div>` : `<p class="hint center">Waiting for the host to start…</p>`}
    <p class="foot">Roles reset if someone leaves mid-game.</p>
  `;
}

function gameHeader(v) {
  const pct = Math.round((v.stepIndex / v.totalSteps) * 100);
  return `
    <div class="hdr">
      ${pixelSVG(v.role, 44, 'hdr-av' + (ui.reaction ? ' px-' + ui.reaction : ''))}
      <div>
        <div style="font-weight:800">${v.recipeEmoji} ${esc(v.recipeName)}</div>
        <small class="muted">You are the ${v.role.toUpperCase()} cook</small>
      </div>
      <span class="spacer"></span>
      <div class="stat"><b>${v.stepIndex}/${v.totalSteps}</b><small>steps</small></div>
      <div class="stat"><b>${v.mistakes}</b><small>oops</small></div>
    </div>
    <div class="progress"><i style="width:${pct}%"></i></div>
  `;
}

function voiceComposer(placeholder) {
  return `
    <div class="composer">
      <input id="voiceInput" type="text" maxlength="140" placeholder="${placeholder}" autocomplete="off" />
      <button class="primary" data-act="voice">Say</button>
    </div>`;
}

function logBlock(title, big) {
  const items = ui.log.length
    ? ui.log.map((m) => `<div class="msg ${m.heard ? 'heard' : ''} ${big ? 'big' : ''}"><div class="who">${esc(m.who)}</div>${esc(m.text)}</div>`).join('')
    : `<p class="hint">Nothing yet.</p>`;
  return `<div class="card"><h3>${title}</h3><div class="log">${items}</div></div>`;
}

function renderGame() {
  const v = ui.state;
  if (v.role === 'deaf') return renderDeaf(v);
  if (v.role === 'blind') return renderBlind(v);
  if (v.role === 'mute') return renderMute(v);
}

function renderDeaf(v) {
  const steps = v.steps.map((s) =>
    `<li class="${s.done ? 'done' : ''} ${s.current ? 'current' : ''}">
      <span class="dot">${s.done ? '✓' : ''}</span><span class="t">${esc(s.text)}</span>
    </li>`
  ).join('');
  const gest = ui.gestures.length
    ? ui.gestures.slice(0, 4).map((g, i) => `<span class="big-token" style="opacity:${1 - i * 0.22}">${esc(g.token)}</span>`).join('')
    : `<p class="hint">The Mute cook will signal you here (positions, ✅ / ❌ …).</p>`;
  app.innerHTML = `
    ${gameHeader(v)}
    <div class="callout">👉 ${esc(v.currentInstruction)}</div>
    <div class="card"><h3>Signals from 🙊 Mute</h3><div class="gest-in">${gest}</div></div>
    <div class="card">
      <h3>Recipe</h3>
      <ul class="steps">${steps}</ul>
    </div>
    <div class="card">
      <h3>Speak</h3>
      <p class="hint">🙈 Blind &amp; 🙊 Mute hear you. You can't hear anything back — watch the signals above.</p>
      ${voiceComposer('Tell the Blind cook what to do…')}
    </div>
  `;
}

function renderBlind(v) {
  const jars = v.gridPositions.map((n) =>
    `<button class="jar" data-act="grab" data-pos="${n}"><span class="n">${n}</span><span class="em">🫙</span></button>`
  ).join('');
  const heat = ['off', 'low', 'med', 'high'].map((lv) =>
    `<button data-act="heat" data-level="${lv}" class="${v.heat === lv ? 'active' : ''}">${lv.toUpperCase()}</button>`
  ).join('');
  app.innerHTML = `
    ${gameHeader(v)}
    <div class="blind-note">
      🙈 You can't see the kitchen. Listen to the 🙉 Deaf cook and do exactly what they say.
      ${('speechSynthesis' in window) ? `<div style="margin-top:8px"><button class="ghost" data-act="toggleSpeak">${ui.speak ? '🔊 Voice: ON' : '🔇 Voice: OFF'}</button></div>` : ''}
    </div>
    ${logBlock('👂 What you hear', true)}
    <div class="card">
      <h3>Jars — tap to add to the pot</h3>
      <div class="grid3">${jars}</div>
    </div>
    <div class="card stack">
      <h3>Pot &amp; stove</h3>
      <button class="full" data-act="stir">🥄 Stir</button>
      <div class="heat-row">${heat}</div>
      <button class="full ${v.canServe ? 'primary' : ''}" data-act="serve">🍽️ Serve the dish</button>
    </div>
    <div class="card">
      <h3>Speak</h3>
      <p class="hint">🙊 Mute hears you (🙉 Deaf can't). Ask questions out loud.</p>
      ${voiceComposer('Ask something out loud…')}
    </div>
  `;
}

function renderMute(v) {
  const shelf = v.shelf.map((s) =>
    `<div class="jar"><span class="n">${s.pos}</span><span class="em">${s.emoji}</span><span class="lbl">${esc(s.label)}</span></div>`
  ).join('');
  const pot = v.pot.length ? v.pot.map((p) => `<span class="chip">${p.emoji} ${esc(p.label)}</span>`).join('') : `<span class="hint">empty</span>`;
  const flames = ['low', 'med', 'high'].map((lv, i) => {
    const active = (v.heat === 'low' && i === 0) || (v.heat === 'med' && i <= 1) || (v.heat === 'high' && i <= 2);
    return `<span class="flame ${active ? 'on' : ''}">🔥</span>`;
  }).join('');
  const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="gesture" data-token="${n}">${n}</button>`).join('');
  app.innerHTML = `
    ${gameHeader(v)}
    <div class="card">
      <h3>The shelf <small class="muted">(positions only you can see)</small></h3>
      <div class="grid3">${shelf}</div>
    </div>
    <div class="pot">
      <b>🍲 In the pot</b>
      <div class="items">${pot}</div>
      <div class="stove">Heat: <span style="margin-left:4px">${flames}</span>
        <span class="muted" style="margin-left:8px">${v.heat.toUpperCase()}</span>
        <span class="spacer" style="flex:1"></span><span class="muted">stirs: ${v.stirs}</span>
      </div>
    </div>
    <div class="card">
      <h3>Signal the 🙉 Deaf cook</h3>
      <p class="hint">You can't speak. Flash a position number or a yes/no. Only the Deaf cook sees this.</p>
      <div class="gest-pad">${nums}</div>
      <div class="gest-wide">
        <button data-act="gesture" data-token="✅">✅</button>
        <button data-act="gesture" data-token="❌">❌</button>
        <button data-act="gesture" data-token="🔼">🔼</button>
        <button data-act="gesture" data-token="🔽">🔽</button>
      </div>
    </div>
    ${logBlock('👂 What you hear', false)}
  `;
}

function renderWon() {
  const v = ui.state;
  app.innerHTML = `
    <div class="center">
      <div class="title">🎉</div>
      <h2>${esc(v.recipeName)} ${v.recipeEmoji} — served!</h2>
      <p class="sub">You pulled it off together.</p>
      ${pixelTrio()}
    </div>
    <div class="card row center">
      <div class="stat"><b>${v.elapsed}s</b><small>time</small></div>
      <div class="stat"><b>${v.mistakes}</b><small>mistakes</small></div>
      <div class="stat"><b>${v.totalSteps}</b><small>steps</small></div>
    </div>
    ${v.isHost ? `<button class="primary full" data-act="again">Back to lobby</button>` : `<p class="hint center">Waiting for the host to restart…</p>`}
  `;
}

// ---------------------------------------------------------------- input wiring
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'create') {
    ui.name = document.getElementById('nameInput').value.trim() || 'Host';
    localStorage.setItem('tc_name', ui.name);
    socket.emit('create', { name: ui.name });
  } else if (act === 'join') {
    ui.name = document.getElementById('nameInput')?.value.trim() || ui.name || 'Cook';
    localStorage.setItem('tc_name', ui.name);
    const code = (document.getElementById('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Enter the 4-letter code', 'bad');
    socket.emit('join', { code, name: ui.name });
  } else if (act === 'role') {
    socket.emit('pickRole', { role: btn.dataset.role });
  } else if (act === 'start') {
    socket.emit('start', { recipeId: btn.dataset.recipe });
  } else if (act === 'voice') {
    emitVoice();
  } else if (act === 'gesture') {
    sendGesture(btn.dataset.token);
  } else if (act === 'grab') {
    doAction({ kind: 'grab', pos: Number(btn.dataset.pos) });
  } else if (act === 'stir') {
    doAction({ kind: 'stir' });
  } else if (act === 'heat') {
    doAction({ kind: 'heat', level: btn.dataset.level });
  } else if (act === 'serve') {
    doAction({ kind: 'serve' });
  } else if (act === 'again') {
    socket.emit('playAgain');
  } else if (act === 'toggleSpeak') {
    ui.speak = !ui.speak;
    localStorage.setItem('tc_speak', ui.speak ? '1' : '0');
    render();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'voiceInput') { e.preventDefault(); emitVoice(); }
  if (e.key === 'Enter' && e.target.id === 'codeInput') {
    e.preventDefault();
    const code = (e.target.value || '').trim().toUpperCase();
    if (code.length === 4) socket.emit('join', { code, name: ui.name || 'Cook' });
  }
});

render();
