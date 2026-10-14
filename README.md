# 🍳 Three Cooks (3 Monkey Game)

A 3-player co-op cooking party game where **each cook is missing one sense** and the three of them have to make a dish together. Inspired by the "see no evil, hear no evil, speak no evil" monkeys. 🙈🙉🙊

Each player joins from their own device (phones work great) using a room code.

## The twist: no one has enough info alone

| Cook | Sees | Hears | Can send |
| --- | --- | --- | --- |
| 🙉 **Deaf** (Director) | the **recipe** only — not the live kitchen | nothing | **voice** → reaches Blind & Mute |
| 🙈 **Blind** (Hands) | nothing | voice | **voice** → reaches Mute (Deaf can't hear it) |
| 🙊 **Mute** (Eyes) | the **live kitchen** — ingredient positions + pot | everything | **gestures** (numbers / ✅ / ❌) → seen only by Deaf |

- The **Deaf** cook knows *what* the recipe needs, but not *where* anything is.
- The **Mute** cook is the only one who can see where ingredients actually sit — but can't speak.
- The **Blind** cook is the only one who can touch anything — but can't see.

So information has to flow around the table:

> **Mute** sees the flour at jar 2 → signals **"2"** to **Deaf** → Deaf tells **Blind** "grab jar 2" out loud → Blind taps it blind → Mute watches it land and confirms. 🔁

The server enforces every channel — voice only reaches cooks who can hear, gestures only reach cooks who can see, and only the Blind cook can perform kitchen actions.

## Features

- Real-time multiplayer over Socket.IO with simple 4-letter room codes
- Role-specific screens that hide exactly what each cook isn't allowed to perceive
- The Blind cook's device reads instructions aloud (Web Speech API)
- Two recipes (🥞 Fluffy Pancakes, 🍫 Chocolate Brownie) — easy to add more
- Pixel-art cooks with idle animation and hop/shake reactions

## Run it

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
node server.js
```

The server prints a `http://localhost:3000` address plus your local Wi-Fi address. Open it on three devices on the same network, have one person **Create a kitchen**, share the 4-letter code, each player picks a cook, and the host picks a dish.

## Project layout

| File | What it does |
| --- | --- |
| `server.js` | Rooms, roles, and the channel-routing rules that enforce each sense |
| `recipes.js` | Ingredients and recipes (add your own here) |
| `public/client.js` | The three role screens + pixel-art cooks |
| `public/styles.css` | Styling and animations |
| `public/index.html` | Page shell |

## Add a recipe

Add an entry to `RECIPES` in `recipes.js`: a `shelf` (which ingredients appear, plus decoys) and ordered `steps` (`add` / `stir` / `heat` / `serve`). The shelf positions are shuffled each game, which is what forces the Mute → Deaf → Blind relay.
