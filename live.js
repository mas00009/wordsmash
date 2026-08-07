// Word Smash — live multiplayer.
// Flow: host picks a deck -> lobby (room code) -> host sets teams -> play.
// A turn: the board space under your team gives the category; the describer
// gets words of that category (or DRAWS them) against the clock; every correct
// answer is one space forward. First team to the end wins.
// Uses globals from index.html: $, esc, API_BASE, cloudOn, userId, deck,
// setDeckSub, setDeckGame, saveDeck, renderPlayer, showToast, hideToast,
// makeQR, buzz, generate, setPageTitle. Board data from wordsmash.js.
(function () {
  "use strict";
  const POLL_MS = 1500;
  const DRAW_COLORS = ["#111111", "#ff2d78", "#7c3aed", "#00b3a4", "#ff7a1a", "#2b6cff"];
  const CANVAS_RES = 512;
  const M = () => window.WORDSMASH;

  let S = null, liveCode = null, isHost = false, myName = "";
  let liveMode = "none";                 // 'join' | 'session'
  let pollT = null, lastV = 0, lastKey = "", acting = false;
  let myStrokes = [], curStroke = null, drawColorIdx = 1, lastUpload = 0, drawDirty = false;
  // solo (local, no Worker — a mock backend plus scripted bots)
  let demo = false, solo = false, demoUA = 1, botGuard = "";
  // Enough bots that every solo team always fields TWO players (you get a bot
  // team-mate; 4 teams needs you + 7 of them).
  const BOTS = [
    { id: "bot1", name: "Bazza" }, { id: "bot2", name: "Shazza" }, { id: "bot3", name: "Dazza" },
    { id: "bot4", name: "Gazza" }, { id: "bot5", name: "Wazza" }, { id: "bot6", name: "Muzza" },
    { id: "bot7", name: "Tezza" },
  ];
  const soloBotsFor = n => BOTS.slice(0, n * 2 - 1);
  // Keep the mock room's player entries in step with how many bots are playing.
  async function syncSoloBots(n) {
    const need = soloBotsFor(n);
    for (const b of need) if (!demoStore.entries[b.id + "|player"]) await localEntry(b.id, "player", { name: b.name });
    const keep = need.map(b => b.id);
    Object.keys(demoStore.entries).forEach(k => {
      const pid = k.split("|")[0];
      if (pid.indexOf("bot") === 0 && keep.indexOf(pid) < 0) delete demoStore.entries[k];
    });
  }
  // Honest solo names: your side is "Your team", a bot pair is "Bazza & Dazza".
  function soloNames(st) {
    st.teams.forEach(t => {
      const m = t.members || [];
      if (m.includes(userId)) t.name = "Your team";
      else t.name = m.map(pid => (BOTS.find(b => b.id === pid) || {}).name || "Bot").join(" & ") || "The Bots";
    });
  }
  let timeUpKey = 0;   // so the time-up buzz fires once per turn
  let spinFxKey = "", spinOutKey = "", stealFxKey = "", overFx = false;   // celebrate each event once
  let spinRevealT = 0, spinHoldT = 0;                    // build-up -> hold -> reveal
  const demoStore = { session: null, entries: {} };

  myName = localStorage.getItem("masgames_name") || "";

  const inner = () => $("liveInner");
  const openLive = () => {
    $("liveView").classList.add("open");
    if (typeof syncHomeMark === "function") syncHomeMark();
  };
  // always clear the app bar's ✕ on the way out, whichever screen closed
  const closeLive = () => {
    $("liveView").classList.remove("open");
    $("liveView").classList.remove("artbg");
    $("liveView").classList.remove("game");
    $("liveView").classList.remove("vid");
    const bg = $("joinBg"); if (bg) bg.pause();     // don't decode it off-screen
    dropUndo();
    if (typeof syncHomeMark === "function") syncHomeMark();
    if (typeof setHeaderClose === "function") setHeaderClose(null);
  };
  // autoplay fires once and a paused video stays paused (backgrounded tab, iOS
  // Low Power Mode), so nudge it whenever the join screen is shown. If it's
  // blocked the poster still shows the same artwork, just not moving.
  function playJoinBg() {
    const v = $("joinBg");
    if (!v) return;
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    const c = $("liveView").classList;
    if (!document.hidden && (c.contains("artbg") || c.contains("vid"))) playJoinBg();
  });

  const title = t => { if (typeof setPageTitle === "function") setPageTitle(t); };

  // ---------- server clock ----------
  // The turn deadline is an absolute timestamp written by one phone and read by
  // every other phone and the TV. Phone and laptop clocks can sit seconds apart,
  // which showed the room two different countdowns. So we take the Worker's
  // clock as the only clock: every response carries `now`, and we keep the
  // reading from the fastest round-trip we've seen (the least guesswork about
  // how much of the trip was outbound).
  let skew = 0, skewRtt = Infinity;
  function noteServerTime(serverNow, t0, t1) {
    if (!serverNow) return;
    const rtt = t1 - t0;
    if (rtt > skewRtt + 40) return;             // an obviously slower sample
    skewRtt = rtt;
    skew = serverNow - (t0 + rtt / 2);          // assume the trip split evenly
  }
  // Use everywhere a turn deadline is written or read. Falls back to the device
  // clock until the first response lands, and if the Worker is old enough not to
  // send `now` the skew simply stays 0 and nothing changes.
  const srvNow = () => Date.now() + skew;

  async function api(path, method, body) {
    if (demo) return localApi(path, method, body);
    const t0 = Date.now();
    const r = await fetch(API_BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || ("error " + r.status)); e.status = r.status; throw e; }
    const j = await r.json();
    if (j && j.now) noteServerTime(j.now, t0, Date.now());
    return j;
  }

  // ---------- local mock backend (demo mode) ----------
  const snapshot = () => { const s = demoStore.session; return { code: s.code, host: s.host, game: s.game, deck: s.deck, state: s.state, entries: Object.values(demoStore.entries), updated_at: s.updated_at }; };
  function localApi(path, method, body) {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    if (method === "POST" && parts[1] === "session" && parts.length === 2) {
      demoStore.session = { code: "DEMO", host: body.host, game: body.game, deck: body.deck, state: body.state, updated_at: ++demoUA };
      demoStore.entries = {}; return Promise.resolve({ code: "DEMO" });
    }
    if (method === "GET" && parts.length === 3) {
      const v = new URLSearchParams(path.split("?")[1] || "").get("v");
      if (v && String(demoStore.session.updated_at) === v) return Promise.resolve({ unchanged: true, updated_at: demoStore.session.updated_at });
      return Promise.resolve(snapshot());
    }
    const sub = parts[3];
    if (method === "POST" && sub === "state") {
      const cur = demoStore.session.state;
      if (typeof body.expectedRev === "number" && (cur.rev || 0) !== body.expectedRev) { const e = new Error("conflict"); e.status = 409; return Promise.reject(e); }
      demoStore.session.state = body.state; demoStore.session.updated_at = ++demoUA;
      return Promise.resolve({ ok: true, updated_at: demoStore.session.updated_at });
    }
    if (method === "POST" && sub === "entry") {
      demoStore.entries[body.player + "|" + body.kind] = { player: body.player, kind: body.kind, data: body.data, updated_at: ++demoUA };
      demoStore.session.updated_at = ++demoUA; return Promise.resolve({ ok: true });
    }
    if (method === "POST" && sub === "clear") {
      Object.keys(demoStore.entries).forEach(k => { if (!body.kind || demoStore.entries[k].kind === body.kind) delete demoStore.entries[k]; });
      demoStore.session.updated_at = ++demoUA; return Promise.resolve({ ok: true });
    }
    return Promise.reject(new Error("demo: unknown " + path));
  }
  const localEntry = (player, kind, data) => localApi("/api/session/DEMO/entry", "POST", { player, kind, data });

  // ---------- players / teams ----------
  function players() {
    if (!S) return [];
    return S.entries.filter(e => e.kind === "player" && e.data)
      .sort((a, b) => a.updated_at - b.updated_at)
      .map(e => ({ id: e.player, name: e.data.name || "Player" }));
  }
  const nameOf = pid => (players().find(p => p.id === pid) || {}).name || "Player";
  const teams = () => (S && S.state.teams) || [];
  const activeTeam = () => { const t = teams(); return t.length ? t[(S.state.activeTeam || 0) % t.length] : null; };
  const activeTeamIdx = () => { const t = teams(); return t.length ? (S.state.activeTeam || 0) % t.length : -1; };
  function describerId() {
    const t = activeTeam();
    if (!t || !t.members || !t.members.length) return null;
    return t.members[(t.turnIdx || 0) % t.members.length];
  }
  const amDescriber = () => describerId() === userId;
  const myTeamIdx = () => { const t = teams(); for (let i = 0; i < t.length; i++) if ((t[i].members || []).includes(userId)) return i; return -1; };

  // The board this game is played on: the full 48 or the short 24, whichever
  // the host chose. Old sessions have no boardLen and get the full board.
  const B = () => M().boardFor(S && S.state && S.state.boardLen);
  // The pointer the live undo offer belongs to, or -1 for no offer. The offer
  // only stands for that one word on that one turn: it must not survive into
  // the next team's turn, which is what an offer left on screen would do.
  let undoAt = -1;
  const dropUndo = () => { undoAt = -1; if (typeof hideUndo === "function") hideUndo(); };

  // How many skips the describer gets in a turn (0 = none at all).
  const skipCap = () => { const n = S && S.state && S.state.skipsPerTurn; return n === undefined || n === null ? 1 : Math.max(0, n | 0); };

  // Word pool for the current category, and the current word
  function currentPool() {
    const st = S.state;
    return M().poolFor(S.deck, st.cat || "OBJECT", st.seed);
  }
  function currentWord() {
    const pool = currentPool();
    if (!pool.length) return "…";
    return pool[(S.state.ptr || 0) % pool.length];
  }

  // ---------- lifecycle ----------
  const writePlayer = () => api(`/api/session/${liveCode}/entry`, "POST", { player: userId, kind: "player", data: { name: myName || "Player" } });

  // Host's game settings, set in the menu and baked into the room when it's
  // created — everyone in the room plays the host's game, and changing the
  // setting later can't move the finish line of a game already running.
  function gameSettings() {
    const len = +localStorage.getItem("masgames_boardlen");
    const sk = localStorage.getItem("masgames_skips");
    return {
      boardLen: len === 24 ? 24 : 48,
      skipsPerTurn: sk === null || sk === "" ? 1 : Math.max(0, Math.min(9, +sk | 0)),
    };
  }

  function freshState() {
    const g = gameSettings();
    return { rev: 1, phase: "lobby", flow: "wordsmash", game: "wordsmash",
      teams: [], activeTeam: 0, cat: "OBJECT", ptr: 0, correct: 0,
      turnActive: false, timerEnds: 0, turnSeconds: M().TURN_SECONDS, clearSeq: 0,
      boardLen: g.boardLen, skipsPerTurn: g.skipsPerTurn, skipsUsed: 0, spinRevealAt: 0,
      // reshuffles every category for this game only, so the same deck never
      // deals the same run of words twice
      seed: Math.random().toString(36).slice(2, 10),
      control: null, spinResult: null, spinPick: null, spinOutcome: null, fromSpade: false };
  }

  async function hostGame() {
    if (!demo && !cloudOn()) { showToast("Set up the Worker & API_BASE to play live.", true); return; }
    if (!deck.length) { showToast("Pick a deck first."); return; }
    myName = myName || "Host";
    try {
      const res = await api("/api/session", "POST", { host: userId, game: "wordsmash", deck, state: freshState() });
      liveCode = res.code; isHost = true; liveMode = "session"; lastV = 0; lastKey = "";
      await writePlayer();
      openLive(); startPoll();
    } catch (e) { showToast(e.message, true); }
  }

  async function joinGame(code) {
    if (!cloudOn()) { showToast("This game needs the host's Worker online.", true); return; }
    code = (code || "").trim().toUpperCase();
    if (code.length < 3) { showToast("Enter the room code."); return; }
    myName = myName || "Player";
    liveCode = code; isHost = false; liveMode = "session"; lastV = 0; lastKey = "";
    try {
      const d = await api(`/api/session/${code}`, "GET");
      await writePlayer();
      S = d;
      const st0 = d.state || {};
      if (st0.phase && st0.phase !== "lobby" && (st0.teams || []).length &&
          !(st0.teams || []).some(t => (t.members || []).includes(userId))) {
        await mutate(st => {
          let sm = 0;
          st.teams.forEach((t, i) => {
            if ((t.members || []).length < (st.teams[sm].members || []).length) sm = i;
          });
          (st.teams[sm].members = st.teams[sm].members || []).push(userId);
          return st;
        });
      }
      openLive(); startPoll();
    } catch (e) { showToast(e.status === 404 ? "Game not found. Check the code." : e.message, true); liveMode = "none"; liveCode = null; }
  }

  function leaveLive() {
    stopPoll(); liveCode = null; S = null; liveMode = "none"; lastKey = "";
    spinFxKey = spinOutKey = stealFxKey = ""; overFx = false;
    demo = false; solo = false; demoStore.session = null; demoStore.entries = {};
    title(""); closeLive();
    if (typeof renderPlayer === "function") renderPlayer();
  }

  const startPoll = () => { stopPoll(); poll(); pollT = setInterval(poll, POLL_MS); };
  const stopPoll = () => { if (pollT) clearInterval(pollT); pollT = null; };

  async function poll() {
    if (liveMode !== "session" || !liveCode) return;
    try {
      const d = await api(`/api/session/${liveCode}` + (lastV ? `?v=${lastV}` : ""), "GET");
      if (d.unchanged) return;
      lastV = d.updated_at; S = d; isHost = S.host === userId;
      renderLive();
    } catch (e) { /* transient */ }
  }

  async function mutate(fn) {
    for (let i = 0; i < 5; i++) {
      const old = S.state.rev || 0;
      const ns = fn(JSON.parse(JSON.stringify(S.state)));
      if (!ns) return false;
      ns.rev = old + 1;
      try { await api(`/api/session/${liveCode}/state`, "POST", { state: ns, expectedRev: old }); S.state = ns; renderLive(); return true; }
      catch (e) { if (e.status === 409) { await poll(); continue; } showToast(e.message, true); return false; }
    }
    return false;
  }

  // ---------- host: team setup ----------
  const gotoTeams = () => mutate(st => {
    if (!st.teams.length) {
      const ps = players();
      st.teams = [0, 1].map(i => ({ name: "Team " + (i + 1), pos: 0, members: [], turnIdx: 0 }));
      ps.forEach((p, i) => st.teams[i % 2].members.push(p.id));
    }
    st.phase = "teams"; return st;
  });

  // Changing the count re-deals everyone round-robin. Growing the list used to
  // leave the new teams empty, and Start then refused to run until you noticed
  // and shuffled — the dead end was invisible from the screen. In solo the bot
  // bench grows and shrinks with the count so every team always has two players.
  const setTeamCount = async n => {
    if (solo) { await syncSoloBots(n); lastV = 0; await poll(); }
    return mutate(st => {
      const cur = st.teams.length;
      const roster = solo
        ? [userId].concat(soloBotsFor(n).map(b => b.id))
        : st.teams.flatMap(t => t.members || []);
      for (let i = cur; i < n; i++) st.teams.push({ name: "Team " + (i + 1), pos: 0, members: [], turnIdx: 0 });
      st.teams = st.teams.slice(0, n);
      st.teams.forEach(t => t.members = []);
      roster.forEach((pid, i) => st.teams[i % n].members.push(pid));
      if (solo) soloNames(st);
      return st;
    });
  };

  const cyclePlayer = pid => mutate(st => {
    let from = -1;
    st.teams.forEach((t, i) => { if ((t.members || []).includes(pid)) from = i; });
    st.teams.forEach(t => { t.members = (t.members || []).filter(x => x !== pid); });
    st.teams[(from + 1) % st.teams.length].members.push(pid);
    return st;
  });

  const autoAssign = () => mutate(st => {
    const ps = players().map(p => p.id);
    for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
    st.teams.forEach(t => t.members = []);
    ps.forEach((pid, i) => st.teams[i % st.teams.length].members.push(pid));
    if (solo) soloNames(st);
    return st;
  });

  const renameTeam = (i, name) => mutate(st => { if (st.teams[i]) st.teams[i].name = name.slice(0, 20) || ("Team " + (i + 1)); return st; });

  async function startGame() {
    overFx = false;
    const bad = teams().filter(t => !(t.members || []).length);
    if (bad.length) { showToast("Every team needs at least one player."); setTimeout(hideToast, 2400); return; }
    await mutate(st => {
      st.phase = "play"; st.activeTeam = 0; st.correct = 0; st.turnActive = false; st.timerEnds = 0;
      st.cat = B().catAt(st.teams[0].pos | 0);
      // the pool is shuffled per game now, so the run starts at its own start
      st.ptr = 0;
      return st;
    });
  }

  // ---------- play ----------
  const startTurn = () => { buzz(15); return mutate(st => {
    st.turnActive = true; st.correct = 0; st.spinResult = null; st.skipsUsed = 0;
    st.timerEnds = srvNow() + (st.turnSeconds || M().TURN_SECONDS) * 1000;
    st.cat = B().catAt((st.teams[(st.activeTeam || 0) % st.teams.length].pos) | 0);
    st.clearSeq = (st.clearSeq || 0) + 1;
    return st;
  }); };

  const gotIt = () => { buzz(20); FX.burst(0.5, 0.72, 18, 4.5); myStrokes = []; return mutate(st => {
    st.correct = (st.correct || 0) + 1; st.ptr = (st.ptr || 0) + 1;
    st.clearSeq = (st.clearSeq || 0) + 1; return st;
  }).then(ok => {
    // tie the offer to the word it was made for, so a skip or another Got it in
    // the meantime can't be the thing that gets taken back
    // Only the describer can take one back, and in solo the bots call this too.
    // The turn check matters because this lands a round-trip late: by now the
    // turn may already have been ended, and an offer to undo it would be a lie.
    if (!ok || !amDescriber() || !S.state.turnActive) return ok;
    undoAt = S.state.ptr;
    if (typeof showUndo === "function") showUndo("Counted it", () => undoGotIt(undoAt));
    return ok;
  }); };

  // A fat thumb on "Got it" banks a point and burns a word, and until now there
  // was no way back. Offered for a few seconds after the tap, and only while the
  // same turn is still on the same word.
  const undoGotIt = at => { buzz(15); dropUndo(); return mutate(st => {
    if (!st.turnActive || !(st.correct > 0) || st.ptr !== at) return null;
    st.correct -= 1; st.ptr = Math.max(0, (st.ptr || 0) - 1);
    st.clearSeq = (st.clearSeq || 0) + 1; return st;
  }); };

  const passWord = () => {
    const cap = skipCap(), used = (S.state.skipsUsed || 0);
    if (used >= cap) {
      showToast(cap ? "That's your skip gone. Keep going!" : "No skips in this game. Keep going!");
      setTimeout(hideToast, 1800); buzz(35); return Promise.resolve();
    }
    myStrokes = [];
    dropUndo();
    return mutate(st => {
      st.skipsUsed = (st.skipsUsed || 0) + 1;
      st.ptr = (st.ptr || 0) + 1; st.clearSeq = (st.clearSeq || 0) + 1; return st;
    });
  };

  // End of turn, following the real rules:
  //  1. move forward 1 space per correct answer
  //  2. landing on an orange/red (Action/Random) segment -> spin for bonus places
  //  3. reaching/passing FINISH -> a control turn you must win to take the game
  //  4. if the next team is sitting on a white spade -> their turn is a control turn
  // `expectEnds` guards the automatic time-up path: several devices can race to
  // end the same turn, and the loser of that race retries against fresh state,
  // which would end the NEXT team's turn too. Pass the deadline you saw and the
  // mutation drops out if the turn has already moved on. Manual End presses pass
  // nothing, so the host can always force a turn along.
  async function endTurn(expectEnds) {
    // This is bound straight to onclick in two places, so what arrives here can
    // be a MouseEvent rather than a deadline. Only a real timestamp guards.
    const expect = typeof expectEnds === "number" ? expectEnds : 0;
    if (acting) return; acting = true;
    dropUndo();
    await mutate(st => {
      if (expect && st.timerEnds !== expect) return null;
      const W = B(), n = st.teams.length;
      const i = (st.activeTeam || 0) % n, t = st.teams[i];
      st.spinResult = null; st.spinOutcome = null; st.fromSpade = false;
      t.pos = (t.pos | 0) + (st.correct || 0);

      let pending = null;
      if (st.correct > 0 && t.pos < W.WIN_POS && W.isSpinner(t.pos)) {
        const res = W.spin();
        st.spinResult = { id: Date.now(), label: res.label, places: res.places, angle: Math.floor(Math.random() * 360) };
        // A payout is no longer applied on the spot: the team that earned it
        // chooses whether to take the places or take them off somebody else.
        if (res.places) {
          pending = { team: i, places: res.places, id: st.spinResult.id };
          // the wheel runs for about five and a half seconds on the TV; nobody
          // gets to choose (or even see the number) until it lands
          st.spinRevealAt = srvNow() + 5300;
        }
      }
      t.turnIdx = (t.turnIdx || 0) + 1;
      st.turnActive = false; st.timerEnds = 0; st.correct = 0;
      st.clearSeq = (st.clearSeq || 0) + 1;
      // the word on screen when the turn ended is burned: whoever heard it
      // described must never see it again
      st.ptr = (st.ptr || 0) + 1;

      if (pending) { st.spinPick = pending; return st; }   // hand over to the choice
      return advanceAfterTurn(st, i);
    });
    myStrokes = []; acting = false;
  }

  // Everything that happens once the turn's movement is final: the finish
  // check, then whose turn is next and what kind of turn it is. Split out of
  // endTurn because a spinner payout pauses in between for the team to choose.
  function advanceAfterTurn(st, i) {
    const W = B(), n = st.teams.length, t = st.teams[i];
    if (t.pos >= W.WIN_POS) {           // control turn for the win
      t.pos = W.WIN_POS;
      st.phase = "control"; st.control = { mode: "finish", team: i };
      return st;
    }
    const ni = (i + 1) % n, nt = st.teams[ni];
    st.activeTeam = ni;
    if (nt.pos >= W.WIN_POS) {          // already on FINISH -> retry the control turn
      st.phase = "control"; st.control = { mode: "finish", team: ni };
    } else if (W.isSpade(nt.pos)) {     // white spade -> all play
      st.phase = "control"; st.control = { mode: "spade", team: ni };
    } else {
      st.cat = W.catAt(nt.pos);
    }
    return st;
  }

  // The spinner paid out and the team is choosing what to do with it: take the
  // places themselves, or knock that many off another team.
  async function resolveSpin(mode, targetIdx) {
    if (acting) return; acting = true;
    await mutate(st => {
      const p = st.spinPick;
      if (!p) return null;                       // someone else already chose
      const n = st.teams.length, i = p.team % n;
      if (mode === "back" && targetIdx != null && (targetIdx % n) !== i) {
        const j = targetIdx % n, tgt = st.teams[j];
        tgt.pos = Math.max(0, (tgt.pos | 0) - p.places);
        st.spinOutcome = { kind: "back", team: j, by: i, places: p.places, id: p.id };
      } else {
        st.teams[i].pos = (st.teams[i].pos | 0) + p.places;
        st.spinOutcome = { kind: "forward", team: i, places: p.places, id: p.id };
      }
      st.spinPick = null; st.spinRevealAt = 0;
      return advanceAfterTurn(st, i);
    });
    acting = false;
  }

  // Control turn resolved: whichever team guessed first takes the turn.
  // On a FINISH control, the finishing team winning it ends the game.
  async function awardControl(teamIdx) {
    if (acting) return; acting = true;
    await mutate(st => {
      const W = M(), c = st.control || {};
      // The describer of the control turn has now had their go, so their team's
      // rotation moves on. Without this a team that keeps winning all-plays (or
      // keeps retrying the finish) hands the phone to the same person forever.
      const ct = st.teams[(c.team | 0) % st.teams.length];
      if (ct) ct.turnIdx = (ct.turnIdx || 0) + 1;
      if (c.mode === "finish" && teamIdx === c.team) { st.phase = "over"; st.control = null; return st; }
      st.phase = "play"; st.control = null;
      st.activeTeam = teamIdx;
      st.skipsUsed = 0;
      const t = st.teams[teamIdx];
      // A spade is "any category", so pick one for their turn.
      st.cat = W.CYCLE[Math.floor(Math.random() * W.CYCLE.length)];
      st.fromSpade = true;
      st.turnActive = false; st.timerEnds = 0; st.correct = 0;
      st.clearSeq = (st.clearSeq || 0) + 1;
      return st;
    });
    acting = false;
  }

  // ---------- rendering ----------
  function renderLive() {
    if (liveMode !== "session" || !S) return;
    const st = S.state;
    const key = [st.phase, (st.control && st.control.mode) || "", activeTeamIdx(), st.turnActive, amDescriber(), st.cat, st.ptr, st.clearSeq, st.skipsUsed, (st.spinPick ? st.spinPick.id + (spinHeld() ? "|hold" : "|pick") : ""), teams().length, st.teams.map(t => (t.members || []).length).join(",")].join("|");
    if (key !== lastKey) {
      // a banner mid-pop straddling a screen change reads as a glitch
      if (lastKey && lastKey.split("|")[0] !== st.phase && window.FX && FX.soften) FX.soften();
      // an undo offer only stands for the word, turn and describer it was made
      // for; anything else moving on retires it
      if (undoAt >= 0 && (!st.turnActive || st.ptr !== undoAt || !amDescriber())) dropUndo();
      build(); lastKey = key;
    }
    updateDynamic();
  }

  const headerClose = fn => { if (typeof setHeaderClose === "function") setHeaderClose(fn); };

  // Every game screen carries its own heading, exactly like Host and Join, so
  // the app bar stays clean instead of repeating it.
  function head(t, sub) {
    return `<div class="gs-head"><h2 class="gs-title">${esc(t)}</h2>
      <div class="tagrule"><span></span><i></i><span></span></div>
      ${sub ? `<p class="gs-sub">${esc(sub)}</p>` : ""}</div>`;
  }
  const teamVars = i => { const c = M().TEAM_COLORS[i % 4]; return `--t1:${c.c1};--t2:${c.c2}`; };
  // The live category tints the whole screen, so a turn reads as its colour
  // before you get to the label.
  // Flags the view as an in-game screen: bare chrome, plain backdrop — unless
  // showBg asks for the shared Host/Join video (solo team setup, winners page).
  function tint(showBg) {
    const v = $("liveView");
    v.classList.add("game");
    // Host and Join set `artbg` on the way in and nothing cleared it, so the
    // video kept playing behind every screen of the game. In here we ARE a game
    // screen: `vid` is the only thing that may show it (solo team setup, the
    // winners page), and every other turn stays on the plain backdrop.
    v.classList.remove("artbg");
    v.classList.toggle("vid", !!showBg);
    const bg = $("joinBg");
    if (showBg) playJoinBg();
    else if (bg) bg.pause();
    // game screens carry their own heading — drop the header mark and rule,
    // same as Host and Join
    if (typeof syncHomeMark === "function") syncHomeMark();
  }
  const ICON = {
    arrow: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
    check: '<path d="m4.5 12.6 5.2 5.2L19.5 6.6"/>',
    play:  '<path d="M8 5.5 18 12 8 18.5Z" fill="currentColor" stroke-linejoin="round"/>',
    tv:    '<rect x="2.6" y="4" width="18.8" height="13" rx="2.4"/><path d="M8.5 20.6h7"/><path d="M12 17v3.6"/>',
    shuf:  '<path d="M3.4 6.8h3.1c1.5 0 2.4.8 3.2 2M20.6 6.8h-3.6c-2.9 0-3.6 3-5.6 6.4-.9 1.5-1.8 2.9-3.5 2.9H3.4"/><path d="m17.9 4.1 2.7 2.7-2.7 2.7"/><path d="m17.9 14.4 2.7 2.7-2.7 2.7"/><path d="M20.6 17.1h-3.4c-1.3 0-2.1-.6-2.8-1.6"/>'
  };
  const svg = (d, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2.3}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  function build() {
    const st = S.state;
    if (st.phase === "lobby") return buildLobby();
    if (st.phase === "teams") return buildTeams();
    if (st.phase === "control") return buildControl();
    if (st.phase === "over") return buildOver();
    if (st.spinPick) return buildSpinPick();
    return buildPlay();
  }

  // The spinner paid out. The team that earned it takes the places, or takes
  // them off a rival. Everyone else watches it happen.
  const spinHeld = () => { const st = S && S.state;
    return !!(st && st.spinPick && st.spinRevealAt && srvNow() < st.spinRevealAt); };

  function buildSpinPick() {
    const st = S.state, T = teams(), p = st.spinPick;
    const i = (p.team | 0) % T.length, t = T[i];
    const mine = myTeamIdx() === i, n = p.places;
    title(""); tint();
    if (spinHeld()) {
      // the wheel is still going on the TV — everyone watches it together
      inner().innerHTML = `<div class="gs">
        ${head("Spin space!", t.name + " landed on the spinner")}
        <div class="gs-body mid"><div class="gpanel spinwait">
          <div class="spinwheel">🎯</div>
          <p class="spinwaittxt">Watch the wheel…</p></div></div>
        <div class="gs-foot"></div></div>`;
      headerClose(leaveLive);
      return;
    }
    const others = T.map((x, j) => ({ x, j })).filter(o => o.j !== i);
    const body = mine
      ? `<div class="gpanel spinpick"><h4>Take it or take it off them</h4>
          <button class="gbtn" id="spFwd" style="width:100%">Move us forward +${n}</button>
          <p class="spor">or knock ${n} off</p>
          <div class="spback">${others.map(o => `<button class="gbtn ghost" data-j="${o.j}" style="${teamVars(o.j)}">
            <i class="tdot" style="${teamVars(o.j)}"></i>${esc(o.x.name)} &minus;${n}</button>`).join("")}</div></div>`
      : `<div class="gbtn wait">${esc(t.name)} are deciding…</div>`;
    inner().innerHTML = `<div class="gs">
      ${head("+" + n + (n > 1 ? " places" : " place"), t.name + " landed on the spinner")}
      <div class="gs-body mid">${body}</div>
      <div class="gs-foot"></div>
    </div>`;
    headerClose(leaveLive);
    if (mine) {
      $("spFwd").onclick = () => resolveSpin("forward");
      inner().querySelectorAll(".spback button").forEach(b => b.onclick = () => resolveSpin("back", +b.dataset.j));
    }
  }

  // One line telling the room what they're in for, so nobody is surprised
  // 20 minutes in that there are 24 more spaces to go.
  function gameBlurb() {
    const len = B().WIN_POS, cap = skipCap();
    return (len === 24 ? "Quick game · 24 spaces" : "Full game · 48 spaces")
      + " · " + (cap === 0 ? "no skips" : cap === 1 ? "one skip a turn" : cap + " skips a turn");
  }

  // ---------- lobby (live only — solo has nothing to share) ----------
  function buildLobby() {
    title(""); tint();
    const boardLink = location.origin + location.pathname.replace(/[^/]*$/, "board.html") + "?code=" + liveCode + "&api=" + encodeURIComponent(API_BASE);
    const cells = String(liveCode || "").slice(0, 4).padEnd(4, " ").split("")
      .map(c => `<span>${esc(c.trim())}</span>`).join("");
    inner().innerHTML = `<div class="gs">
      ${head("Game lobby", isHost ? "Share this code, then set up the teams" : "You're in, waiting for the host")}
      <div class="gs-body">
        <div class="roomcode">${cells}</div>
        <p class="gs-note">${esc(gameBlurb())}</p>
        <div class="gpanel"><h4>In the room</h4><div class="whos" id="livePlayers"></div></div>
        <div class="gpanel"><h4>Your name</h4>
          <input class="tname" id="myNameInp" value="${esc(myName)}" style="width:100%" /></div>
        ${isHost ? `<button class="gbtn ghost" id="boardBtn" style="width:100%">${svg(ICON.tv, 1.9)} Copy the board link</button>` : ""}
      </div>
      <div class="gs-foot">${isHost
        ? `<button class="gbtn" id="toTeams">Set up teams ${svg(ICON.arrow)}</button>`
        : `<div class="gbtn wait">Waiting for the host…</div>`}</div>
    </div>`;
    headerClose(leaveLive);
    const nm = $("myNameInp");
    nm.onchange = async () => { myName = nm.value.trim() || "Player"; localStorage.setItem("masgames_name", myName); await writePlayer(); };
    if (isHost) {
      $("toTeams").onclick = gotoTeams;
      // the board belongs on a TV or laptop — opening it here would take over
      // the app (an installed app has no tabs), so the link is copied instead
      $("boardBtn").onclick = async () => {
        try {
          await navigator.clipboard.writeText(boardLink);
          showToast("Board link copied. Open it on a TV or laptop");
        } catch {
          window.prompt("Copy this link for the TV:", boardLink);
        }
        setTimeout(hideToast, 2800);
      };
    }
  }

  // ---------- team setup ----------
  function buildTeams() {
    title(""); tint(solo);
    const T = teams(), ps = players();
    if (!isHost) {
      const mine = myTeamIdx();
      inner().innerHTML = `<div class="gs">
        ${head("Teams", "The host is sorting everyone out")}
        <div class="gs-body mid">
          <div class="wordcard quiet" style="${mine >= 0 ? teamVars(mine) : "--c1:#39414f;--c2:#12161d"};--c1:${mine >= 0 ? M().TEAM_COLORS[mine % 4].c1 : "#39414f"};--c2:${mine >= 0 ? M().TEAM_COLORS[mine % 4].c2 : "#12161d"}">
            <span class="cat">You're on</span>
            <div class="w">${mine >= 0 ? esc(T[mine].name) : "Not assigned yet"}</div></div>
          <div class="gpanel"><h4>Line-up</h4><div id="teamPeek" style="display:flex;flex-direction:column;gap:9px"></div></div>
        </div>
        <div class="gs-foot"><div class="gbtn wait">Waiting for the host…</div></div>
      </div>`;
      headerClose(leaveLive);
      $("teamPeek").innerHTML = T.map((t, i) => `<div class="strow" style="${teamVars(i)}">
        <span class="nm">${esc(t.name)}</span>
        <small style="color:#7f8db0;font-size:12px">${esc((t.members || []).map(nameOf).join(", ") || "empty")}</small></div>`).join("");
      return;
    }
    inner().innerHTML = `<div class="gs">
      ${head("Teams", solo ? "You against the bots. Tap a name to move it" : "Tap a team name to rename it, tap a player to move them")}
      <div class="gs-body">
        <div class="gpanel"><h4>How many teams</h4>
          <div class="tcount" id="teamCount">${[2, 3, 4].map(n => `<button class="${T.length === n ? "on" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
        </div>
        <div id="teamCards" style="display:flex;flex-direction:column;gap:11px"></div>
        <button class="gbtn ghost" id="autoBtn" style="width:100%">${svg(ICON.shuf, 1.9)} Shuffle the teams</button>
      </div>
      <div class="gs-foot"><button class="gbtn" id="startBtn">Start game ${svg(ICON.play, 1.6)}</button></div>
    </div>`;
    headerClose(leaveLive);
    $("autoBtn").onclick = autoAssign;
    $("startBtn").onclick = startGame;
    inner().querySelectorAll("#teamCount button").forEach(b => b.onclick = () => setTeamCount(+b.dataset.n));

    const wrap = $("teamCards");
    const loose = ps.filter(p => !T.some(t => (t.members || []).includes(p.id)));
    wrap.innerHTML = T.map((t, i) => `<div class="tcard" style="${teamVars(i)}">
        <div class="tcard-h"><span class="tsw" style="${teamVars(i)}"></span>
          <input class="tname" data-i="${i}" value="${esc(t.name)}" /></div>
        <div class="tmem" style="${teamVars(i)}">${(t.members || []).map(pid =>
          `<button class="who ${pid.indexOf("bot") === 0 ? "bot" : ""}" data-pid="${pid}">${esc(nameOf(pid))}</button>`).join("")
          || `<span class="none">Empty. Tap someone to move them here</span>`}</div>
      </div>`).join("")
      + (loose.length ? `<div class="gpanel"><h4>Not on a team</h4><div class="tmem" style="--t1:#39414f;--t2:#12161d">${
          loose.map(p => `<button class="who" data-pid="${p.id}">${esc(p.name)}</button>`).join("")}</div></div>` : "");
    wrap.querySelectorAll(".who[data-pid]").forEach(el => el.onclick = () => cyclePlayer(el.dataset.pid));
    // Commit as they type (debounced) as well as on blur: tapping straight from
    // the name field to "Start game" used to lose the last edit on some phones.
    wrap.querySelectorAll("input.tname").forEach(el => {
      let t = 0;
      el.oninput = () => { clearTimeout(t); t = setTimeout(() => renameTeam(+el.dataset.i, el.value), 600); };
      el.onchange = () => { clearTimeout(t); renameTeam(+el.dataset.i, el.value); };
    });
  }

  // ---------- the turn ----------
  const RING_R = 66, RING_C = 2 * Math.PI * RING_R;
  function ringHTML(st) {
    return `<div class="ring idle" id="ring">
      <svg viewBox="0 0 154 154">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#00E5FF"/><stop offset=".55" stop-color="#8A2BE2"/><stop offset="1" stop-color="#FF2FD0"/>
        </linearGradient></defs>
        <circle class="trk" cx="77" cy="77" r="${RING_R}"/>
        <circle class="prg" id="ringPrg" cx="77" cy="77" r="${RING_R}"
          stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="0"/>
      </svg>
      <div class="num"><b id="liveTimer">${st.turnSeconds || 30}</b><small>seconds</small></div>
    </div>`;
  }

  function buildPlay() {
    const st = S.state, T = teams(), ti = activeTeamIdx(), t = T[ti];
    const C = M().CATEGORIES[st.cat] || M().CATEGORIES.OBJECT;
    const isDraw = st.cat === "DRAW", isAct = st.cat === "ACTION", mine = myTeamIdx(), me = amDescriber();
    title(""); tint();
    const catName = st.cat === "SPADE" ? "All play" : C.label;
    const cvars = `--c1:${C.c1};--c2:${C.c2};--ink:${C.ink}`;

    let main;
    if (me && st.turnActive) {
      main = `<div class="wordcard" style="${cvars}">
          <span class="cat">${esc(catName)}</span>
          <div class="w">${esc(currentWord())}</div>
          <div class="v">${isDraw ? "Draw it. No words, no letters" : isAct ? "Act it out. No talking" : "Describe it. Don't say it"}</div>
        </div>` + (isDraw ? drawArea(true) : "");
    } else if (me) {
      main = `<div class="wordcard quiet" style="${cvars}">
          <span class="cat">${esc(catName)}</span>
          <div class="w"><span class="spark">✦</span> You're up! <span class="spark">✦</span></div>
          <div class="v">${isDraw ? "You draw, they guess" : isAct ? "You act it out, they guess" : "You describe, they guess"}</div>
        </div>`;
    } else if (st.turnActive && mine !== ti && mine !== -1) {
      // Other teams aren't guessing, so they get the answer too — half the fun
      // is knowing it while the guesses fly.
      main = `<div class="wordcard" style="${cvars}">
          <span class="cat">${esc(catName)}</span>
          <div class="w">${esc(currentWord())}</div>
          <div class="v">${esc(t.name)} are guessing. Keep it zipped</div>
        </div>` + (isDraw ? drawArea(false) : "");
    } else if (mine === -1) {
      main = `<div class="wordcard quiet" style="${cvars}">
          <span class="cat">${esc(catName)}</span>
          <div class="w">Not on a team</div>
          <div class="v">Ask the host to add you</div>
        </div>`;
    } else {
      const who = nameOf(describerId());
      main = `<div class="wordcard quiet" style="${cvars}">
          <span class="cat">${esc(catName)}</span>
          <div class="w">${esc(who)}</div>
          <div class="v">${st.turnActive ? "Your team, shout it out" : "Getting ready"}</div>
        </div>` + (isDraw && st.turnActive ? drawArea(false) : "");
    }

    // The compact draw layout (small ring, no subtitle) exists to make room for
    // the canvas, and the canvas only appears once the turn is running. Applying
    // it to the "You're up!" screen shrank the clock for no reason and left a
    // hole where the canvas would be, so it's gated on the turn being live.
    inner().innerHTML = `<div class="gs${isDraw && st.turnActive ? " draw" : ""}">
      <div class="gs-head" style="margin-bottom:15px">
        <div class="upbar ${mine === ti ? "mine" : "theirs"}" style="${teamVars(ti)}">
          <i></i><b>${
            amDescriber() ? (st.turnActive ? "Your turn · " + (isDraw ? "draw!" : isAct ? "act it out!" : "describe!")
                                             : "Your turn · you " + (isDraw ? "draw" : isAct ? "act" : "describe"))
            : mine === ti ? (st.turnActive ? "Your turn · shout answers!" : "Your team is up")
            : esc(t.name) + (st.turnActive ? " are playing" : " are up next")
          }</b><small>${(t.pos | 0) + 1} / ${B().WIN_POS}</small>
        </div>
      </div>
      <div class="gs-body mid">
        ${ringHTML(st)}
        <div class="tally" id="tally"></div>
        ${main}
      </div>
      <div class="gs-foot" id="liveFoot"></div>
    </div>`;
    headerClose(leaveLive);

    const foot = $("liveFoot");
    if (me && !st.turnActive) foot.innerHTML = `<button class="gbtn" id="startTurnBtn">Start my turn ${svg(ICON.play, 1.6)}</button>`;
    else if (me) {
      // Skips are rationed. The button keeps its place once they're gone (a row
      // that reflows under a moving thumb costs someone a card) but reads spent,
      // and says how many are left when there's more than one.
      const cap = skipCap(), left = Math.max(0, cap - (st.skipsUsed || 0));
      const skipBtn = cap === 0 ? ""
        : `<button class="gbtn ghost${left ? "" : " spent"}" id="passBtn">Skip${cap > 1 ? " " + left : ""}</button>`;
      foot.innerHTML = `<button class="gbtn" id="gotBtn">Got it ${svg(ICON.check)}</button>
        ${skipBtn}
        <button class="gbtn ghost" id="endBtn">End</button>`;
    }
    else if (solo) foot.innerHTML = `<div class="gbtn wait">${esc(nameOf(describerId()))} is playing…</div>`;
    else foot.innerHTML = isHost
      ? `<button class="gbtn ghost" id="hostEnd" style="flex:1">End turn</button><button class="gbtn ghost" id="hostOver">Finish</button>`
      : `<div class="gbtn wait">${esc(nameOf(describerId()))} is playing…</div>`;
    if (st.fromSpade && !st.turnActive) {
      const k = liveCode + "|" + (st.clearSeq || 0);
      if (stealFxKey !== k) {
        stealFxKey = k;
        FX.banner(t.name + "!", "won the all play");
        FX.burst(0.5, 0.4, 40, 7); buzz([70, 50, 70]);
      }
    }
    if ($("startTurnBtn")) $("startTurnBtn").onclick = startTurn;
    if ($("gotBtn")) $("gotBtn").onclick = gotIt;
    if ($("passBtn")) $("passBtn").onclick = passWord;
    if ($("endBtn")) $("endBtn").onclick = endTurn;
    if ($("hostEnd")) $("hostEnd").onclick = endTurn;
    if ($("hostOver")) $("hostOver").onclick = () => mutate(st2 => { st2.phase = "over"; st2.timerEnds = 0; return st2; });
    if (isDraw) setupCanvas(me && st.turnActive);
  }

  // ---------- control turn: spade (anyone can take it) or finish ----------
  function buildControl() {
    const st = S.state, W = M(), c = st.control || {}, T = teams();
    const owner = T[c.team % T.length];
    const isFinish = c.mode === "finish";
    title(""); tint();
    const pool = W.poolFor(S.deck, "SPADE", st.seed);
    const word = pool[(st.ptr || 0) % Math.max(1, pool.length)] || "…";
    const cvars = "--c1:#f2f6ff;--c2:#c9d6ee;--ink:#0B0F17";

    const main = amDescriber()
      ? `<div class="wordcard" style="${cvars}">
          <span class="cat">Describe to everyone</span>
          <div class="w">${esc(word)}</div>
          <div class="v">${isFinish ? "Your team must answer first to win" : "First team to guess takes the turn"}</div>
        </div>`
      : `<div class="wordcard quiet" style="${cvars}">
          <span class="cat">${isFinish ? "Finish · control turn" : "Spade · all play"}</span>
          <div class="w">Shout it out</div>
          <div class="v">${esc(nameOf(describerId()))} is describing to the whole room</div>
        </div>`;

    inner().innerHTML = `<div class="gs ctrl">
      <div class="gs-body mid">
        ${head(isFinish ? "Finish!" : "All play",
               isFinish ? `${owner.name} is on the last space. Win this and the game is theirs`
                        : `${owner.name} landed on a spade. Any team can steal the turn`)}
        ${main}
        ${(isHost || amDescriber()) ? `<div class="gpanel"><h4>Who got it first?</h4><div class="awards" id="awardWrap"></div></div>`
          : `<div class="lhint">Waiting for the result…</div>`}
      </div>
    </div>`;
    headerClose(leaveLive);
    if (isHost || amDescriber()) {
      const w = $("awardWrap");
      w.innerHTML = T.map((t, i) => `<button class="awardbtn" data-i="${i}" style="${teamVars(i)}">
          <i></i><span>${esc(t.name)}</span>${i === c.team ? `<small>${isFinish ? "to win" : "landed here"}</small>` : ""}</button>`).join("");
      w.querySelectorAll(".awardbtn").forEach(b => b.onclick = () => awardControl(+b.dataset.i));
    }
  }

  // ---------- result ----------
  function buildOver() {
    title(""); tint(true);
    if (!overFx) {
      overFx = true;
      FX.fireworks(4200); buzz([140, 70, 140, 70, 420]);
    }
    const order = teams().map((t, i) => ({ t, i })).sort((a, b) => (b.t.pos | 0) - (a.t.pos | 0));
    const win = order[0];
    inner().innerHTML = `<div class="gs">
      <div class="gs-body mid">
        ${head("Game over", "")}
        <div class="winner">
          <div class="cup"><svg viewBox="0 0 24 24">
            <defs><linearGradient id="cupGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#FFE873"/><stop offset=".55" stop-color="#FFC93C"/><stop offset="1" stop-color="#E08700"/>
            </linearGradient></defs>
            <path fill="url(#cupGold)" d="M7 2.6h10v5.6a5 5 0 0 1-10 0Z"/>
            <path fill="none" stroke="url(#cupGold)" stroke-width="1.6" d="M7 4.6H4.4v1.6a3.4 3.4 0 0 0 3.3 3.4M17 4.6h2.6v1.6a3.4 3.4 0 0 1-3.3 3.4"/>
            <path fill="url(#cupGold)" d="M11 12.8h2v3h-2Z"/>
            <path fill="url(#cupGold)" d="M9.6 15.8h4.8l1.1 3.6H8.5Z"/>
            <rect fill="url(#cupGold)" x="7.6" y="19.8" width="8.8" height="1.9" rx=".9"/>
            <path fill="#fff" opacity=".92" d="m12 4.4.75 1.52 1.68.24-1.21 1.18.29 1.67L12 8.22l-1.51.79.29-1.67-1.21-1.18 1.68-.24Z"/>
          </svg></div>
          <div class="nm">${esc(win ? win.t.name : "…")}</div>
          <div class="wins">wins!</div>
        </div>
        <div class="gpanel"><h4>Final positions</h4>
          <div class="standings">${order.map((o, n) => `<div class="strow ${n === 0 ? "first" : ""}" style="${teamVars(o.i)}">
            <span class="medal">${n + 1}</span><span class="nm">${esc(o.t.name)}</span>
            <span class="pos">${o.t.pos | 0}</span></div>`).join("")}</div>
        </div>
      </div>
    </div>`;
    headerClose(leaveLive);
  }

  function scoreStrip() {
    const T = teams(), ti = activeTeamIdx();
    return T.map((t, i) => i === ti
      ? `<span class="tb on" style="${teamVars(i)}"><i></i><b>${esc(t.name)}</b><small>${(t.pos | 0) + 1} / ${B().WIN_POS}</small></span>`
      : `<span class="tb" style="${teamVars(i)}"><i></i><b>${t.pos | 0}</b></span>`).join("");
  }

  function updateDynamic() {
    const st = S.state;
    // The spinner choice landed. Announce it wherever we now are — taking the
    // places yourself and sending a rival back are worth different noises.
    if (st.spinOutcome) {
      const k = liveCode + "|out|" + st.spinOutcome.id;
      if (spinOutKey !== k) {
        spinOutKey = k;
        const o = st.spinOutcome, T = teams(), nm = (T[o.team] || {}).name || "They";
        if (o.kind === "back") {
          FX.banner("−" + o.places + " " + nm, "knocked backwards", 3000);
          buzz([220, 90, 220, 90, 380]);
        } else {
          FX.fireworks(2200);
          FX.banner("+" + o.places + (o.places > 1 ? " places" : " place"), "taken", 2200);
          buzz([90, 60, 200]);
        }
      }
    }
    if (st.phase === "lobby") {
      const pl = $("livePlayers");
      if (pl) pl.innerHTML = players().map(p => `<span class="who ${p.id === userId ? "me" : ""}">${esc(p.name)}${p.id === S.host ? " · host" : ""}</span>`).join("")
        || '<span class="lhint">No one yet…</span>';
    } else if (st.phase === "play") {
      if ($("liveScores")) $("liveScores").innerHTML = scoreStrip();
      // one pip per correct answer = one space on the board. The track is a
      // fixed six pips — a hot streak becomes "+N" instead of wrapping to a
      // second row and shoving the buttons off the bottom of the screen.
      const tl = $("tally"), n = st.correct || 0;
      if (tl) tl.innerHTML = Array.from({ length: 6 },
        (_, i) => `<span class="pip ${i < Math.min(n, 6) ? "on" : ""}"></span>`).join("")
        + (n > 6 ? `<span class="pipmore">+${n - 6}</span>` : "");
      if (st.spinResult) {
        const k = liveCode + "|" + (st.spinResult.id || st.spinResult.label);
        if (spinFxKey !== k) {
          spinFxKey = k;
          const places = st.spinResult.places | 0;
          // The wheel runs for five and a half seconds on the TV. The phones
          // hold the room for the same stretch instead of blurting the result
          // out: build, a beat of "wait for it", then the reveal on the landing.
          FX.banner("Spin space!", "the wheel is spinning…", 2600);
          buzz([40, 50, 40, 50, 40]);
          clearTimeout(spinRevealT); clearTimeout(spinHoldT);
          spinHoldT = setTimeout(() => {
            FX.banner("Wait for it…", "", 2600);
            buzz([25, 120, 25, 120, 25]);
          }, 2700);
          spinRevealT = setTimeout(() => {
            if (places > 0) {
              FX.fireworks(3200);
              // deliberately NOT "+1": they have not decided yet, and calling it
              // a gain reads as a lie when they use it to shove someone back
              FX.banner(places + (places > 1 ? " PLACES" : " PLACE"), "take it or give it", 2600);
              buzz([90, 60, 90, 60, 260]);
            } else {
              FX.banner("No bonus", "the wheel says no");
              buzz(60);
            }
          }, 5300);
        }
      }
      if (st.cat === "DRAW" && st.turnActive && !amDescriber()) redrawWatcher();
    }
  }

  // ---------- ticker ----------
  setInterval(() => {
    if (liveMode !== "session" || !S) return;
    if (solo) soloBots();
    const st = S.state, el = $("liveTimer"), ring = $("ring"), prg = $("ringPrg");
    const now = srvNow();
    if (el && st.timerEnds) {
      const total = Math.max(1000, (st.turnSeconds || M().TURN_SECONDS) * 1000);
      const left = Math.max(0, st.timerEnds - now);
      const rem = Math.ceil(left / 1000);
      el.textContent = rem;
      if (ring) {
        ring.classList.remove("idle");
        ring.classList.toggle("warn", rem <= 10 && rem > 0);
        ring.classList.toggle("done", rem === 0);
      }
      if (prg) prg.style.strokeDashoffset = (RING_C * (1 - left / total)).toFixed(1);
    }
    // Time's up: every phone in the room buzzes once, and the describer's device
    // is the one that actually ends the turn. If that phone has locked, gone to
    // sleep or dropped off, the clock would sit on zero forever, so the job
    // passes on: the host picks it up shortly after, then anyone still watching.
    // Whoever gets there first wins the compare-and-set and the rest no-op.
    if (st.phase === "play" && st.turnActive && st.timerEnds && now >= st.timerEnds) {
      if (timeUpKey !== st.timerEnds) {
        timeUpKey = st.timerEnds;
        buzz([220, 90, 220, 90, 450]);
        showToast("⏰ Time!"); setTimeout(hideToast, 1800);
      }
      const late = now - st.timerEnds;
      if (amDescriber() || (solo && isHost) || (isHost && late > 3000) || late > 6000) endTurn(st.timerEnds);
    }
    if (st.cat === "DRAW" && amDescriber() && st.turnActive && drawDirty && Date.now() - lastUpload > 900) uploadDraw();
  }, 300);

  // ---------- drawing (DRAW category) ----------
  function drawArea(canDraw) {
    const sw = canDraw ? `<div class="drawtools">${DRAW_COLORS.map((c, i) => `<span class="swatch ${i === drawColorIdx ? "sel" : ""}" data-ci="${i}" style="background:${c}"></span>`).join("")}<button class="chip" id="clearDraw">Clear</button></div>` : "";
    return `<div class="gpanel drawpanel"><div class="drawwrap"><canvas class="drawcanvas" id="drawCanvas" width="${CANVAS_RES}" height="${CANVAS_RES}"></canvas></div>${sw}</div>`;
  }
  function setupCanvas(canDraw) {
    const cv = $("drawCanvas"); if (!cv) return;
    const ctx = cv.getContext("2d"); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (!canDraw) { redrawWatcher(); return; }
    myStrokes = []; curStroke = null; drawDirty = false; paint(ctx, myStrokes);
    const pos = e => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return [(t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height]; };
    cv.onpointerdown = e => { e.preventDefault(); curStroke = { c: drawColorIdx, p: [pos(e)] }; myStrokes.push(curStroke); if (myStrokes.length > 400) myStrokes.shift(); };
    cv.onpointermove = e => { if (!curStroke) return; e.preventDefault(); const p = pos(e); const l = curStroke.p[curStroke.p.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.008) { curStroke.p.push(p); paint(ctx, myStrokes); drawDirty = true; } };
    cv.onpointerup = cv.onpointerleave = () => { if (curStroke) { curStroke = null; drawDirty = true; uploadDraw(); } };
    const sw = inner().querySelectorAll(".swatch");
    sw.forEach(s => s.onclick = () => { drawColorIdx = +s.dataset.ci; sw.forEach(x => x.classList.toggle("sel", x === s)); });
    if ($("clearDraw")) $("clearDraw").onclick = () => { myStrokes = []; paint(ctx, myStrokes); uploadDraw(); };
  }
  function paint(ctx, strokes) {
    const n = CANVAS_RES;
    ctx.clearRect(0, 0, n, n); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, n, n);
    (strokes || []).forEach(s => {
      if (!s.p || !s.p.length) return;
      ctx.strokeStyle = DRAW_COLORS[s.c] || "#111"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(s.p[0][0] * n, s.p[0][1] * n);
      for (let i = 1; i < s.p.length; i++) ctx.lineTo(s.p[i][0] * n, s.p[i][1] * n);
      if (s.p.length === 1) ctx.lineTo(s.p[0][0] * n + .1, s.p[0][1] * n + .1);
      ctx.stroke();
    });
  }
  function redrawWatcher() {
    const cv = $("drawCanvas"); if (!cv) return;
    const ctx = cv.getContext("2d"); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const e = S.entries.find(x => x.player === describerId() && x.kind === "draw");
    paint(ctx, (e && e.data && e.data.seq === S.state.clearSeq) ? e.data.strokes : []);
  }
  async function uploadDraw() {
    lastUpload = Date.now(); drawDirty = false;
    try { await api(`/api/session/${liveCode}/entry`, "POST", { player: userId, kind: "draw", data: { seq: S.state.clearSeq, strokes: myStrokes } }); } catch {}
  }

  // ---------- solo: you against the bots ----------
  // Solo has no room to share, so it skips the lobby entirely: the session is
  // created already sitting on the team screen, one tap from playing.
  async function startSolo() {
    demo = true; solo = true; botGuard = "";
    const d = (window.BUILTIN_DECKS || [])[0];
    if (!d) { showToast("No starter decks found.", true); return; }
    deck.length = 0; d.cards.forEach(c => deck.push(c));
    setDeckSub(d.title); setDeckGame("wordsmash");
    if (typeof saveDeck === "function") saveDeck();
    myName = myName || "You";
    const st = freshState();
    st.phase = "teams";
    const bots = soloBotsFor(2);
    st.teams = [
      { name: "", pos: 0, members: [], turnIdx: 0 },
      { name: "", pos: 0, members: [], turnIdx: 0 },
    ];
    [userId].concat(bots.map(b => b.id)).forEach((pid, i) => st.teams[i % 2].members.push(pid));
    soloNames(st);
    try {
      const res = await api("/api/session", "POST", { host: userId, game: "wordsmash", deck, state: st });
      liveCode = res.code; isHost = true; liveMode = "session"; lastV = 0; lastKey = "";
      await writePlayer();
      for (const b of bots) await localEntry(b.id, "player", { name: b.name });
      openLive(); startPoll();
    } catch (e) { showToast(e.message, true); solo = demo = false; }
  }

  // The bots have no device of their own, so this one drives them: they start
  // their own turn (nobody else can), then answer or give up on a timer.
  function soloBots() {
    const st = S && S.state;
    if (!st || st.phase !== "play") return;
    // a bot team that won the spinner decides for itself: mostly takes the
    // places, sometimes knocks them off whoever is in front
    if (st.spinPick) {
      const T = st.teams, i = (st.spinPick.team | 0) % T.length;
      if ((T[i].members || []).some(m => m.indexOf("bot") === 0) && !(T[i].members || []).includes(userId)) {
        const key = "pick|" + st.spinPick.id;
        if (botGuard !== key) {
          botGuard = key;
          setTimeout(() => {
            const cur = S && S.state;
            if (!cur || !cur.spinPick || cur.spinPick.id !== st.spinPick.id) return;
            const lead = T.map((t, j) => ({ t, j })).filter(o => o.j !== i).sort((a, b) => (b.t.pos | 0) - (a.t.pos | 0))[0];
            if (lead && Math.random() < 0.4) resolveSpin("back", lead.j); else resolveSpin("forward");
          }, 1400 + Math.random() * 900);
        }
      }
      return;
    }
    const d = describerId();
    if (!d || d.indexOf("bot") !== 0) return;
    const key = st.clearSeq + "|" + st.turnActive;
    if (botGuard === key) return;
    botGuard = key;
    const wait = st.turnActive ? 1100 + Math.random() * 900 : 900;
    setTimeout(() => {
      if (!solo || !S || describerId() !== d) return;
      const cur = S.state;
      if (cur.phase !== "play") return;
      if (!cur.turnActive) { startTurn(); return; }
      if (Math.random() < 0.72) gotIt(); else endTurn();
    }, wait);
  }

  // ---------- join (code only) ----------
  function openJoinForm(code) {
    liveMode = "join"; liveCode = null; S = null;
    title("");                                  // the screen carries its own heading
    $("liveView").classList.add("artbg");
    playJoinBg();
    inner().innerHTML = `
      <div class="live-body joinbody">
        <div class="joincard">
          <h2 class="jointitle">Join a game</h2>
          <div class="tagrule"><span></span><i></i><span></span></div>
          <p class="joinsub">Enter your game code</p>
          <div class="jslot">
          <div class="codewrap" id="codeWrap">
            <input class="codeinput" id="jCode" maxlength="4" value="${esc(code || "")}"
                   autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
                   inputmode="text" aria-label="Room code" />
            <div class="codecells" id="codeCells" aria-hidden="true"></div>
          </div>
          </div>
          <button class="joingo" id="jGo" disabled>Join game
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
        </div>
      </div>`;
    openLive();
    const inp = $("jCode"), cells = $("codeCells"), go = $("jGo");

    function paint() {
      const v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      if (v !== inp.value) inp.value = v;
      const focused = document.activeElement === inp;
      cells.innerHTML = [0, 1, 2, 3].map(i => {
        const cls = v[i] ? "cc filled" : (i === v.length && focused ? "cc next" : "cc");
        return `<span class="${cls}">${v[i] || (i === v.length && focused ? '<i class="caret"></i>' : "")}</span>`;
      }).join("");
      go.disabled = v.length !== 4;
    }
    inp.addEventListener("input", paint);
    inp.addEventListener("focus", paint);
    inp.addEventListener("blur", paint);
    inp.addEventListener("keydown", e => { if (e.key === "Enter" && !go.disabled) go.click(); });
    $("codeWrap").addEventListener("click", () => inp.focus());
    paint();
    setTimeout(() => inp.focus(), 120);

    headerClose(() => { liveMode = "none"; title(""); closeLive(); });
    go.onclick = () => joinGame(inp.value);
  }

  // ---------- host: pick a deck, then host ----------
  function openHostWizard() {
    liveMode = "none"; S = null; liveCode = null;
    title("");                                   // the screen carries its own heading
    $("liveView").classList.add("artbg");
    playJoinBg();
    const all = (window.BUILTIN_DECKS || []);
    const hasCurrent = deck.length > 0;
    inner().innerHTML = `
      <div class="live-body joinbody">
        <div class="joincard">
          <h2 class="jointitle">Host a game</h2>
          <div class="tagrule"><span></span><i></i><span></span></div>
          <p class="joinsub">Choose a deck to play</p>
          <div class="jslot">
          <div class="deckinfo" id="pickedWrap">
            <p class="di-blurb" id="pickedBlurb"></p>
            <div class="di-stats" id="pickedStats" style="visibility:hidden"><span id="pickedCount"></span><i></i><span id="pickedAud"></span></div>
          </div>
          <div id="hostPick"></div>
          <button class="joingo" id="hostGo" disabled>Host game
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
        </div>
      </div>`;
    openLive();

    const go = $("hostGo");
    // same picker component the settings menu uses
    const opts = deckPickerOptions(hasCurrent);
    let pick = opts.length ? opts[0].v : null;

    const chosen = () => {
      if (pick === "cur") return { title: $("deckSub").textContent || "Current deck", cards: deck.slice(), audience: "", icon: "deck" };
      return all[+pick];
    };
    function paintInfo() {
      const d = chosen(); if (!d) return;
      $("pickedStats").style.visibility = "visible";
      $("pickedBlurb").textContent = d.blurb || "Your own deck, ready to play.";
      $("pickedCount").textContent = d.cards.length + " cards";
      $("pickedAud").textContent = /spicy/.test(d.audience || "") ? "18+"
        : (d.audience || "any audience").replace(/\s*\(.*\)/, "");
      go.disabled = !d.cards.length;
    }
    mountDeckPicker($("hostPick"), opts, v => { pick = v; paintInfo(); });
    paintInfo();

    go.onclick = () => { const d = chosen(); if (d) hostWithDeck(d.title, d.cards); };
    headerClose(() => { title(""); closeLive(); });
  }

  async function hostWithDeck(t, cards) {
    // copy first — `cards` can be the built-in deck's own array, and clearing
    // `deck` in place would empty it before we ever read it
    const src = (cards || []).slice();
    deck.length = 0; src.forEach(c => deck.push(c));
    setDeckSub(t); setDeckGame("wordsmash");
    if (typeof saveDeck === "function") saveDeck();
    if (typeof renderPlayer === "function") renderPlayer();
    await hostGame();
  }


  // ---------- expose + wire ----------
  window.MasLive = { hostGame, openHostWizard, openJoinForm, startSolo, leaveLive, get state() { return S; },
    _render(snap) { liveMode = "session"; S = snap; liveCode = snap.code; isHost = snap.host === userId; lastKey = ""; openLive(); renderLive(); } };

  function initLive() {
    const host = () => { if (typeof closeSheet === "function") closeSheet(); openHostWizard(); };
    if ($("emptyHost")) $("emptyHost").addEventListener("click", host);
    if ($("sheetHostBtn")) $("sheetHostBtn").addEventListener("click", host);
    if ($("emptyJoin")) $("emptyJoin").addEventListener("click", () => openJoinForm(""));
    if ($("sheetJoinBtn")) $("sheetJoinBtn").addEventListener("click", () => { if (typeof closeSheet === "function") closeSheet(); openJoinForm(""); });
    if ($("emptySolo")) $("emptySolo").addEventListener("click", startSolo);
    if ($("hostLiveBtn")) $("hostLiveBtn").addEventListener("click", openHostWizard);
    const j = new URLSearchParams(location.search).get("join");
    if (j) openJoinForm(j.toUpperCase());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLive);
  else initLive();
})();
