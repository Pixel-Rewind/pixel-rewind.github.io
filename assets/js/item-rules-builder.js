/* The item rules builder (item-rules-builder.html).

   A form over one JSON ruleset: the page keeps the ruleset as plain state, renders it as
   rule cards, and writes the JSON the server accepts. The checks here mirror the server's,
   so a ruleset that passes them is one it takes. Nothing is sent anywhere: the JSON leaves
   only by copy, download, share link or e-mail, each on the visitor's own click. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ vocabulary

  // Items in their fixed order: [rules name, name in the game, rules may make it, ever dropped online]
  var ITEMS = [
    ["Teleport", "Teleport", true, true],
    ["RingOfInvisibility", "The Ring", true, true],
    ["Crates", "Crates", true, false],
    ["Spring", "Spring", true, true],
    ["HeavyTile", "Heavy Tile", true, false],
    ["Pig", "Pig", true, false],
    ["Larva", "Blockapede", true, false],
    ["Wolf", "Wolf", true, false],
    ["Bomb", "Grenade", true, true],
    ["BiggestFreakinGunPossible", "BFGP", true, true],
    ["Tube", "Tube", false, true],
    null,
    ["ComboBuilder", "Paintbrush", true, true],
    ["BootsOfSpeed", "Boots of Speed", true, false],
    ["HealthPack", "Health Pack", true, false],
    ["Shield", "Shield", true, false],
    ["Sword", "Sword", true, false],
    ["MonsterTrainerBox", "Monster Box", true, true],
    ["Battery", "Battery", true, true],
    ["Wand", "Wand", false, true],
    ["ResetButton", "Reset Button", true, true],
    null
  ];

  // The standard online weights: mid-match, and for the opening spread
  var STD_MID = { Teleport: 750, RingOfInvisibility: 500, Spring: 2500, Bomb: 500, BiggestFreakinGunPossible: 750, Tube: 1500, ComboBuilder: 1000, MonsterTrainerBox: 1500, Battery: 1000, Wand: 250, ResetButton: 1 };
  var STD_START = { Teleport: 250, RingOfInvisibility: 250, Spring: 4500, Bomb: 10, BiggestFreakinGunPossible: 10, Tube: 1000, ComboBuilder: 500, MonsterTrainerBox: 1500, Battery: 1000, Wand: 100 };

  var SCORE = [
    ["health", "Hero health", "0 to 100; 0 with no hero on the board."],
    ["specialPower", "Special Power", "0 to 100."],
    ["territory", "Territory", "Cells they own, castle and combo cells included."],
    ["comboCells", "Combo cells", "Owned cells that are part of a combo, counted once (on top of territory)."],
    ["princessHome", "Princess at home", "Their castles with their own princess inside: 1 for a player who still has her."],
    ["carrying", "Carrying a princess", "1 while their hero carries one."],
    ["carryHome", "Carrier near home", "0 to 100: how close a princess carrier is to scoring. 100 at the castle, about 50 a turn away, 0 when not carrying or blocked."],
    ["hero", "Hero on the board", "1 while their hero is alive."],
    ["jetpack", "Movement boost", "1 while their hero's movement boost is active."],
    ["boxingGloves", "Attack boost", "1 while their hero's attack boost is active."],
    ["monsters", "Monsters", "Their own monsters on the board that act: Pigs, Blockapedes, Wolves and Boss Monsters.", 5]
  ];

  // Inputs a condition can test: [name, takes an item, group, short label, explanation, newer app]
  var INPUTS = [
    ["round", false, "Match", "Round", "The match's round, from 1."],
    ["matchStart", false, "Match", "Opening spread", "Yes for the items placed before the first turn."],
    ["iteration", false, "Match", "Item number in this drop", "Several items can drop at once: 0 for the first, 1 for the second..."],
    ["playersAlive", false, "Match", "Players still in", "Players still in the match."],
    ["boardWidth", false, "Match", "Board width", "In cells."],
    ["boardHeight", false, "Match", "Board height", "In cells."],
    ["itemsOnBoard", false, "Items", "Items on the board", "All items lying on the board."],
    ["itemsOfType", true, "Items", "On the board:", "How many of that item lie on the board."],
    ["heldOfType", true, "Items", "Carried:", "How many of that item heroes and monsters carry."],
    ["itemsAnywhere", true, "Items", "In play:", "On the board plus carried: the usual way to cap an item."],
    ["engineType", false, "Items", "The game's roll", "The item the game rolled."],
    ["type", false, "Items", "This item", "In a which-item rule, the game's roll. In a where rule, the item that will actually drop."],
    ["scoreSpread", false, "Standing", "Lead", "Leader's standing minus trailer's standing. 0 with one player left."],
    ["leaderScore", false, "Standing", "Leader's standing", ""],
    ["trailerScore", false, "Standing", "Trailer's standing", ""],
    ["leaderHealth", false, "Standing", "Leader's health", "0 with no hero."],
    ["trailerHealth", false, "Standing", "Trailer's health", "0 with no hero."],
    ["equitySpread", false, "Item luck", "Item value gap", "Richest player's item value minus the poorest's.", 4],
    ["needyDeficit", false, "Item luck", "Owed player is short by", "Richest player's item value minus the owed player's.", 4]
  ];

  // Factors a where rule scores cells by: [name, label, explanation, newer app, measured in]
  var FEATURES = [
    ["distLeaderHero", "Steps to the leader's hero", "", 0, "steps"],
    ["distTrailerHero", "Steps to the trailer's hero", "", 0, "steps"],
    ["distNearestHero", "Steps to the nearest hero", "Anyone's.", 0, "steps"],
    ["distNearestItem", "Steps to the nearest item", "Already on the board.", 0, "steps"],
    ["distCenter", "Steps to the centre", "Counted double, so an even-sized board's centre is exact.", 0, "half-steps"],
    ["distLeaderCastle", "Steps to the leader's castle", "", 0, "steps"],
    ["distTrailerCastle", "Steps to the trailer's castle", "", 0, "steps"],
    ["distNearestCastle", "Steps to the nearest castle", "", 0, "steps"],
    ["ownedByLeader", "Leader's ground", "1 on the leader's cells, else 0.", 0, ""],
    ["ownedByTrailer", "Trailer's ground", "1 on the trailer's cells, else 0.", 0, ""],
    ["unowned", "Nobody's ground", "1 on cells nobody owns, else 0.", 0, ""],
    ["noise", "Random", "0 to 255, different for every cell and item, the same for every player.", 0, ""],
    ["needyReach", "Owed player's travel time", "How long the owed player takes to get there (1000 = one turn).", 4, "travel"],
    ["needyLead", "Owed player's lead", "Nearest rival's travel time minus the owed player's. Above 0, the owed player gets there first.", 4, "travel"],
    ["needyLeadOff", "Distance from the target lead", "How far the owed player's lead is from this rule's head start. 0 where the lead is exactly the one asked for.", 4, "travel"],
    ["contest", "Race closeness", "Second-fastest arrival minus the fastest. 0 is a dead heat.", 4, "travel"],
    ["reachNearest", "Fastest arrival", "The travel time of whoever gets there first.", 4, "travel"],
    ["reachSpread", "Arrival spread", "Slowest player's travel time minus the fastest's. 0 where everyone gets there at the same time.", 5, "travel"]
  ];

  var OPS = [["<", "<"], ["<=", "≤"], ["==", "="], ["!=", "≠"], [">=", "≥"], [">", ">"]];
  var EDIT_OPS = [["set", "Set weight of"], ["add", "Add to weight of"], ["scale", "Multiply weight of"]];

  var MAX_RULES = 32, MAX_CONDS = 8;
  var L_VALUE = 1000000000, L_WEIGHT = 1000000, L_SCALE = 1000, L_ITEM_VALUE = 10000, L_CATCHUP = 100000, L_HEAD = 100000;
  var TOP_FIELDS = ["mode", "note", "score", "baseWeights", "baseWeightsStart", "deal", "typeRules", "placeRules"];
  var DRAFT_KEY = "pixelrewind.itemRulesDraft";
  var SEND_TO = "support@jubinganga.com";

  var DEFAULT_VALUES = { Spring: 10, Battery: 15, RingOfInvisibility: 20, Teleport: 25, ComboBuilder: 25, Wand: 30, Bomb: 35, MonsterTrainerBox: 35, BiggestFreakinGunPossible: 60, ResetButton: 10 };

  // ------------------------------------------------------------------ templates

  var STANDING = { health: 1, territory: 1, comboCells: 5, princessHome: 40, carrying: 20, carryHome: 1, hero: 30, jetpack: 40, boxingGloves: 60, monsters: 35 };
  var DEAL = { values: DEFAULT_VALUES, catchUp: 100, catchUpFrom: 50 };
  var TIERS = [
    { when: [["scoreSpread", ">=", 120]], scale: { BiggestFreakinGunPossible: 1.5, Teleport: 1.5, ComboBuilder: 1.5, MonsterTrainerBox: 1.5, Spring: 0.6 } },
    { when: [["scoreSpread", ">=", 50], ["scoreSpread", "<", 120]], scale: { Teleport: 1.25, ComboBuilder: 1.25, MonsterTrainerBox: 1.25, Spring: 0.8 } }
  ];
  var ANSWER = { when: [["needyDeficit", ">=", 60]], scale: { BiggestFreakinGunPossible: 1.5, Bomb: 1.5, MonsterTrainerBox: 1.25, Spring: 0.75 } };
  var DEALT = { needyLeadOff: -10, needyReach: -2, noise: 1 };
  function toTrailer(item, w) {
    return { when: [["type", "==", item]], place: { distTrailerHero: w, distLeaderHero: 400, noise: 1 }, stop: true };
  }
  function strongDealt(item) {
    return { when: [["scoreSpread", ">=", 50], ["type", "==", item]], place: DEALT, headStart: 1000, stop: true };
  }
  var STRONG = ["BiggestFreakinGunPossible", "Bomb", "Teleport", "ComboBuilder", "MonsterTrainerBox"];

  var TEMPLATES = [
    { name: "Blank", text: "An empty ruleset: the game's own items, where the game puts them.", json: {} },
    {
      name: "Catch-up (Mario Kart)",
      text: "The game's own items until someone pulls ahead. Then strong items get more common, and BFGPs, Grenades, Teleports, Paintbrushes and Monster Boxes land next to whoever is behind.",
      json: {
        score: STANDING, baseWeights: "match", typeRules: TIERS,
        placeRules: [{ when: [["scoreSpread", "<", 50]], stop: true }].concat(
          STRONG.slice(0, 4).map(function (i) { return toTrailer(i, -1000); }),
          [toTrailer("MonsterTrainerBox", -600)])
      }
    },
    {
      name: "Catch-up 2 (fair deal)",
      text: "Every item is dealt to whoever has had the least item luck, as a race they are level in or a little ahead. Once someone pulls ahead, whoever is behind is owed more and strong items land a full turn on their side.",
      json: {
        score: STANDING, deal: DEAL, baseWeights: "match", typeRules: TIERS.concat([ANSWER]),
        placeRules: [{ when: [["type", "==", "Tube"]], stop: true }].concat(
          STRONG.map(strongDealt),
          [{ place: DEALT, headStart: 250 }])
      }
    },
    {
      name: "Catch-up 3 (fair ground)",
      text: "Like Catch-up 2, but an item goes to someone only while they are owed it. Once everyone is even, items land on fair ground: where every player arrives at about the same time.",
      json: {
        score: STANDING, deal: DEAL, baseWeights: "match", typeRules: TIERS.concat([ANSWER]),
        placeRules: [{ when: [["type", "==", "Tube"]], stop: true }].concat(
          STRONG.map(strongDealt),
          [
            { when: [["scoreSpread", ">=", 50]], place: DEALT, headStart: 250, stop: true },
            { when: [["needyDeficit", ">=", 20]], place: DEALT, headStart: 250, stop: true },
            { place: { reachSpread: -10, reachNearest: -2, noise: 1 } }
          ])
      }
    },
    {
      name: "Tame the power spikes",
      text: "Fewer BFGPs, Grenades and Monster Boxes, more Springs and Paintbrushes, and never more than one BFGP or two Grenades, Monster Boxes or Teleports in play at once.",
      json: {
        baseWeights: "match",
        typeRules: [
          { scale: { BiggestFreakinGunPossible: 0.4, Bomb: 0.6, MonsterTrainerBox: 0.6 }, add: { Spring: 500, ComboBuilder: 300 } },
          { when: [["itemsAnywhere", "BiggestFreakinGunPossible", ">=", 1]], set: { BiggestFreakinGunPossible: 0 } },
          { when: [["itemsAnywhere", "Bomb", ">=", 2]], set: { Bomb: 0 } },
          { when: [["itemsAnywhere", "MonsterTrainerBox", ">=", 2]], set: { MonsterTrainerBox: 0 } },
          { when: [["itemsAnywhere", "Teleport", ">=", 2]], set: { Teleport: 0 } }
        ]
      }
    },
    {
      name: "Neutral ground",
      text: "The game's own items, but every item lands towards the middle and away from all heroes.",
      json: { placeRules: [{ place: { distNearestHero: 100, distCenter: -60, noise: 1 } }] }
    },
    {
      name: "Slow build-up",
      text: "The first five rounds drop only movement and building items. Weapons come in after that, and from round 15 there are twice as many.",
      json: {
        baseWeights: "match",
        typeRules: [
          { when: [["round", "<=", 5]], set: { BiggestFreakinGunPossible: 0, Bomb: 0, MonsterTrainerBox: 0 } },
          { when: [["round", ">=", 15]], scale: { BiggestFreakinGunPossible: 2, Bomb: 2 } }
        ]
      }
    },
    {
      name: "Mobility madness",
      text: "Only Springs, Teleports and Batteries.",
      json: { baseWeights: { Spring: 2500, Teleport: 1500, Battery: 1000 }, typeRules: [{ add: { Spring: 0 } }] }
    },
    {
      name: "Chaos",
      text: "Every item that drops online, all equally likely, so the strong ones are far more common than usual.",
      json: {
        baseWeights: { Teleport: 1, RingOfInvisibility: 1, Spring: 1, Bomb: 1, BiggestFreakinGunPossible: 1, ComboBuilder: 1, MonsterTrainerBox: 1, Battery: 1 },
        typeRules: [{ add: { Spring: 0 } }]
      }
    }
  ];

  // ------------------------------------------------------------------ lookups

  function lc(s) { return String(s).toLowerCase(); }
  function find(list, name) {
    for (var i = 0; i < list.length; i++) if (lc(list[i][0]) === lc(name)) return list[i];
    return null;
  }
  function itemIndex(name) {
    if (typeof name === "number" || /^\d+$/.test(String(name))) {
      var n = Number(name);
      return n >= 0 && n < ITEMS.length && ITEMS[n] ? n : -1;
    }
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i] && (lc(ITEMS[i][0]) === lc(name) || lc(ITEMS[i][1]) === lc(name))) return i;
    }
    return -1;
  }
  function itemKey(name) { var s = itemIndex(name); return s < 0 ? null : ITEMS[s][0]; }
  function itemName(key) { var s = itemIndex(key); return s < 0 ? String(key) : ITEMS[s][1]; }
  function makeable(key) { var s = itemIndex(key); return s >= 0 && ITEMS[s][2]; }
  function tested(key) { var s = itemIndex(key); return s >= 0 && ITEMS[s][3]; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function isInt(v, lo, hi) { return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi; }
  function num(raw) {
    if (raw === "" || raw == null) return null;
    var n = Number(raw);
    return isNaN(n) ? raw : n;
  }
  function opLabel(op) { var o = find(OPS, op); return o ? o[1] : op; }
  function fmtNum(n) { return Number(n).toLocaleString("en-US"); }

  // ------------------------------------------------------------------ state

  var nextId = 1;
  // Rules that arrive whole (template, paste, link, draft) start folded, so the page reads as a list
  function foldAll() {
    state.typeRules.concat(state.placeRules).forEach(function (r) { ui.closed[r._id] = true; });
  }
  function blankState() {
    var values = {};
    Object.keys(DEFAULT_VALUES).forEach(function (k) { values[k] = String(DEFAULT_VALUES[k]); });
    return {
      meta: { name: "", author: "", description: "" },
      score: {},
      base: { kind: "match", mid: {}, start: {}, separateStart: false },
      deal: { enabled: false, values: values, catchUp: "", catchUpFrom: "" },
      typeRules: [],
      placeRules: []
    };
  }
  var state = blankState();
  var ui = { closed: {}, preview: {}, previewOpening: false, showUntested: false };

  function newCond() { return { input: "round", item: "", op: ">=", value: "1" }; }
  function newTypeRule() { return { _id: nextId++, when: [], edits: [{ op: "scale", item: "Spring", value: "1" }], stop: false, note: "" }; }
  function newPlaceRule() { return { _id: nextId++, when: [], outcome: "place", place: [{ feature: "distCenter", weight: "-1" }], headStart: "", stop: false, note: "" }; }

  // ------------------------------------------------------------------ JSON <-> state

  // The JSON the server takes. Mode is always "shadow": we try every submission that way first.
  function toJSON(s) {
    var o = { mode: "shadow" };
    var note = composeNote(s.meta);
    if (note) o.note = note;

    var score = {};
    SCORE.forEach(function (st) {
      var v = num(s.score[st[0]]);
      if (v !== null && v !== 0) score[st[0]] = v;
    });
    if (Object.keys(score).length) o.score = score;

    if (s.base.kind === "match") o.baseWeights = "match";
    if (s.base.kind === "custom") {
      o.baseWeights = weightsOut(s.base.mid);
      if (s.base.separateStart) o.baseWeightsStart = weightsOut(s.base.start);
    }

    if (s.deal.enabled) {
      var d = { values: weightsOut(s.deal.values) };
      var cu = num(s.deal.catchUp), cf = num(s.deal.catchUpFrom);
      if (cu !== null && cu !== 0) d.catchUp = cu;
      if (cf !== null && cf !== 0) d.catchUpFrom = cf;
      o.deal = d;
    }

    if (s.typeRules.length) {
      o.typeRules = s.typeRules.map(function (r) {
        var out = {};
        if (r.when.length) out.when = r.when.map(condOut);
        ["set", "add", "scale"].forEach(function (op) {
          var m = {};
          r.edits.forEach(function (e) { if (e.op === op) m[e.item] = num(e.value) === null ? 0 : num(e.value); });
          if (Object.keys(m).length) out[op] = m;
        });
        if (r.stop) out.stop = true;
        if (r.note.trim()) out.note = r.note.trim();
        return out;
      });
    }

    if (s.placeRules.length) {
      o.placeRules = s.placeRules.map(function (r) {
        var out = {};
        if (r.when.length) out.when = r.when.map(condOut);
        if (r.outcome === "place") {
          var p = {};
          r.place.forEach(function (f) { p[f.feature] = num(f.weight) === null ? 0 : num(f.weight); });
          out.place = p;
          var hs = num(r.headStart);
          if (hs !== null) out.headStart = hs;
        }
        if (r.outcome === "suppress") out.suppress = true;
        if (r.stop) out.stop = true;
        if (r.note.trim()) out.note = r.note.trim();
        return out;
      });
    }
    return o;
  }

  function weightsOut(m) {
    var o = {};
    Object.keys(m).forEach(function (k) {
      var v = num(m[k]);
      if (v !== null && v !== 0) o[k] = v;
    });
    return o;
  }

  function condOut(c) {
    var inp = find(INPUTS, c.input);
    var itemValued = c.input === "type" || c.input === "engineType";
    var v = itemValued ? c.value : num(c.value);
    if (v === null) v = 0;
    return inp && inp[1] ? [c.input, c.item, c.op, v] : [c.input, c.op, v];
  }

  // "Name (by author): what it does" - read back by parseNote; any other note is a description
  function composeNote(m) {
    var name = m.name.trim(), by = m.author.trim(), text = m.description.trim();
    if (!name && !by) return text;
    return (name || "Untitled") + " (by " + (by || "anonymous") + ")" + (text ? ": " + text : "");
  }
  function parseNote(note) {
    var m = /^([^\n]{1,60}?) \(by ([^\n]{1,40}?)\)(?:: ([\s\S]*))?$/.exec(note);
    if (!m) return { name: "", author: "", description: note };
    return { name: m[1] === "Untitled" ? "" : m[1], author: m[2] === "anonymous" ? "" : m[2], description: m[3] || "" };
  }

  // A checked ruleset (validate() found nothing) into state
  function fromJSON(o) {
    var s = blankState();
    if (typeof o.note === "string") s.meta = parseNote(o.note);
    if (isObj(o.score)) Object.keys(o.score).forEach(function (k) { s.score[find(SCORE, k)[0]] = String(o.score[k]); });
    if (typeof o.baseWeights === "string") s.base.kind = "match";
    else if (isObj(o.baseWeights)) {
      s.base.kind = "custom";
      s.base.mid = weightsIn(o.baseWeights);
      if (isObj(o.baseWeightsStart)) { s.base.separateStart = true; s.base.start = weightsIn(o.baseWeightsStart); }
    } else s.base.kind = "none";
    if (isObj(o.deal)) {
      s.deal.enabled = true;
      s.deal.values = weightsIn(o.deal.values || {});
      s.deal.catchUp = o.deal.catchUp != null ? String(o.deal.catchUp) : "";
      s.deal.catchUpFrom = o.deal.catchUpFrom != null ? String(o.deal.catchUpFrom) : "";
    }
    (o.typeRules || []).forEach(function (r) {
      var t = { _id: nextId++, when: (r.when || []).map(condIn), edits: [], stop: r.stop === true, note: typeof r.note === "string" ? r.note : "" };
      ["set", "add", "scale"].forEach(function (op) {
        if (isObj(r[op])) Object.keys(r[op]).forEach(function (k) { t.edits.push({ op: op, item: itemKey(k), value: String(r[op][k]) }); });
      });
      s.typeRules.push(t);
    });
    (o.placeRules || []).forEach(function (r) {
      var p = {
        _id: nextId++, when: (r.when || []).map(condIn), place: [], headStart: r.headStart != null ? String(r.headStart) : "",
        outcome: r.suppress === true ? "suppress" : isObj(r.place) ? "place" : "keep", stop: r.stop === true,
        note: typeof r.note === "string" ? r.note : ""
      };
      if (isObj(r.place)) Object.keys(r.place).forEach(function (k) { p.place.push({ feature: find(FEATURES, k)[0], weight: String(r.place[k]) }); });
      s.placeRules.push(p);
    });
    return s;
  }
  function weightsIn(m) {
    var o = {};
    Object.keys(m).forEach(function (k) { o[itemKey(k)] = String(m[k]); });
    return o;
  }
  function condIn(c) {
    var inp = find(INPUTS, c[0]);
    var typed = inp[1];
    var value = c[c.length - 1];
    var itemValued = inp[0] === "type" || inp[0] === "engineType";
    return {
      input: inp[0], item: typed ? itemKey(c[1]) : "", op: c[c.length - 2],
      value: itemValued ? (itemKey(value) || "Spring") : String(value)
    };
  }

  // ------------------------------------------------------------------ the server's checks

  function where(path) {
    return path
      .replace(/^typeRules\[(\d+)\]/, function (_, i) { return "Which-item rule " + (+i + 1); })
      .replace(/^placeRules\[(\d+)\]/, function (_, i) { return "Where rule " + (+i + 1); })
      .replace(/\.when\[(\d+)\]/, function (_, i) { return ", condition " + (+i + 1); })
      .replace(/^score\./, "Standing: ")
      .replace(/^deal\.values\./, "Item value of ")
      .replace(/^baseWeightsStart\./, "Opening weight of ")
      .replace(/^baseWeights\./, "Starting weight of ");
  }

  function validate(o) {
    var E = [];
    function err(path, msg) { E.push((path ? where(path) + ": " : "") + msg); }
    function int(v, path, lo, hi) {
      if (isInt(v, lo, hi)) return true;
      err(path, "a whole number from " + fmtNum(lo) + " to " + fmtNum(hi));
      return false;
    }
    if (!isObj(o)) { err("", "a ruleset is a JSON object { ... }"); return E; }
    Object.keys(o).forEach(function (k) { if (TOP_FIELDS.indexOf(k) < 0) err(k, "not a ruleset field"); });

    if ("mode" in o && !(typeof o.mode === "string" && /^(shadow|live)$/i.test(o.mode))) err("mode", "\"shadow\" or \"live\"");

    if ("score" in o) {
      if (!isObj(o.score)) err("score", "an object of standing weights");
      else Object.keys(o.score).forEach(function (k) {
        if (!find(SCORE, k)) err("score." + k, "not a standing figure");
        else int(o.score[k], "score." + k, -L_WEIGHT, L_WEIGHT);
      });
    }

    var baseObj = false;
    if ("baseWeights" in o) {
      if (typeof o.baseWeights === "string" && lc(o.baseWeights) === "match") { /* the game's own */ }
      else if (isObj(o.baseWeights)) { baseObj = true; weightsCheck(o.baseWeights, "baseWeights", 0, L_WEIGHT); }
      else err("baseWeights", "\"match\", or an object of item weights");
    }
    if ("baseWeightsStart" in o) {
      if (!baseObj) err("baseWeightsStart", "only beside your own starting weights");
      else if (isObj(o.baseWeightsStart)) weightsCheck(o.baseWeightsStart, "baseWeightsStart", 0, L_WEIGHT);
      else err("baseWeightsStart", "an object of item weights");
    }

    if ("deal" in o) {
      if (!isObj(o.deal)) err("deal", "an object of values, catchUp and catchUpFrom");
      else Object.keys(o.deal).forEach(function (k) {
        if (k === "values") {
          if (!isObj(o.deal.values)) err("deal.values", "an object of item values");
          else weightsCheck(o.deal.values, "deal.values", 0, L_ITEM_VALUE);
        } else if (k === "catchUp") int(o.deal.catchUp, "deal.catchUp", 0, L_CATCHUP);
        else if (k === "catchUpFrom") int(o.deal.catchUpFrom, "deal.catchUpFrom", 0, L_VALUE);
        else err("deal." + k, "the deal has values, catchUp and catchUpFrom");
      });
    }

    rulesCheck("typeRules", false);
    rulesCheck("placeRules", true);
    return E;

    function weightsCheck(m, path, lo, hi) {
      Object.keys(m).forEach(function (k) {
        if (itemIndex(k) < 0) err(path + "." + k, "not an item");
        else int(m[k], path + "." + k, lo, hi);
      });
    }

    function rulesCheck(name, place) {
      if (!(name in o)) return;
      var list = o[name];
      if (!Array.isArray(list)) { err(name, "a list of rules"); return; }
      if (list.length > MAX_RULES) err(name, "at most " + MAX_RULES + " rules");
      var allowed = place ? ["when", "place", "headStart", "suppress", "stop", "note"] : ["when", "set", "add", "scale", "stop", "note"];
      list.forEach(function (r, i) {
        var path = name + "[" + i + "]";
        if (!isObj(r)) { err(path, "a rule is an object"); return; }
        Object.keys(r).forEach(function (k) { if (allowed.indexOf(k) < 0) err(path, "\"" + k + "\" is not part of this kind of rule"); });
        if ("when" in r) {
          if (!Array.isArray(r.when)) err(path, "the conditions are a list");
          else {
            if (r.when.length > MAX_CONDS) err(path, "at most " + MAX_CONDS + " conditions");
            r.when.forEach(function (c, ci) { condCheck(c, path + ".when[" + ci + "]"); });
          }
        }
        if (!place) {
          ["set", "add", "scale"].forEach(function (op) {
            if (!(op in r)) return;
            if (!isObj(r[op])) { err(path, op + " is an object of items"); return; }
            Object.keys(r[op]).forEach(function (k) {
              var at = path + ", " + op + " " + k;
              var s = itemIndex(k);
              if (s < 0) err(at, "not an item");
              else if (!ITEMS[s][2]) err(at, "the rules never make or remove " + ITEMS[s][1] + "s");
              else if (op === "scale") {
                var v = r[op][k];
                if (!(typeof v === "number" && v >= 0 && v <= L_SCALE)) err(at, "a multiplier from 0 to 1000");
              } else int(r[op][k], at, -L_WEIGHT, L_WEIGHT);
            });
          });
        }
        if (place && "place" in r) {
          if (!isObj(r.place)) err(path, "place is an object of factor weights");
          else Object.keys(r.place).forEach(function (k) {
            if (!find(FEATURES, k)) err(path, "\"" + k + "\" is not a factor");
            else int(r.place[k], path + ", " + k, -L_WEIGHT, L_WEIGHT);
          });
        }
        if (place && "headStart" in r) {
          int(r.headStart, path + ", head start", -L_HEAD, L_HEAD);
          if (!("place" in r)) err(path, "a head start only goes with a chosen spot");
        }
        ["stop", "suppress"].forEach(function (k) {
          if (k in r && typeof r[k] !== "boolean") err(path, k + " is true or false");
        });
      });
    }

    function condCheck(c, path) {
      if (!Array.isArray(c) || (c.length !== 3 && c.length !== 4)) { err(path, "[input, comparison, value], or [input, item, comparison, value]"); return; }
      var inp = typeof c[0] === "string" ? find(INPUTS, c[0]) : null;
      if (!inp) { err(path, "unknown input"); return; }
      if (inp[1] !== (c.length === 4)) { err(path, inp[1] ? c[0] + " needs an item" : c[0] + " takes no item"); return; }
      if (inp[1] && !itemArg(c[1])) { err(path, "not an item"); return; }
      if (!find(OPS, c[c.length - 2])) { err(path, "the comparison is one of < <= == != >= >"); return; }
      var v = c[c.length - 1];
      var itemValued = inp[0] === "type" || inp[0] === "engineType";
      if (itemValued && typeof v === "string") { if (itemIndex(v) < 0) err(path, "not an item"); }
      else if (!isInt(v, -L_VALUE, L_VALUE)) err(path, "a whole number");
      else if (itemValued && itemIndex(v) < 0) err(path, "this page names items, not numbers: use the item's name");
    }
    function itemArg(v) { return (typeof v === "string" || typeof v === "number") && itemIndex(v) >= 0; }
  }

  // ------------------------------------------------------------------ advice

  function needsRecent(o) {
    var five = (o.score && o.score.monsters) || (o.placeRules || []).some(function (r) { return r.place && "reachSpread" in r.place; });
    if (five) return true;
    var newInputs = ["equitySpread", "needyDeficit"];
    var newFeatures = FEATURES.filter(function (f) { return f[3]; }).map(function (f) { return f[0]; });
    return !!o.deal || (o.typeRules || []).concat(o.placeRules || []).some(function (r) {
      return "headStart" in r ||
        (r.when || []).some(function (c) { return newInputs.indexOf(c[0]) >= 0; }) ||
        (r.place && Object.keys(r.place).some(function (k) { return newFeatures.indexOf(k) >= 0; }));
    });
  }

  function startWeights(kind, opening) {
    var w = {};
    ITEMS.forEach(function (it) {
      if (!it) return;
      var v = 0;
      if (kind === "match") v = (opening ? STD_START : STD_MID)[it[0]] || 0;
      if (kind === "custom") {
        var src = opening && state.base.separateStart ? state.base.start : state.base.mid;
        v = num(src[it[0]]);
        v = typeof v === "number" && v > 0 ? Math.floor(v) : 0;
      }
      w[it[0]] = v;
    });
    return w;
  }

  function lint(s, o) {
    var W = [];
    function warn(msg) { W.push(["warn", msg]); }
    function info(msg) { W.push(["info", msg]); }

    var types = s.typeRules, places = s.placeRules;
    if (!types.length && !places.length) info("There are no rules yet, so this ruleset changes nothing.");

    var scoreUsed = SCORE.some(function (st) { var v = num(s.score[st[0]]); return typeof v === "number" && v !== 0; });
    var standingWords = ["scoreSpread", "leaderScore", "trailerScore"];
    var standingFeatures = ["distLeaderHero", "distTrailerHero", "distLeaderCastle", "distTrailerCastle", "ownedByLeader", "ownedByTrailer"];
    var usesStanding = types.concat(places).some(function (r) {
      return r.when.some(function (c) { return standingWords.indexOf(c.input) >= 0 || c.input === "leaderHealth" || c.input === "trailerHealth"; }) ||
        (r.place && r.outcome === "place" && r.place.some(function (f) { return standingFeatures.indexOf(f.feature) >= 0; }));
    });
    if (usesStanding && !scoreUsed) warn("Your rules ask about the leader or trailer, but every standing weight is 0. Everyone then stands at 0, the lead is always 0, and player 1 always counts as the leader.");

    var dealWords = ["equitySpread", "needyDeficit"];
    var dealFeatures = ["needyReach", "needyLead", "needyLeadOff"];
    var usesDeal = types.concat(places).some(function (r) {
      return r.when.some(function (c) { return dealWords.indexOf(c.input) >= 0; }) ||
        (r.outcome === "place" && r.place && r.place.some(function (f) { return dealFeatures.indexOf(f.feature) >= 0; }));
    });
    var usesEquity = types.concat(places).some(function (r) { return r.when.some(function (c) { return dealWords.indexOf(c.input) >= 0; }); });
    if (usesEquity && !s.deal.enabled) warn("Your rules test the item value gap, but the fair deal is off. Every player's item value is then 0, so those conditions always see 0.");
    else if (usesDeal && !s.deal.enabled) info("Without the fair deal, the “owed” player is simply the trailer.");
    if (s.deal.enabled && !usesDeal) info("The fair deal is on, but no rule uses it. Item values only matter to the “owed player” factors and the item value conditions.");

    if (s.base.kind === "none" && types.length) {
      var anyRaise = types.some(function (r) { return r.edits.some(function (e) { return (e.op === "set" || e.op === "add") && Number(e.value) > 0; }); });
      if (!anyRaise) warn("Starting weights are “nothing” and no which-item rule sets or adds a weight above 0, so every weight stays 0 and the game's own item always stays.");
    }
    if (s.base.kind === "custom" && !Object.keys(o.baseWeights || {}).length) warn("Your own starting weights are all 0.");

    // Multiplying an item that has no weight, assuming every rule before it holds
    var w = startWeights(s.base.kind, false);
    var deadFrom = null;
    types.forEach(function (r, i) {
      var label = "Which-item rule " + (i + 1);
      var seen = {};
      r.edits.forEach(function (e) {
        var k = e.op + ":" + e.item;
        if (seen[k]) warn(label + " changes " + itemName(e.item) + " twice the same way; only the last one counts.");
        seen[k] = true;
      });
      applyEdits(w, r, function (item) {
        if (s.base.kind !== "match" || !STD_MID[item]) {
          warn(label + " multiplies " + itemName(item) + ", but its weight is 0 there. Multiplying 0 gives 0: use add or set to bring it in.");
        }
      });
      if (!r.when.length) info(label + " has no conditions, so it applies to every item: each one is drawn again from the starting weights" + (s.base.kind === "match" ? " (and no Wand ever drops)" : "") + ".");
      if (r.when.some(function (c) { return c.input === "type" || c.input === "engineType"; }) && r.when.some(function (c) { return (c.input === "type" || c.input === "engineType") && c.value === "Tube" && c.op === "=="; })) {
        warn(label + " asks for a Tube, but which-item rules never see a Tube: the game keeps every Tube it rolls.");
      }
      if (deadFrom !== null) warn(label + " is never reached: rule " + (deadFrom + 1) + " always applies and stops.");
      if (deadFrom === null && !r.when.length && r.stop) deadFrom = i;
    });

    deadFrom = null;
    places.forEach(function (r, i) {
      var label = "Where rule " + (i + 1);
      if (deadFrom !== null) warn(label + " is never reached: rule " + (deadFrom + 1) + " always applies and stops.");
      if (deadFrom === null && !r.when.length && r.stop) deadFrom = i;
      if (r.outcome === "place") {
        if (!r.place.length) warn(label + " chooses a spot with no factors: every cell scores 0, so the item goes to the free cell nearest the top-left corner.");
        var seen = {};
        r.place.forEach(function (f) {
          if (seen[f.feature]) warn(label + " uses “" + find(FEATURES, f.feature)[1] + "” twice; only the last one counts.");
          seen[f.feature] = true;
        });
        var noise = r.place.filter(function (f) { return f.feature === "noise"; }).map(function (f) { return Math.abs(Number(f.weight) || 0); })[0] || 0;
        if (noise) {
          r.place.forEach(function (f) {
            var fw = Math.abs(Number(f.weight) || 0);
            var unit = find(FEATURES, f.feature)[4];
            if (!fw || (unit !== "steps" && unit !== "travel")) return;
            var steps = unit === "steps" ? noise * 255 / fw : noise * 255 / (fw * 666);
            if (steps >= 1) info(label + ": the random factor can outweigh up to " + Math.floor(steps) + " step" + (steps >= 2 ? "s" : "") + " of “" + find(FEATURES, f.feature)[1] + "”.");
          });
        }
        var hasLeadOff = r.place.some(function (f) { return f.feature === "needyLeadOff"; });
        if (r.headStart !== "" && !hasLeadOff) warn(label + " has a head start but no “distance from the target lead” factor; the head start only changes that factor.");
        if (r.headStart === "" && hasLeadOff) info(label + " uses “distance from the target lead” with no head start, so the target is an even race (0).");
      }
      if (r.outcome === "keep" && !r.stop) info(label + " neither chooses a spot, drops nothing nor stops, so it does nothing.");
    });

    var untested = {};
    function mark(k) { if (k && !tested(k)) untested[itemName(k)] = true; }
    types.forEach(function (r) { r.edits.forEach(function (e) { if (Number(e.value) !== 0 || e.op === "scale") mark(e.item); }); });
    if (s.base.kind === "custom") Object.keys(o.baseWeights || {}).forEach(mark);
    if (Object.keys(untested).length) warn("Untested items: " + Object.keys(untested).join(", ") + ". They exist in the game but have never dropped in an online match, so nobody knows yet how they behave there.");

    return W;
  }

  // Set, then add, then multiply, each in item order: how a rule's changes apply
  function applyEdits(w, r, onDeadScale) {
    ["set", "add", "scale"].forEach(function (op) {
      var last = {};
      r.edits.forEach(function (e) { if (e.op === op && makeable(e.item)) last[e.item] = e.value; });
      Object.keys(last).sort(function (a, b) { return itemIndex(a) - itemIndex(b); }).forEach(function (item) {
        var v = Number(last[item]);
        if (isNaN(v)) return;
        var cur = w[item] || 0;
        if (op === "set") cur = Math.trunc(v);
        if (op === "add") cur = cur + Math.trunc(v);
        if (op === "scale") {
          if (cur === 0 && onDeadScale) onDeadScale(item);
          cur = Math.trunc(cur * Math.round(v * 1000) / 1000);
        }
        w[item] = Math.max(0, Math.min(1000000000, cur));
      });
    });
  }

  // ------------------------------------------------------------------ rendering helpers

  function sel(path, options, current, attrs) {
    return '<select data-path="' + path + '"' + (attrs || "") + ">" + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current) ? " selected" : "") + (o[2] ? " disabled" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }
  function numIn(path, value, lo, hi, step, label, attrs) {
    return '<input type="number" data-path="' + path + '" value="' + esc(value) + '" min="' + lo + '" max="' + hi + '" step="' + (step || 1) + '"' +
      (label ? ' aria-label="' + esc(label) + '"' : "") + (attrs || "") + ">";
  }
  // Item choices: which ones to offer, and untested ones only on request (or when already chosen)
  function itemOptions(filter, current) {
    var out = [];
    ITEMS.forEach(function (it) {
      if (!it) return;
      if (filter === "makeable" && !it[2]) return;
      if (filter === "values" && it[0] === "Tube") return;
      if (!it[3] && !ui.showUntested && it[0] !== current) return;
      out.push([it[0], it[1] + (it[3] ? "" : " (untested)")]);
    });
    return out;
  }
  function tagNew(level) { return level ? '<span class="tag tag--new" title="Needs a recent app">recent apps</span>' : ""; }
  function inputOptions() {
    var out = [];
    INPUTS.forEach(function (i) { out.push([i[0], i[2] + " › " + i[3].replace(/:$/, " (item)") + (i[5] ? " *" : "")]); });
    return out;
  }

  function condText(c) {
    var inp = find(INPUTS, c.input);
    if (!inp) return "?";
    var label = inp[1] ? inp[3] + " " + itemName(c.item) : inp[3];
    var v = c.input === "type" || c.input === "engineType" ? itemName(c.value) : c.value === "" ? "0" : c.value;
    if (c.input === "matchStart" && (c.op === "==" || c.op === "!=")) {
      var yes = (c.op === "==") === (String(c.value) === "1");
      return yes ? "it is the opening spread" : "it is not the opening spread";
    }
    return label + " " + opLabel(c.op) + " " + v;
  }
  function whenText(when) {
    return when.length ? "If " + when.map(condText).join(" and ") : "Always";
  }
  function typeSummary(r) {
    var parts = [];
    ["set", "add", "scale"].forEach(function (op) {
      r.edits.forEach(function (e) {
        if (e.op !== op) return;
        var n = itemName(e.item);
        if (op === "set") parts.push(n + " = " + (e.value || 0));
        if (op === "add") parts.push(n + (Number(e.value) < 0 ? " − " + Math.abs(Number(e.value)) : " + " + (e.value || 0)));
        if (op === "scale") parts.push(n + " ×" + (e.value || 0));
      });
    });
    return esc(whenText(r.when)) + ": " + (parts.length ? esc(parts.join(", ")) : "<em>draw again, no changes</em>") + (r.stop ? ". <em>Then stop.</em>" : ".");
  }
  function placeSummary(r) {
    var what;
    if (r.outcome === "suppress") what = "<em>drop nothing</em>";
    else if (r.outcome === "keep") what = "leave the game's spot";
    else {
      var f = r.place.map(function (p) {
        var w = Number(p.weight) || 0;
        return (w < 0 ? "−" : "+") + Math.abs(w) + " × " + find(FEATURES, p.feature)[1].toLowerCase();
      });
      what = "best cell by " + (f.length ? esc(f.join(", ")) : "nothing") + (r.headStart !== "" ? esc(", head start " + r.headStart) : "");
    }
    return esc(whenText(r.when)) + ": " + what + (r.stop ? ". <em>Then stop.</em>" : ".");
  }

  // ------------------------------------------------------------------ sections

  function renderMeta() {
    var m = state.meta;
    return '<label class="field"><span>Name</span><input type="text" data-path="meta.name" maxlength="60" value="' + esc(m.name) + '" placeholder="e.g. Comeback kings"></label>' +
      '<label class="field"><span>Your online name (or how we should credit you)</span><input type="text" data-path="meta.author" maxlength="40" value="' + esc(m.author) + '"></label>' +
      '<label class="field"><span>What it does, and why</span><textarea data-path="meta.description" style="min-height:90px;font-family:inherit;font-size:15px">' + esc(m.description) + "</textarea></label>" +
      '<label class="check"><input type="checkbox" data-path="ui.showUntested" data-rerender' + (ui.showUntested ? " checked" : "") + '><span>Show untested items in the lists <span class="hint">(they exist in the game but have never dropped online)</span></span></label>';
  }

  function renderScore() {
    return '<div class="numgrid numgrid--two">' + SCORE.map(function (st) {
      return "<div><b>" + esc(st[1]) + tagNew(st[3]) + "</b>" + numIn("score." + st[0], state.score[st[0]] || "", -L_WEIGHT, L_WEIGHT, 1, st[1] + " weight", ' placeholder="0"') +
        '<span class="hint">' + esc(st[2]) + "</span></div>";
    }).join("") + "</div>" +
      '<p class="hint" style="margin-top:10px">A typical standing: health 1, territory 1, combo cells 5, princess at home 40, carrying 20, carrier near home 1, hero 30, movement boost 40, attack boost 60, monsters 35. At the start of a match everyone is within a few points; territory alone is often 15&ndash;25 per player.</p>';
  }

  function renderBase() {
    var b = state.base;
    var html = '<div class="choice">' +
      radio("base.kind", "match", b.kind, "<b>The game's own mix</b>", "The standard weights (the opening spread has its own). Recommended.") +
      radio("base.kind", "custom", b.kind, "<b>My own weights</b>", "Only the items you give a weight.") +
      radio("base.kind", "none", b.kind, "<b>Nothing</b>", "Every weight starts at 0; your rules must set or add them.") +
      "</div>";
    if (b.kind === "custom") {
      html += weightGrid("base.mid", b.mid, "makeable", 0, L_WEIGHT);
      html += '<label class="check"><input type="checkbox" data-path="base.separateStart" data-rerender' + (b.separateStart ? " checked" : "") +
        "><span>Different weights for the opening spread (the items placed before the first turn)</span></label>";
      if (b.separateStart) html += weightGrid("base.start", b.start, "makeable", 0, L_WEIGHT);
    }
    return html;
  }

  function radio(path, value, current, title, hint) {
    return '<label class="check"><input type="radio" name="' + path + '" data-path="' + path + '" data-rerender value="' + value + '"' + (current === value ? " checked" : "") +
      "><span>" + title + '<br><span class="hint">' + esc(hint) + "</span></span></label>";
  }

  function weightGrid(path, values, filter, lo, hi) {
    return '<div class="numgrid numgrid--two" style="margin:8px 0 12px">' + itemOptions(filter, null).map(function (o) {
      return "<div><b>" + esc(o[1]) + "</b>" + numIn(path + "." + o[0], values[o[0]] || "", lo, hi, 1, o[1], ' placeholder="0"') + "</div>";
    }).join("") + "</div>";
  }

  function renderDeal() {
    var d = state.deal;
    var html = '<label class="check"><input type="checkbox" data-path="deal.enabled" data-rerender' + (d.enabled ? " checked" : "") +
      '><span><b>Use the fair deal</b> <span class="tag tag--new">recent apps</span></span></label>';
    if (!d.enabled) return html;
    html += "<h4>Item values</h4>" + weightGrid("deal.values", d.values, "values", 0, L_ITEM_VALUE);
    html += '<p class="hint">Only the ratios matter. The values filled in are a starting point to tune: Spring 10, Battery 15, The Ring 20, Teleport and Paintbrush 25, Wand 30, Grenade and Monster Box 35, BFGP 60, Reset Button 10.</p>';
    html += "<h4>Owe more to whoever is behind</h4>" +
      '<div class="numgrid"><div><b>Extra share per 100 points behind</b>' + numIn("deal.catchUp", d.catchUp, 0, L_CATCHUP, 1, "Catch-up percent", ' placeholder="0"') +
      '<span class="hint">In percent. 100 means a player 100 points behind the leader is owed until their item value is 1.5× an even player\'s, 150 behind until 2×.</span></div>' +
      '<div><b>Starting from a lead of</b>' + numIn("deal.catchUpFrom", d.catchUpFrom, 0, L_VALUE, 1, "Catch-up from", ' placeholder="0"') +
      '<span class="hint">Standing points. Below this gap, everyone is owed the same.</span></div></div>';
    return html;
  }

  function condRows(list, ri, when) {
    var base = list + "." + ri + ".when";
    var html = "<h4>When all of these are true</h4>";
    if (!when.length) html += '<p class="empty">No conditions: the rule applies to every item.</p>';
    when.forEach(function (c, ci) {
      var p = base + "." + ci;
      var inp = find(INPUTS, c.input);
      html += '<div class="row">' + sel(p + ".input", inputOptions(), c.input, ' class="grow" data-rerender aria-label="Input"');
      if (inp[1]) html += sel(p + ".item", itemOptions("all", c.item), c.item, ' aria-label="Item"');
      if (c.input === "matchStart") {
        html += sel(p + ".op", [["==", "is"], ["!=", "is not"]], c.op, ' aria-label="Comparison"') +
          sel(p + ".value", [["1", "Yes"], ["0", "No"]], String(c.value), ' aria-label="Value"');
      } else {
        html += sel(p + ".op", OPS, c.op, ' aria-label="Comparison"');
        if (c.input === "type" || c.input === "engineType") html += sel(p + ".value", itemOptions("all", c.value), c.value, ' aria-label="Item"');
        else html += numIn(p + ".value", c.value, -L_VALUE, L_VALUE, 1, "Value");
      }
      html += '<button class="tool tool--x" type="button" data-act="del-cond" data-list="' + list + '" data-i="' + ri + '" data-j="' + ci + '" aria-label="Remove condition">✕</button></div>';
      if (inp[4]) html += '<p class="hint" style="margin:0 0 4px">' + esc(inp[4]) + (inp[5] ? " (recent apps)" : "") + "</p>";
    });
    html += '<button class="tool" type="button" data-act="add-cond" data-list="' + list + '" data-i="' + ri + '"' + (when.length >= MAX_CONDS ? " disabled" : "") + ">+ Condition</button>";
    return html;
  }

  function ruleTools(list, i, n) {
    return '<div class="rule__tools">' +
      '<button class="tool" type="button" data-act="up" data-list="' + list + '" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + ">↑ Up</button>" +
      '<button class="tool" type="button" data-act="down" data-list="' + list + '" data-i="' + i + '"' + (i === n - 1 ? " disabled" : "") + ">↓ Down</button>" +
      '<button class="tool" type="button" data-act="dup" data-list="' + list + '" data-i="' + i + '"' + (n >= MAX_RULES ? " disabled" : "") + ">Duplicate</button>" +
      '<button class="tool tool--x" type="button" data-act="del-rule" data-list="' + list + '" data-i="' + i + '">Delete</button></div>';
  }

  function ruleShell(list, r, i, n, body, summary) {
    return '<details class="rule" data-id="' + r._id + '"' + (ui.closed[r._id] ? "" : " open") + '><summary><span class="rule__num">' + (i + 1) +
      '</span><span class="rule__sum" id="sum-' + r._id + '">' + summary + "</span></summary>" +
      '<div class="rule__body">' + ruleTools(list, i, n) + body +
      '<label class="check" style="margin-top:14px"><input type="checkbox" data-path="' + list + "." + i + '.stop"' + (r.stop ? " checked" : "") +
      "><span>Stop here: when this rule applies, skip the rules below it</span></label>" +
      '<label class="field" style="margin-top:8px"><span>Comment (optional)</span><input type="text" data-path="' + list + "." + i + '.note" value="' + esc(r.note) + '"></label>' +
      "</div></details>";
  }

  function renderType() {
    var n = state.typeRules.length;
    var html = '<div class="rules">' + state.typeRules.map(function (r, i) {
      var body = condRows("typeRules", i, r.when) + "<h4>Then change the weights</h4>";
      if (!r.edits.length) body += '<p class="empty">No changes: the item is still drawn again from the starting weights.</p>';
      r.edits.forEach(function (e, ei) {
        var p = "typeRules." + i + ".edits." + ei;
        var scale = e.op === "scale";
        body += '<div class="row">' + sel(p + ".op", EDIT_OPS, e.op, ' data-rerender aria-label="Change"') +
          sel(p + ".item", itemOptions("makeable", e.item), e.item, ' class="grow" aria-label="Item"') +
          (scale ? '<span class="unit">×</span>' : e.op === "set" ? '<span class="unit">to</span>' : '<span class="unit">+</span>') +
          numIn(p + ".value", e.value, scale ? 0 : -L_WEIGHT, scale ? L_SCALE : L_WEIGHT, scale ? 0.001 : 1, "Amount") +
          '<button class="tool tool--x" type="button" data-act="del-edit" data-i="' + i + '" data-j="' + ei + '" aria-label="Remove change">✕</button></div>';
      });
      body += '<button class="tool" type="button" data-act="add-edit" data-i="' + i + '">+ Change</button>';
      return ruleShell("typeRules", r, i, n, body, typeSummary(r));
    }).join("") + "</div>";
    html += '<button class="btn btn--small" type="button" data-act="add-rule" data-list="typeRules"' + (n >= MAX_RULES ? " disabled" : "") + ">+ Which-item rule</button>";
    return html;
  }

  function renderPlace() {
    var n = state.placeRules.length;
    var html = '<div class="rules">' + state.placeRules.map(function (r, i) {
      var p = "placeRules." + i;
      var body = condRows("placeRules", i, r.when) + "<h4>Then</h4>" +
        '<div class="outcomes">' +
        outcome(p, "place", r.outcome, "Choose the spot") +
        outcome(p, "keep", r.outcome, "Leave the game's spot") +
        outcome(p, "suppress", r.outcome, "Drop nothing") + "</div>";
      if (r.outcome === "place") {
        body += "<h4>Score each free cell by</h4>";
        if (!r.place.length) body += '<p class="empty">No factors yet.</p>';
        r.place.forEach(function (f, fi) {
          var fp = p + ".place." + fi;
          var meta = find(FEATURES, f.feature);
          body += '<div class="row">' + numIn(fp + ".weight", f.weight, -L_WEIGHT, L_WEIGHT, 1, "Weight") + '<span class="unit">×</span>' +
            sel(fp + ".feature", FEATURES.map(function (x) { return [x[0], x[1] + (x[3] ? " *" : "")]; }), f.feature, ' class="grow" data-rerender aria-label="Factor"') +
            '<button class="tool tool--x" type="button" data-act="del-feat" data-i="' + i + '" data-j="' + fi + '" aria-label="Remove factor">✕</button></div>' +
            (meta[2] || meta[3] ? '<p class="hint" style="margin:0 0 4px">' + esc(meta[2]) + (meta[3] ? " (recent apps)" : "") + "</p>" : "");
        });
        body += '<button class="tool" type="button" data-act="add-feat" data-i="' + i + '">+ Factor</button>';
        body += '<div class="row" style="margin-top:10px"><span class="unit">Head start</span>' + numIn(p + ".headStart", r.headStart, -L_HEAD, L_HEAD, 1, "Head start", ' placeholder="none"') +
          '<span class="unit">thousandths of a turn <span class="tag tag--new">recent apps</span></span></div>' +
          '<p class="hint">Only for “distance from the target lead”: 0 is an even race, 250 a step ahead, 1000 a full turn ahead. See the reference below.</p>';
      }
      return ruleShell("placeRules", r, i, n, body, placeSummary(r));
    }).join("") + "</div>";
    html += '<button class="btn btn--small" type="button" data-act="add-rule" data-list="placeRules"' + (n >= MAX_RULES ? " disabled" : "") + ">+ Where rule</button>";
    html += '<p class="hint" style="margin-top:12px">Factors marked * need a recent app.</p>';
    return html;
  }
  function outcome(p, value, current, label) {
    return '<label class="check"><input type="radio" name="' + p + '.outcome" data-path="' + p + '.outcome" data-rerender value="' + value + '"' +
      (current === value ? " checked" : "") + "><span>" + esc(label) + "</span></label>";
  }

  // The share of each item while the ticked rules hold
  function renderPreview() {
    if (!state.typeRules.length) return '<p class="empty">Add a which-item rule to see what it does to the mix.</p>';
    var opening = ui.previewOpening;
    var std = opening ? STD_START : STD_MID;
    var stdTotal = 0;
    Object.keys(std).forEach(function (k) { stdTotal += std[k]; });

    var w = startWeights(state.base.kind, opening);
    var any = false, stopped = false;
    var boxes = state.typeRules.map(function (r, i) {
      var on = !!ui.preview[r._id];
      var skipped = stopped;
      if (on && !stopped) { any = true; applyEdits(w, r); if (r.stop) stopped = true; }
      return '<label class="check"><input type="checkbox" data-preview="' + r._id + '"' + (on ? " checked" : "") + (skipped ? " disabled" : "") +
        '><span><b>Rule ' + (i + 1) + "</b> " + '<span class="hint">' + typeSummary(r) + (skipped ? " (skipped: an earlier ticked rule stops)" : "") + "</span></span></label>";
    }).join("");

    var total = 0;
    ITEMS.forEach(function (it) { if (it && it[2]) total += w[it[0]] || 0; });
    var tubeShare = (std.Tube || 0) / stdTotal;
    var shares = {}, note = "";
    ITEMS.forEach(function (it) {
      if (!it) return;
      var k = it[0];
      if (!any || total === 0) shares[k] = (std[k] || 0) / stdTotal;
      else if (k === "Tube") shares[k] = tubeShare;
      else if (!it[2]) shares[k] = 0;
      else shares[k] = (1 - tubeShare) * (w[k] || 0) / total;
    });
    if (any && total === 0) note = '<p class="hint">With the ticked rules every weight is 0, so the game\'s own item stays.</p>';

    var rows = ITEMS.filter(function (it) {
      return it && ((std[it[0]] || 0) > 0 || shares[it[0]] > 0);
    }).sort(function (a, b) { return shares[b[0]] - shares[a[0]]; }).map(function (it) {
      var before = (std[it[0]] || 0) / stdTotal, after = shares[it[0]];
      var diff = after - before;
      var cls = Math.abs(diff) < 0.0005 ? "" : diff > 0 ? "up" : "down";
      return "<tr><td>" + esc(it[1]) + (it[3] ? "" : ' <span class="tag tag--untested">untested</span>') + '</td><td class="n">' + pct(before) +
        '</td><td class="n ' + cls + '">' + pct(after) + '</td><td style="width:30%"><div class="bar"><i style="width:' + Math.min(100, after * 100 * 2.5).toFixed(1) + '%"></i></div></td></tr>';
    }).join("");

    return '<div class="outcomes">' +
      '<label class="check"><input type="radio" name="previewWhen" data-preview-when="mid"' + (opening ? "" : " checked") + "><span>During the match</span></label>" +
      '<label class="check"><input type="radio" name="previewWhen" data-preview-when="opening"' + (opening ? " checked" : "") + "><span>Opening spread</span></label></div>" +
      boxes + note +
      '<table class="mix"><tr><th>Item</th><th>Standard</th><th>With ticked rules</th><th></th></tr>' + rows + "</table>" +
      '<p class="hint" style="margin-top:10px">Tubes keep their share because the rules never touch a Tube the game rolled.</p>';
  }
  function pct(x) { return x === 0 ? "–" : (x * 100 < 0.1 ? "<0.1" : (x * 100).toFixed(1)) + " %"; }

  function renderOut() {
    var o = toJSON(state);
    var errors = validate(o);
    var warnings = lint(state, o);
    var recent = needsRecent(o);
    var json = pretty(o);
    var issues = errors.map(function (e) { return ["err", e]; }).concat(warnings);
    var label = { err: "Error", warn: "Check", info: "Note" };
    var list = issues.length
      ? '<ul class="issues">' + issues.map(function (x) { return '<li class="' + x[0] + '"><b>' + label[x[0]] + "</b>" + esc(x[1]) + "</li>"; }).join("") + "</ul>"
      : '<ul class="issues"><li class="info"><b>OK</b>No problems found.</li></ul>';
    return '<span class="compat ' + (recent ? "compat--recent" : "compat--all") + '">' +
      (recent ? "Needs a recent app" : "Works with every app that has item rules") + "</span>" +
      (recent ? '<p class="hint">It uses the fair deal, a head start, monsters or arrival times. In a match where a player still has an older app, nobody plays with item rules.</p>' : "") +
      list +
      '<pre class="json" id="jsonOut">' + esc(json) + "</pre>" +
      '<div class="btn-row">' +
      '<button class="btn btn--primary" type="button" data-act="email"' + (errors.length ? " disabled" : "") + ">Send it to us</button>" +
      '<button class="btn btn--small" type="button" data-act="copy">Copy JSON</button>' +
      '<button class="btn btn--small" type="button" data-act="download">Download .json</button>' +
      '<button class="btn btn--small" type="button" data-act="share">Copy share link</button>' +
      '<button class="btn btn--small" type="button" data-act="clear">Start over</button></div>' +
      '<p class="status" id="status" role="status"></p>' +
      '<p class="hint" style="margin-top:10px">&ldquo;Send it to us&rdquo; opens your e-mail app with the ruleset filled in, addressed to <a href="mailto:' + SEND_TO + '">' + SEND_TO +
      "</a>. If it is too long for that, the file is downloaded for you to attach. The share link holds the whole ruleset in the address itself: anyone who opens it gets your rules in this builder, and nothing is stored anywhere else.</p>";
  }

  function renderRef() {
    var inputs = INPUTS.map(function (i) {
      return "<tr><td>" + esc(i[3].replace(/:$/, " (an item)")) + tagNew(i[5]) + "</td><td>" + esc(i[2]) + "</td><td>" + esc(i[4]) + "</td></tr>";
    }).join("");
    var feats = FEATURES.map(function (f) {
      return "<tr><td>" + esc(f[1]) + tagNew(f[3]) + "</td><td>" + esc(f[2] || (f[4] === "steps" ? "Steps across or down, not diagonal. A hero or castle that isn't there counts as far as possible." : "")) + "</td></tr>";
    }).join("");
    var items = ITEMS.filter(Boolean).map(function (it) {
      var m = STD_MID[it[0]] || 0, s = STD_START[it[0]] || 0;
      return "<tr><td>" + esc(it[1]) + (it[3] ? "" : ' <span class="tag tag--untested">untested</span>') + "</td><td>" + (m ? fmtNum(m) : "–") + "</td><td>" + (s ? fmtNum(s) : "–") +
        "</td><td>" + (it[2] ? "yes" : "no") + "</td></tr>";
    }).join("");
    return "<details><summary>Conditions</summary><div><table><tr><th>Input</th><th>Group</th><th>Value</th></tr>" + inputs + "</table>" +
      '<p class="hint" style="margin-top:10px">All values are whole numbers. AND: several conditions in one rule. OR: the same change in two rules. A range: two conditions on the same input.</p></div></details>' +
      "<details><summary>Spot factors</summary><div><table><tr><th>Factor</th><th>Value at a cell</th></tr>" + feats + "</table></div></details>" +
      "<details><summary>Items and their standard weights</summary><div><table><tr><th>Item</th><th>Mid-match</th><th>Opening</th><th>Rules can make it</th></tr>" + items + "</table>" +
      '<p class="hint" style="margin-top:10px">The Tube and the Wand are left to the game: the rules never make or remove them. Untested items exist in the game but have never dropped in an online match.</p></div></details>';
  }

  // ------------------------------------------------------------------ JSON text

  function compact(v) {
    if (Array.isArray(v)) return "[" + v.map(compact).join(", ") + "]";
    if (isObj(v)) {
      var keys = Object.keys(v);
      return keys.length ? "{ " + keys.map(function (k) { return JSON.stringify(k) + ": " + compact(v[k]); }).join(", ") + " }" : "{}";
    }
    return JSON.stringify(v);
  }
  function pretty(o) {
    var keys = Object.keys(o);
    return "{\n" + keys.map(function (k) {
      var v = o[k];
      if (Array.isArray(v)) return "  " + JSON.stringify(k) + ": [\n" + v.map(function (r) { return "    " + compact(r); }).join(",\n") + "\n  ]";
      return "  " + JSON.stringify(k) + ": " + compact(v);
    }).join(",\n") + "\n}\n";
  }

  // ------------------------------------------------------------------ wiring

  var $ = function (id) { return document.getElementById(id); };

  function renderAll() {
    $("sec-meta").innerHTML = renderMeta();
    $("sec-score").innerHTML = renderScore();
    $("sec-base").innerHTML = renderBase();
    $("sec-deal").innerHTML = renderDeal();
    $("sec-type").innerHTML = renderType();
    $("sec-place").innerHTML = renderPlace();
    refresh();
  }

  // Everything that follows from the values, without rebuilding the inputs being typed in
  function refresh() {
    state.typeRules.forEach(function (r) { var el = $("sum-" + r._id); if (el) el.innerHTML = typeSummary(r); });
    state.placeRules.forEach(function (r) { var el = $("sum-" + r._id); if (el) el.innerHTML = placeSummary(r); });
    $("sec-preview").innerHTML = renderPreview();
    var status = $("status") ? $("status").textContent : "";
    $("sec-out").innerHTML = renderOut();
    if (status) $("status").textContent = status;
    saveDraft();
  }

  function setPath(path, value) {
    var parts = path.split(".");
    var root = parts[0] === "ui" ? ui : state;
    if (parts[0] === "ui") parts.shift();
    var o = root;
    for (var i = 0; i < parts.length - 1; i++) o = o[/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]];
    o[parts[parts.length - 1]] = value;
    return o;
  }

  function onValue(e) {
    var el = e.target;
    var path = el.getAttribute("data-path");
    if (!path) return;
    var value = el.type === "checkbox" ? el.checked : el.value;
    var holder = setPath(path, value);
    if (/\.when\.\d+\.input$/.test(path)) normalizeCond(holder);
    if (el.hasAttribute("data-rerender") || el.type === "radio") renderAll();
    else refresh();
  }

  function normalizeCond(c) {
    var inp = find(INPUTS, c.input);
    c.item = inp[1] ? (c.item || "Spring") : "";
    var itemValued = c.input === "type" || c.input === "engineType";
    var wasItem = !/^-?\d*$/.test(c.value) && itemIndex(c.value) >= 0;
    if (itemValued && !wasItem) { c.value = "Spring"; c.op = "=="; }
    if (!itemValued && wasItem) c.value = "1";
    if (c.input === "matchStart") { c.op = c.op === "!=" ? "!=" : "=="; c.value = c.value === "0" ? "0" : "1"; }
  }

  document.addEventListener("input", function (e) {
    if (e.target.matches("input[type=text], input[type=number], textarea")) onValue(e);
  });
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el.hasAttribute("data-preview")) {
      ui.preview[el.getAttribute("data-preview")] = el.checked;
      $("sec-preview").innerHTML = renderPreview();
      return;
    }
    if (el.hasAttribute("data-preview-when")) {
      ui.previewOpening = el.getAttribute("data-preview-when") === "opening";
      $("sec-preview").innerHTML = renderPreview();
      return;
    }
    if (el.id === "template") { showTemplateHint(); return; }
    if (el.matches("select, input[type=checkbox], input[type=radio]")) onValue(e);
  });
  document.addEventListener("toggle", function (e) {
    var el = e.target;
    if (el.classList && el.classList.contains("rule")) ui.closed[el.getAttribute("data-id")] = !el.open;
  }, true);

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-act");
    var listName = el.getAttribute("data-list");
    var i = Number(el.getAttribute("data-i"));
    var j = Number(el.getAttribute("data-j"));
    var list = listName ? state[listName] : null;
    switch (act) {
      case "add-rule":
        list.push(listName === "typeRules" ? newTypeRule() : newPlaceRule());
        break;
      case "del-rule":
        list.splice(i, 1);
        break;
      case "up":
        if (i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]);
        break;
      case "down":
        if (i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]);
        break;
      case "dup":
        var copy = JSON.parse(JSON.stringify(list[i]));
        copy._id = nextId++;
        list.splice(i + 1, 0, copy);
        break;
      case "add-cond":
        list[i].when.push(newCond());
        break;
      case "del-cond":
        list[i].when.splice(j, 1);
        break;
      case "add-edit":
        state.typeRules[i].edits.push({ op: "scale", item: "Spring", value: "1" });
        break;
      case "del-edit":
        state.typeRules[i].edits.splice(j, 1);
        break;
      case "add-feat":
        state.placeRules[i].place.push({ feature: "noise", weight: "1" });
        break;
      case "del-feat":
        state.placeRules[i].place.splice(j, 1);
        break;
      case "template": loadTemplate(); return;
      case "import": importText(); return;
      case "copy": copyText(pretty(toJSON(state)), "JSON copied."); return;
      case "download": download(); say("Downloaded " + fileName() + "."); return;
      case "share": copyText(shareLink(), "Share link copied."); return;
      case "email": email(); return;
      case "clear":
        if (!confirm("Clear everything and start from a blank ruleset?")) return;
        state = blankState();
        try { history.replaceState(null, "", location.pathname); } catch (err) { /* ignore */ }
        break;
      default: return;
    }
    renderAll();
  });

  // ------------------------------------------------------------------ templates, import, export

  function showTemplateHint() {
    var t = TEMPLATES[Number($("template").value)];
    $("templateHint").textContent = t ? t.text : "";
  }

  function isEmpty() {
    return !state.typeRules.length && !state.placeRules.length && !state.meta.name && !state.meta.description;
  }

  function loadTemplate() {
    var t = TEMPLATES[Number($("template").value)];
    if (!t) return;
    if (!isEmpty() && !confirm("Replace what you have built so far with “" + t.name + "”?")) return;
    var json = JSON.parse(JSON.stringify(t.json));
    state = fromJSON(json);
    if (t !== TEMPLATES[0]) state.meta = { name: "", author: "", description: "Based on “" + t.name + "”. " };
    ui.preview = {};
    foldAll();
    renderAll();
  }

  function importText() {
    var text = $("importText").value.trim();
    var box = $("importIssues");
    var o;
    try { o = parseShared(text); } catch (err) {
      box.innerHTML = '<li class="err"><b>Error</b>' + esc(err.message) + "</li>";
      return;
    }
    var errors = validate(o);
    if (errors.length) {
      box.innerHTML = errors.map(function (e) { return '<li class="err"><b>Error</b>' + esc(e) + "</li>"; }).join("");
      return;
    }
    if (!isEmpty() && !confirm("Replace what you have built so far with the pasted ruleset?")) return;
    state = fromJSON(o);
    ui.preview = {};
    foldAll();
    box.innerHTML = '<li class="info"><b>OK</b>Loaded.</li>';
    renderAll();
  }

  // A pasted ruleset: its JSON, or a share link to one
  function parseShared(text) {
    var m = /#r=([A-Za-z0-9_-]+)/.exec(text);
    if (m) return JSON.parse(fromB64(m[1]));
    try { return JSON.parse(text); } catch (err) { throw new Error("That is not valid JSON (" + err.message + ")."); }
  }

  function toB64(s) {
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64(s) {
    var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function shareLink() {
    return location.href.split("#")[0] + "#r=" + toB64(JSON.stringify(toJSON(state)));
  }

  function fileName() {
    var base = (state.meta.name || "item-rules").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item-rules";
    return base + ".json";
  }
  function download() {
    var blob = new Blob([pretty(toJSON(state))], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function email() {
    var m = state.meta;
    if (!m.name.trim()) {
      say("Give your ruleset a name first (section 1).");
      $("sec-meta").querySelector("input").focus();
      return;
    }
    var o = toJSON(state);
    var subject = "Item ruleset: " + m.name.trim();
    var head = "Name: " + m.name.trim() + "\nBy: " + (m.author.trim() || "(not given)") + "\n\n" + (m.description.trim() || "") + "\n\n";
    var body = head + "Ruleset:\n" + JSON.stringify(o) + "\n";
    var url = "mailto:" + SEND_TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    if (url.length > 1900) {
      download();
      body = head + "The ruleset is attached (" + fileName() + ").\n";
      url = "mailto:" + SEND_TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      say("The ruleset is too long for an e-mail link, so " + fileName() + " was downloaded: attach it to the e-mail.");
    } else {
      say("Opening your e-mail app… If nothing opens, copy the JSON and send it to " + SEND_TO + ".");
    }
    location.href = url;
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say(done); }, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); say(done); } catch (err) { say("Copying failed: select the text and copy it by hand."); }
    t.remove();
  }
  function say(text) { var s = $("status"); if (s) s.textContent = text; }

  // ------------------------------------------------------------------ draft

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ meta: state.meta, json: toJSON(state), raw: state })); } catch (err) { /* private mode */ }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && d.raw && d.raw.base && Array.isArray(d.raw.typeRules)) {
        d.raw.typeRules.concat(d.raw.placeRules).forEach(function (r) { r._id = nextId++; });
        return d.raw;
      }
    } catch (err) { /* nothing usable */ }
    return null;
  }

  // ------------------------------------------------------------------ start

  $("template").innerHTML = TEMPLATES.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + "</option>"; }).join("");
  $("sec-ref").innerHTML = renderRef();

  var shared = /#r=([A-Za-z0-9_-]+)/.exec(location.hash);
  var loaded = false;
  if (shared) {
    try {
      var o = JSON.parse(fromB64(shared[1]));
      if (!validate(o).length) { state = fromJSON(o); loaded = true; }
    } catch (err) { /* a broken link: fall back to the draft */ }
  }
  if (!loaded) {
    var draft = loadDraft();
    if (draft) state = draft;
  }
  foldAll();
  renderAll();
  if (loaded) say("Loaded the ruleset from the link.");
}());
