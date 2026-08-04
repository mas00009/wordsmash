// MasGames API — Cloudflare Worker backed by D1.
//
// Decks (save / share / library):
//   POST   /api/decks             {title, cards, owner, isPublic}  -> {id}
//   GET    /api/decks/:id                                          -> deck
//   GET    /api/decks?owner=UID                                    -> [decks]
//   GET    /api/decks?public=1                                     -> [decks]
//   DELETE /api/decks/:id?owner=UID                                -> {deleted}
//
// Live sessions (standalone multiplayer):
//   POST   /api/session                    {host, game, deck, state}      -> {code}
//   GET    /api/session/:code[?v=updated]                                 -> {code,game,deck,state,entries,updated_at} | {unchanged:true}
//   POST   /api/session/:code/state        {state, expectedRev}           -> {ok} | 409 conflict
//   POST   /api/session/:code/entry        {player, kind, data}           -> {ok}
//   POST   /api/session/:code/clear        {kind}                         -> {ok}   (delete entries of a kind)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
// Every response carries the server's clock. The turn deadline is an absolute
// timestamp one phone writes and the whole room reads, and phone/laptop clocks
// drift apart by seconds — so the clients steer by this instead of their own.
function json(data, status = 200) {
  const body = data && typeof data === "object" && !Array.isArray(data) ? { ...data, now: Date.now() } : data;
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function shortId(n = 8) {
  const a = "23456789abcdefghijkmnpqrstuvwxyz";
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (const x of b) s += a[x % a.length]; return s;
}
function roomCode(n = 4) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (const x of b) s += a[x % a.length]; return s;
}
function safeParse(s, f) { try { return JSON.parse(s); } catch { return f; } }
function rowToDeck(r) { return { id: r.id, title: r.title, cards: safeParse(r.cards, []), owner: r.owner, isPublic: !!r.is_public, created_at: r.created_at }; }

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean); // ["api","decks",...] or ["api","session",...]
    try {
      if (p[0] !== "api") return json({ error: "not found" }, 404);
      if (p[1] === "decks") return await decks(req, env, url, p);
      if (p[1] === "session") return await sessions(req, env, url, p);
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

// ---------------- decks ----------------
async function decks(req, env, url, p) {
  const id = p[2];
  if (req.method === "GET" && id) {
    const row = await env.DB.prepare("SELECT id,title,cards,owner,is_public,created_at FROM decks WHERE id=?").bind(id).first();
    if (!row) return json({ error: "deck not found" }, 404);
    return json(rowToDeck(row));
  }
  if (req.method === "GET") {
    const owner = url.searchParams.get("owner"), pub = url.searchParams.get("public");
    let rows;
    if (owner) rows = await env.DB.prepare("SELECT id,title,cards,owner,is_public,created_at FROM decks WHERE owner=? ORDER BY created_at DESC LIMIT 100").bind(owner).all();
    else if (pub) rows = await env.DB.prepare("SELECT id,title,cards,owner,is_public,created_at FROM decks WHERE is_public=1 ORDER BY created_at DESC LIMIT 100").all();
    else return json({ error: "specify ?owner= or ?public=1" }, 400);
    return json((rows.results || []).map(rowToDeck));
  }
  if (req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || !Array.isArray(b.cards) || !b.cards.length) return json({ error: "cards array required" }, 400);
    const cardsStr = JSON.stringify(b.cards);
    if (cardsStr.length > 100000) return json({ error: "deck too large" }, 413);
    const did = shortId(), now = Date.now();
    await env.DB.prepare("INSERT INTO decks (id,title,cards,owner,is_public,created_at) VALUES (?,?,?,?,?,?)")
      .bind(did, String(b.title || "Untitled deck").slice(0, 80), cardsStr, String(b.owner || "anon").slice(0, 64), b.isPublic ? 1 : 0, now).run();
    return json({ id: did, isPublic: !!b.isPublic, created_at: now }, 201);
  }
  if (req.method === "DELETE" && id) {
    const owner = url.searchParams.get("owner") || "";
    const res = await env.DB.prepare("DELETE FROM decks WHERE id=? AND owner=?").bind(id, owner).run();
    return json({ deleted: (res.meta?.changes || 0) > 0 });
  }
  return json({ error: "method not allowed" }, 405);
}

// ---------------- sessions ----------------
async function sessions(req, env, url, p) {
  const code = p[2], sub = p[3];

  // create
  if (req.method === "POST" && !code) {
    const b = await req.json().catch(() => null);
    if (!b || !b.game || !Array.isArray(b.deck)) return json({ error: "game and deck required" }, 400);
    if (JSON.stringify(b.deck).length > 100000) return json({ error: "deck too large" }, 413);
    const now = Date.now();
    let c = "";
    for (let i = 0; i < 6; i++) { c = roomCode(4); const ex = await env.DB.prepare("SELECT code FROM sessions WHERE code=?").bind(c).first(); if (!ex) break; }
    await env.DB.prepare("INSERT INTO sessions (code,host,game,deck,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(c, String(b.host || "host").slice(0, 64), String(b.game).slice(0, 32), JSON.stringify(b.deck), JSON.stringify(b.state || { rev: 1, phase: "lobby" }), now, now).run();
    return json({ code: c }, 201);
  }
  if (!code) return json({ error: "code required" }, 400);

  // read (with optional ?v= to short-circuit when unchanged)
  if (req.method === "GET" && !sub) {
    const row = await env.DB.prepare("SELECT code,host,game,deck,state,updated_at FROM sessions WHERE code=?").bind(code).first();
    if (!row) return json({ error: "game not found" }, 404);
    const v = url.searchParams.get("v");
    if (v && String(row.updated_at) === v) return json({ unchanged: true, updated_at: row.updated_at });
    const er = await env.DB.prepare("SELECT player,kind,data,updated_at FROM entries WHERE code=?").bind(code).all();
    return json({
      code: row.code, host: row.host, game: row.game,
      deck: safeParse(row.deck, []), state: safeParse(row.state, {}),
      entries: (er.results || []).map(e => ({ player: e.player, kind: e.kind, data: safeParse(e.data, null), updated_at: e.updated_at })),
      updated_at: row.updated_at,
    });
  }

  // update state with compare-and-set on rev
  if (req.method === "POST" && sub === "state") {
    const b = await req.json().catch(() => null);
    if (!b || !b.state) return json({ error: "state required" }, 400);
    const row = await env.DB.prepare("SELECT state FROM sessions WHERE code=?").bind(code).first();
    if (!row) return json({ error: "game not found" }, 404);
    const cur = safeParse(row.state, {});
    if (typeof b.expectedRev === "number" && (cur.rev || 0) !== b.expectedRev) {
      return json({ error: "conflict", rev: cur.rev || 0 }, 409);
    }
    const now = Date.now();
    await env.DB.prepare("UPDATE sessions SET state=?, updated_at=? WHERE code=?").bind(JSON.stringify(b.state), now, code).run();
    return json({ ok: true, updated_at: now });
  }

  // upsert a per-player entry
  if (req.method === "POST" && sub === "entry") {
    const b = await req.json().catch(() => null);
    if (!b || !b.player || !b.kind) return json({ error: "player and kind required" }, 400);
    const now = Date.now();
    await env.DB.prepare("INSERT INTO entries (code,player,kind,data,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(code,player,kind) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
      .bind(code, String(b.player).slice(0, 64), String(b.kind).slice(0, 24), JSON.stringify(b.data ?? null), now).run();
    await env.DB.prepare("UPDATE sessions SET updated_at=? WHERE code=?").bind(now, code).run();
    return json({ ok: true, updated_at: now });
  }

  // clear entries of a kind (host, on new round)
  if (req.method === "POST" && sub === "clear") {
    const b = await req.json().catch(() => ({}));
    const now = Date.now();
    if (b && b.kind) await env.DB.prepare("DELETE FROM entries WHERE code=? AND kind=?").bind(code, String(b.kind)).run();
    else await env.DB.prepare("DELETE FROM entries WHERE code=?").bind(code).run();
    await env.DB.prepare("UPDATE sessions SET updated_at=? WHERE code=?").bind(now, code).run();
    return json({ ok: true, updated_at: now });
  }

  return json({ error: "not found" }, 404);
}
