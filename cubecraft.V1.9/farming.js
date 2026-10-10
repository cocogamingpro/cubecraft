"use strict";
// Farming and flowing water. Server only (like mobs.js).
//
// The server owns both systems; the clients only draw the blocks it tells them about (`set` and `sets` messages).
//
// WATER FLOW
//   A block of water is a SOURCE (B.WATER, what lakes, the sea and a poured bucket are made of), FLOWING water of a
//   strength from 1 (right next to a source) to 7 (it goes no further), or FALLING water (straight down).
//   - A source spreads sideways at strength 1, flowing water spreads on at one weaker, up to FLOW_MAX blocks.
//   - Water above an empty block (or flowing water) falls into it. Flowing water with nothing solid under it falls
//     instead of spreading sideways; falling water that lands on the ground spreads out from there.
//   - Two sources side by side with a floor under an empty block make a new source (so a pond cannot be drained
//     by scooping one block, like in Minecraft).
//   - Take a source away and the flow it fed dries up again.
//   Nothing moves by itself: when a block changes, that block and its 6 neighbours are put in a queue (room.waterQ) and
//   looked at one step (WATER_STEP_MS) later; a block that changes puts its own neighbours in the queue, and so
//   the water creeps along about 4 blocks per second. The sea does not flow until something next to it changes.
//
// FARMLAND AND CROPS
//   Farmland (made with a hoe) turns into WET farmland when a water source is within FARM.WATER_RANGE blocks and dries
//   again when there isn't one. Wheat only grows on wet farmland: it needs FARM.GROW_TIME seconds in total (the clock
//   pauses while the soil is dry) and changes its look at 33%, 66% and when ripe (4 blocks: WHEAT_0..WHEAT_3).
module.exports = function createFarming(WorldGen, opts) {
  const { HEIGHT, B, FARM, FLOW_MAX, isWater, isFlowing, flowLevel, isSolid, isWheat, isFarmland, wheatStage } = WorldGen;
  const MAX_EDITS = (opts && opts.MAX_EDITS) || 40000;

  // ---------- Tuning ----------
  const WATER_STEP_MS = 250;     // time between two steps of the water
  const MAX_WATER_CELLS = 900;   // blocks looked at per step and world (the rest wait for the next step)
  const FARM_STEP_MS = 1000;     // time between two looks at the farmland and the crops
  const FARM_BUDGET = 150;       // farmland blocks checked for water per look (round robin) ...
  const FARM_BUDGET_FAST = 900;  // ... and when water was just added or taken away somewhere
  const FARM_DT_MAX = 2;         // seconds; a server hiccup must not grow a crop in one go

  const key = (x, y, z) => `${x},${y},${z}`;
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // ---------- Per-world state ----------
  // room.waterQ     Map  "x,y,z" -> [x, y, z]: blocks whose water has to be looked at in the next step
  // room.farms      Map  "x,y,z" -> [x, y, z]: every farmland block (dry or wet)
  // room.crops      Map  "x,y,z" -> { x, y, z, g }: every wheat plant and the seconds it has grown on wet soil
  function init(room) {
    room.waterQ = new Map();
    room.farms = new Map();
    room.crops = new Map();
    room.farmList = [];      // snapshot of the farmland used to check a few blocks per look
    room.farmListVer = -1;
    room.farmsVer = 0;
    room.farmCursor = 0;
    room.hydroDirty = false; // water was added or removed: re-check all the farmland soon ...
    room.hydroLeft = undefined; // ... and this counts how many farmland blocks still have to be looked at
    room.lastWaterStep = Date.now();
    room.lastFarmStep = Date.now();
  }

  // Put a block and its 6 neighbours in the water queue.
  function touch(room, x, y, z) {
    for (let i = 0; i < 7; i++) {
      const nx = x + (i === 1 ? 1 : i === 2 ? -1 : 0), ny = y + (i === 3 ? 1 : i === 4 ? -1 : 0), nz = z + (i === 5 ? 1 : i === 6 ? -1 : 0);
      if (ny < 1 || ny >= HEIGHT) continue;
      const k = key(nx, ny, nz);
      if (!room.waterQ.has(k)) room.waterQ.set(k, [nx, ny, nz]);
    }
  }

  // Called by Room.setBlock for EVERY block change (a player's, the water's, a crop growing...).
  function onSet(room, x, y, z, b, prev) {
    const k = key(x, y, z);
    if (isFarmland(b)) { if (!room.farms.has(k)) { room.farms.set(k, [x, y, z]); room.farmsVer++; } }
    else if (room.farms.delete(k)) room.farmsVer++;
    if (!isWheat(b)) room.crops.delete(k); // (planting adds the crop AFTER placing the first wheat block, see plant())
    if (b === B.WATER || prev === B.WATER) { room.hydroDirty = true; room.hydroLeft = undefined; } // a source appeared or went away: look at all the farmland again
    touch(room, x, y, z);
  }

  // ---------- Water ----------
  // What the block at (x, y, z) should be, going by its surroundings (B.AIR = no water): this is the heart of the flow.
  function waterWant(room, x, y, z) {
    if (isWater(room.blockAt(x, y + 1, z))) return B.WATER_FALL; // water above: it falls into this block
    const below = room.blockAt(x, y - 1, z);
    let sources = 0, best = 99; // best = the strength of the strongest neighbour that can feed this block
    for (const [dx, dz] of ORTH) {
      const nx = x + dx, nz = z + dz, nb = room.blockAt(nx, y, nz);
      if (!isWater(nb)) continue;
      let lvl;
      if (nb === B.WATER) { lvl = 0; sources++; }                  // a source always spreads sideways
      else {
        if (!isSolid(room.blockAt(nx, y - 1, nz))) continue;       // flowing water with nothing under it falls, it doesn't spread
        lvl = nb === B.WATER_FALL ? 0 : flowLevel(nb);             // falling water that has landed spreads like a source
        if (lvl >= FLOW_MAX) continue;                             // the weakest water goes no further
      }
      if (lvl < best) best = lvl;
    }
    if (sources >= 2 && (isSolid(below) || below === B.WATER)) return B.WATER; // two sources side by side make a third
    if (best < 99) return B.WATER_1 + best;                        // one weaker than the neighbour that feeds it
    return B.AIR;
  }

  // The new block for (x, y, z), or null if it stays as it is.
  function stepCell(room, x, y, z) {
    if (y < 1 || y >= HEIGHT) return null;
    const cur = room.blockAt(x, y, z);
    if (cur === B.WATER) return null;                         // sources never change by themselves
    if (cur !== B.AIR && !isFlowing(cur)) return null;        // something solid (or a plant...) is here: water doesn't flow into it
    const want = waterWant(room, x, y, z);
    if (want === cur) return null;
    if (cur === B.AIR) return want;
    // It is flowing water now, and the supply changed:
    if (want === B.AIR) return B.AIR;                         // nothing feeds it any more: it dries up
    if (want === B.WATER || want === B.WATER_FALL) return want; // it is now a source / water is falling in from above
    if (cur === B.WATER_FALL) return B.AIR;                   // it was fed from above and that is gone: dry out (it refills if something else feeds it)
    // A flow of another strength: a stronger one (a closer source) takes over at once. A weaker one means the old supply
    // is gone: dry it first, then it fills up again at the new strength (that keeps two blocks from propping each other up).
    return flowLevel(want) < flowLevel(cur) ? want : B.AIR;
  }

  // One step of the water. Returns true if anything changed.
  function tickWater(room) {
    const q = room.waterQ;
    if (!q.size) return false;
    room.waterQ = new Map(); // changes made now are looked at in the NEXT step
    const changes = [];
    let looked = 0;
    for (const [k, c] of q) {
      if (++looked > MAX_WATER_CELLS) { if (!room.waterQ.has(k)) room.waterQ.set(k, c); continue; }
      const nb = stepCell(room, c[0], c[1], c[2]);
      if (nb === null) continue;
      if (nb !== B.AIR && room.edits.size >= MAX_EDITS && !room.edits.has(k)) continue; // the world holds as many changes as it can
      room.setBlock(c[0], c[1], c[2], nb); // (this queues the neighbours for the next step)
      changes.push([c[0], c[1], c[2], nb]);
    }
    if (changes.length) room.broadcast({ type: "sets", l: changes });
    return changes.length > 0;
  }

  // ---------- Farmland and crops ----------
  // Is there a water source within reach of the farmland at (x, y, z)? (Flowing water does not count, only sources.)
  function hydrated(room, x, y, z) {
    const R = FARM.WATER_RANGE, DY = FARM.WATER_DY;
    for (let dy = -DY; dy <= DY; dy++) {
      const by = y + dy;
      if (by < 1 || by >= HEIGHT) continue;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (room.blockAt(x + dx, by, z + dz) === B.WATER) return true;
    }
    return false;
  }

  // Plant a seed: the farmland is at (x, y - 1, z), the wheat goes at (x, y, z). The caller has checked everything.
  function plant(room, x, y, z, grown) {
    room.setBlock(x, y, z, B.WHEAT_0 + wheatStage(grown || 0));
    room.crops.set(key(x, y, z), { x, y, z, g: grown || 0 });
  }

  // One look at the farmland (wet or dry?) and the crops (grow).
  function tickFarms(room, dt) {
    const changes = [];
    const set = (x, y, z, b) => { room.setBlock(x, y, z, b); changes.push([x, y, z, b]); };

    // 1. farmland: wet if a source is near, dry if not. Checked round robin so a huge farm costs little per second.
    if (room.farmListVer !== room.farmsVer) { room.farmList = [...room.farms.values()]; room.farmListVer = room.farmsVer; }
    const list = room.farmList;
    const budget = Math.min(list.length, room.hydroDirty ? FARM_BUDGET_FAST : FARM_BUDGET);
    if (room.hydroDirty) { // one full pass over the farmland, then back to the slow round robin
      if (room.hydroLeft === undefined) room.hydroLeft = list.length;
      room.hydroLeft -= budget;
      if (room.hydroLeft <= 0) { room.hydroDirty = false; room.hydroLeft = undefined; }
    }
    for (let n = 0; n < budget; n++) {
      if (room.farmCursor >= list.length) room.farmCursor = 0;
      const [x, y, z] = list[room.farmCursor++];
      const cur = room.blockAt(x, y, z);
      if (!isFarmland(cur)) continue; // (the list is a snapshot; this one was just removed)
      const want = hydrated(room, x, y, z) ? B.FARMLAND_WET : B.FARMLAND;
      if (cur !== want) set(x, y, z, want);
    }

    // 2. crops: grow on wet soil (the clock stops on dry soil), and show it when a stage is reached
    for (const [k, c] of room.crops) {
      const cur = room.blockAt(c.x, c.y, c.z);
      if (!isWheat(cur)) { room.crops.delete(k); continue; }
      if (room.blockAt(c.x, c.y - 1, c.z) !== B.FARMLAND_WET) continue;
      if (c.g < FARM.GROW_TIME) c.g = Math.min(FARM.GROW_TIME, c.g + dt);
      const stage = wheatStage(c.g);
      if (cur !== B.WHEAT_0 + stage) set(c.x, c.y, c.z, B.WHEAT_0 + stage);
    }
    if (changes.length) room.broadcast({ type: "sets", l: changes });
  }

  // Called a few times a second for every running world.
  function tick(room) {
    const now = Date.now();
    if (now - room.lastWaterStep >= WATER_STEP_MS) { room.lastWaterStep = now; tickWater(room); }
    if (now - room.lastFarmStep >= FARM_STEP_MS) {
      const dt = Math.min(FARM_DT_MAX, (now - room.lastFarmStep) / 1000);
      room.lastFarmStep = now;
      if (room.farms.size || room.crops.size) tickFarms(room, dt);
    }
  }

  // After a world is loaded from disk (room.edits is filled): find the farmland and crops again, and let the water
  // have a look at itself (a spread that was cut off by a restart carries on).
  function afterLoad(room, savedCrops) {
    const saved = new Map();
    for (const c of savedCrops || []) if (c && [c.x, c.y, c.z].every(Number.isInteger) && Number.isFinite(c.g)) saved.set(key(c.x, c.y, c.z), c.g);
    for (const [k, b] of room.edits) {
      const [x, y, z] = k.split(",").map(Number);
      if (isFarmland(b)) room.farms.set(k, [x, y, z]);
      else if (isWheat(b)) {
        const g = saved.has(k) ? Math.max(0, Math.min(FARM.GROW_TIME, saved.get(k))) : (b - B.WHEAT_0) * (FARM.GROW_TIME / 3); // (no clock saved: the start of its stage)
        room.crops.set(k, { x, y, z, g });
      } else if (isWater(b)) touch(room, x, y, z);
    }
    room.farmsVer++;
    room.hydroDirty = room.farms.size > 0; room.hydroLeft = undefined;
  }

  const serializeCrops = (room) => [...room.crops.values()].map((c) => ({ x: c.x, y: c.y, z: c.z, g: Math.round(c.g * 10) / 10 }));

  return { init, onSet, tick, tickWater, tickFarms, stepCell, waterWant, hydrated, plant, afterLoad, serializeCrops, touch };
};
