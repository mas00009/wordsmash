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
  const TOTAL = 48;        // segments around the ring
  const TURN_SECONDS = 30; // authentic 30-second turns

  // BOARD[i] = { cat, spade, spinner }
  // Spinner spaces are the Action/Random segments, matching "orange or red".
  const BOARD = (function () {
    const b = []; let ci = 0;
    for (let i = 0; i < TOTAL; i++) {
      if ((i + 1) % SPADE_EVERY === 0) { b.push({ cat: "SPADE", spade: true, spinner: false }); continue; }
      const cat = CYCLE[ci++ % CYCLE.length];
      b.push({ cat, spade: false, spinner: cat === "ACTION" || cat === "RANDOM" });
    }
    b[0] = { cat: "OBJECT", spade: false, spinner: false }; // everyone starts on Object
    return b;
  })();
  const WIN_POS = BOARD.length;

  // Centre spinner shares the board's 48 segments — same angles, same colours —
  // so the inner wheel lines up radially with the outer ring and reads as one
  // continuous board. A handful of those segments pay out; nothing marks them,
  // so a spin gives nothing away until the reveal.
  const SPIN_SLICES = TOTAL;                       // aligned with the board
  const SPIN_BONUS = { 5: 1, 14: 1, 23: 1, 33: 1, 42: 1, 11: 2, 29: 2 };
  const SPIN_LABEL = { 0: "No bonus", 1: "+1 place", 2: "+2 places" };

  // [{ i, a0, sweep, cat, places }] — angles identical to BOARD[i]
  const spinnerLayout = (function () {
    const sweep = 360 / SPIN_SLICES, out = [];
    for (let i = 0; i < SPIN_SLICES; i++) {
      out.push({ i, a0: i * sweep, sweep, cat: BOARD[i].cat, places: SPIN_BONUS[i] || 0 });
    }
    return out;
  })();

  // Odds are simply how many paying segments there are.
  const SPINNER = [0, 1, 2].map(p => {
    const n = spinnerLayout.filter(x => x.places === p).length;
    return { places: p, label: SPIN_LABEL[p], slices: n, chance: n / SPIN_SLICES };
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

  const spaceAt = pos => BOARD[Math.max(0, Math.min(BOARD.length - 1, pos | 0))];
  const catAt = pos => spaceAt(pos).cat;
  const isSpade = pos => !!spaceAt(pos).spade;
  const isSpinner = pos => !!spaceAt(pos).spinner;

  // Words of one category from a deck of {badge, title} cards.
  function wordsFor(cards, cat) {
    const want = String(cat || "").toUpperCase();
    return (cards || []).filter(c => c && c.title && String(c.badge || "").toUpperCase() === want).map(c => c.title);
  }
  // SPADE is a control turn on any subject, so it draws from everything.
  // Also falls back to the whole deck if a category has no words.
  function poolFor(cards, cat) {
    if (String(cat).toUpperCase() === "SPADE") return (cards || []).filter(c => c && c.title).map(c => c.title);
    const w = wordsFor(cards, cat);
    return w.length ? w : (cards || []).filter(c => c && c.title).map(c => c.title);
  }

  window.WORDSMASH = {
    CATEGORIES, CYCLE, BOARD, WIN_POS, TOTAL, TURN_SECONDS,
    SPINNER, SPIN_SLICES, SPIN_BONUS, spinnerLayout, TEAM_COLORS,
    spaceAt, catAt, isSpade, isSpinner, spin, wordsFor, poolFor,
  };
})();
