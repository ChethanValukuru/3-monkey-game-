import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';
import { fileURLToPath } from 'url';
import path from 'path';
import { INGREDIENTS, RECIPES, HEAT_LEVELS } from './recipes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Dev: never cache static assets so edits always show up on reload.
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------------------
// Roles and what each sense allows. This table is the heart of the game.
//   canSee   -> receives VISUAL messages (gestures) and visual game panels
//   canHear  -> receives AUDIO messages (voice)
//   send     -> which channel this role may transmit on
// ---------------------------------------------------------------------------
const ROLES = ['deaf', 'blind', 'mute'];
const CAPS = {
  deaf:  { canSee: true,  canHear: false, send: 'voice',   label: 'Deaf',  emoji: '🙉', blurb: 'Reads the recipe. Can speak, but hears nothing.' },
  blind: { canSee: false, canHear: true,  send: 'voice',   label: 'Blind', emoji: '🙈', blurb: 'The only hands. Cannot see anything.' },
  mute:  { canSee: true,  canHear: true,  send: 'gesture', label: 'Mute',  emoji: '🙊', blurb: 'The only eyes on the kitchen. Cannot speak.' },
};

/** @type {Map<string, Room>} rooms by code */
const rooms = new Map();
const sidPid = new Map();   // socket.id -> player id (pid)
const pidRoom = new Map();  // pid -> room code
const cleanupTimers = new Map(); // code -> timeout

function makeCode() {
  let code;
  do { code = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(code));
  return code;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function newRoom(code) {
  return { code, hostPid: null, players: new Map(), phase: 'lobby', recipe: null, shelf: [], state: null };
}
function roleTaken(room, role) { for (const p of room.players.values()) if (p.role === role) return true; return false; }
function playerByRole(room, role) { for (const p of room.players.values()) if (p.role === role) return p; return null; }
function liveCount(room) { let n = 0; for (const p of room.players.values()) if (p.connected) n++; return n; }

// resolve the acting player from a socket
function meOf(socket) {
  const pid = sidPid.get(socket.id);
  const code = pidRoom.get(pid);
  const r = code ? rooms.get(code) : null;
  return { pid, code, r, me: r ? r.players.get(pid) : null };
}

function startGame(room, recipe) {
  room.recipe = recipe;
  const positions = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  room.shelf = recipe.shelf.map((ing, i) => ({ pos: positions[i], ingredient: ing }));
  room.shelf.sort((a, b) => a.pos - b.pos);
  room.state = { stepIndex: 0, pot: [], heat: 'off', stirs: 0, mistakes: 0, startedAt: Date.now(), finishedAt: null };
  room.phase = 'playing';
}

function describeStep(step) {
  if (!step) return 'All done!';
  switch (step.type) {
    case 'add':  return `Add the ${INGREDIENTS[step.ingredient].label} ${INGREDIENTS[step.ingredient].emoji}`;
    case 'stir': return `Stir ${step.count} times`;
    case 'heat': return `Set the heat to ${step.level.toUpperCase()}`;
    case 'serve':return `Serve the dish! 🍽️`;
    default:     return 'Unknown step';
  }
}

function viewFor(room, role) {
  const base = {
    phase: room.phase, code: room.code, role,
    roster: ROLES.map((r) => {
      const p = playerByRole(room, r);
      return { role: r, taken: !!p, name: p?.name || null, ...CAPS[r] };
    }),
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji })),
    isHost: false,
  };
  if (room.phase === 'lobby') return base;

  const s = room.state;
  const step = room.recipe.steps[s.stepIndex];
  const common = {
    recipeName: room.recipe.name, recipeEmoji: room.recipe.emoji,
    stepIndex: s.stepIndex, totalSteps: room.recipe.steps.length,
    mistakes: s.mistakes, elapsed: Math.round(((s.finishedAt || Date.now()) - s.startedAt) / 1000),
  };
  if (room.phase === 'won') return { ...base, ...common, won: true };

  if (role === 'deaf') {
    return {
      ...base, ...common,
      steps: room.recipe.steps.map((st, i) => ({ text: describeStep(st), done: i < s.stepIndex, current: i === s.stepIndex })),
      currentInstruction: describeStep(step),
    };
  }
  if (role === 'mute') {
    return {
      ...base, ...common,
      shelf: room.shelf.map((slot) => ({ pos: slot.pos, label: INGREDIENTS[slot.ingredient].label, emoji: INGREDIENTS[slot.ingredient].emoji })),
      pot: s.pot.map((ing) => ({ label: INGREDIENTS[ing].label, emoji: INGREDIENTS[ing].emoji })),
      heat: s.heat, stirs: s.stirs,
    };
  }
  // blind — the hands. Controls only, nothing to look at.
  return { ...base, ...common, heat: s.heat, stirsThisStep: s.stirs, canServe: step?.type === 'serve', gridPositions: [1,2,3,4,5,6,7,8,9] };
}

function broadcastState(room) {
  for (const p of room.players.values()) {
    if (!p.connected) continue;
    const v = viewFor(room, p.role);
    v.isHost = p.pid === room.hostPid;
    io.to(p.sid).emit('state', v);
  }
}

function perceive(room, { audio, visual, payload }) {
  for (const p of room.players.values()) {
    if (!p.connected) continue;
    const caps = CAPS[p.role] || {};
    if ((audio && caps.canHear) || (visual && caps.canSee)) io.to(p.sid).emit('event', payload);
  }
}

function checkAction(room, action) {
  const s = room.state;
  const step = room.recipe.steps[s.stepIndex];
  if (!step) return { ok: false, reason: 'Nothing left to do.' };
  if (action.kind === 'grab') {
    if (step.type !== 'add') return { ok: false, reason: 'Not the time to add an ingredient.' };
    const slot = room.shelf.find((x) => x.pos === action.pos);
    if (!slot) return { ok: false, reason: 'Empty spot.' };
    if (slot.ingredient !== step.ingredient) return { ok: false, reason: `Wrong jar — that was ${INGREDIENTS[slot.ingredient].label}.` };
    s.pot.push(slot.ingredient); s.stepIndex++;
    return { ok: true, note: `Added ${INGREDIENTS[slot.ingredient].label}.`, ingredient: slot.ingredient };
  }
  if (action.kind === 'stir') {
    if (step.type !== 'stir') return { ok: false, reason: 'No need to stir right now.' };
    s.stirs++;
    if (s.stirs >= step.count) { s.stepIndex++; s.stirs = 0; return { ok: true, note: 'Stirred enough.' }; }
    return { ok: true, note: `Stir ${s.stirs}/${step.count}.`, partial: true };
  }
  if (action.kind === 'heat') {
    if (!HEAT_LEVELS.includes(action.level)) return { ok: false, reason: 'Unknown heat.' };
    s.heat = action.level;
    if (step.type !== 'heat') return { ok: false, reason: 'Heat not needed yet.' };
    if (action.level !== step.level) return { ok: false, reason: `Heat should be ${step.level.toUpperCase()}.` };
    s.stepIndex++;
    return { ok: true, note: `Heat set to ${action.level.toUpperCase()}.` };
  }
  if (action.kind === 'serve') {
    if (step.type !== 'serve') return { ok: false, reason: 'The dish is not ready to serve.' };
    s.stepIndex++;
    return { ok: true, note: 'Served!' };
  }
  return { ok: false, reason: 'Unknown action.' };
}

function bindSocket(socket, pid, code) {
  sidPid.set(socket.id, pid);
  pidRoom.set(pid, code);
  socket.join(code);
  const t = cleanupTimers.get(code);
  if (t) { clearTimeout(t); cleanupTimers.delete(code); }
}

function scheduleCleanup(code) {
  const r = rooms.get(code); if (!r) return;
  if (liveCount(r) > 0) return;
  if (cleanupTimers.has(code)) return;
  cleanupTimers.set(code, setTimeout(() => {
    const room = rooms.get(code);
    if (room && liveCount(room) === 0) {
      for (const p of room.players.values()) pidRoom.delete(p.pid);
      rooms.delete(code);
    }
    cleanupTimers.delete(code);
  }, 90000));
}

io.on('connection', (socket) => {
  // Reconnect / resume: client sends its stable pid plus the room it thinks it's in.
  socket.on('resume', ({ pid, code, name }) => {
    if (!pid) return;
    sidPid.set(socket.id, pid);
    const r = code ? rooms.get(code) : null;
    if (!r) return; // nothing to resume
    let me = r.players.get(pid);
    if (me) {
      me.sid = socket.id; me.connected = true; if (name) me.name = name;
    } else {
      if (r.phase !== 'lobby' || r.players.size >= 3) return socket.emit('error_msg', 'Could not rejoin that game.');
      me = { pid, sid: socket.id, name: (name || 'Cook').slice(0, 16), role: null, connected: true };
      r.players.set(pid, me);
    }
    if (!r.hostPid || !r.players.get(r.hostPid)?.connected) r.hostPid = pid;
    bindSocket(socket, pid, r.code);
    socket.emit('joined', { code: r.code });
    broadcastState(r);
  });

  socket.on('create', ({ name, pid }) => {
    if (!pid) return;
    const code = makeCode();
    const r = newRoom(code);
    r.hostPid = pid;
    r.players.set(pid, { pid, sid: socket.id, name: (name || 'Host').slice(0, 16), role: null, connected: true });
    rooms.set(code, r);
    bindSocket(socket, pid, code);
    socket.emit('joined', { code });
    broadcastState(r);
  });

  socket.on('join', ({ code, name, pid }) => {
    if (!pid) return;
    const r = rooms.get((code || '').toUpperCase());
    if (!r) return socket.emit('error_msg', 'No kitchen with that code.');
    if (r.players.has(pid)) { // already a member — treat as resume
      const me = r.players.get(pid); me.sid = socket.id; me.connected = true;
      bindSocket(socket, pid, r.code); socket.emit('joined', { code: r.code }); return broadcastState(r);
    }
    if (r.phase !== 'lobby') return socket.emit('error_msg', 'That game already started.');
    if (r.players.size >= 3) return socket.emit('error_msg', 'Kitchen is full (3 cooks).');
    r.players.set(pid, { pid, sid: socket.id, name: (name || 'Cook').slice(0, 16), role: null, connected: true });
    bindSocket(socket, pid, r.code);
    socket.emit('joined', { code: r.code });
    broadcastState(r);
  });

  socket.on('pickRole', ({ role }) => {
    const { r, me } = meOf(socket);
    if (!r || r.phase !== 'lobby' || !me || !ROLES.includes(role)) return;
    if (role !== me.role && roleTaken(r, role)) return socket.emit('error_msg', 'That role is taken.');
    me.role = me.role === role ? null : role;
    broadcastState(r);
  });

  socket.on('start', ({ recipeId }) => {
    const { r, me } = meOf(socket);
    if (!r || r.phase !== 'lobby' || !me) return;
    if (me.pid !== r.hostPid) return socket.emit('error_msg', 'Only the host can start.');
    if (ROLES.some((role) => !roleTaken(r, role))) return socket.emit('error_msg', 'All three roles must be filled.');
    const recipe = RECIPES.find((x) => x.id === recipeId) || RECIPES[0];
    startGame(r, recipe);
    broadcastState(r);
  });

  socket.on('voice', ({ text }) => {
    const { r, me } = meOf(socket);
    if (!r || r.phase !== 'playing' || !me || CAPS[me.role].send !== 'voice') return;
    const clean = String(text || '').slice(0, 140).trim(); if (!clean) return;
    perceive(r, { audio: true, payload: { kind: 'voice', from: me.role, fromLabel: CAPS[me.role].label, text: clean, t: Date.now() } });
  });

  socket.on('gesture', ({ token }) => {
    const { r, me } = meOf(socket);
    if (!r || r.phase !== 'playing' || !me || CAPS[me.role].send !== 'gesture') return;
    perceive(r, { visual: true, payload: { kind: 'gesture', from: me.role, fromLabel: CAPS[me.role].label, token: String(token).slice(0, 4), t: Date.now() } });
  });

  socket.on('action', (action) => {
    const { r, me } = meOf(socket);
    if (!r || r.phase !== 'playing' || !me || me.role !== 'blind') return;
    const result = checkAction(r, action);
    const act = { kind: action.kind, pos: action.pos, level: action.level, ingredient: result.ingredient };
    if (result.ok) {
      perceive(r, { audio: true, visual: true, payload: { kind: 'result', ok: true, note: result.note, act } });
      if (r.state.stepIndex >= r.recipe.steps.length) { r.phase = 'won'; r.state.finishedAt = Date.now(); }
    } else {
      r.state.mistakes++;
      perceive(r, { audio: true, visual: true, payload: { kind: 'result', ok: false, note: result.reason, act } });
    }
    broadcastState(r);
  });

  socket.on('playAgain', () => {
    const { r, me } = meOf(socket);
    if (!r || !me || me.pid !== r.hostPid) return;
    r.phase = 'lobby'; r.recipe = null; r.state = null; r.shelf = [];
    broadcastState(r);
  });

  socket.on('disconnect', () => {
    const pid = sidPid.get(socket.id);
    sidPid.delete(socket.id);
    const code = pidRoom.get(pid);
    const r = code ? rooms.get(code) : null;
    if (!r) return;
    const me = r.players.get(pid);
    if (me && me.sid === socket.id) me.connected = false; // keep the player so they can resume
    // host migration to a connected player
    if (r.hostPid === pid) {
      const alt = [...r.players.values()].find((p) => p.connected);
      if (alt) r.hostPid = alt.pid;
    }
    broadcastState(r);
    scheduleCleanup(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) for (const net of nets[name] || []) if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
  console.log('\n  🍳  Three Cooks is running!\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  On the same Wi-Fi:  http://${ip}:${PORT}`);
  console.log('\n  Open it on 3 devices (phones work great), create a kitchen on one,');
  console.log('  and share the 4-letter code with the other two.\n');
});
