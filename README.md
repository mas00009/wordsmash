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
| 🎯 Spinner | Landing on an **Action (orange)** or **Random (red)** segment spins the centre wheel. It shares the board's segments and colours, so the inner wheel lines up radially with the outer ring. Nothing marks the paying slices — the needle spins and **the slice it lands on is the result**. A payout is not applied automatically: the team that earned it chooses to **take the places, or knock that many off a rival team**. Full board: +1 place (5 of 48, ~10%), +2 places (2 of 48, ~4%). Quick board: +1 (3 of 24, ~13%), +2 (1 of 24, ~4%) — a touch richer because there are half as many turns to land one. Those board spaces carry a ⟳ spin icon. |
| Draw | Describer **sketches** on a canvas that syncs to every phone |
| Finish | Reaching/passing **FINISH** triggers a control turn — **you must win it to win**, otherwise you stay there and retry next turn. On the board it's the only cyan→purple space, capped with a chequered flag |
| ⏭ Skip | **Rationed** — 1 per turn by default (0–3 in **⚙ → Game settings**). A spent skip stays in the row, dimmed, so the button under your thumb never moves mid-turn |
| ↩️ Undo | **Got it** offers a 4-second **Undo** pill. It only stands for that word, that turn, that describer; a skip, another Got it, or the turn ending retires it |
| ⏰ Time | At 0:00 the board buzzes and shows **TIME'S UP!**; every phone in the room vibrates and the describer's phone ends the turn. If that phone has locked or dropped off, the **host's** device ends it 3s later and **anyone's** at 6s, so the room is never stuck on a dead clock |

Board: **two of them**, chosen by the host in **⚙ → Game settings** before the room is created.

| Length | Segments | Spades | Spinner | Roughly |
|---|---|---|---|---|
| **Full** | 48 | 6 (every 8th) | 7 paying slices of 48 | 40 min |
| **Quick** | 24 | 3 (every 8th) | 4 paying slices of 24 | 20 min |

Both are built by the same rule (seven categories, then a white spade to close the lap) so the quick board keeps the full board's rhythm rather than being a truncated one, and each carries its own spinner at matching odds. They're separate arrays: changing one can't move the other one's finish line. The board view reads `state.boardLen` and draws whichever it is — fewer, wider slices around the same ring. A session written before this existed has no `boardLen` and gets the full board.

Every ring is drawn from `BOARD.length`, inside a rainbow neon bezel, as SVG so it scales to a TV.

**Sound is on by default.** Browsers refuse to start audio until someone interacts with the page, and a board sitting on a TV never gets touched — so a small mute icon in the corner meant it stayed silent all night. Now the whole screen asks once ("Tap anywhere for sound") and any tap or key anywhere satisfies the browser; the prompt disappears the instant audio starts. The corner icon is a deliberate mute toggle, remembered per device, defaulting to unmuted.

**Board audio** is synthesised in the page — no sample files, no extra request, works offline. One voice function (oscillator → filter → envelope) plus a noise source and a reverb built from a generated impulse, so a token run, a wheel spin and a win all sound like the same instrument. Sounds are written in C so overlapping events agree with each other. `createAudio(ctx, dest)` takes its context, which is how every sound is checked: render it through an `OfflineAudioContext` and assert it is audible, the right length, and not clipping — the levels are deliberately ordered so the win and the buzzer are the loudest things on the board and the one-a-second countdown tick is the quietest.

The real game's spinner gives +2/+3; ours is tuned to +1/+2 with much lower odds so a bonus feels like a treat. The odds aren't a weighted table — they're literally how many diamond slices are on the wheel, so what you see is what you get.

- The **host sets up teams** after players join.
- A separate **board view** runs on a TV or laptop, showing team tokens moving live.

## Live

- **Play:** https://mas00009.github.io/wordsmash/
- **Board (TV):** https://mas00009.github.io/wordsmash/board.html?code=ROOMCODE
- **API:** https://masgames-api.mmohammad.workers.dev (Cloudflare Worker + D1)
- **Repo:** https://github.com/mas00009/wordsmash

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

1. **Host** taps **Host a game** → picks a deck from the list → gets a **room code**. (Generating a new deck lives in **⚙ → Create a new deck**, and game length/skips in **⚙ → Game settings**, not in the host flow.)
2. Everyone else taps **📲 Join a game** and enters the code.
3. Host taps **👥 Set up teams** — choose 2–4 teams, tap players to move them, rename teams, or auto-assign.
4. Host opens **📺 Board view** on a TV/laptop:
   `board.html?code=ROOMCODE&api=YOUR_WORKER_URL`
5. **▶ Start** — the describer's phone shows the secret word (or a drawing canvas). Team-mates shout answers; tap **Got it** for each. When the clock stops, the team moves that many spaces.

**Solo game** on the home screen plays a full local game against bots — no key, no Worker, works offline. It skips the lobby (nothing to share) and drops you straight on the team screen; the bots start, play and end their own turns. Every solo team always fields **two players**: pick 2/3/4 teams and the bot bench grows to match (you get a bot team-mate; 4 teams means you + 7 bots), with bot teams named after their pair ("Bazza & Wazza"). Live teams take any size — players are dealt round-robin and can be tapped between teams. Solo and live share the same game screens — lobby, teams, turn (countdown ring, one pip per correct answer, the word in its category's colours), all-play/finish control turns and the result — so solo is also the visual reference for live.

The phones celebrate with the board: a spinner bonus sets off fireworks and a "+1 PLACE!" banner on every phone in the room (each spin exactly once), winning an all-play pops the team's name, and the result screen opens with a full fireworks show — all drawn on one particle canvas (`FX` in index.html) with matching vibration patterns. Teams that aren't guessing see the secret word (and the live drawing) during another team's turn, so the whole room is in on the answer while the guesses fly.

The Host/Join animated backdrop (`join-bg.webm`, one shared video element) appears in exactly four places: the Host and Join screens, solo's team-setup screen, and the winners page — mid-game turns stay on a plain backdrop so the word is the loudest thing on screen, and the video pauses whenever it's hidden. During a turn one bar carries everything: the active team as a loud named pill with its board position, the other teams as a coloured dot + position (the TV board has the full detail). The winners page is trophy, gradient name + gold "wins!", and gold/silver/bronze medal standings, with no buttons — the header ✕ leaves, like every screen. A renderer gotcha lives in the countdown-ring styling: `filter: drop-shadow` on the arc promoted a compositing layer whose square edge rendered as a visible slab, so the glow is a round `box-shadow` on the container instead.

**One clock, not five.** The turn deadline is an absolute timestamp one phone writes and the whole room reads, and phone and laptop clocks sit seconds apart in practice. So every Worker response carries `now`, each client keeps the reading from its fastest round-trip, and all countdowns are drawn from that shared clock. A device 7 seconds fast shows the same number as everyone else instead of running the turn out early.

**No repeats between games.** Each category is shuffled deterministically from a per-game `seed` on the state, so every phone and the board derive the same word from the same pointer, and the same deck never deals the same run of words twice. Before this, only the starting offset was random and the order was fixed, so a second game replayed the first.

There is no card-by-card player: the phone-as-deck mode (with its round timer and standalone scoreboard) was from before the board game existed and has been removed. Picking a deck selects it and shows **All cards**; playing happens in a live room.

## Your crew's vibe

A persistent crew profile (*Aussie, born early '80s, love American pop culture*) is mixed into every AI-generated deck. It has no menu editor any more — it lives in `DEFAULT_GROUP` / `localStorage`. **Theme** is the per-deck topic on top of that.

The menu is **🃏 Decks**, **🕐 Game settings**, **✨ Create a new deck**, **♻️ Reset game** and **🔑 AI key** — sections expand in place rather than opening a separate page. **Game settings** is game length (Full 48 / Quick 24) and skips per turn (0–3). They live in `localStorage` on the host's device and are **baked into the room state when it's created**, so everyone plays the host's game and changing a setting can never move the finish line of a game already running. The lobby prints the terms under the room code ("QUICK GAME · 24 SPACES · ONE SKIP A TURN") so nobody is surprised 20 minutes in. Expanding Decks lists the 10 built-in decks. **✨ Create a new deck** is a free-text brief plus Difficulty and Audience — format and card count aren't settings: every card is a Word Smash word across all 7 categories, and every deck is **210 cards** (30 per category), generated in 2 batches of 105. Picking a deck opens **All cards** so you can review it before hosting.

**Deck size and why it matters.** A 48-space game runs ~40 turns spread over 7 categories, so one category comes up ~6 times and, at ~6 cards a turn, a single game draws **about 40 cards out of one category**. At 30 a category the pool ran dry mid-game and started repeating — which is exactly what happened the first time it was played with a family. Every deck now holds **200 a category (1,400 a deck)**, so a whole game uses under a quarter of the pool and cannot repeat. Checked across all 70 deck/category pairs: a game's worth of draws produces zero repeats.

## Files

| Path | What |
|---|---|
| `index.html` | The phone app (UI + logic) |
| `wordsmash.js` | Board + category definitions (shared by app and board view) |
| `live.js` | Live multiplayer: rooms, polling sync, turn flow, team setup, drawing, local demo |
| `decks.js` | 10 built-in decks, **200 words a category — 1,400 cards a deck, 14,000 in total**. Run `node tools/deckcheck.js` to verify |
| `tools/deckcheck.js` | Deck integrity check. Reports per deck and category: count, duplicates, and how many words short of target. `--fix` drops duplicates and trims overflow (it never invents words). 14,000 hand-written strings is past what anyone can keep straight by eye |
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
