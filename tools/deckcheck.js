#!/usr/bin/env node
// Deck integrity tool.
//
// The built-in decks are hand-written word lists, and at 200 words a category
// across 7 categories and 10 decks that is 14,000 strings — far past the point
// where a person (or a model) can keep them straight by eye. This reads the
// real decks.js the same way the app does and reports, per deck and category:
// the count, any duplicates, and how far off the target it is.
//
//   node tools/deckcheck.js            # report
//   node tools/deckcheck.js --target 200
//   node tools/deckcheck.js --fix      # drop duplicates, trim overflow, rewrite
//
// --fix only ever REMOVES words (duplicates first, then the tail of an
// over-long category). It never invents any: filling a short category is a
// writing job, and the report tells you exactly how many are missing.
const fs = require("fs");
const path = require("path");

const CATS = ["OBJECT", "NATURE", "RANDOM", "PERSON", "ACTION", "WORLD", "DRAW"];
const FILE = path.join(__dirname, "..", "decks.js");
const args = process.argv.slice(2);
const TARGET = +(args[args.indexOf("--target") + 1] || 0) || 200;
const FIX = args.includes("--fix");

function load() {
  const g = { window: {} };
  new Function("window", fs.readFileSync(FILE, "utf8"))(g.window);
  return g.window.BUILTIN_DECKS;
}

// Rewrites decks.js in place by editing the literal word arrays. Each array is
// found by its category key inside a deck block, so the file's comments and
// hand-written shape survive untouched.
function rewrite(decks, keep) {
  let src = fs.readFileSync(FILE, "utf8");
  // split the source into deck blocks so a category key is matched in the
  // right deck rather than the first one that happens to have it
  const starts = [];
  const re = /\n  deck\(/g; let m;
  while ((m = re.exec(src))) starts.push(m.index);
  starts.push(src.length);
  let out = src.slice(0, starts[0]);
  decks.forEach((d, di) => {
    let block = src.slice(starts[di], starts[di + 1]);
    CATS.forEach(cat => {
      const words = keep[di][cat];
      // collect every array for this category in this deck, replace the first
      // with the full kept list and empty the rest
      const rx = new RegExp(cat + ":\\s*\\[[^\\]]*\\]", "g");
      let n = 0;
      block = block.replace(rx, () => {
        n++;
        if (n > 1) return cat + ": []";
        const lines = [];
        for (let i = 0; i < words.length; i += 6)
          lines.push("        " + words.slice(i, i + 6).map(w => JSON.stringify(w)).join(","));
        return cat + ": [\n" + lines.join(",\n") + "]";
      });
    });
    out += block;
  });
  fs.writeFileSync(FILE, out);
}

const decks = load();
const keep = [];
let problems = 0, missing = 0;
console.log("target: " + TARGET + " per category\n");
decks.forEach((d, di) => {
  const by = {}; CATS.forEach(c => by[c] = []);
  const seen = new Set(); const dups = [];
  d.cards.forEach(c => {
    const cat = String(c.badge).toUpperCase();
    if (!CATS.includes(cat)) { console.log("  BAD BADGE " + cat + " in " + d.title); problems++; return; }
    const k = cat + "|" + c.title.toLowerCase().trim();
    if (seen.has(k)) { dups.push(cat + ":" + c.title); return; }
    seen.add(k); by[cat].push(c.title);
  });
  CATS.forEach(c => { if (by[c].length > TARGET) by[c] = by[c].slice(0, TARGET); });
  keep.push(by);
  const short = CATS.filter(c => by[c].length < TARGET);
  const line = CATS.map(c => by[c].length).join("/");
  const shortMsg = short.length ? "  short: " + short.map(c => c + " needs " + (TARGET - by[c].length)).join(", ") : "";
  console.log((d.title + "                    ").slice(0, 22) + line.padEnd(32) + shortMsg);
  if (dups.length) { console.log("    " + dups.length + " duplicate(s): " + dups.slice(0, 8).join(", ") + (dups.length > 8 ? " …" : "")); problems++; }
  short.forEach(c => missing += TARGET - by[c].length);
});
console.log("\n" + (problems ? problems + " deck(s) had duplicates or bad badges" : "no duplicates, no bad badges"));
console.log(missing ? missing + " word(s) still to write" : "every category is at " + TARGET);
if (FIX) { rewrite(decks, keep); console.log("\ndecks.js rewritten: duplicates dropped, overflow trimmed"); }
