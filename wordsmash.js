// Word Smash — shared game definition.
// Modelled on the real Articulate! board (Drumond Park), plus our DRAW category.
//
// Authentic rules this encodes:
//  * Six categories: Object, Nature, Random, Person, Action, World.
//  * Everyone STARTS on Object.
//  * 30-second turns; you move 1 space per correct answer.
//  * The space you LAND on sets the category for your NEXT turn.
//  * White SPADE spaces = a "control turn": the describer describes to ALL
//    teams and the first team to guess correctly takes the turn.
//  * Landing on an orange (Action) or red (Random) segment that reaches the
//    centre lets you SPIN the spinner for bonus places.
//  * Reaching/passing FINISH triggers a control turn — win it to win the game.
//
// Our addition: DRAW (sketch it instead of describing it).
(function () {
  "use strict";

  // Category colours follow the real board (Object light blue, Nature green,
  // Random red, Person yellow, Action orange, World royal blue) tuned to our
  // neon palette. DRAW is ours; SPADE is the white control space.
  const CATEGORIES = {
    OBJECT: { label: "Object", short: "OBJ",  c1: "#00E5FF", c2: "#0098c9", ink: "#04141c", verb: "Describe" },
    NATURE: { label: "Nature", short: "NAT",  c1: "#43e97b", c2: "#16a34a", ink: "#04160a", verb: "Describe" },
    RANDOM: { label: "Random", short: "RND",  c1: "#ff2d55", c2: "#b5152f", ink: "#ffffff", verb: "Describe" },
    PERSON: { label: "Person", short: "PER",  c1: "#FFD100", c2: "#e08700", ink: "#1a1200", verb: "Describe" },
    ACTION: { label: "Action", short: "ACT",  c1: "#ff7a1a", c2: "#d1490a", ink: "#1a0c00", verb: "Describe" },
    WORLD:  { label: "World",  short: "WLD",  c1: "#4361ee", c2: "#2b3fb8", ink: "#ffffff", verb: "Describe" },
    DRAW:   { label: "Draw it", short: "DRW", c1: "#8A2BE2", c2: "#5b1a9a", ink: "#ffffff", verb: "Draw" },
    SPADE:  { label: "Spade · all play", short: "♠", c1: "#f2f6ff", c2: "#c9d6ee", ink: "#0B0F17", verb: "Describe" },
  };

  // Real board order, with DRAW woven in as a 7th step.
  const CYCLE = ["OBJECT", "NATURE", "RANDOM", "PERSON", "ACTION", "WORLD", "DRAW"];
  const SPADE_EVERY = 8;   // a white spade/control space every 8th step
  const TOTAL = 48;        // segments around the ring (the full board)
  const TURN_SECONDS = 30; // authentic 30-second turns

  // BOARD[i] = { cat, spade, spinner }
  // Spinner spaces are the Action/Random segments, matching "orange or red".
  // Same rules at any size, so the short board keeps the full board's rhythm:
  // seven categories in a row, then a white spade to close the lap.
  function makeBoard(total) {
    const b = []; let ci = 0;
    for (let i = 0; i < total; i++) {
      if ((i + 1) % SPADE_EVERY === 0) { b.push({ cat: "SPADE", spade: true, spinner: false }); continue; }
      const cat = CYCLE[ci++ % CYCLE.length];
      b.push({ cat, spade: false, spinner: cat === "ACTION" || cat === "RANDOM" });
    }
    b[0] = { cat: "OBJECT", spade: false, spinner: false }; // everyone starts on Object
    return b;
  }

  // The full game, untouched.
  const BOARD = makeBoard(TOTAL);
  const WIN_POS = BOARD.length;
  // The quick game: its own board, three laps of the cycle instead of six, with
  // its own finish. Nothing is shared with the 48 board but the rules that build
  // it, so changing one can never move the other one's finish line.
  const SHORT_TOTAL = 24;
  const BOARD_SHORT = makeBoard(SHORT_TOTAL);

  // Centre spinner shares the board's segments — same angles, same colours — so
  // the inner wheel lines up radially with the outer ring and reads as one
  // continuous board. A handful of those segments pay out; nothing marks them,
  // so a spin gives nothing away until the reveal.
  // Each board carries its own paying slices at roughly the same odds: the short
  // game has half the turns, so it needs a slightly richer wheel to land a
  // bonus at all.
  const SPIN_BONUS = { 5: 1, 14: 1, 23: 1, 33: 1, 42: 1, 11: 2, 29: 2 };          // 7 of 48
  const SPIN_BONUS_SHORT = { 3: 1, 12: 1, 20: 1, 8: 2 };                          // 4 of 24
  const SPIN_LABEL = { 0: "No bonus", 1: "+1 place", 2: "+2 places" };

  // Everything that depends on how big the board is, bundled per board so a
  // session can hand the whole set around by length.
  function makeGeom(board, bonus) {
    const slices = board.length;
    const sweep = 360 / slices;
    // [{ i, a0, sweep, cat, places }] — angles identical to board[i]
    const spinnerLayout = [];
    for (let i = 0; i < slices; i++) {
      spinnerLayout.push({ i, a0: i * sweep, sweep, cat: board[i].cat, places: bonus[i] || 0 });
    }
    // Odds are simply how many paying segments there are.
    const SPINNER = [0, 1, 2].map(p => {
      const n = spinnerLayout.filter(x => x.places === p).length;
      return { places: p, label: SPIN_LABEL[p], slices: n, chance: n / slices };
    });
    // Land on a segment; that segment IS the outcome.
    function spin() {
      const seg = spinnerLayout[Math.floor(Math.random() * spinnerLayout.length)];
      return {
        kind: seg.places ? "win" + seg.places : "none",
        label: SPIN_LABEL[seg.places],
        places: seg.places,
        slice: seg.i,
        angle: seg.a0 + seg.sweep / 2,
      };
    }
    const spaceAt = pos => board[Math.max(0, Math.min(board.length - 1, pos | 0))];
    return {
      BOARD: board, WIN_POS: board.length, TOTAL: board.length,
      SPIN_SLICES: slices, SPIN_BONUS: bonus, spinnerLayout, SPINNER, spin,
      spaceAt,
      catAt: pos => spaceAt(pos).cat,
      isSpade: pos => !!spaceAt(pos).spade,
      isSpinner: pos => !!spaceAt(pos).spinner,
    };
  }

  const GEOM = {
    48: makeGeom(BOARD, SPIN_BONUS),
    24: makeGeom(BOARD_SHORT, SPIN_BONUS_SHORT),
  };
  // Lengths a host can choose, longest first is deliberate: the full game is the
  // default and sits at the top of the list.
  const LENGTHS = [
    { spaces: 48, label: "Full game", note: "48 spaces · about 40 min" },
    { spaces: 24, label: "Quick game", note: "24 spaces · about 20 min" },
  ];
  // Anything unrecognised (old sessions written before this existed) is a full game.
  const boardFor = len => GEOM[+len === 24 ? 24 : 48];

  // Team colours deliberately avoid the board's palette (cyan, green, red,
  // yellow, orange, royal blue, purple, white) so pieces never read as a slice:
  // magenta, slate, bronze and petrol teal are all unused on the board.
  // Slate replaced a near-black charcoal, which was legible as a token on the
  // bright board but vanished against the app's own near-black panels.
  const TEAM_COLORS = [
    { c1: "#FF2FD0", c2: "#A8107F", name: "Magenta" },
    { c1: "#8D9AB8", c2: "#495468", name: "Slate" },
    { c1: "#C77B2A", c2: "#6F4210", name: "Bronze" },
    { c1: "#12A8A8", c2: "#05595C", name: "Petrol" },
  ];

  // Words of one category from a deck of {badge, title} cards.
  function wordsFor(cards, cat) {
    const want = String(cat || "").toUpperCase();
    return (cards || []).filter(c => c && c.title && String(c.badge || "").toUpperCase() === want).map(c => c.title);
  }

  // Deterministic shuffle. Every phone and the board derive the word from the
  // same pointer, so they must all shuffle a category into the SAME order — a
  // plain Math.random() shuffle would show four players four different words.
  // The seed is stored on the game state, so a new game reorders every category
  // and a group playing twice on one deck never gets the same run of words.
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function shuffled(arr, seedNum) {
    const a = arr.slice();
    let s = seedNum >>> 0;
    const rnd = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const v = a[i]; a[i] = a[j]; a[j] = v; }
    return a;
  }
  const poolCache = new Map();

  // SPADE is a control turn on any subject, so it draws from everything.
  // Also falls back to the whole deck if a category has no words.
  // Pass the game's seed to get that game's shuffled order (cached — this is
  // called on every render).
  function poolFor(cards, cat, seed) {
    const all = () => (cards || []).filter(c => c && c.title).map(c => c.title);
    let base;
    if (String(cat).toUpperCase() === "SPADE") base = all();
    else { const w = wordsFor(cards, cat); base = w.length ? w : all(); }
    if (seed === undefined || seed === null || seed === "") return base;
    const key = seed + "|" + cat + "|" + base.length;
    if (!poolCache.has(key)) {
      if (poolCache.size > 64) poolCache.clear();
      poolCache.set(key, shuffled(base, hashStr(key)));
    }
    return poolCache.get(key);
  }

  window.WORDSMASH = {
    CATEGORIES, CYCLE, TURN_SECONDS, TEAM_COLORS,
    // the full board's geometry stays on the root, so anything that never asked
    // about length keeps working and keeps getting the 48 board
    ...GEOM[48],
    LENGTHS, boardFor,
    wordsFor, poolFor,
  };
})();
