// Answer Battle — a Quiplash-style party game for 3–15 players.
// Each round every player writes answers to two prompts; each prompt is shared
// with exactly one other player, and everyone else votes on the funnier answer.
// Pure game logic here; server.js owns sockets, players and broadcasting.

export const BATTLE_MAX = 15;
export const BATTLE_MIN = 3;
export const ROUNDS = 3;

export const BATTLE_PROMPTS = [
  'The worst possible name for a pet goldfish',
  "A terrible slogan for a dentist's office",
  'The real reason the Wi-Fi is down',
  'A rejected flavor of ice cream',
  'The worst superpower to have',
  'Something you should NOT say to your boss',
  'A bad name for a boat',
  "The secret ingredient in grandma's soup",
  "A terrible theme for a kid's birthday party",
  'What aliens would be most confused by on Earth',
  'The worst thing to find in your sandwich',
  'A bad name for a perfume',
  'The real reason the dinosaurs went extinct',
  'A terrible Wi-Fi password',
  'Something a superhero would never say',
  'The worst reason to call in sick',
  'A rejected Olympic sport',
  'The worst advice to give a new driver',
  'A terrible name for a nightclub',
  'What your pet is REALLY thinking',
  'The worst thing to say on a first date',
  'A bad name for a breakfast cereal',
  'The least useful thing to bring to a deserted island',
  'A terrible motivational poster slogan',
  'The worst feature for a new phone',
  'Something you would regret teaching a parrot',
  'A bad name for a hair salon',
  'The worst possible time for your phone to ring',
  'A rejected Disney movie title',
  'The worst thing to hear your pilot say',
  'A terrible name for a racehorse',
  "What's really inside a hot dog",
  'The worst gift to give your in-laws',
  'A bad name for a gym',
  'The worst thing to say to a police officer',
  'A terrible lyric for an ice-cream-truck jingle',
  'The real reason you were late',
  'A bad name for a law firm',
  'The worst catchphrase for a game-show host',
  'Something you should never put in the microwave',
  'A terrible name for a cruise ship',
  'The worst thing to write in a yearbook',
  'A rejected scented candle',
  'The worst thing to say during a job interview',
  'A bad name for a coffee shop',
  'The worst habit a houseguest could have',
  'A terrible name for a newly discovered planet',
  'What the Wi-Fi router dreams about at night',
  'The worst thing to find in your hotel room',
  'A bad name for a sandwich shop',
  'The worst reason to start a podcast',
  'A questionable idea for a first tattoo',
  'The worst thing to say to your dentist',
  'A bad name for a vacuum cleaner',
  'The worst superpower for a librarian',
  'A rejected pizza topping',
  'The worst way to answer the phone',
  'A terrible name for a boy band',
  'The worst thing to keep in your fridge',
  'A bad title for a self-help book',
  'The worst thing to say to a bear',
  'A terrible name for a breakfast restaurant',
];

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function newBattle() {
  return { phase: 'lobby', round: 0, rounds: ROUNDS, prompts: [], matchups: [], voteIndex: 0, scores: {} };
}

// Arrange players in a shuffled ring; prompt i is answered by player i and i+1,
// so every player writes exactly two answers and every prompt has two authors.
export function startRound(b, playerPids) {
  b.round++;
  const pids = shuffle(playerPids);
  const texts = shuffle(BATTLE_PROMPTS).slice(0, pids.length);
  b.prompts = texts.map((text, i) => ({
    id: `r${b.round}p${i}`,
    text,
    authors: shuffle([pids[i], pids[(i + 1) % pids.length]]), // A/B display order randomized
    answers: {},
    votes: {},
    revealed: false,
  }));
  b.matchups = shuffle(b.prompts.map((p) => p.id));
  b.voteIndex = 0;
  b.phase = 'answer';
}

export function promptsFor(b, pid) { return b.prompts.filter((p) => p.authors.includes(pid)); }

export function submitAnswer(b, pid, promptId, text) {
  const p = b.prompts.find((x) => x.id === promptId);
  if (!p || !p.authors.includes(pid)) return false;
  const clean = String(text || '').slice(0, 100).trim();
  if (!clean) return false;
  p.answers[pid] = clean;
  return true;
}

export function allAnswered(b) {
  return b.prompts.every((p) => p.authors.every((a) => p.answers[a]));
}

export function fillBlanks(b) {
  for (const p of b.prompts) for (const a of p.authors) if (!p.answers[a]) p.answers[a] = '(no answer)';
}

export function currentMatchup(b) {
  const id = b.matchups[b.voteIndex];
  return b.prompts.find((p) => p.id === id) || null;
}

export function submitVote(b, pid, choice) {
  const m = currentMatchup(b);
  if (!m || m.revealed || m.authors.includes(pid)) return false;
  if (choice !== 'a' && choice !== 'b') return false;
  m.votes[pid] = choice;
  return true;
}

export function allVoted(b, connectedPids) {
  const m = currentMatchup(b);
  if (!m) return true;
  const eligible = connectedPids.filter((p) => !m.authors.includes(p));
  if (eligible.length === 0) return true;
  return eligible.every((p) => m.votes[p]);
}

// Tally the current matchup and award points. authors[0] is A, authors[1] is B.
export function reveal(b) {
  const m = currentMatchup(b);
  if (!m || m.revealed) return;
  let aV = 0, bV = 0;
  for (const voter in m.votes) { if (m.votes[voter] === 'a') aV++; else if (m.votes[voter] === 'b') bV++; }
  m.aVotes = aV; m.bVotes = bV;
  const mult = 100 * b.round;
  b.scores[m.authors[0]] = (b.scores[m.authors[0]] || 0) + aV * mult;
  b.scores[m.authors[1]] = (b.scores[m.authors[1]] || 0) + bV * mult;
  if (aV > 0 && bV === 0) { b.scores[m.authors[0]] += mult; m.flawless = 'a'; }       // "LASH!" bonus
  if (bV > 0 && aV === 0) { b.scores[m.authors[1]] += mult; m.flawless = 'b'; }
  m.revealed = true;
}

export function advanceVote(b) {
  b.voteIndex++;
  if (b.voteIndex >= b.matchups.length) { b.phase = 'scores'; return 'scores'; }
  return 'vote';
}

export function isLastRound(b) { return b.round >= b.rounds; }

export function resetBattle(b) {
  b.phase = 'lobby'; b.round = 0; b.prompts = []; b.matchups = []; b.voteIndex = 0; b.scores = {};
}
