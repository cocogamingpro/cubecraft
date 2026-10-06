const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

// The game files normally live in ./public. If they were uploaded next to server.js instead
// (a flat GitHub upload), use them from there so the server still starts.
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "public", "worldgen.js"))
  ? path.join(__dirname, "public")
  : __dirname;
const WorldGen = require(path.join(PUBLIC_DIR, "worldgen.js"));

const PORT = process.env.PORT || 3000;
const { CHUNK, HEIGHT, B, MAX_HP, MAX_STACK, BREAK_TIME, matchRecipe, Inventory, toolSpeed, dropFor, canMine, Furnace, SMELT, CHEST_SLOTS,
        HUNGER, FOOD, MOBS, weaponDamage, DAYNIGHT } = WorldGen;

// ---------- Limits ----------
const MAX_ROOMS = 20;       // worlds alive at the same time (keeps the free tier happy)
const MAX_PLAYERS = 12;     // per world
const MAX_EDITS = 40000;    // player-made block changes kept per world
const MAX_COORD = 30000;    // world limit on x and z
// (damage per punch is decided by what the player holds: see weaponDamage / SWORD_DAMAGE in worldgen.js)
const HIT_COOLDOWN = 450;   // ms between punches
const HIT_REACH = 7;        // blocks
const EAT_COOLDOWN = 1200;  // ms between two "eat" messages (the client needs HUNGER.EAT_TIME = 1.6 s per item)
const MINE_TOLERANCE = 0.7; // accept a break after 70% of the mining time (network jitter)
const DEAD_BLOCKED = new Set(["place", "break", "mine", "hit", "hitmob", "eat", "fall", "drown", "craft", "slotmove", "slotquick",
  "fopen", "fput", "fquick", "ftake", "copen", "cmove", "cquick", "drop"]);
const MAX_ITEMS = 200;      // items lying on the ground per world (the oldest disappears first)
const ITEM_LIFETIME = 5 * 60 * 1000; // items on the ground vanish after 5 minutes
const PICKUP_RADIUS = 1.6;  // blocks (sideways): you have to walk up close to an item to pick it up
const THROW_DISTANCE = 2.2; // blocks in front of you that a dropped item lands (less if something is in the way)
const THROW_PICKUP_DELAY = 1500; // ms before a thrown item can be picked up (so it isn't grabbed straight back)
const DROP_COOLDOWN = 120; // ms between drops (holding the key keeps dropping, but not faster than this)
const REACH = 12;           // generous; the client only reaches ~6 blocks
const PLACEABLE = new Set([
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.WOOD, B.PLANKS, B.LEAVES, B.SAND, B.SNOW,
  B.CRAFTING_TABLE, B.BUTTON, B.TORCH, B.SANDSTONE, B.STONE_BRICKS, // craftable blocks (the stick is an item, not a block)
  B.FURNACE, B.CHEST, B.COAL_ORE, B.IRON_ORE, B.DIAMOND_ORE,        // (ores are only placed in creative; in survival they drop their mineral)
]);

// Join codes: 6 characters, no look-alikes (0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const Mobs = require("./mobs.js")(WorldGen, { MAX_COORD }); // animals: spawning, AI, pathfinding (see mobs.js)

const key = (x, y, z) => `${x},${y},${z}`;
// Seconds since the first sunrise (it keeps counting; the browser wraps it around the day/night cycle).
const worldTime = (room) => Math.round(((Date.now() - room.dayStart) / 1000) * 10) / 10;

// Buttons and torches hang on a neighbouring block. A block "supports" them unless it is air, water, a button or a torch.
// A button can stick to any side (even the ceiling); a torch only stands on the floor or leans on a wall.
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const supports = (b) => b !== B.AIR && b !== B.WATER && b !== B.BUTTON && b !== B.TORCH;
const hasSupport = (room, x, y, z, noCeiling) => NEIGHBORS.some(([dx, dy, dz]) => {
  if (noCeiling && dy === 1) return false;
  const ny = y + dy;
  return ny >= 0 && ny < HEIGHT && supports(room.blockAt(x + dx, ny, z + dz));
});
// Does the small block `b` at (x, y, z) still have what it hangs on?
const attached = (room, b, x, y, z) => b === B.BUTTON ? hasSupport(room, x, y, z, false) : b === B.TORCH ? hasSupport(room, x, y, z, true) : true;

// ---------- Worlds ----------
// Every world is generated from its own seed. Only the changes made by players are stored.
const rooms = new Set();
const openCodes = new Map(); // code -> room (only worlds that are currently opened to friends)

class Room {
  constructor(seed, mode) {
    this.seed = seed;
    this.mode = mode;            // "creative" or "survival"
    this.gen = WorldGen.createWorld(seed);
    this.edits = new Map();      // "x,y,z" -> block id (0 = removed)
    this.terrain = new Map();    // small cache of generated chunks, used to check edits
    this.clients = new Set();
    this.hostId = null;
    this.code = null;            // set while the world is open
    this.items = new Map();      // items lying on the ground: eid -> { eid, id, n, x, y, z, t }
    this.nextEid = 1;
    this.furnaces = new Map();   // "x,y,z" -> furnace state (see Furnace in worldgen.js)
    this.chests = new Map();     // "x,y,z" -> { x, y, z, slots: [27 x null | { id, n }] }
    this.lastFurnaceTick = Date.now();
    this.lastVitals = Date.now(); // hunger / regeneration clock
    this.dayStart = Date.now() - DAYNIGHT.START * 1000; // the world's clock: seconds since sunrise of day 1 (see DAYNIGHT in worldgen.js)
    // animals (see mobs.js)
    this.mobs = new Map();       // id -> animal
    this.nextMid = 1;
    this.mobCols = new Map();    // cache of the natural ground height of columns
    this.mobLast = Date.now();
    this.mobSpawnT = 0;
    this.mobBurst = 0;           // spawn attempts still to make right away
  }

  terrainBlock(x, y, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const ck = `${cx},${cz}`;
    let data = this.terrain.get(ck);
    if (!data) {
      data = this.gen.generateChunk(cx, cz);
      this.terrain.set(ck, data);
      if (this.terrain.size > 300) this.terrain.delete(this.terrain.keys().next().value); // animals walk around in several places at once
    }
    return data[(y * CHUNK + (z - cz * CHUNK)) * CHUNK + (x - cx * CHUNK)];
  }
  blockAt(x, y, z) {
    const e = this.edits.get(key(x, y, z));
    return e !== undefined ? e : this.terrainBlock(x, y, z);
  }
  setBlock(x, y, z, b) {
    if (b === this.terrainBlock(x, y, z)) this.edits.delete(key(x, y, z)); // back to original
    else this.edits.set(key(x, y, z), b);
    for (const it of this.items.values()) { // items in this column fall or rise to the new ground level
      if (Math.floor(it.x) !== x || Math.floor(it.z) !== z) continue;
      const ny = this.landY(it.x, it.z, it.y);
      if (ny !== it.y) { it.y = ny; this.broadcast({ type: "imove", eid: it.eid, y: ny }); }
    }
  }

  // Height an item comes to rest at: on top of the first solid block at or below fromY.
  landY(x, z, fromY) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = Math.min(HEIGHT - 1, Math.floor(fromY)); y >= 0; y--) {
      const b = this.blockAt(bx, y, bz);
      if (b !== B.AIR && b !== B.WATER && b !== B.BUTTON && b !== B.TORCH) return y + 1;
    }
    return 1;
  }
  // Put n of an item on the ground at (x, y, z); it drops down to the ground and anyone with room can pick it up.
  // `from` (optional) is where a thrown item starts, so everyone sees it fly to where it lands; `delay` (ms) is how
  // long nobody can pick it up.
  dropItem(id, n, x, y, z, from) {
    if (this.items.size >= MAX_ITEMS) {
      const oldest = this.items.keys().next().value;
      this.items.delete(oldest);
      this.broadcast({ type: "ipick", eid: oldest });
    }
    const now = Date.now();
    const it = { eid: this.nextEid++, id, n, x, z, y: this.landY(x, z, y), t: now, pickAt: from && from.delay ? now + from.delay : 0 };
    this.items.set(it.eid, it);
    const msg = { type: "idrop", eid: it.eid, id, n, x, z, y: it.y, y0: y };
    if (from && from.x0 !== undefined) { msg.x0 = from.x0; msg.z0 = from.z0; }
    this.broadcast(msg);
  }

  players() { return [...this.clients].map((c) => c.player); }
  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const c of this.clients) if (c !== except && c.readyState === 1) c.send(data);
  }
  info() { return { type: "room", open: !!this.code, code: this.code, hostId: this.hostId }; }
}

function newCode() {
  for (;;) {
    let c = "";
    for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!openCodes.has(c)) return c;
  }
}
const normCode = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------- Input cleaning ----------
const cleanName = (raw, id) => {
  const s = String(raw || "").replace(/[^\p{L}\p{N} _\-.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return s || `Player${id}`;
};
const cleanSeed = (raw) => {
  const s = String(raw || "").trim().slice(0, 32);
  return s || String(Math.floor(Math.random() * 1e9));
};
const cleanMode = (raw) => (raw === "survival" ? "survival" : "creative");
const cleanChat = (raw) => String(raw || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);

// ---------- HTTP ----------
const app = express();
if (PUBLIC_DIR !== __dirname) {
  app.use(express.static(PUBLIC_DIR));
} else { // flat layout: share only the two game files, never server.js
  const file = (name) => (_req, res) => res.sendFile(path.join(__dirname, name));
  app.get("/", file("index.html"));
  app.get("/index.html", file("index.html"));
  app.get("/worldgen.js", file("worldgen.js"));
}
app.get("/health", (_req, res) => res.send("ok"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Players ----------
let nextId = 1;

const randomColor = () => {
  const hue = Math.floor(Math.random() * 360);
  // HSL -> hex int (saturation 65%, lightness 55%)
  const s = 0.65, l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const to255 = (v) => Math.round(v * 255);
  return (to255(f(0)) << 16) | (to255(f(8)) << 8) | to255(f(4));
};

const send = (ws, obj) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
};
const fail = (ws, message) => send(ws, { type: "error", message });

const isInt = (n) => Number.isInteger(n);
const validBlockPos = (x, y, z) =>
  isInt(x) && isInt(y) && isInt(z) &&
  Math.abs(x) <= MAX_COORD && Math.abs(z) <= MAX_COORD &&
  y >= 1 && y < HEIGHT; // y = 0 is unbreakable bedrock

const inReach = (p, x, y, z) => {
  const dx = x + 0.5 - p.x, dy = y + 0.5 - (p.y + 1.6), dz = z + 0.5 - p.z;
  return dx * dx + dy * dy + dz * dz <= REACH * REACH;
};

function sendInv(ws) { send(ws, { type: "inv", slots: ws.st.inv }); }

// Survival: put one item into the inventory, or on the ground at (wx, wy, wz) when there is no room left.
function giveItem(ws, id, wx, wy, wz) {
  const left = Inventory.add(ws.st.inv, id, 1);
  if (left > 0) ws.room.dropItem(id, left, wx, wy, wz);
  sendInv(ws);
}
const heldId = (st) => (st.inv[st.sel] ? st.inv[st.sel].id : 0); // the item in the selected hotbar slot

// Walk over an item to pick it up (if there is room for it).
function tickItems(room) {
  if (!room.items.size) return;
  const now = Date.now();
  for (const [eid, it] of room.items) {
    if (now - it.t > ITEM_LIFETIME) { room.items.delete(eid); room.broadcast({ type: "ipick", eid }); continue; }
    if (now < it.pickAt) continue; // just thrown: not yet
    for (const c of room.clients) {
      const st = c.st, p = c.player;
      if (!st || st.dead) continue;
      if (Math.hypot(p.x - it.x, p.z - it.z) > PICKUP_RADIUS || p.y > it.y + 1.8 || p.y < it.y - 1.8) continue;
      const left = Inventory.add(st.inv, it.id, it.n);
      if (left === it.n) continue; // inventory full: it stays on the ground
      sendInv(c);
      if (left > 0) it.n = left;
      else { room.items.delete(eid); room.broadcast({ type: "ipick", eid }); }
      break;
    }
  }
}

// ---------- Chests ----------
// A chest has 27 slots (3 rows of 9) shared by the whole world, like the blocks: everyone who opens it sees the same
// items, and a change shows up for all of them at once. The contents live on the server only.
const solidAt = (room, x, y, z) => { const b = room.blockAt(x, Math.max(0, Math.min(HEIGHT - 1, y)), z); return b !== B.AIR && b !== B.WATER && b !== B.BUTTON && b !== B.TORCH; };
function getChest(room, x, y, z) {
  const k = key(x, y, z);
  let c = room.chests.get(k);
  if (!c) room.chests.set(k, (c = { x, y, z, slots: new Array(CHEST_SLOTS).fill(null) }));
  return c;
}
const viewingChest = (c, x, y, z) => c.st && c.st.chest && c.st.chest.x === x && c.st.chest.y === y && c.st.chest.z === z;
function pushChest(room, c) { // tell everyone who has this chest open
  const data = JSON.stringify({ type: "cstate", x: c.x, y: c.y, z: c.z, slots: c.slots });
  for (const cl of room.clients) if (viewingChest(cl, c.x, c.y, c.z) && cl.readyState === 1) cl.send(data);
}
// The chest the player has open, or null (and their screen is closed) if it is gone or out of reach.
function openChestOf(ws) {
  const t = ws.st.chest;
  if (!t) return null;
  if (ws.room.blockAt(t.x, t.y, t.z) !== B.CHEST || !inReach(ws.player, t.x, t.y, t.z)) {
    ws.st.chest = null;
    send(ws, { type: "cclose" });
    return null;
  }
  return getChest(ws.room, t.x, t.y, t.z);
}
// A chest block was removed: everything in it drops on the ground, and anyone looking at it is sent back to the game.
function removeChest(room, x, y, z) {
  const c = room.chests.get(key(x, y, z));
  if (c) {
    for (const s of c.slots) if (s) room.dropItem(s.id, s.n, x + 0.5, y, z + 0.5);
    room.chests.delete(key(x, y, z));
  }
  for (const cl of room.clients) if (viewingChest(cl, x, y, z)) { cl.st.chest = null; send(cl, { type: "cclose" }); }
}
function tickChests(room) { // forget empty chests nobody is looking at (the block itself stays)
  for (const [k, c] of room.chests) {
    if (c.slots.every((s) => !s) && ![...room.clients].some((cl) => viewingChest(cl, c.x, c.y, c.z))) room.chests.delete(k);
  }
}
// Throw n of an item from the player: it flies a couple of blocks ahead and lands there (less far if a wall is in the way).
function throwItem(room, p, id, n) {
  const dx = -Math.sin(p.ry), dz = -Math.cos(p.ry); // the direction the player is facing (same as the client's camera)
  const clear = (d) => {
    const bx = Math.floor(p.x + dx * d), bz = Math.floor(p.z + dz * d);
    return !solidAt(room, bx, Math.floor(p.y + 0.5), bz) && !solidAt(room, bx, Math.floor(p.y + 1.5), bz);
  };
  let d = THROW_DISTANCE;
  while (d > 0.3 && !clear(d)) d -= 0.7;
  if (d <= 0.3) d = 0;
  room.dropItem(id, n, p.x + dx * d, p.y + 1.2, p.z + dz * d, { x0: p.x, z0: p.z, delay: THROW_PICKUP_DELAY });
}

// ---------- Furnaces ----------
// Furnaces are shared by the whole world (like the blocks): whoever opens one sees the same three slots.
// They keep smelting on the server even when nobody is looking at them.
const FURNACE_TICK_MAX = 1;  // seconds; a long pause (server hiccup) must not smelt a whole stack at once
function getFurnace(room, x, y, z) {
  const k = key(x, y, z);
  let f = room.furnaces.get(k);
  if (!f) room.furnaces.set(k, (f = Furnace.create(x, y, z)));
  return f;
}
const viewing = (c, x, y, z) => c.st && c.st.furnace && c.st.furnace.x === x && c.st.furnace.y === y && c.st.furnace.z === z;
function pushFurnace(room, f) { // tell everyone who has this furnace open
  const data = JSON.stringify({ type: "fstate", x: f.x, y: f.y, z: f.z, ...Furnace.view(f) });
  for (const c of room.clients) if (viewing(c, f.x, f.y, f.z) && c.readyState === 1) c.send(data);
}
// The furnace the player has open, or null (and their screen is closed) if it is gone or out of reach.
function openFurnace(ws) {
  const t = ws.st.furnace;
  if (!t) return null;
  if (ws.room.blockAt(t.x, t.y, t.z) !== B.FURNACE || !inReach(ws.player, t.x, t.y, t.z)) {
    ws.st.furnace = null;
    send(ws, { type: "fclose" });
    return null;
  }
  return getFurnace(ws.room, t.x, t.y, t.z);
}
// A furnace block was removed: its contents drop on the ground and anyone looking at it is sent back to the game.
function removeFurnace(room, x, y, z) {
  const f = room.furnaces.get(key(x, y, z));
  if (f) {
    for (const part of ["input", "fuel", "output"]) if (f[part]) room.dropItem(f[part].id, f[part].n, x + 0.5, y, z + 0.5);
    room.furnaces.delete(key(x, y, z));
  }
  for (const c of room.clients) if (viewing(c, x, y, z)) { c.st.furnace = null; send(c, { type: "fclose" }); }
}
function tickFurnaces(room) {
  const now = Date.now();
  const dt = Math.min(FURNACE_TICK_MAX, (now - room.lastFurnaceTick) / 1000);
  room.lastFurnaceTick = now;
  for (const [k, f] of room.furnaces) {
    if (Furnace.tick(f, dt)) pushFurnace(room, f);
    else if (Furnace.isIdle(f) && ![...room.clients].some((c) => viewing(c, f.x, f.y, f.z))) room.furnaces.delete(k); // nothing in it: forget it
  }
}

// ---------- Hunger ----------
// Moving, taking damage and regenerating hearts build up exhaustion; every 4 exhaustion costs 1 hunger point.
// The server keeps the numbers (the client only shows them and refuses to run when hunger is low).
function addExhaustion(st, amount) {
  st.exh += amount;
  while (st.exh >= 4) { st.exh -= 4; if (st.food > 0) st.food--; }
}
function syncFood(ws) { // tell the player when the number of hunger points changed
  const st = ws.st;
  if (st && st.food !== st.foodSent) { st.foodSent = st.food; send(ws, { type: "food", food: st.food }); }
}
// Hearts come back while hunger is high enough (and cost hunger); at 0 hunger you take damage.
function tickVitals(room) {
  const now = Date.now();
  const dt = Math.min(1, (now - room.lastVitals) / 1000);
  room.lastVitals = now;
  if (room.mode !== "survival") return;
  for (const ws of [...room.clients]) {
    const st = ws.st;
    if (!st || st.dead) continue;
    if (st.food >= HUNGER.REGEN_MIN && st.hp < MAX_HP) {
      st.regenT += dt;
      if (st.regenT >= HUNGER.REGEN_INTERVAL) {
        st.regenT = 0;
        st.hp = Math.min(MAX_HP, st.hp + 1);
        send(ws, { type: "hp", hp: st.hp });
        addExhaustion(st, HUNGER.REGEN_EXH);
        syncFood(ws);
      }
    } else st.regenT = 0;
    if (st.food <= 0) {
      st.starveT += dt;
      if (st.starveT >= HUNGER.STARVE_INTERVAL) { st.starveT = 0; damage(ws, HUNGER.STARVE_DAMAGE, { kind: "starve" }); }
    } else st.starveT = 0;
  }
}

// Survival damage. The server keeps the health; clients only report falls and drowning.
function damage(ws, amount, cause) {
  const st = ws.st, room = ws.room, name = ws.player.name;
  if (!st || st.dead || room.mode !== "survival") return;
  st.hp = Math.max(0, st.hp - amount);
  send(ws, { type: "hp", hp: st.hp });
  if (cause.kind !== "starve") { addExhaustion(st, amount * HUNGER.DAMAGE_EXH); syncFood(ws); } // being hurt makes you hungrier
  if (st.hp > 0) return;
  st.dead = true;
  st.mining = null;
  st.furnace = null;
  st.chest = null;
  ws.player.dead = true;
  send(ws, { type: "dead", kind: cause.kind, by: cause.by });
  room.broadcast({ type: "state", id: ws.player.id, dead: true }, ws);
  const how = cause.kind === "fall" ? "fell from a high place"
    : cause.kind === "drown" ? "drowned"
    : cause.kind === "starve" ? "starved to death" : `was slain by ${cause.by}`;
  room.broadcast({ type: "system", text: `${name} ${how}` });
}

function enterRoom(ws, room, rawName) {
  const id = nextId++;
  const player = { id, name: cleanName(rawName, id), color: randomColor(), x: 0, y: 40, z: 0, ry: 0, dead: false };
  const host = [...room.clients].find((c) => c.player.id === room.hostId);

  ws.room = room;
  ws.player = player;
  ws.st = { hp: MAX_HP, inv: Inventory.newInv(), sel: 0, mining: null, dead: false, lastHit: 0, lastDrown: 0, lastDrop: 0, furnace: null, chest: null,
            food: HUNGER.MAX, foodSent: HUNGER.MAX, exh: 0, regenT: 0, starveT: 0, lastEat: 0, moved: false }; // private survival state
  room.clients.add(ws);
  if (room.hostId === null) room.hostId = id;

  const editList = [];
  for (const [k, b] of room.edits) {
    const [x, y, z] = k.split(",").map(Number);
    editList.push([x, y, z, b]);
  }
  send(ws, {
    type: "init",
    id,
    name: player.name,
    color: player.color,
    seed: room.seed,
    mode: room.mode,
    hp: ws.st.hp,
    food: ws.st.food,
    time: worldTime(room),
    inv: ws.st.inv,
    mobs: Mobs.list(room),
    edits: editList,
    items: [...room.items.values()].map(({ eid, id, n, x, y, z }) => ({ eid, id, n, x, y, z })),
    players: room.players().filter((p) => p.id !== id),
    room: room.info(),
    spawn: host ? { x: host.player.x, z: host.player.z } : null, // friends appear near the host
  });
  room.broadcast({ type: "join", player }, ws);
  room.broadcast({ type: "system", text: `${player.name} joined the world` }, ws);
}

function leaveRoom(ws) {
  const room = ws.room, player = ws.player;
  if (!room) return;
  ws.room = null;
  ws.player = null;
  ws.st = null;
  room.clients.delete(ws);

  if (room.clients.size === 0) { // last one out: the world is discarded
    rooms.delete(room);
    if (room.code) openCodes.delete(room.code);
    return;
  }
  room.broadcast({ type: "leave", id: player.id });
  room.broadcast({ type: "system", text: `${player.name} left the world` });
  if (room.hostId === player.id) { // pass hosting on to whoever has been here longest
    const next = room.clients.values().next().value.player;
    room.hostId = next.id;
    room.broadcast(room.info());
    room.broadcast({ type: "system", text: `${next.name} is now the host` });
  }
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.player = null;
  ws.isAlive = true;
  ws.msgCount = 0;
  ws.failedJoins = 0;
  ws.chatTimes = [];

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    // Very small flood protection.
    if (++ws.msgCount > 400) return;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const room = ws.room, player = ws.player;

    // Not in a world yet: the only things allowed are creating or joining one.
    if (!room) {
      if (msg.type === "create") {
        if (rooms.size >= MAX_ROOMS) return fail(ws, "The server is full right now. Please try again in a few minutes.");
        const r = new Room(cleanSeed(msg.seed), cleanMode(msg.mode));
        rooms.add(r);
        enterRoom(ws, r, msg.name);
      } else if (msg.type === "join") {
        if (ws.failedJoins >= 10) return fail(ws, "Too many wrong codes. Wait a moment and reload the page.");
        const r = openCodes.get(normCode(msg.code));
        if (!r) {
          ws.failedJoins++;
          return fail(ws, "No open world has that code. Ask your friend to click \u201cOpen World\u201d and read you the code.");
        }
        if (r.clients.size >= MAX_PLAYERS) return fail(ws, "That world is full.");
        enterRoom(ws, r, msg.name);
      }
      return;
    }

    const st = ws.st, survival = room.mode === "survival";
    if (survival && st.dead && DEAD_BLOCKED.has(msg.type)) return; // dead players can't act until they respawn

    switch (msg.type) {
      case "move": {
        const { x, y, z, ry } = msg;
        if (![x, y, z, ry].every(Number.isFinite)) return;
        if (!st.moved) { st.moved = true; Mobs.populate(room); } // now we know where they really are: animals appear around them
        if (survival && !st.dead) { // walking and running make you hungry (big jumps are teleports: respawns)
          const d = Math.hypot(x - player.x, z - player.z);
          if (d > 0 && d < 3) { addExhaustion(st, d * (msg.run === true ? HUNGER.RUN_EXH : HUNGER.WALK_EXH)); syncFood(ws); }
        }
        Object.assign(player, { x, y, z, ry });
        room.broadcast({ type: "move", id: player.id, x, y, z, ry }, ws);
        break;
      }
      case "place": {
        const { x, y, z, b } = msg;
        if (!validBlockPos(x, y, z) || !PLACEABLE.has(b)) return;
        if (!inReach(player, x, y, z)) return;
        const cur = room.blockAt(x, y, z);
        if (cur !== B.AIR && cur !== B.WATER) return;
        if (room.edits.size >= MAX_EDITS) return;
        if ((b === B.BUTTON || b === B.TORCH) && !attached(room, b, x, y, z)) return; // buttons and torches need something to hang on
        if (survival) { // placing uses up one item from the hotbar slot the player is holding
          const slot = msg.slot, s = Number.isInteger(slot) && slot >= 0 && slot < Inventory.HOTBAR ? st.inv[slot] : null;
          if (!s || s.id !== b) return;
          if (--s.n <= 0) st.inv[slot] = null;
          sendInv(ws);
        }
        room.setBlock(x, y, z, b);
        room.broadcast({ type: "set", x, y, z, b });
        break;
      }
      case "break": {
        const { x, y, z } = msg;
        if (!validBlockPos(x, y, z)) return;
        if (!inReach(player, x, y, z)) return;
        const cur = room.blockAt(x, y, z);
        if (cur === B.AIR || cur === B.WATER || cur === B.BEDROCK) return;
        if (room.edits.size >= MAX_EDITS) return;
        if (survival) { // digging takes time (less with the right tool): the client must have started mining this block long enough ago
          if (!canMine(heldId(st), cur)) return; // e.g. diamond ore needs an iron or diamond pickaxe
          const m = st.mining, need = BREAK_TIME[cur] / toolSpeed(heldId(st), cur);
          if (!m || m.key !== key(x, y, z) || Date.now() - m.t < need * 1000 * MINE_TOLERANCE) return;
          st.mining = null;
        }
        if (cur === B.FURNACE) removeFurnace(room, x, y, z); // its contents fall out
        if (cur === B.CHEST) removeChest(room, x, y, z);
        room.setBlock(x, y, z, B.AIR);
        room.broadcast({ type: "set", x, y, z, b: B.AIR });
        for (const [dx, dy, dz] of NEIGHBORS) { // buttons and torches that lost the block they hung on pop off
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (ny < 1 || ny >= HEIGHT) continue;
          const nb = room.blockAt(nx, ny, nz);
          if ((nb !== B.BUTTON && nb !== B.TORCH) || attached(room, nb, nx, ny, nz)) continue;
          room.setBlock(nx, ny, nz, B.AIR);
          room.broadcast({ type: "set", x: nx, y: ny, z: nz, b: B.AIR });
          if (survival) giveItem(ws, nb, nx + 0.5, ny, nz + 0.5);
        }
        // the block goes into the inventory (stone gives cobblestone); with no room left it falls on the ground
        if (survival) giveItem(ws, dropFor(cur), x + 0.5, y, z + 0.5);
        break;
      }
      case "mine": { // survival: the player started digging this block
        const { x, y, z } = msg;
        if (!survival || !validBlockPos(x, y, z) || !inReach(player, x, y, z)) return;
        st.mining = { key: key(x, y, z), t: Date.now() };
        break;
      }
      case "hit": { // survival: punch another player
        if (!survival) return;
        const now = Date.now();
        if (now - st.lastHit < HIT_COOLDOWN) return;
        const target = [...room.clients].find((c) => c !== ws && c.player.id === msg.id);
        if (!target || target.st.dead) return;
        const t = target.player;
        if (Math.hypot(t.x - player.x, t.y + 0.9 - (player.y + 1.6), t.z - player.z) > HIT_REACH) return;
        st.lastHit = now;
        damage(target, survival ? weaponDamage(heldId(st)) : 0, { kind: "player", by: player.name });
        break;
      }
      case "hitmob": { // punch an animal: in survival it takes 5 punches, in creative it dies at once
        const now = Date.now();
        if (now - st.lastHit < HIT_COOLDOWN) return;
        const mob = room.mobs.get(msg.id);
        if (!mob) return;
        const def = MOBS[mob.kind];
        if (Math.hypot(mob.x - player.x, mob.y + def.h / 2 - (player.y + 1.6), mob.z - player.z) > HIT_REACH) return;
        st.lastHit = now;
        Mobs.hurt(room, mob, survival ? weaponDamage(heldId(st)) : 999, player);
        break;
      }
      case "eat": { // survival: the player held right click on food long enough
        const now = Date.now();
        if (!survival || now - st.lastEat < EAT_COOLDOWN) return;
        const slot = Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < Inventory.HOTBAR ? msg.slot : st.sel;
        const s = st.inv[slot];
        if (!s || FOOD[s.id] === undefined || st.food >= HUNGER.MAX) return;
        st.lastEat = now;
        st.food = Math.min(HUNGER.MAX, st.food + FOOD[s.id]);
        if (--s.n <= 0) st.inv[slot] = null;
        sendInv(ws);
        syncFood(ws);
        break;
      }
      case "fall": {
        if (!survival || !Number.isFinite(msg.amount)) return;
        damage(ws, Math.max(1, Math.min(MAX_HP, Math.floor(msg.amount))), { kind: "fall" });
        break;
      }
      case "drown": {
        const now = Date.now();
        if (!survival || now - st.lastDrown < 800) return;
        st.lastDrown = now;
        damage(ws, 2, { kind: "drown" });
        break;
      }
      case "respawn": {
        if (!survival || !st.dead) return;
        st.hp = MAX_HP; st.dead = false; st.mining = null; player.dead = false;
        st.food = HUNGER.MAX; st.exh = 0; st.regenT = 0; st.starveT = 0; // a fresh start: full hunger (you keep your items)
        send(ws, { type: "hp", hp: st.hp });
        syncFood(ws);
        room.broadcast({ type: "state", id: player.id, dead: false }, ws);
        break;
      }
      case "craft": { // survival: turn items from the inventory into something new
        // msg.grid = the crafting grid (4 ids for the inventory's 2x2, 9 for a crafting table's 3x3; 0 = empty).
        // msg.times = how many times to craft (shift-click = many). The grid is only a recipe the player arranges:
        // the server checks the inventory really holds the ingredients, takes them and hands over the result.
        if (!survival || !Array.isArray(msg.grid) || (msg.grid.length !== 4 && msg.grid.length !== 9)) return;
        if (msg.grid.length === 9) { // the 3x3 grid needs a crafting table within reach
          const t = msg.table || {};
          if (!validBlockPos(t.x, t.y, t.z) || !inReach(player, t.x, t.y, t.z) || room.blockAt(t.x, t.y, t.z) !== B.CRAFTING_TABLE) return;
        }
        const grid = msg.grid.map((v) => (Number.isInteger(v) ? v : 0));
        const rec = matchRecipe(grid);
        if (!rec) return;
        const need = {}; // item id -> how many are needed for ONE craft
        for (const id of grid) if (id) need[id] = (need[id] || 0) + 1;
        const times = Math.max(1, Math.min(MAX_STACK, Math.floor(Number(msg.times)) || 1));
        let made = 0;
        for (let i = 0; i < times && Inventory.has(st.inv, need); i++) {
          for (const id in need) Inventory.take(st.inv, Number(id), need[id]);
          const left = Inventory.add(st.inv, rec.out, rec.n);
          made++;
          if (left > 0) { room.dropItem(rec.out, left, player.x, player.y + 0.5, player.z); break; } // no room: it drops at your feet
        }
        if (made) sendInv(ws);
        break;
      }
      // ----- furnace (survival) -----
      case "fopen": { // right-click on a furnace
        const { x, y, z } = msg;
        if (!survival || !validBlockPos(x, y, z) || !inReach(player, x, y, z) || room.blockAt(x, y, z) !== B.FURNACE) return;
        st.furnace = { x, y, z };
        const f = getFurnace(room, x, y, z);
        send(ws, { type: "fstate", x, y, z, ...Furnace.view(f) });
        break;
      }
      case "fclose": st.furnace = null; break;
      case "fput": case "fquick": { // put a stack from an inventory slot into the furnace (fquick picks input or fuel itself)
        if (!survival) return;
        const f = openFurnace(ws);
        if (!f) return;
        const s = Number.isInteger(msg.from) && msg.from >= 0 && msg.from < Inventory.SIZE ? st.inv[msg.from] : null;
        if (!s) return;
        let part = msg.part;
        if (msg.type === "fquick") part = SMELT[s.id] !== undefined ? "input" : WorldGen.FUEL[s.id] !== undefined ? "fuel" : null;
        if (!part) { // not furnace material: shift-click works like in the normal inventory
          if (Inventory.quickMove(st.inv, msg.from)) sendInv(ws);
          return;
        }
        const err = Furnace.insert(f, st.inv, msg.from, part);
        if (err) return send(ws, { type: "finfo", text: err });
        sendInv(ws);
        pushFurnace(room, f);
        break;
      }
      case "ftake": { // take a slot of the furnace into the inventory
        if (!survival) return;
        const f = openFurnace(ws);
        if (!f) return;
        const err = Furnace.take(f, st.inv, msg.part);
        if (err) return send(ws, { type: "finfo", text: err });
        sendInv(ws);
        pushFurnace(room, f);
        break;
      }
      // ----- chest (survival) -----
      case "copen": { // right-click on a chest
        const { x, y, z } = msg;
        if (!survival || !validBlockPos(x, y, z) || !inReach(player, x, y, z) || room.blockAt(x, y, z) !== B.CHEST) return;
        st.chest = { x, y, z };
        send(ws, { type: "cstate", x, y, z, slots: getChest(room, x, y, z).slots });
        break;
      }
      case "cclose": st.chest = null; break;
      case "cmove": case "cquick": { // move items between your inventory and the open chest
        if (!survival) return;
        const c = openChestOf(ws);
        if (!c) return;
        const area = (a) => (a && a.area === "inv" ? st.inv : a && a.area === "chest" ? c.slots : null);
        const from = msg.from, src = area(from);
        if (!src || !Number.isInteger(from.i)) return;
        let changed;
        if (msg.type === "cmove") {
          const to = msg.to, dst = area(to);
          if (!dst || !Number.isInteger(to.i)) return;
          changed = Inventory.moveBetween(src, from.i, dst, to.i);
        } else { // shift-click: chest -> inventory, inventory -> chest
          changed = Inventory.quickInto(src, from.i, src === c.slots ? st.inv : c.slots);
        }
        if (!changed) return;
        sendInv(ws);
        pushChest(room, c);
        break;
      }
      // ----- drop (survival): throw one item (or the whole stack) from a slot; the selected hotbar slot by default -----
      case "drop": {
        if (!survival) return;
        const now = Date.now();
        if (now - st.lastDrop < DROP_COOLDOWN) return;
        const slot = Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < Inventory.SIZE ? msg.slot : st.sel;
        const s = st.inv[slot];
        if (!s) return;
        const id = s.id, n = msg.all ? s.n : 1;
        st.lastDrop = now;
        s.n -= n;
        if (s.n <= 0) st.inv[slot] = null;
        sendInv(ws);
        throwItem(room, player, id, n);
        break;
      }
      case "select": { // which hotbar slot the player holds (decides the mining speed)
        if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < Inventory.HOTBAR) st.sel = msg.slot;
        break;
      }
      case "slotmove": { // survival: click one slot, then another (move / merge / swap)
        if (survival && Inventory.moveSlot(st.inv, msg.from, msg.to)) sendInv(ws);
        break;
      }
      case "slotquick": { // survival: shift-click a slot (hotbar <-> inventory)
        if (survival && Inventory.quickMove(st.inv, msg.from)) sendInv(ws);
        break;
      }
      case "chat": {
        const text = cleanChat(msg.text);
        if (!text) return;
        const now = Date.now();
        ws.chatTimes = ws.chatTimes.filter((t) => now - t < 6000);
        if (ws.chatTimes.length >= 5) return send(ws, { type: "system", text: "You're sending messages too fast." });
        ws.chatTimes.push(now);
        room.broadcast({ type: "chat", id: player.id, name: player.name, text });
        break;
      }
      case "open": { // host only: give the world a code friends can type in
        if (room.hostId !== player.id || room.code) return;
        room.code = newCode();
        openCodes.set(room.code, room);
        room.broadcast(room.info());
        room.broadcast({ type: "system", text: `World opened! Friends can join with the code ${room.code}` });
        break;
      }
      case "close": { // host only: stop new players from joining
        if (room.hostId !== player.id || !room.code) return;
        openCodes.delete(room.code);
        room.code = null;
        room.broadcast(room.info());
        room.broadcast({ type: "system", text: "World closed. No new players can join." });
        break;
      }
      case "leave":
        leaveRoom(ws);
        break;
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

// Pickups and despawning of items lying on the ground, and furnaces smelting.
setInterval(() => { for (const room of rooms) { tickItems(room); tickFurnaces(room); tickChests(room); tickVitals(room); } }, 150);

// Day and night: every few seconds everybody gets the world's clock again, so all the skies stay in step.
setInterval(() => { for (const room of rooms) room.broadcast({ type: "time", t: worldTime(room) }); }, 5000);

// Animals: AI, spawning and movement.
setInterval(() => { for (const room of rooms) Mobs.tick(room); }, 100);

// Reset flood counters every second.
setInterval(() => {
  for (const ws of wss.clients) ws.msgCount = 0;
}, 1000);

// Heartbeat: drop dead connections and keep proxies from idling the socket.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Block Platform running on port ${PORT}`));
