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

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newRoom(code) {
  return {
    code,
    hostId: null,
    players: new Map(), // socketId -> { name, role }
    phase: 'lobby',     // lobby | playing | won
    recipe: null,
    shelf: [],          // [{ pos, ingredient }]
    state: null,
  };
}

function roleTaken(room, role) {
  for (const p of room.players.values()) if (p.role === role) return true;
  return false;
}

function playerByRole(room, role) {
  for (const [id, p] of room.players) if (p.role === role) return { id, ...p };
  return null;
}

function startGame(room, recipe) {
  room.recipe = recipe;
  const positions = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  room.shelf = recipe.shelf.map((ing, i) => ({ pos: positions[i], ingredient: ing }));
  room.shelf.sort((a, b) => a.pos - b.pos);
  room.state = {
    stepIndex: 0,
    pot: [],
    heat: 'off',
    stirs: 0,
    mistakes: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };
  room.phase = 'playing';
}

// Describe a step in words — only ever shown to the Deaf cook (who has the recipe).
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

// Build the view a specific role should receive. Information is withheld here —
// this is where "Deaf can't see the kitchen" and "Blind sees nothing" live.
function viewFor(room, role) {
  const base = {
    phase: room.phase,
    code: room.code,
    role,
    roster: ROLES.map((r) => {
      const p = playerByRole(room, r);
      return { role: r, taken: !!p, name: p?.name || null, ...CAPS[r] };
    }),
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji })),
    isHost: false, // set per-socket below
  };
  if (room.phase === 'lobby') return base;

  const s = room.state;
  const step = room.recipe.steps[s.stepIndex];
  const common = {
    recipeName: room.recipe.name,
    recipeEmoji: room.recipe.emoji,
    stepIndex: s.stepIndex,
    totalSteps: room.recipe.steps.length,
    mistakes: s.mistakes,
    elapsed: Math.round(((s.finishedAt || Date.now()) - s.startedAt) / 1000),
  };

  if (room.phase === 'won') {
    return { ...base, ...common, won: true };
  }

  if (role === 'deaf') {
    // The plan — full recipe with current step. No live kitchen, no positions.
    return {
      ...base, ...common,
      steps: room.recipe.steps.map((st, i) => ({
        text: describeStep(st),
        done: i < s.stepIndex,
        current: i === s.stepIndex,
      })),
      currentInstruction: describeStep(step),
    };
  }

  if (role === 'mute') {
    // Reality — positions, labels, pot, stove. No recipe / no idea what's next.
    return {
      ...base, ...common,
      shelf: room.shelf.map((slot) => ({
        pos: slot.pos,
        label: INGREDIENTS[slot.ingredient].label,
        emoji: INGREDIENTS[slot.ingredient].emoji,
      })),
      pot: s.pot.map((ing) => ({ label: INGREDIENTS[ing].label, emoji: INGREDIENTS[ing].emoji })),
      heat: s.heat,
      stirs: s.stirs,
    };
  }

  // blind — the hands. Controls only, nothing to look at.
  return {
    ...base, ...common,
    heat: s.heat,          // so the heat buttons can show which is active
    stirsThisStep: s.stirs,
    canServe: step?.type === 'serve',
    gridPositions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
}

function broadcastState(room) {
  for (const [id, p] of room.players) {
    const v = viewFor(room, p.role);
    v.isHost = id === room.hostId;
    io.to(id).emit('state', v);
  }
}

// Send an ephemeral event only to the players who can perceive it.
function perceive(room, { audio, visual, payload }) {
  for (const [id, p] of room.players) {
    const caps = CAPS[p.role];
    if ((audio && caps.canHear) || (visual && caps.canSee)) {
      io.to(id).emit('event', payload);
    }
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
    if (slot.ingredient !== step.ingredient) {
      return { ok: false, reason: `Wrong jar — that was ${INGREDIENTS[slot.ingredient].label}.` };
    }
    s.pot.push(slot.ingredient);
    s.stepIndex++;
    return { ok: true, note: `Added ${INGREDIENTS[slot.ingredient].label}.` };
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

io.on('connection', (socket) => {
  let roomCode = null;

  const room = () => (roomCode ? rooms.get(roomCode) : null);

  socket.on('create', ({ name }) => {
    const code = makeCode();
    const r = newRoom(code);
    r.hostId = socket.id;
    r.players.set(socket.id, { name: (name || 'Host').slice(0, 16), role: null });
    rooms.set(code, r);
    roomCode = code;
    socket.join(code);
    socket.emit('joined', { code });
    broadcastState(r);
  });

  socket.on('join', ({ code, name }) => {
    const r = rooms.get((code || '').toUpperCase());
    if (!r) return socket.emit('error_msg', 'No kitchen with that code.');
    if (r.phase !== 'lobby') return socket.emit('error_msg', 'That game already started.');
    if (r.players.size >= 3) return socket.emit('error_msg', 'Kitchen is full (3 cooks).');
    roomCode = r.code;
    r.players.set(socket.id, { name: (name || 'Cook').slice(0, 16), role: null });
    socket.join(r.code);
    socket.emit('joined', { code: r.code });
    broadcastState(r);
  });

  socket.on('pickRole', ({ role }) => {
    const r = room();
    if (!r || r.phase !== 'lobby') return;
    if (!ROLES.includes(role)) return;
    const me = r.players.get(socket.id);
    if (!me) return;
    if (role !== me.role && roleTaken(r, role)) return socket.emit('error_msg', 'That role is taken.');
    me.role = me.role === role ? null : role; // toggle
    broadcastState(r);
  });

  socket.on('start', ({ recipeId }) => {
    const r = room();
    if (!r || r.phase !== 'lobby') return;
    if (socket.id !== r.hostId) return socket.emit('error_msg', 'Only the host can start.');
    if (ROLES.some((role) => !roleTaken(r, role))) return socket.emit('error_msg', 'All three roles must be filled.');
    const recipe = RECIPES.find((x) => x.id === recipeId) || RECIPES[0];
    startGame(r, recipe);
    broadcastState(r);
  });

  socket.on('voice', ({ text }) => {
    const r = room();
    if (!r || r.phase !== 'playing') return;
    const me = r.players.get(socket.id);
    if (!me || CAPS[me.role].send !== 'voice') return;
    const clean = String(text || '').slice(0, 140).trim();
    if (!clean) return;
    perceive(r, {
      audio: true,
      payload: { kind: 'voice', from: me.role, fromLabel: CAPS[me.role].label, text: clean, t: Date.now() },
    });
  });

  socket.on('gesture', ({ token }) => {
    const r = room();
    if (!r || r.phase !== 'playing') return;
    const me = r.players.get(socket.id);
    if (!me || CAPS[me.role].send !== 'gesture') return;
    perceive(r, {
      visual: true,
      payload: { kind: 'gesture', from: me.role, fromLabel: CAPS[me.role].label, token: String(token).slice(0, 4), t: Date.now() },
    });
  });

  socket.on('action', (action) => {
    const r = room();
    if (!r || r.phase !== 'playing') return;
    const me = r.players.get(socket.id);
    if (!me || me.role !== 'blind') return; // only the hands may act

    const result = checkAction(r, action);
    if (result.ok) {
      // A kitchen thing happened: Mute sees it, Blind feels it. Deaf perceives neither
      // directly, but the shared state (progress) updates for everyone.
      perceive(r, { audio: true, visual: true, payload: { kind: 'result', ok: true, note: result.note } });
      if (r.state.stepIndex >= r.recipe.steps.length) {
        r.phase = 'won';
        r.state.finishedAt = Date.now();
      }
    } else {
      r.state.mistakes++;
      perceive(r, { audio: true, visual: true, payload: { kind: 'result', ok: false, note: result.reason } });
    }
    broadcastState(r);
  });

  socket.on('playAgain', () => {
    const r = room();
    if (!r) return;
    if (socket.id !== r.hostId) return;
    r.phase = 'lobby';
    r.recipe = null;
    r.state = null;
    r.shelf = [];
    broadcastState(r);
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    r.players.delete(socket.id);
    if (r.players.size === 0) {
      rooms.delete(r.code);
      return;
    }
    if (socket.id === r.hostId) r.hostId = r.players.keys().next().value;
    // If a game was in progress and a cook left, drop back to the lobby.
    if (r.phase === 'playing') {
      r.phase = 'lobby';
      r.recipe = null;
      r.state = null;
      r.shelf = [];
    }
    broadcastState(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  console.log('\n  🍳  Three Cooks is running!\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  On the same Wi-Fi:  http://${ip}:${PORT}`);
  console.log('\n  Open it on 3 devices (phones work great), create a kitchen on one,');
  console.log('  and share the 4-letter code with the other two.\n');
});
