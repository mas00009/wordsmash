# 🎉 Word Smash

A phone-installable party game: **Articulate-style describe-it, with a drawing twist, played on a board.**

The board and rules follow the real **Articulate!** (Drumond Park), with our **Draw** category added.

### Rules (as implemented)

| Rule | Detail |
|---|---|
| Categories | **7**: Object · Nature · Random · Person · Action · World · **Draw** (ours) |
| Start | Every team starts on **Object** |
| Turn | **30 seconds** |
| Movement | **1 space per correct answer** |
| Next category | Set by the space you **land on** |
| ♠ Spade (white) | **Control turn** — describe to *everyone*; the first team to guess **takes the turn** (then plays any category) |
| 🎯 Spinner | Landing on an **Action (orange)** or **Random (red)** segment spins the centre wheel. It has **28 slices** in the board's colours; **4 are shiny diamonds** that pay out. The needle spins and **the slice it lands on is the result**: +1 place (3 slices, ~11%), +2 places (1 slice, ~4%), otherwise nothing (~86%). Those board spaces carry a ⟳ spin icon. |
| Draw | Describer **sketches** on a canvas that syncs to every phone |
| Finish | Reaching/passing **FINISH** triggers a control turn — **you must win it to win**, otherwise you stay there and retry next turn. On the board it's the only cyan→purple space, capped with a chequered flag |
| ⏰ Time | At 0:00 the board buzzes and shows **TIME'S UP!**; every phone in the room vibrates and the describer's phone ends the turn |

Board: **48 segments** in a circular ring around the centre spinner, with a spade every 8th space, inside a rainbow neon bezel. Rendered as SVG so it scales to a TV.

The real game's spinner gives +2/+3; ours is tuned to +1/+2 with much lower odds so a bonus feels like a treat. The odds aren't a weighted table — they're literally how many diamond slices are on the wheel, so what you see is what you get.

- The **host sets up teams** after players join.
- A separate **board view** runs on a TV or laptop, showing team tokens moving live.

## Stack

- **Frontend:** static files on **GitHub Pages**
- **AI (optional):** **OpenRouter** — only the host needs a key, and only to generate new decks. The 10 built-in decks work with no key at all.
- **Backend:** **Cloudflare Worker + D1** (in `worker/`) for live game rooms and saved/shared decks

---

## 1. Deploy the backend (Cloudflare Worker + D1)

Needs the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm i -g wrangler`, then `wrangler login`.

```bash
cd worker
wrangler d1 create masgames      # copy the printed database_id into wrangler.toml
wrangler d1 execute masgames --file=./schema.sql --remote
wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g. `https://masgames-api.YOURNAME.workers.dev`.

## 2. Point the app at your Worker

In **`index.html`**, near the top of the `<script>`:

```js
const API_BASE = "https://masgames-api.YOURNAME.workers.dev";
```

Leave the `REPLACE-ME` default and the app still runs — the offline **Solo game** works, but live rooms and the board view need the Worker.

## 3. Host the frontend

Push to GitHub, then **Settings → Pages → deploy from branch** (`main`, root `/`).

## 4. Install on your phone

- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** tap the **Install** prompt

---

## How to play

1. **Host** taps **Host a game** → picks a deck from the list → gets a **room code + QR**. (Generating a new deck lives in **⚙ → Create a new deck**, not in the host flow.)
2. Everyone else taps **📲 Join a game** and enters the code.
3. Host taps **👥 Set up teams** — choose 2–4 teams, tap players to move them, rename teams, or auto-assign.
4. Host opens **📺 Board view** on a TV/laptop:
   `board.html?code=ROOMCODE&api=YOUR_WORKER_URL`
5. **▶ Start** — the describer's phone shows the secret word (or a drawing canvas). Team-mates shout answers; tap **Got it** for each. When the clock stops, the team moves that many spaces.

**Solo game** on the home screen plays a full local game against bots — no key, no Worker, works offline. It skips the lobby (nothing to share) and drops you straight on the team screen; the bots start, play and end their own turns. Every solo team always fields **two players**: pick 2/3/4 teams and the bot bench grows to match (you get a bot team-mate; 4 teams means you + 7 bots), with bot teams named after their pair ("Bazza & Wazza"). Live teams take any size — players are dealt round-robin and can be tapped between teams. Solo and live share the same game screens — lobby, teams, turn (countdown ring, one pip per correct answer, the word in its category's colours), all-play/finish control turns and the result — so solo is also the visual reference for live.

The phones celebrate with the board: a spinner bonus sets off fireworks and a "+1 PLACE!" banner on every phone in the room (each spin exactly once), winning an all-play pops the team's name, and the result screen opens with a full fireworks show — all drawn on one particle canvas (`FX` in index.html) with matching vibration patterns. Teams that aren't guessing see the secret word (and the live drawing) during another team's turn, so the whole room is in on the answer while the guesses fly.

The Host/Join animated backdrop (`join-bg.webm`, one shared video element) appears in exactly four places: the Host and Join screens, solo's team-setup screen, and the winners page — mid-game turns stay on a plain backdrop so the word is the loudest thing on screen, and the video pauses whenever it's hidden. During a turn one bar carries everything: the active team as a loud named pill with its board position, the other teams as a coloured dot + position (the TV board has the full detail). The winners page is trophy, gradient name + gold "wins!", and gold/silver/bronze medal standings, with no buttons — the header ✕ leaves, like every screen. A renderer gotcha lives in the countdown-ring styling: `filter: drop-shadow` on the arc promoted a compositing layer whose square edge rendered as a visible slab, so the glow is a round `box-shadow` on the container instead.

There is no card-by-card player: the phone-as-deck mode (with its round timer and standalone scoreboard) was from before the board game existed and has been removed. Picking a deck selects it and shows **All cards**; playing happens in a live room.

## Your crew's vibe

A persistent crew profile (*Aussie, born early '80s, love American pop culture*) is mixed into every AI-generated deck. It has no menu editor any more — it lives in `DEFAULT_GROUP` / `localStorage`. **Theme** is the per-deck topic on top of that.

The menu is **🃏 Decks**, **♻️ Reset game** and **🔑 AI key** — Decks expands in place rather than opening a separate page. Expanding Decks lists the 10 built-in decks. **✨ Create a new deck** is a free-text brief plus Difficulty and Audience — format and card count aren't settings: every card is a Word Smash word across all 7 categories, and every deck is **210 cards** (30 per category), generated in 2 batches of 105. Picking a deck opens **All cards** so you can review it before hosting.

## Files

| Path | What |
|---|---|
| `index.html` | The phone app (UI + logic) |
| `wordsmash.js` | Board + category definitions (shared by app and board view) |
| `live.js` | Live multiplayer: rooms, polling sync, turn flow, team setup, drawing, local demo |
| `decks.js` | 10 built-in decks — **210 words each** (30 per category), plus a `blurb` and `icon` shown when you pick one to host |
| `board.html` | TV/laptop board display |
| `qr.js` | Self-contained QR generator (MIT, Kazuhiko Arase) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | PWA / installable app assets |
| `home-bg.webm` | Animated full-screen home backdrop with the logo baked in (VP9, 6s loop) — from `logo/word_smash_new_logo_loop.webm`; runs up behind the transparent app bar, strapline and buttons overlay its lower third |
| `home-bg.jpg` | Still poster for the above, and the fallback if autoplay is blocked |
| `join-bg.webm` | Animated join screen backdrop (VP9, 8s loop, 226 KB) — from `logo/word_smash_animated_background.webm` |
| `join-bg.jpg` | Still poster for the above, and the fallback if autoplay is blocked (44 KB) |
| `wordsmash-logo.png` | Full logo (card backs, board centre) |
| `wordsmash-mark.png` | Small logo (header, board view) |
| `logo/` | Original source images |
| `make-icons.py` | Rebuilds app icons from the logo |
| `worker/src/worker.js`, `worker/schema.sql`, `worker/wrangler.toml` | Cloudflare Worker + D1 |

## Brand

Cyan `#00E5FF` · purple `#8A2BE2` · gold `#FFD100` · mint `#00FFC6` on near-black `#0B0F17`. Tagline **SKETCH · SHOUT · SCORE**. Phone layout is tuned for **iPhone 16 (393 × 852)**.

## Notes

- The Worker allows CORS from any origin (`*`). To lock it down, edit `Access-Control-Allow-Origin` in `worker/src/worker.js`.
- Saved "Mine" decks are tied to an anonymous id in your browser, so they're per-device unless you open a shared link elsewhere.
- Scattergories was removed from this app and is earmarked as a separate standalone game.
- Rules researched from [UltraBoardGames](https://www.ultraboardgames.com/articulate/game-rules.php), [Wikipedia](https://en.wikipedia.org/wiki/Articulate!) and [Drumond Park](https://www.drumondpark.co.uk/rules/articulate).
