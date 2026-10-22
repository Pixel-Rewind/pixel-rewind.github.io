/* The map builder (map-builder.html).

   A drawing board over one map file: the page keeps the map as plain state (one board per player
   count), draws it on a canvas, and writes the JSON the server's map editor reads
   ("pr-legacy-server-map/1", the same format as the server's own maps). The checks here mirror
   the server's, so a map that passes them is one it takes. Nothing is sent anywhere: the JSON leaves
   only by download, copy or e-mail, each on the visitor's own click. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ vocabulary

  var FORMAT = "pr-legacy-server-map/1";
  var MIN_SIZE = 6, MAX_SIZE = 32, MAX_MONSTERS = 32;
  var HOLE = -2, NEUTRAL = 5;
  var DRAFT_KEY = "pixelrewind.mapBuilderDraft";
  var SEND_TO = "support@jubinganga.com";
  var SPRITE_DIR = "assets/img/map-builder/";
  var UNDO_LIMIT = 100;

  // Monsters in the order of the game's kinds (a unit's monsterKind is the index): [name, two letters]
  var MONSTERS = [["Pig", "Pg"], ["Blockapede", "Bl"], ["Wolf", "Wf"], ["Cyborg Clone", "CC"], ["Mega", "Mg"],
    ["Chicken", "Ch"], ["Zombie Chicken", "ZC"], ["Wizard", "Wz"], ["Ultimate Foe", "UF"]];
  var NEUTRAL_KINDS = ["Chicken", "Zombie Chicken"];
  var ENVIRONMENTS = [["space", "Space"], ["clouds_and_grass", "Clouds and grass"], ["speedball", "Speedball"],
    ["soccer", "Soccer"], ["racetrack", "Racetrack"]];
  var COLOURS = { 1: "#f2c14e", 2: "#e5553b", 3: "#7cc242", 4: "#3aa0d8" };

  // A new board starts from the layout the game's own quick-match maps share.
  var DEFAULT_LAYOUT = {
    2: { size: [10, 10], castles: [[1, 2], [7, 8]], heroes: [[2, 2], [7, 7]] },
    3: { size: [12, 10], castles: [[1, 2], [9, 2], [5, 8]], heroes: [[2, 2], [9, 2], [5, 7]] },
    4: { size: [11, 11], castles: [[1, 2], [8, 2], [8, 9], [1, 9]], heroes: [[2, 2], [9, 2], [9, 9], [2, 9]] }
  };

  var TOOLS = [
    { id: "paint", label: "Territory", key: "B", help: "Click or drag to give ground to the chosen player. Right-click or right-drag erases." },
    { id: "erase", label: "Erase", key: "E", help: "Click or drag to make ground nobody's. This also fills a hole." },
    { id: "hole", label: "Hole", key: "O", help: "Click or drag to dig holes: cells nothing can stand on, be built on or be dropped on. Heroes walk around them. Right-drag fills them. A cell with a castle, hero, princess or monster on it cannot be a hole." },
    { id: "castle", label: "Castle", key: "C", help: "Click where the chosen player's castle goes. It covers 2×2 cells and your click is its top-left one. It moves if it was already placed." },
    { id: "hero", label: "Hero", key: "H", help: "Click the cell the chosen player's hero starts on. It moves if it was already placed." },
    { id: "princess", label: "Princess", key: "P", help: "Click where the chosen player's princess starts, instead of inside her castle. Right-click removes her." },
    { id: "monster", label: "Monster", key: "M", help: "Click to give the chosen player a monster of the kind picked above. Clicking a monster replaces it; right-click removes it." },
    { id: "neutral", label: "Neutral princess", key: "N", help: "Princess Rush only: click where the neutral princess waits. She moves if she was already placed; right-click removes her. Without her, the game uses the free cell nearest the middle. Other modes leave her out." },
    { id: "remove", label: "Remove", key: "X", help: "Click a princess or monster to remove it. Castles and heroes cannot be removed, only moved: every player needs both." }
  ];
  var DEATHMATCH_TOOLS = { castle: 1, princess: 1, neutral: 1 };

  // ------------------------------------------------------------------ state

  var state = freshState();
  var ui = { tool: "paint", player: 1, monster: "Wolf", hover: null, cs: 32 };
  var undoStack = [], redoStack = [];
  var savedJson = "";            // what was last downloaded or loaded: unsaved work is anything else
  var examples = [];
  var pristineJson = JSON.stringify(toFile());   // the blank board the page opens with: nothing worth keeping

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function isObj(o) { return o !== null && typeof o === "object" && !Array.isArray(o); }
  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function colour(o) { return COLOURS[o] || "#ffffff"; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function freshState() {
    var boards = { 2: blankBoard(2), 3: null, 4: null };
    return { meta: { name: "", author: "", description: "" }, boards: boards, current: 2 };
  }
  function cur() { return state.boards[state.current]; }
  function playerList(n) { return [1, 2, 3, 4].slice(0, n); }
  function isDeathmatch(v) { return v.castles.length === 0; }
  function isHole(v, x, y) { return v.blocks[y * v.width + x] === HOLE; }
  function boardNumbers() { return [2, 3, 4].filter(function (p) { return state.boards[p]; }); }

  // ------------------------------------------------------------------ boards

  function blankBoard(players) {
    var d = DEFAULT_LAYOUT[players];
    var piece = function (xy, i) { return { owner: i + 1, x: xy[0], y: xy[1] }; };
    var v = {
      players: players, width: d.size[0], height: d.size[1],
      castles: d.castles.map(function (c, i) { var p = piece(c, i); p.hasPrincess = true; return p; }),
      heroes: d.heroes.map(piece),
      blocks: new Array(d.size[0] * d.size[1]).fill(0),
      princesses: [], monsters: [], environment: null, neutralPrincess: null
    };
    v.castles.forEach(function (c) { paintCastleBlocks(v, c); });
    return v;
  }

  // The castle's own ground: its 2x2 footprint belongs to its owner, as in every shipped map.
  function paintCastleBlocks(v, c) {
    for (var dx = 0; dx < 2; dx++) {
      for (var dy = -1; dy <= 0; dy++) {
        var x = c.x + dx, y = c.y + dy;
        if (x >= 0 && y >= 0 && x < v.width && y < v.height) v.blocks[y * v.width + x] = c.owner;
      }
    }
  }

  function copyBoard(from, players) {
    var s = state.boards[from];
    var keep = function (list) { return list.filter(function (p) { return p.owner <= players; }).map(function (p) { return Object.assign({}, p); }); };
    return {
      players: players, width: s.width, height: s.height,
      blocks: s.blocks.map(function (b) { return b > players ? 0 : b; }),
      castles: keep(s.castles), heroes: keep(s.heroes), princesses: keep(s.princesses), monsters: keep(s.monsters),
      environment: s.environment, neutralPrincess: s.neutralPrincess ? Object.assign({}, s.neutralPrincess) : null
    };
  }

  function princessState(v, owner) {
    if (v.princesses.some(function (p) { return p.owner === owner; })) return "placed";
    var c = v.castles.filter(function (c) { return c.owner === owner; })[0];
    return c && c.hasPrincess === false ? "none" : "castle";
  }

  // What stands on a cell, as a label, or null.
  function occupant(v, x, y) {
    var i, at = function (p) { return p.x === x && p.y === y; };
    for (i = 0; i < v.castles.length; i++) {
      var c = v.castles[i];
      if (x >= c.x && x <= c.x + 1 && y >= c.y - 1 && y <= c.y) return "player " + c.owner + "'s castle";
    }
    var h = v.heroes.filter(at)[0]; if (h) return "player " + h.owner + "'s hero";
    var q = v.princesses.filter(at)[0]; if (q) return "player " + q.owner + "'s princess";
    var m = v.monsters.filter(at)[0]; if (m) return "player " + m.owner + "'s " + m.kind;
    if (v.neutralPrincess && at(v.neutralPrincess)) return "the neutral princess";
    return null;
  }

  // ------------------------------------------------------------------ the file

  function monsterIndex(name) {
    for (var i = 0; i < MONSTERS.length; i++) if (MONSTERS[i][0] === name) return i;
    return -1;
  }

  function boardToMission(v) {
    var byOwner = function (a, b) { return a.owner - b.owner; };
    var unit = function (p, category) { return { owner: p.owner, x: p.x, y: p.y, category: category }; };
    var units = v.heroes.slice().sort(byOwner).map(function (h) { return unit(h, "hero"); })
      .concat(v.princesses.slice().sort(byOwner).map(function (p) { return unit(p, "princess"); }));
    if (v.neutralPrincess) units.push(unit({ owner: NEUTRAL, x: v.neutralPrincess.x, y: v.neutralPrincess.y }, "princess"));
    v.monsters.forEach(function (m) {
      var u = unit(m, "monster");
      u.monsterKind = monsterIndex(m.kind);
      units.push(u);
    });
    var rows = [];
    for (var y = 0; y < v.height; y++) rows.push(v.blocks.slice(y * v.width, (y + 1) * v.width));
    var mission = { id: v.players, nameId: "QUICK_MATCH", descriptionId: "QUICK_MATCH" };
    if (v.environment) mission.environment = v.environment;
    mission.blocks = { width: v.width, height: v.height, rows: rows };
    mission.castles = v.castles.slice().sort(byOwner).map(function (c) {
      var o = { owner: c.owner, x: c.x, y: c.y };
      if (c.hasPrincess === false) o.princess = false;
      return o;
    });
    mission.units = units;
    return mission;
  }

  function toFile() {
    var doc = { format: FORMAT, name: state.meta.name.trim() };
    if (state.meta.author.trim()) doc.author = state.meta.author.trim();
    if (state.meta.description.trim()) doc.description = state.meta.description.trim();
    doc.missions = boardNumbers().map(function (p) { return boardToMission(state.boards[p]); });
    return doc;
  }

  // Indented, with every array of plain numbers kept on one line, so a grid reads as one (like the server's).
  function pretty(doc) {
    return JSON.stringify(doc, null, 2).replace(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g, function (m, nums) {
      return "[" + nums.replace(/\s*,\s*/g, ", ") + "]";
    }) + "\n";
  }

  // Reads a map file. Throws an Error with a plain sentence when it cannot be a map at all; whatever
  // can be drawn but is wrong is kept, and shows up in the checks.
  function fromFile(doc, fileName) {
    if (!isObj(doc)) throw new Error("This file does not hold a map.");
    if (doc.format !== FORMAT) {
      if (doc.typeRules || doc.placeRules) throw new Error("This is an item ruleset, not a map. Open it in the item rules builder instead.");
      throw new Error("This is not a map file: its format is " + (doc.format ? "“" + doc.format + "”" : "missing") + ", and a map's is “" + FORMAT + "”.");
    }
    if (!Array.isArray(doc.missions) || !doc.missions.length) throw new Error("This map file has no boards in it.");

    var boards = { 2: null, 3: null, 4: null }, notes = [];
    doc.missions.forEach(function (m, i) {
      var at = "Board " + (i + 1) + " of the file";
      if (!isObj(m) || !isObj(m.blocks) || !Array.isArray(m.blocks.rows)) throw new Error(at + " has no territory grid.");
      var rows = m.blocks.rows, width = m.blocks.width, height = m.blocks.height;
      if (!isInt(width) || !isInt(height) || rows.length !== height) throw new Error(at + ": the territory grid is not as tall as it says.");
      var blocks = [];
      rows.forEach(function (row) {
        if (!Array.isArray(row) || row.length !== width || !row.every(isInt)) throw new Error(at + ": the territory grid has a row that is not " + width + " cells of whole numbers.");
        blocks = blocks.concat(row);
      });
      if (m.items && m.items.rows && m.items.rows.some(function (r) { return Array.isArray(r) && r.some(function (n) { return n !== 0; }); })) {
        notes.push("Items drawn in the file were left out: the builder has no items.");
      }
      var castles = (Array.isArray(m.castles) ? m.castles : []).map(function (c) {
        if (!isObj(c) || !isInt(c.owner) || !isInt(c.x) || !isInt(c.y)) throw new Error(at + " has a castle without a whole-number owner and position.");
        return { owner: c.owner, x: c.x, y: c.y, hasPrincess: c.princess !== false };
      });
      var v = { width: width, height: height, blocks: blocks, castles: castles, heroes: [], princesses: [], monsters: [], environment: null, neutralPrincess: null };
      (Array.isArray(m.units) ? m.units : []).forEach(function (u) {
        if (!isObj(u) || !isInt(u.owner) || !isInt(u.x) || !isInt(u.y)) throw new Error(at + " has a unit without a whole-number owner and position.");
        var p = { owner: u.owner, x: u.x, y: u.y };
        if (u.category === "hero") v.heroes.push(p);
        else if (u.category === "princess" && u.owner === NEUTRAL) {
          if (v.neutralPrincess) notes.push("A board has two neutral princesses; only the first was kept.");
          else v.neutralPrincess = p;
        } else if (u.category === "princess") v.princesses.push(p);
        else if (u.category === "monster") {
          if (!isInt(u.monsterKind) || u.monsterKind < 0 || u.monsterKind >= MONSTERS.length) throw new Error(at + " has a monster the builder does not know (kind " + u.monsterKind + ").");
          p.kind = MONSTERS[u.monsterKind][0];
          v.monsters.push(p);
        } else throw new Error(at + " has a unit that is not a hero, princess or monster.");
      });
      if (typeof m.environment === "string") {
        var env = m.environment.trim().toLowerCase();
        if (ENVIRONMENTS.some(function (e) { return e[0] === env; })) v.environment = env;
        else notes.push("The scenery “" + m.environment + "” is not one the builder knows; the board gets a random one.");
      }
      var players = castles.length ? castles.length : distinctHeroOwners(v.heroes);
      if (players < 2 || players > 4) {
        notes.push("Skipped a board for " + players + " player" + (players === 1 ? "" : "s") + ": a board is for 2, 3 or 4.");
        return;
      }
      if (boards[players]) {
        notes.push("The file has two boards for " + players + " players; only the first was kept.");
        return;
      }
      v.players = players;
      boards[players] = v;
    });
    if (![2, 3, 4].some(function (p) { return boards[p]; })) throw new Error("This map file has no board for 2, 3 or 4 players.");
    if (doc.allowedAt) notes.push("Where the map may be played (“allowedAt”) is not part of the builder. We decide that.");

    var name = typeof doc.name === "string" ? doc.name : "";
    if (!name && fileName) name = fileName.replace(/\.json$/i, "").replace(/[_-]+/g, " ").trim();
    return {
      meta: { name: name.slice(0, 32), author: typeof doc.author === "string" ? doc.author.slice(0, 60) : "", description: typeof doc.description === "string" ? doc.description.slice(0, 300) : "" },
      boards: boards, notes: notes.filter(function (n, i, all) { return all.indexOf(n) === i; })
    };
  }
  function distinctHeroOwners(heroes) {
    var seen = {};
    heroes.forEach(function (h) { if (h.owner >= 1 && h.owner <= 4) seen[h.owner] = 1; });
    return Object.keys(seen).length;
  }

  // ------------------------------------------------------------------ checks, mirroring the server's

  function checks() {
    var problems = [], warnings = [];
    var bad = function (p, text) { problems.push({ board: p, text: text }); };
    var warn = function (p, text) { warnings.push({ board: p, text: text }); };

    if (!state.meta.name.trim()) bad(0, "Give your map a name.");
    var boards = boardNumbers();
    if (!boards.length) bad(0, "A map needs a board for at least one player count.");

    boards.forEach(function (p) {
      var v = state.boards[p], who = "the " + p + "-player board", deathmatch = isDeathmatch(v);
      if (v.width < MIN_SIZE || v.width > MAX_SIZE || v.height < MIN_SIZE || v.height > MAX_SIZE) {
        bad(p, cap(who) + " is " + v.width + "×" + v.height + "; each side must be " + MIN_SIZE + " to " + MAX_SIZE + ".");
        return;
      }
      var inside = function (x, y) { return x >= 0 && y >= 0 && x < v.width && y < v.height; };
      var badOwner = v.blocks.filter(function (b) { return b !== HOLE && (b < 0 || b > p); })[0];
      if (badOwner !== undefined) bad(p, cap(who) + " has territory for player " + badOwner + ", who is not playing on it.");

      var count = function (list, o) { return list.filter(function (x) { return x.owner === o; }).length; };
      for (var o = 1; o <= p; o++) {
        if (!deathmatch && !count(v.castles, o)) bad(p, "Player " + o + " has no castle on " + who + ". Give every player a castle, or none at all for a deathmatch.");
        if (!count(v.heroes, o)) bad(p, "Player " + o + " has no hero on " + who + ".");
        [["castle", v.castles], ["hero", v.heroes], ["princess", v.princesses]].forEach(function (kv) {
          if (count(kv[1], o) > 1) bad(p, "Player " + o + " has " + count(kv[1], o) + " " + kv[0] + "s on " + who + "; one each at most.");
        });
      }
      [["castle", v.castles], ["hero", v.heroes], ["princess", v.princesses], ["monster", v.monsters]].forEach(function (kv) {
        var seen = {};
        kv[1].forEach(function (x) {
          if ((x.owner < 1 || x.owner > p) && !seen[x.owner]) {
            seen[x.owner] = 1;
            bad(p, cap(who) + " has a " + kv[0] + " for player " + x.owner + ", who is not playing on it.");
          }
        });
      });
      if (deathmatch && v.princesses.length) bad(p, cap(who) + " is a deathmatch (it has no castles), so it has no princesses. Remove the placed ones.");

      var castleAt = {};
      v.castles.forEach(function (c) {
        if (c.x < 0 || c.y < 1 || c.x + 2 > v.width || c.y >= v.height) {
          bad(p, "Player " + c.owner + "'s castle at (" + c.x + ", " + c.y + ") does not fit on " + who + ".");
          return;
        }
        var clash = null, onHole = null;
        for (var dy = -1; dy <= 0; dy++) {
          for (var dx = 0; dx < 2; dx++) {
            var k = (c.x + dx) + "," + (c.y + dy);
            if (isHole(v, c.x + dx, c.y + dy) && !onHole) onHole = "(" + (c.x + dx) + ", " + (c.y + dy) + ")";
            if (castleAt[k] !== undefined && clash === null) clash = castleAt[k];
            castleAt[k] = c.owner;
          }
        }
        if (onHole) bad(p, "Player " + c.owner + "'s castle is on a hole at " + onHole + " on " + who + ".");
        else if (clash !== null) bad(p, "Player " + c.owner + "'s castle overlaps player " + clash + "'s on " + who + ".");
      });

      var unitAt = {};
      var place = function (x, y, label) {      // returns the owner of the castle on that cell, if any
        if (!inside(x, y)) { bad(p, cap(label) + " at (" + x + ", " + y + ") is off " + who + "."); return undefined; }
        var k = x + "," + y;
        if (isHole(v, x, y)) bad(p, cap(label) + " starts on a hole at (" + x + ", " + y + ") on " + who + ".");
        if (unitAt[k]) bad(p, cap(label) + " starts on the same cell as " + unitAt[k] + " on " + who + ".");
        unitAt[k] = label;
        return castleAt[k];
      };
      v.heroes.forEach(function (h) {
        var on = place(h.x, h.y, "player " + h.owner + "'s hero");
        if (on !== undefined && on !== h.owner) bad(p, "Player " + h.owner + "'s hero starts on player " + on + "'s castle on " + who + ".");
      });
      v.princesses.forEach(function (q) {
        var on = place(q.x, q.y, "player " + q.owner + "'s princess");
        if (on !== undefined) bad(p, "Player " + q.owner + "'s princess is on player " + on + "'s castle on " + who + ". To keep a princess in her castle, remove the placed one.");
      });
      if (v.neutralPrincess) {
        var n = v.neutralPrincess;
        if (deathmatch) bad(p, cap(who) + " is a deathmatch (it has no castles), so it has no neutral princess. Remove her.");
        else {
          var onN = place(n.x, n.y, "the neutral princess");
          if (onN !== undefined) bad(p, "The neutral princess is on player " + onN + "'s castle on " + who + ".");
        }
      }
      if (v.monsters.length > MAX_MONSTERS) bad(p, cap(who) + " has " + v.monsters.length + " monsters; at most " + MAX_MONSTERS + ".");
      v.monsters.forEach(function (m) {
        var on = place(m.x, m.y, "player " + m.owner + "'s " + m.kind);
        if (on !== undefined) bad(p, "Player " + m.owner + "'s " + m.kind + " is on player " + on + "'s castle on " + who + ".");
      });

      // Allowed, but worth a second look
      if (!deathmatch) {
        var none = playerList(p).filter(function (o) { return princessState(v, o) === "none"; });
        if (none.length === p) warn(p, "Nobody has a princess on " + who + ", so no one can win by bringing one home.");
        else if (none.length) warn(p, "On " + who + ", player" + (none.length > 1 ? "s " : " ") + none.join(", ") + (none.length > 1 ? " start" : " starts") + " without a princess.");
      }
      var own = playerList(p).map(function (o) { return v.blocks.filter(function (b) { return b === o; }).length; });
      if (Math.max.apply(null, own) !== Math.min.apply(null, own)) warn(p, "Players start with different amounts of territory on " + who + " (" + own.join(", ") + "). That is fine if it is on purpose.");
    });
    return { problems: problems, warnings: warnings };
  }

  // ------------------------------------------------------------------ sprites and drawing

  var IMAGES = {};
  function sprite(name) {
    if (!IMAGES[name]) {
      var img = new Image();
      img.onload = function () { drawBoard(); drawExampleThumbs(); };
      img.src = SPRITE_DIR + name + ".png";
      IMAGES[name] = img;
    }
    return IMAGES[name];
  }
  // A picture drawn into a box keeping its proportions, centred, standing on the box's bottom.
  function fit(g, img, x, y, w, h) {
    if (!img.naturalWidth) return;
    var s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    g.drawImage(img, x + (w - dw) / 2, y + h - dh, dw, dh);
  }
  function ownSprite(base, owner) { return sprite(owner >= 1 && owner <= 4 ? base + "-" + owner : base === "territory" ? "floor" : "hero-1"); }

  function drawBoard() {
    var v = cur(), canvas = $("board");
    if (!v || !canvas) return;
    var cs = ui.cs, top = Math.round(cs / 2);
    canvas.width = v.width * cs;
    canvas.height = v.height * cs + top;
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";
    var g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);

    var x, y;
    for (y = 0; y < v.height; y++) {
      for (x = 0; x < v.width; x++) {
        var owner = v.blocks[y * v.width + x];
        if (owner === HOLE) {
          g.fillStyle = "#0b0c10";
          g.fillRect(x * cs, top + y * cs, cs, cs);
          g.strokeStyle = "rgba(255,255,255,.18)";
          g.lineWidth = 1;
          g.strokeRect(x * cs + 2.5, top + y * cs + 2.5, cs - 5, cs - 5);
          continue;
        }
        g.drawImage(owner > 0 ? ownSprite("territory", owner) : sprite("floor"), x * cs, top + y * cs, cs, cs);
      }
    }
    g.strokeStyle = "rgba(0,0,0,.22)";
    g.lineWidth = 1;
    for (x = 1; x < v.width; x++) { g.beginPath(); g.moveTo(x * cs + 0.5, top); g.lineTo(x * cs + 0.5, top + v.height * cs); g.stroke(); }
    for (y = 1; y < v.height; y++) { g.beginPath(); g.moveTo(0, top + y * cs + 0.5); g.lineTo(v.width * cs, top + y * cs + 0.5); g.stroke(); }

    function badge(owner, px, py, text, fill) {
      var r = Math.max(6, Math.round(cs / 5));
      g.fillStyle = fill || colour(owner);
      g.strokeStyle = "#0e1015";
      g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = "#0e1015";
      g.font = "bold " + Math.round(r * 1.4) + "px ui-sans-serif, system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text || String(owner), px, py + 1);
    }
    function shadow(px, py, fill) {
      g.fillStyle = fill;
      g.beginPath(); g.ellipse(px + cs / 2, py + cs * 0.88, cs * 0.38, cs * 0.13, 0, 0, Math.PI * 2); g.fill();
    }

    var pieces = [];
    v.castles.forEach(function (c) { pieces.push({ kind: "castle", p: c, depth: c.y }); });
    v.heroes.forEach(function (h) { pieces.push({ kind: "hero", p: h, depth: h.y + 0.5 }); });
    v.princesses.forEach(function (q) { pieces.push({ kind: "princess", p: q, depth: q.y + 0.5 }); });
    v.monsters.forEach(function (m) { pieces.push({ kind: "monster", p: m, depth: m.y + 0.5 }); });
    if (v.neutralPrincess) pieces.push({ kind: "neutral", p: v.neutralPrincess, depth: v.neutralPrincess.y + 0.5 });
    pieces.sort(function (a, b) { return a.depth - b.depth; });

    pieces.forEach(function (it) {
      var p = it.p;
      // A castle's position is its bottom-left cell (the game's convention), so it is drawn from the row above.
      var px = p.x * cs, py = top + (it.kind === "castle" ? p.y - 1 : p.y) * cs;
      if (it.kind === "castle") {
        g.fillStyle = colour(p.owner) + "55";
        g.fillRect(px, py, cs * 2, cs * 2);
        g.strokeStyle = colour(p.owner);
        g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, cs * 2 - 2, cs * 2 - 2);
        fit(g, sprite("castle"), px, py - cs / 2, cs * 2, cs * 2.5);
        if (princessState(v, p.owner) === "castle") fit(g, sprite("princess"), px + cs * 0.05, py - cs * 0.35, cs * 0.8, cs);
        badge(p.owner, px + cs * 2 - cs / 4, py + cs / 4);
      } else if (it.kind === "neutral") {
        shadow(px, py, "#ffffffaa");
        fit(g, sprite("princess"), px, py - cs / 4, cs, cs * 1.25);
        badge(NEUTRAL, px + cs * 0.82, py + cs * 0.78, "N", "#ffffff");
      } else if (it.kind === "princess" || it.kind === "monster") {
        shadow(px, py, colour(p.owner) + "aa");
        fit(g, sprite(it.kind), px, py - cs / 4, cs, cs * 1.25);
        badge(p.owner, px + cs * 0.82, py + cs * 0.78);
        if (it.kind === "monster") {
          var label = (MONSTERS[monsterIndex(p.kind)] || [0, "?"])[1], fs = Math.max(9, Math.round(cs * 0.32));
          g.font = "bold " + fs + "px ui-sans-serif, system-ui, sans-serif";
          var tw = g.measureText(label).width + 6;
          g.fillStyle = "rgba(14,16,21,.85)";
          g.fillRect(px + 1, py + 1, tw, fs + 3);
          g.fillStyle = "#ffffff";
          g.textAlign = "left"; g.textBaseline = "top";
          g.fillText(label, px + 4, py + 2);
        }
      } else {
        shadow(px, py, colour(p.owner) + "aa");
        fit(g, ownSprite("hero", p.owner), px, py - cs / 4, cs, cs * 1.25);
        badge(p.owner, px + cs * 0.82, py + cs * 0.78);
      }
    });

    var hv = ui.hover;
    if (hv) {
      var isCastle = ui.tool === "castle";
      var hx = isCastle ? Math.min(hv.x, v.width - 2) : hv.x, hy = isCastle ? Math.min(hv.y, v.height - 2) : hv.y;
      var span = isCastle ? 2 : 1;
      g.strokeStyle = ui.tool === "erase" ? "#ffffff" : colour(ui.player);
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(hx * cs + 1, top + hy * cs + 1, span * cs - 2, span * cs - 2);
      g.setLineDash([]);
    }
  }

  function sizeBoard() {
    var v = cur(), wrap = $("boardWrap");
    if (!v || !wrap) return;
    var avail = wrap.clientWidth - 24;
    ui.cs = Math.max(14, Math.min(44, Math.floor(avail / v.width)));
    drawBoard();
  }

  // ------------------------------------------------------------------ examples

  function renderExamples() {
    var groups = [], byGroup = {};
    examples.forEach(function (ex) {
      if (!byGroup[ex.group]) { byGroup[ex.group] = []; groups.push(ex.group); }
      byGroup[ex.group].push(ex);
    });
    $("examples").innerHTML = groups.map(function (g) {
      return "<div><h5>" + esc(g) + '</h5><div class="examples__grid">' + byGroup[g].map(function (ex) {
        var nums = [2, 3, 4].filter(function (p) { return ex.parsed.boards[p]; });
        var sizes = [];
        nums.forEach(function (p) {
          var b = ex.parsed.boards[p], s = b.width + "×" + b.height;
          if (sizes.indexOf(s) < 0) sizes.push(s);
        });
        return '<button class="example" type="button" data-act="example" data-arg="' + esc(ex.id) + '" aria-label="Open ' + esc(ex.name) + ' in the editor">' +
          '<canvas data-thumb="' + esc(ex.id) + '"></canvas><b>' + esc(ex.name) + "</b><span>" + esc(ex.blurb) + "</span>" +
          "<small>" + nums.join(", ") + " players &middot; " + sizes.join(" / ") + "</small></button>";
      }).join("") + "</div></div>";
    }).join("");
    drawExampleThumbs();
  }

  // A small picture of an example's biggest table: ground, holes, castles and who starts where.
  function drawExampleThumbs() {
    examples.forEach(function (ex) {
      var canvas = document.querySelector('canvas[data-thumb="' + ex.id + '"]');
      if (!canvas) return;
      var nums = [2, 3, 4].filter(function (p) { return ex.parsed.boards[p]; });
      var v = ex.parsed.boards[nums[nums.length - 1]];
      var cell = Math.max(4, Math.floor(180 / Math.max(v.width, v.height)));
      canvas.width = v.width * cell;
      canvas.height = v.height * cell;
      var g = canvas.getContext("2d");
      g.fillStyle = "#16233a";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (var y = 0; y < v.height; y++) {
        for (var x = 0; x < v.width; x++) {
          var b = v.blocks[y * v.width + x];
          if (b === HOLE) g.fillStyle = "#05080d";
          else if (b > 0) g.fillStyle = colour(b) + "bb";
          else g.fillStyle = (x + y) % 2 ? "#1b2a45" : "#16233a";
          g.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      v.castles.forEach(function (c) {
        g.fillStyle = colour(c.owner);
        g.fillRect(c.x * cell, (c.y - 1) * cell, cell * 2, cell * 2);
        g.strokeStyle = "#0b1322";
        g.strokeRect(c.x * cell + 0.5, (c.y - 1) * cell + 0.5, cell * 2 - 1, cell * 2 - 1);
      });
      var dot = function (p, fill) {
        g.fillStyle = fill;
        g.beginPath(); g.arc((p.x + 0.5) * cell, (p.y + 0.5) * cell, Math.max(2, cell * 0.38), 0, Math.PI * 2); g.fill();
        g.strokeStyle = "#0b1322"; g.lineWidth = 1; g.stroke();
      };
      v.heroes.forEach(function (h) { dot(h, "#ffffff"); });
      if (v.neutralPrincess) dot(v.neutralPrincess, "#ff9ad5");
      v.monsters.forEach(function (m) { dot(m, "#9a6bff"); });
    });
  }

  // ------------------------------------------------------------------ rendering the panels

  function renderTabs(c) {
    $("boardTabs").innerHTML = [2, 3, 4].map(function (p) {
      var has = state.boards[p], sel = p === state.current;
      var broken = has && c.problems.some(function (x) { return x.board === p; });
      return '<button type="button" role="tab" class="tab' + (has ? "" : " is-empty") + '" aria-selected="' + sel + '" data-act="board" data-arg="' + p + '">' +
        p + " players" + (has ? "" : " &middot; none") + (broken ? ' <span style="color:var(--pink)">!</span>' : "") + "</button>";
    }).join("");
  }

  function renderToolbar() {
    var v = cur();
    if (!v) { $("toolbar").innerHTML = ""; return; }
    var tools = TOOLS.filter(function (t) { return !(isDeathmatch(v) && DEATHMATCH_TOOLS[t.id]); });
    var icon = function (id) {
      var pl = Math.min(ui.player, v.players);
      switch (id) {
        case "paint": return '<img src="' + SPRITE_DIR + "territory-" + pl + '.png" alt="">';
        case "erase": return '<img src="' + SPRITE_DIR + 'floor.png" alt="">';
        case "hole": return '<span class="tool__swatch" style="background:#0b0c10"></span>';
        case "castle": return '<img src="' + SPRITE_DIR + 'castle.png" alt="">';
        case "hero": return '<img src="' + SPRITE_DIR + "hero-" + pl + '.png" alt="">';
        case "princess": return '<img src="' + SPRITE_DIR + 'princess.png" alt="">';
        case "monster": return '<img src="' + SPRITE_DIR + 'monster.png" alt="">';
        case "neutral": return '<img src="' + SPRITE_DIR + 'princess.png" alt="" style="filter:grayscale(1) brightness(1.7)">';
        default: return '<span class="tool__swatch" style="display:grid;place-items:center;color:#f2688a;font-size:16px;line-height:1">&times;</span>';
      }
    };
    var monsterBox = "";
    if (ui.tool === "monster") {
      monsterBox = '<div class="players"><span>Kind of monster:</span><select data-change="monster" aria-label="Kind of monster">' +
        MONSTERS.map(function (m) { return "<option" + (m[0] === ui.monster ? " selected" : "") + ">" + esc(m[0]) + "</option>"; }).join("") + "</select>" +
        (NEUTRAL_KINDS.indexOf(ui.monster) >= 0 ? '<span style="flex-basis:100%">The game always makes ' + esc(ui.monster) + "s neutral wildlife, whoever you give them to.</span>" : "") + "</div>";
    }
    $("toolbar").innerHTML =
      '<div class="tools">' + tools.map(function (t) {
        return '<button type="button" class="tool' + (ui.tool === t.id ? " is-on" : "") + '" data-act="tool" data-arg="' + t.id + '" title="' + esc(t.help) + '">' +
          icon(t.id) + esc(t.label) + " <kbd>" + t.key + "</kbd></button>";
      }).join("") + "</div>" +
      '<div class="players"><span>For player:</span>' + playerList(v.players).map(function (o) {
        return '<button type="button" class="pl' + (ui.player === o ? " is-on" : "") + '" data-act="player" data-arg="' + o + '"><i style="background:' + colour(o) + '"></i>' + o + "</button>";
      }).join("") + "</div>" + monsterBox +
      '<div class="undo"><button type="button" class="btn btn--small" data-act="undo"' + (undoStack.length ? "" : " disabled") + ">Undo</button>" +
      '<button type="button" class="btn btn--small" data-act="redo"' + (redoStack.length ? "" : " disabled") + ">Redo</button></div>";
    var tool = TOOLS.filter(function (t) { return t.id === ui.tool; })[0];
    $("toolHint").textContent = tool ? tool.help : "";
  }

  function renderSettings() {
    var v = cur(), box = $("settings");
    if (!v) { box.innerHTML = ""; return; }
    var deathmatch = isDeathmatch(v);
    var counts = function (list) {
      return playerList(v.players).map(function (o) { return '<span class="count"><i style="background:' + colour(o) + '"></i>' + list(o) + "</span>"; }).join("");
    };
    var holes = v.blocks.filter(function (b) { return b === HOLE; }).length;
    var html = "";

    html += '<div class="card"><h4>Mode</h4><div class="seg">' +
      '<button type="button" class="' + (deathmatch ? "" : "is-on") + '" data-act="mode" data-arg="castles">Castles &amp; princesses</button>' +
      '<button type="button" class="' + (deathmatch ? "is-on" : "") + '" data-act="mode" data-arg="deathmatch">Deathmatch</button></div>' +
      '<p class="hint">' + (deathmatch
        ? "No castles, so no princesses and no respawning: a hero that dies is out, and the last one standing wins."
        : "Win by bringing another player's princess home to your castle. A hero that dies comes back at their castle.") + "</p></div>";

    html += '<div class="card"><h4>Size</h4><div class="row">' +
      '<input type="number" id="mapW" min="' + MIN_SIZE + '" max="' + MAX_SIZE + '" value="' + v.width + '" data-change="size" aria-label="Width in cells">' +
      '<span class="muted">&times;</span>' +
      '<input type="number" id="mapH" min="' + MIN_SIZE + '" max="' + MAX_SIZE + '" value="' + v.height + '" data-change="size" aria-label="Height in cells"></div>' +
      '<p class="hint">Width &times; height in cells, ' + MIN_SIZE + " to " + MAX_SIZE + ". Resizing keeps the top-left corner. The game's own boards are 10 to 12 cells a side.</p></div>";

    html += '<div class="card"><h4>Scenery</h4><select data-change="environment" aria-label="Scenery">' +
      '<option value=""' + (v.environment ? "" : " selected") + ">Random for each match</option>" +
      ENVIRONMENTS.map(function (e) { return '<option value="' + e[0] + '"' + (v.environment === e[0] ? " selected" : "") + ">" + esc(e[1]) + "</option>"; }).join("") +
      '</select><p class="hint">What is drawn around the board. The game\'s own maps pick one at random.</p></div>';

    if (!deathmatch) {
      html += '<div class="card"><h4>Princesses</h4>' + playerList(v.players).map(function (o) {
        var st = princessState(v, o), placed = v.princesses.filter(function (q) { return q.owner === o; })[0];
        return '<div class="row"><span class="count"><i style="background:' + colour(o) + '"></i>' + o + '</span><select class="grow" data-change="princess" data-arg="' + o + '" aria-label="Princess of player ' + o + '">' +
          '<option value="castle"' + (st === "castle" ? " selected" : "") + ">In her castle</option>" +
          '<option value="none"' + (st === "none" ? " selected" : "") + ">No princess</option>" +
          '<option value="placed"' + (st === "placed" ? " selected" : "") + ">" + (placed ? "On the board (" + placed.x + ", " + placed.y + ")" : "Place on the board…") + "</option></select></div>";
      }).join("") +
        '<div class="row" style="margin-top:12px"><span class="muted grow">Neutral princess: ' + (v.neutralPrincess ? "on (" + v.neutralPrincess.x + ", " + v.neutralPrincess.y + ")" : "nearest the middle") + "</span>" +
        '<button type="button" class="btn btn--small" data-act="tool" data-arg="neutral">Place</button>' +
        (v.neutralPrincess ? '<button type="button" class="btn btn--small" data-act="clear-neutral">Clear</button>' : "") + "</div>" +
        '<p class="hint">A princess placed on the board starts there instead of in her castle. The neutral one is for Princess Rush only.</p></div>';
    }

    html += '<div class="card"><h4>On this board</h4>' +
      '<div class="muted">Territory</div><div>' + counts(function (o) { return v.blocks.filter(function (b) { return b === o; }).length; }) + "</div>" +
      '<div class="muted" style="margin-top:6px">Monsters <span style="opacity:.7">(' + v.monsters.length + "/" + MAX_MONSTERS + ")</span> &middot; holes " + holes + "</div>" +
      (v.monsters.length ? "<div>" + counts(function (o) { return v.monsters.filter(function (m) { return m.owner === o; }).length; }) + "</div>" : "") +
      '<div class="row" style="margin-top:12px"><button type="button" class="btn btn--small" data-act="clear-territory">Clear all territory</button>' +
      '<button type="button" class="btn btn--small btn--danger" data-act="remove-board">Remove this board</button></div></div>';

    box.innerHTML = html;
  }

  function renderBoardEmpty() {
    var v = cur(), p = state.current, empty = $("boardEmpty");
    $("boardArea").hidden = !v;
    empty.hidden = !!v;
    if (v) return;
    var d = DEFAULT_LAYOUT[p].size;
    empty.innerHTML = "<p>This map has no board for " + p + " players yet, so a table of " + p + " cannot play on it.</p>" +
      '<div class="btn-row"><button type="button" class="btn btn--small" data-act="add-board" data-arg="blank">Start from the default layout (' + d[0] + "&times;" + d[1] + ")</button>" +
      boardNumbers().map(function (o) { return '<button type="button" class="btn btn--small" data-act="add-board" data-arg="' + o + '">Copy the ' + o + "-player board</button>"; }).join("") + "</div>";
  }

  function renderChecks() {
    var c = checks();
    var rows = c.problems.map(function (x) { return li("err", "Fix", x); })
      .concat(c.warnings.map(function (x) { return li("warn", "Look", x); }));
    $("checks").innerHTML = '<ul class="issues">' + (rows.length ? rows.join("") : '<li class="ok"><b>Good</b>Nothing to fix.</li>') + "</ul>";
    function li(cls, tag, x) {
      return '<li class="' + cls + '"><b>' + tag + "</b>" + (x.board ? "<em>" + x.board + " players:</em> " : "") + esc(x.text) + "</li>";
    }
    return c;
  }

  function renderSend(c) {
    var ok = !c.problems.length;
    $("verdict").innerHTML = '<span class="compat ' + (ok ? "compat--all" : "compat--bad") + '">' + (ok ? "✓ Ready to send" : "✕ " + c.problems.length + " thing" + (c.problems.length === 1 ? "" : "s") + " to fix first") + "</span>";
    ["btnDownload", "btnEmail", "btnCopy"].forEach(function (id) { $(id).disabled = !ok; });
    $("jsonText").textContent = ok ? pretty(toFile()) : "Fix the problems above to see the file.";
  }

  function renderAll() {
    renderBoardEmpty();
    renderToolbar();
    renderSettings();
    update();
    sizeBoard();
  }

  var updateTimer = null;
  // Checks, file preview and draft: cheap, but not worth doing for every cell of a drag.
  function scheduleUpdate() {
    if (updateTimer) return;
    updateTimer = setTimeout(function () { updateTimer = null; update(); }, 60);
  }
  function update() {
    var c = renderChecks();
    renderTabs(c);
    renderSend(c);
    renderToolbarUndo();
    persist();
  }
  function renderToolbarUndo() {
    var u = document.querySelector('[data-act="undo"]'), r = document.querySelector('[data-act="redo"]');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  // ------------------------------------------------------------------ changing the map

  function snapshot() { return JSON.stringify({ boards: state.boards, current: state.current }); }
  function restore(json) {
    var s = JSON.parse(json);
    state.boards = s.boards;
    state.current = s.current;
  }
  function pushUndo(json) {
    undoStack.push(json);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }
  // A change from a button: remembered for Undo, then everything is drawn again.
  function act(fn) {
    var before = snapshot();
    fn();
    if (snapshot() !== before) pushUndo(before);
    renderAll();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    renderAll();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    renderAll();
  }

  function setMode(deathmatch) {
    var v = cur();
    if (deathmatch === isDeathmatch(v)) return;
    act(function () {
      if (deathmatch) {
        v.stash = { castles: v.castles, princesses: v.princesses, neutralPrincess: v.neutralPrincess };
        v.castles = []; v.princesses = []; v.neutralPrincess = null;
        if (DEATHMATCH_TOOLS[ui.tool]) ui.tool = "hero";
      } else {
        // The default layout's castles, pulled onto a board smaller than the layout's. One that lands on
        // a hero or another castle shows up under the board as a problem, to be moved.
        var layout = DEFAULT_LAYOUT[v.players].castles.map(function (xy, i) {
          return { owner: i + 1, x: Math.min(xy[0], v.width - 2), y: Math.min(xy[1], v.height - 1), hasPrincess: true };
        });
        v.castles = v.stash ? v.stash.castles : layout;
        v.castles.forEach(function (c) { paintCastleBlocks(v, c); });
        v.princesses = v.stash ? v.stash.princesses : [];
        v.neutralPrincess = v.stash ? v.stash.neutralPrincess : null;
        delete v.stash;
      }
    });
  }

  function setPrincess(owner, value) {
    var v = cur();
    if (value === "placed") {
      if (princessState(v, owner) !== "placed") { ui.player = owner; ui.tool = "princess"; renderToolbar(); renderSettings(); }
      return;
    }
    act(function () {
      v.princesses = v.princesses.filter(function (p) { return p.owner !== owner; });
      var c = v.castles.filter(function (c) { return c.owner === owner; })[0];
      if (c) c.hasPrincess = value === "castle";
    });
  }

  function applySize() {
    var v = cur();
    var w = Number($("mapW").value), h = Number($("mapH").value);
    if (!isInt(w) || !isInt(h) || w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) {
      say("Each side must be a whole number from " + MIN_SIZE + " to " + MAX_SIZE + ".", "boardMsg");
      renderSettings();
      return;
    }
    if (w === v.width && h === v.height) return;
    var dropped = [];
    act(function () {
      var blocks = new Array(w * h).fill(0);
      for (var y = 0; y < Math.min(h, v.height); y++) {
        for (var x = 0; x < Math.min(w, v.width); x++) blocks[y * w + x] = v.blocks[y * v.width + x];
      }
      var keep = function (list, fits, label) {
        return list.filter(function (p) { if (fits(p)) return true; dropped.push(label(p)); return false; });
      };
      v.castles = keep(v.castles, function (c) { return c.x + 2 <= w && c.y < h; }, function (c) { return "player " + c.owner + "'s castle"; });
      v.heroes = keep(v.heroes, function (p) { return p.x < w && p.y < h; }, function (p) { return "player " + p.owner + "'s hero"; });
      v.princesses = keep(v.princesses, function (p) { return p.x < w && p.y < h; }, function (p) { return "player " + p.owner + "'s princess"; });
      v.monsters = keep(v.monsters, function (p) { return p.x < w && p.y < h; }, function (p) { return "player " + p.owner + "'s " + p.kind; });
      var n = v.neutralPrincess;
      if (n && (n.x >= w || n.y >= h)) { dropped.push("the neutral princess"); v.neutralPrincess = null; }
      v.width = w; v.height = h; v.blocks = blocks;
    });
    say(dropped.length ? "Removed " + dropped.join(", ") + ": no longer on the board. Place them again." : "", "boardMsg");
  }

  // ------------------------------------------------------------------ drawing on the board

  function cellAt(canvas, e) {
    var v = cur(), cs = ui.cs, top = Math.round(cs / 2);
    var r = canvas.getBoundingClientRect();
    var px = (e.clientX - r.left) * (canvas.width / r.width), py = (e.clientY - r.top) * (canvas.height / r.height);
    var x = Math.floor(px / cs), y = Math.floor((py - top) / cs);
    return x >= 0 && y >= 0 && x < v.width && y < v.height ? { x: x, y: y } : null;
  }

  // Does what the tool does on a cell; true when the board changed.
  function applyTool(cell, mode) {
    var v = cur();
    if (!cell) return false;
    var refuse = function (x, y, what) {
      if (!isHole(v, x, y)) return false;
      say(what + " cannot go on a hole at (" + x + ", " + y + "). Fill the hole first.", "boardMsg");
      return true;
    };
    var same = function (m) { return m.x === cell.x && m.y === cell.y; };
    if (mode === "paint" || mode === "erase" || mode === "hole") {
      var value = mode === "paint" ? ui.player : mode === "hole" ? HOLE : 0, i = cell.y * v.width + cell.x;
      if (v.blocks[i] === value) return false;
      if (mode === "hole" && occupant(v, cell.x, cell.y)) return false;     // a hole never goes under a piece
      v.blocks[i] = value;
    } else if (mode === "castle") {
      // The click is the top-left cell; the game stores the bottom-left one.
      var x = Math.min(cell.x, v.width - 2), y = Math.min(cell.y, v.height - 2) + 1;
      for (var dx = 0; dx < 2; dx++) for (var dy = -1; dy <= 0; dy++) if (refuse(x + dx, y + dy, "A castle")) return false;
      var castle = { owner: ui.player, x: x, y: y, hasPrincess: true };
      var old = v.castles.filter(function (c) { return c.owner === ui.player; })[0];
      if (old) castle.hasPrincess = old.hasPrincess;
      v.castles = v.castles.filter(function (c) { return c.owner !== ui.player; }).concat(castle);
      paintCastleBlocks(v, castle);
    } else if (mode === "hero") {
      if (refuse(cell.x, cell.y, "A hero")) return false;
      v.heroes = v.heroes.filter(function (h) { return h.owner !== ui.player; }).concat({ owner: ui.player, x: cell.x, y: cell.y });
    } else if (mode === "princess") {
      if (refuse(cell.x, cell.y, "A princess")) return false;
      v.princesses = v.princesses.filter(function (q) { return q.owner !== ui.player; }).concat({ owner: ui.player, x: cell.x, y: cell.y });
    } else if (mode === "neutral") {
      if (refuse(cell.x, cell.y, "The neutral princess")) return false;
      v.neutralPrincess = { owner: NEUTRAL, x: cell.x, y: cell.y };
    } else if (mode === "monster") {
      if (refuse(cell.x, cell.y, "A monster")) return false;
      v.monsters = v.monsters.filter(function (m) { return !same(m); }).concat({ owner: ui.player, kind: ui.monster, x: cell.x, y: cell.y });
    } else if (mode === "remove") {
      var before = v.princesses.length + v.monsters.length + (v.neutralPrincess ? 1 : 0);
      v.princesses = v.princesses.filter(function (q) { return !same(q); });
      v.monsters = v.monsters.filter(function (m) { return !same(m); });
      if (v.neutralPrincess && same(v.neutralPrincess)) v.neutralPrincess = null;
      if (v.princesses.length + v.monsters.length + (v.neutralPrincess ? 1 : 0) === before) return false;
    }
    say("", "boardMsg");
    return true;
  }

  function wireCanvas() {
    var canvas = $("board");
    var stroke = null, before = null, logged = false;
    var paints = function (mode) { return mode === "paint" || mode === "erase" || mode === "hole"; };
    var go = function (cell, mode) {
      if (!applyTool(cell, mode)) return;
      if (!logged) { pushUndo(before); logged = true; }
      drawBoard();
      scheduleUpdate();
      if (!stroke) renderSettings();       // a piece placed: the side panel's counts and choices change
    };
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("pointerdown", function (e) {
      if (!cur()) return;
      e.preventDefault();
      before = snapshot();
      logged = false;
      // Right-click erases ground, or with a piece tool removes the piece under the pointer.
      var mode = e.button === 2 ? (["princess", "neutral", "monster", "remove"].indexOf(ui.tool) >= 0 ? "remove" : "erase") : ui.tool;
      if (paints(mode)) { stroke = mode; canvas.setPointerCapture(e.pointerId); }
      go(cellAt(canvas, e), mode);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!cur()) return;
      var cell = cellAt(canvas, e);
      var moved = JSON.stringify(cell) !== JSON.stringify(ui.hover);
      ui.hover = cell;
      if (stroke) go(cell, stroke);
      else if (moved) drawBoard();
    });
    var end = function () {
      if (!stroke) return;
      stroke = null;
      renderSettings();                     // the counts catch up once the drag ends
      renderToolbar();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", function () { ui.hover = null; if (cur()) drawBoard(); });
  }

  // ------------------------------------------------------------------ loading and starting

  function hasUnsavedWork() {
    var now = JSON.stringify(toFile());
    return now !== savedJson && now !== pristineJson;
  }
  function leave() {
    return !hasUnsavedWork() || confirm("You have a map in the editor that you have not downloaded. Replace it?");
  }

  function show(parsed, opts) {
    state = { meta: parsed.meta, boards: parsed.boards, current: [2, 3, 4].filter(function (p) { return parsed.boards[p]; })[0] };
    undoStack = []; redoStack = [];
    ui.player = 1;
    ui.tool = "paint";
    savedJson = opts && opts.saved ? JSON.stringify(toFile()) : "";
    $("mapName").value = state.meta.name;
    $("mapAuthor").value = state.meta.author;
    $("mapDesc").value = state.meta.description;
    renderAll();
  }

  function result(kind, lines) {
    $("loadResult").innerHTML = '<ul class="issues" style="margin-top:14px">' + lines.map(function (l) {
      return '<li class="' + kind + '"><b>' + { err: "Problem", ok: "Done", info: "Note" }[kind] + "</b>" + esc(l) + "</li>";
    }).join("") + "</ul>";
  }
  function toDraw() { $("draw").scrollIntoView({ behavior: "smooth", block: "start" }); }

  function startBlank() {
    if (!leave()) return;
    var keep = { name: "", author: state.meta.author, description: "" };
    show({ meta: keep, boards: { 2: blankBoard(2), 3: null, 4: null } });
    result("ok", ["Started a blank board. Pick a tool and draw."]);
    toDraw();
  }

  function startExample(id) {
    var ex = examples.filter(function (e) { return e.id === id; })[0];
    if (!ex || !leave()) return;
    var parsed = fromFile(JSON.parse(JSON.stringify(ex.file)));
    parsed.meta = { name: "", author: state.meta.author, description: "" };
    show(parsed);
    result("ok", ["Opened " + ex.name + ". Change it any way you like, then give it a name of your own."]);
    toDraw();
    $("mapName").focus({ preventScroll: true });
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > 1048576) { result("err", [file.name + " is too big to be a map file."]); return; }
    var reader = new FileReader();
    reader.onerror = function () { result("err", ["Could not read " + file.name + "."]); };
    reader.onload = function () {
      var doc, parsed;
      try { doc = JSON.parse(String(reader.result)); } catch (err) { result("err", [file.name + " is not valid JSON (" + err.message + ")."]); return; }
      try { parsed = fromFile(doc, file.name); } catch (err) { result("err", [file.name + ": " + err.message]); return; }
      if (!leave()) return;
      show(parsed, { saved: true });
      var nums = boardNumbers();
      result("ok", ["Opened " + file.name + ": boards for " + nums.join(", ") + " players."]);
      if (parsed.notes.length) $("loadResult").firstChild.insertAdjacentHTML("beforeend", parsed.notes.map(function (n) { return '<li class="info"><b>Note</b>' + esc(n) + "</li>"; }).join(""));
      toDraw();
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------ sending

  function fileName() {
    var base = state.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "map";
    return base.slice(0, 32) + ".json";
  }
  function saveFile(text, name, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function download() {
    saveFile(pretty(toFile()), fileName(), "application/json");
    savedJson = JSON.stringify(toFile());
  }
  function email() {
    var m = state.meta;
    download();
    var subject = "Map: " + m.name.trim();
    var body = "Name: " + m.name.trim() + "\nBy: " + (m.author.trim() || "(not given)") + "\n\n" + (m.description.trim() ? m.description.trim() + "\n\n" : "") +
      "The map is attached (" + fileName() + ").\n";
    say("Downloaded " + fileName() + ". Attach it to the e-mail that opens. If nothing opens, send it to " + SEND_TO + ".");
    location.href = "mailto:" + SEND_TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
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
    try { document.execCommand("copy"); say(done); } catch (err) { say("Copying failed: open “Look at the file” and copy it by hand."); }
    t.remove();
  }
  function say(text, where) { var s = $(where || "status"); if (s) s.textContent = text; }

  // ------------------------------------------------------------------ draft

  function persist() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ meta: state.meta, boards: state.boards, current: state.current })); } catch (err) { /* private mode */ }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d || !isObj(d.meta) || !isObj(d.boards)) return null;
      var boards = { 2: null, 3: null, 4: null };
      [2, 3, 4].forEach(function (p) {
        var v = d.boards[p];
        if (!v) return;
        var ok = isObj(v) && v.players === p && isInt(v.width) && isInt(v.height) && Array.isArray(v.blocks) && v.blocks.length === v.width * v.height &&
          ["castles", "heroes", "princesses", "monsters"].every(function (k) { return Array.isArray(v[k]); });
        if (ok) { v.environment = v.environment || null; v.neutralPrincess = v.neutralPrincess || null; boards[p] = v; }
      });
      if (![2, 3, 4].some(function (p) { return boards[p]; })) return null;
      var meta = { name: String(d.meta.name || ""), author: String(d.meta.author || ""), description: String(d.meta.description || "") };
      return { meta: meta, boards: boards };
    } catch (err) { return null; }
  }

  // ------------------------------------------------------------------ events

  var ACT = {
    blank: startBlank,
    example: startExample,
    board: function (p) { state.current = Number(p); ui.hover = null; if (ui.player > state.current) ui.player = 1; var v = cur(); if (v && isDeathmatch(v) && DEATHMATCH_TOOLS[ui.tool]) ui.tool = "hero"; renderAll(); },
    tool: function (t) { var v = cur(); if (v && isDeathmatch(v) && DEATHMATCH_TOOLS[t]) return; ui.tool = t; renderToolbar(); },
    player: function (o) { ui.player = Number(o); renderToolbar(); },
    undo: undo,
    redo: redo,
    mode: function (m) { setMode(m === "deathmatch"); },
    "clear-neutral": function () { act(function () { cur().neutralPrincess = null; }); },
    "clear-territory": function () {
      var v = cur();
      if (!v.blocks.some(function (b) { return b > 0; }) || !confirm("Make every territory cell nobody's? Holes stay.")) return;
      act(function () { v.blocks = v.blocks.map(function (b) { return b === HOLE ? HOLE : 0; }); });
    },
    "remove-board": function () {
      if (!confirm("Remove the " + state.current + "-player board? A table of " + state.current + " will not be playable on this map.")) return;
      act(function () { state.boards[state.current] = null; });
    },
    "add-board": function (from) {
      var p = state.current;
      act(function () { state.boards[p] = from === "blank" ? blankBoard(p) : copyBoard(Number(from), p); });
    },
    download: function () { download(); say("Downloaded " + fileName() + "."); },
    email: email,
    copy: function () { copyText(pretty(toFile()), "Copied the map's JSON."); }
  };
  var CHANGE = {
    monster: function (v) { ui.monster = v; renderToolbar(); },
    size: applySize,
    environment: function (v) { act(function () { cur().environment = v || null; }); },
    princess: function (v, el) { setPrincess(Number(el.getAttribute("data-arg")), v); }
  };

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el || el.disabled) return;
    var fn = ACT[el.getAttribute("data-act")];
    if (fn) fn(el.getAttribute("data-arg"), el);
  });
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el.id === "openFile") { loadFile(el.files[0]); el.value = ""; return; }
    var name = el.getAttribute && el.getAttribute("data-change");
    if (name && CHANGE[name]) CHANGE[name](el.value, el);
  });

  [["mapName", "name"], ["mapAuthor", "author"], ["mapDesc", "description"]].forEach(function (pair) {
    $(pair[0]).addEventListener("input", function () { state.meta[pair[1]] = this.value; scheduleUpdate(); });
  });

  document.addEventListener("keydown", function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
      return;
    }
    var v = cur();
    if (e.altKey || !v) return;
    var tool = TOOLS.filter(function (t) { return t.key.toLowerCase() === e.key.toLowerCase() && !(isDeathmatch(v) && DEATHMATCH_TOOLS[t.id]); })[0];
    if (tool) { ui.tool = tool.id; renderToolbar(); return; }
    var n = Number(e.key);
    if (n >= 1 && n <= v.players) { ui.player = n; renderToolbar(); }
  });

  // A map file dropped anywhere on the page
  document.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  window.addEventListener("resize", sizeBoard);

  // ------------------------------------------------------------------ start

  ["floor", "castle", "princess", "monster", "territory-1", "territory-2", "territory-3", "territory-4", "hero-1", "hero-2", "hero-3", "hero-4"].forEach(sprite);

  (window.MAP_EXAMPLES || []).forEach(function (ex) {
    try { ex.parsed = fromFile(JSON.parse(JSON.stringify(ex.file))); examples.push(ex); } catch (err) { /* an example that does not load is left out */ }
  });
  $("mailLink").textContent = SEND_TO;
  $("mailLink").href = "mailto:" + SEND_TO;
  renderExamples();
  wireCanvas();

  var draft = loadDraft();
  if (draft) {
    state = { meta: draft.meta, boards: draft.boards, current: [2, 3, 4].filter(function (p) { return draft.boards[p]; })[0] };
    $("mapName").value = state.meta.name;
    $("mapAuthor").value = state.meta.author;
    $("mapDesc").value = state.meta.description;
    result("info", ["Picked up where you left off. “Blank board” starts over."]);
  }
  renderAll();
}());
