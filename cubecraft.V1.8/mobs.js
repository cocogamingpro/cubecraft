"use strict";
// Peaceful animals (pig, cow, sheep): spawning, AI and pathfinding. Server only.
//
// The server owns the animals. Every 100 ms it moves them and tells the clients where they are; the clients only
// draw them (see index.html). What the animals know about the world comes from room.blockAt(), so blocks placed or
// broken by players are taken into account.
//
// How an animal "chooses its path":
//   idle   -> stands still, now and then looks around (or at a player who is close)
//   walk   -> after a few seconds it looks at the ground around it, flood-fills every cell it could walk to (steps of
//             at most 1 block up or down, never into water, never into holes or caves), picks one of those cells and
//             walks the shortest route there
//   panic  -> when hit it runs away from the attacker, along a route chosen the same way, much faster
module.exports = function createMobs(WorldGen, opts) {
  const { HEIGHT, SEA, B, MOBS, MOB_KINDS, SHEEP_COLORS } = WorldGen;
  const MAX_COORD = (opts && opts.MAX_COORD) || 30000;

  // ---------- Tuning ----------
  const MOB_CAP_ROOM = 48;      // animals per world
  const PER_PLAYER = 12;        // a player stops "attracting" new herds when this many animals are within NEAR_R
  const NEAR_R = 64;           // blocks
  const SPAWN_MIN = 18, SPAWN_MAX = 40; // herds appear this far from a player (never right next to you)
  const DESPAWN_DIST = 96;      // animals this far from every player disappear (the world is endless)
  const SPAWN_EVERY = 1.5;      // seconds between spawn attempts
  const BURST_TRIES = 14;       // spawn attempts made right away when someone joins, so the land isn't empty
  const SEARCH_R = 8;           // how far (in blocks) an animal looks for a place to walk to
  const SEARCH_MAX = 320;       // cells looked at per search
  const PLANS_PER_TICK = 4;     // path searches per world per tick (spreads the work)
  const PANIC_TIME = 4;         // seconds an animal runs after being hit
  const PANIC_SPEED = 2.4;      // times its walking speed
  const KNOCK_DEFAULT = 5;      // blocks/s: how hard an animal is pushed when the attacker doesn't say (see hurt)
  const KNOCK_DECAY = 7;        // per second: the push fades out, so a push of speed v slides about v / 7 blocks
  const KNOCK_STUN = 0.2;       // seconds an animal is dazed after a hit, before it starts running
  const MAX_DT = 0.25;

  const isSolid = (b) => b !== B.AIR && b !== B.WATER && b !== B.BUTTON && b !== B.TORCH;
  const isFree = (b) => b === B.AIR || b === B.BUTTON || b === B.TORCH; // an animal fits through air and walks through buttons and torches
  const r2 = (v) => Math.round(v * 100) / 100;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- The natural ground ----------
  // gen.column() is the terrain as generated (before caves, trees and player edits). Animals only walk where the
  // ground is at least as high as that: so never down into a cave, a cave mouth or a pit. Cached per world.
  function natCol(room, x, z) {
    const k = (x + 32768) * 65536 + (z + 32768);
    let v = room.mobCols.get(k);
    if (v === undefined) {
      const c = room.gen.column(x, z);
      v = c.h * 2 + (c.grass ? 1 : 0);
      if (room.mobCols.size > 30000) room.mobCols.clear();
      room.mobCols.set(k, v);
    }
    return v;
  }
  const natH = (room, x, z) => natCol(room, x, z) >> 1;
  const natGrass = (room, x, z) => (natCol(room, x, z) & 1) === 1;

  // Can an animal that is `cells` tall stand with its feet in block (x, fy, z)?
  // strict = also refuse ground lower than the natural surface (caves, holes).
  function canStand(room, cells, x, z, fy, strict) {
    if (Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD) return false;
    if (fy < 1 || fy + cells >= HEIGHT) return false;
    const ground = room.blockAt(x, fy - 1, z);
    if (!isSolid(ground) || ground === B.LEAVES) return false; // water is not solid, so never walkable
    for (let k = 0; k < cells; k++) if (!isFree(room.blockAt(x, fy + k, z))) return false; // water, trees, walls
    if (strict && fy - 1 < natH(room, x, z)) return false;
    return true;
  }
  // Where would an animal standing at height fy end up when it steps into column (x, z)? Flat, one block up or one
  // block down; null if it can't go there.
  function stepY(room, cells, x, z, fy, strict) {
    if (canStand(room, cells, x, z, fy, strict)) return fy;
    if (canStand(room, cells, x, z, fy + 1, strict)) return fy + 1;
    if (canStand(room, cells, x, z, fy - 1, strict) && isFree(room.blockAt(x, fy + cells - 1, z))) return fy - 1; // head clears the ledge
    return null;
  }

  // ---------- Path search ----------
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1, 0, 2], [1, -1, 0, 3], [-1, 1, 1, 2], [-1, -1, 1, 3]]; // dx, dz, and the two orthogonal steps it needs
  // Flood-fills the cells the animal can walk to (within SEARCH_R). Returns the list of cells, each
  // { x, z, fy, parent, depth } (cell 0 is where the animal is).
  function explore(room, mob, strict) {
    const cells = MOBS[mob.kind].cells;
    const sx = Math.floor(mob.x), sz = Math.floor(mob.z);
    const nodes = [{ x: sx, z: sz, fy: mob.gy, parent: -1, depth: 0 }];
    const seen = new Set();
    const keyOf = (x, z, fy) => ((x - sx + 16) * 40 + (z - sz + 16)) * 128 + fy;
    seen.add(keyOf(sx, sz, mob.gy));
    for (let head = 0; head < nodes.length && nodes.length < SEARCH_MAX; head++) {
      const n = nodes[head];
      const step = [null, null, null, null];
      for (let d = 0; d < 4; d++) {
        const nx = n.x + ORTH[d][0], nz = n.z + ORTH[d][1];
        if (Math.abs(nx - sx) > SEARCH_R || Math.abs(nz - sz) > SEARCH_R) continue;
        step[d] = stepY(room, cells, nx, nz, n.fy, strict);
      }
      const add = (nx, nz, fy) => {
        const k = keyOf(nx, nz, fy);
        if (seen.has(k)) return;
        seen.add(k);
        nodes.push({ x: nx, z: nz, fy, parent: head, depth: n.depth + 1 });
      };
      for (let d = 0; d < 4; d++) if (step[d] !== null) add(n.x + ORTH[d][0], n.z + ORTH[d][1], step[d]);
      for (const [dx, dz, a, b] of DIAG) { // no cutting corners: both sides must be walkable too
        if (step[a] === null || step[b] === null) continue;
        const nx = n.x + dx, nz = n.z + dz;
        if (Math.abs(nx - sx) > SEARCH_R || Math.abs(nz - sz) > SEARCH_R) continue;
        const fy = stepY(room, cells, nx, nz, n.fy, strict);
        if (fy !== null && fy === step[a] && fy === step[b]) add(nx, nz, fy);
      }
    }
    return nodes;
  }
  const routeTo = (nodes, i) => { // the cells from the start (not included) to node i
    const path = [];
    for (let n = i; n > 0; n = nodes[n].parent) path.push([nodes[n].x, nodes[n].z, nodes[n].fy]);
    return path.reverse();
  };

  // Is the animal standing somewhere it's allowed to be (so the strict rules apply to its search)?
  const onSurface = (room, mob) => canStand(room, MOBS[mob.kind].cells, Math.floor(mob.x), Math.floor(mob.z), mob.gy, true);

  // Choose a place to wander to and the route there. Returns true if the animal now has a route.
  function planWander(room, mob) {
    const strict = onSurface(room, mob);
    const nodes = explore(room, mob, strict);
    const far = [];
    for (let i = 1; i < nodes.length; i++) if (nodes[i].depth >= 3) far.push(i);
    if (!far.length) return false;
    // prefer medium trips; now and then a short hop
    const pick = far[Math.floor(Math.random() * far.length)];
    mob.path = routeTo(nodes, pick); mob.pi = 0; mob.strict = strict;
    return true;
  }
  // Choose a place far away from `from` ({x, z}) and the route there.
  function planFlee(room, mob, from) {
    const strict = onSurface(room, mob);
    const nodes = explore(room, mob, strict);
    let best = 0;
    const dist = nodes.map((n) => Math.hypot(n.x + 0.5 - from.x, n.z + 0.5 - from.z));
    for (let i = 1; i < nodes.length; i++) best = Math.max(best, dist[i]);
    if (nodes.length < 2) return false;
    const good = [];
    for (let i = 1; i < nodes.length; i++) if (dist[i] >= best - 1.5 && nodes[i].depth >= 2) good.push(i);
    if (!good.length) return false;
    mob.path = routeTo(nodes, good[Math.floor(Math.random() * good.length)]); mob.pi = 0; mob.strict = strict;
    return true;
  }

  // ---------- Spawning ----------
  const view = (m) => ({ id: m.id, kind: m.kind, x: r2(m.x), y: r2(m.y), z: r2(m.z), ry: r2(m.ry), hp: m.hp, v: m.v });
  const list = (room) => [...room.mobs.values()].map(view);

  // A valid spawn spot is the grass surface with open sky above it: that rules out water, trees, caves and cave
  // mouths. Returns the height of the feet, or -1.
  function spawnSpot(room, x, z) {
    if (Math.abs(x) > MAX_COORD - 40 || Math.abs(z) > MAX_COORD - 40) return -1;
    if (!natGrass(room, x, z)) return -1;
    const h = natH(room, x, z);
    if (h <= SEA + 1) return -1;
    if (room.blockAt(x, h, z) !== B.GRASS) return -1; // carved away or built over
    const fy = h + 1;
    if (!canStand(room, 2, x, z, fy, true)) return -1;
    for (let y = fy + 2; y < HEIGHT; y++) if (room.blockAt(x, y, z) !== B.AIR) return -1; // under a tree or a roof
    for (const m of room.mobs.values()) if (Math.floor(m.x) === x && Math.floor(m.z) === z) return -1;
    return fy;
  }
  function addMob(room, kind, x, z, fy) {
    const def = MOBS[kind];
    const m = {
      id: room.nextMid++, kind, x: x + 0.5, z: z + 0.5, y: fy, gy: fy, ry: Math.random() * Math.PI * 2, hp: def.hp,
      v: kind === "sheep" ? (Math.random() < 0.82 ? 0 : 1 + Math.floor(Math.random() * (SHEEP_COLORS - 1))) : 0,
      state: "idle", t: 0.5 + Math.random() * 4, lookT: Math.random() * 3, targetRy: 0,
      path: null, pi: 0, strict: true, panic: 0, threat: null, speed: def.speed,
      sx: 0, sy: 0, sz: 0, sry: 0, kx: 0, kz: 0, // kx, kz: knockback velocity (blocks/s)
    };
    m.targetRy = m.ry;
    room.mobs.set(m.id, m);
    room.broadcast({ type: "mspawn", mob: view(m) });
    return m;
  }
  const playersOf = (room) => [...room.clients].map((c) => c.player).filter(Boolean);

  function trySpawnHerd(room) {
    if (room.mobs.size >= MOB_CAP_ROOM) return;
    const ps = playersOf(room);
    if (!ps.length) return;
    const p = ps[Math.floor(Math.random() * ps.length)];
    let near = 0;
    for (const m of room.mobs.values()) if (Math.hypot(m.x - p.x, m.z - p.z) < NEAR_R) near++;
    if (near >= PER_PLAYER) return;
    const ang = Math.random() * Math.PI * 2, d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x0 = Math.floor(p.x + Math.cos(ang) * d), z0 = Math.floor(p.z + Math.sin(ang) * d);
    const fy0 = spawnSpot(room, x0, z0);
    if (fy0 < 0) return;
    const kind = MOB_KINDS[Math.floor(Math.random() * MOB_KINDS.length)];
    const size = 2 + Math.floor(Math.random() * 3); // a herd of 2-4
    addMob(room, kind, x0, z0, fy0);
    for (let i = 1, tries = 0; i < size && tries < 12 && room.mobs.size < MOB_CAP_ROOM; tries++) {
      const x = x0 + Math.floor(Math.random() * 9) - 4, z = z0 + Math.floor(Math.random() * 9) - 4;
      const fy = spawnSpot(room, x, z);
      if (fy < 0 || Math.hypot(x - p.x, z - p.z) < SPAWN_MIN - 4) continue;
      addMob(room, kind, x, z, fy);
      i++;
    }
  }

  function remove(room, mob, dead) {
    room.mobs.delete(mob.id);
    room.broadcast({ type: "mdie", id: mob.id, dead: !!dead });
  }

  // ---------- Damage ----------
  // `from` is the attacker's position {x, z}. `knock` is how hard the animal is pushed away from the attacker (blocks/s:
  // the weapon decides, a weak hit during its cooldown pushes less). Returns true if the animal died.
  function hurt(room, mob, dmg, from, knock) {
    const def = MOBS[mob.kind];
    mob.hp -= dmg;
    if (mob.hp <= 0) {
      remove(room, mob, true);
      if (room.mode === "survival") { // creative has no inventory, so nothing drops
        const n = def.dropMin + Math.floor(Math.random() * (def.dropMax - def.dropMin + 1));
        room.dropItem(def.drop, n, mob.x, mob.y + 0.5, mob.z);
      }
      return true;
    }
    // pushed away from the attacker (it slides, see applyKnock), dazed for a moment, then runs
    let dx = mob.x - from.x, dz = mob.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const v = Number.isFinite(knock) ? knock : KNOCK_DEFAULT;
    mob.kx = (dx / len) * v; mob.kz = (dz / len) * v;
    mob.path = null;
    mob.panic = PANIC_TIME;
    mob.threat = { x: from.x, z: from.z };
    mob.state = "idle"; mob.t = KNOCK_STUN; // plans its escape once the stun is over
    room.broadcast({ type: "mhurt", id: mob.id, hp: mob.hp });
    return false;
  }

  // Slide a knocked-back animal along its push (in small steps so it can't skip through a wall). It only moves onto
  // ground it could walk on, and stops dead at a wall or at the edge of a pit.
  function applyKnock(room, mob, dt) {
    const def = MOBS[mob.kind];
    const n = Math.max(1, Math.ceil((Math.hypot(mob.kx, mob.kz) * dt) / 0.4));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const nx = mob.x + mob.kx * h, nz = mob.z + mob.kz * h;
      const cx = Math.floor(nx), cz = Math.floor(nz);
      if (cx === Math.floor(mob.x) && cz === Math.floor(mob.z)) { mob.x = nx; mob.z = nz; }
      else {
        const fy = stepY(room, def.cells, cx, cz, mob.gy, onSurface(room, mob));
        if (fy === null) { mob.kx = mob.kz = 0; return; }
        mob.x = nx; mob.z = nz; mob.gy = fy;
      }
    }
    const f = Math.exp(-KNOCK_DECAY * dt);
    mob.kx *= f; mob.kz *= f;
    if (Math.hypot(mob.kx, mob.kz) < 0.3) mob.kx = mob.kz = 0;
  }

  // ---------- Behaviour ----------
  function update(room, mob, dt, players, budget) {
    const def = MOBS[mob.kind];
    mob.t -= dt;
    if (mob.panic > 0) mob.panic -= dt;
    if (mob.kx || mob.kz) applyKnock(room, mob, dt);
    let turn = 3;

    if (mob.state === "walk") {
      turn = 8;
      const p = mob.path && mob.path[mob.pi];
      if (!p || !canStand(room, def.cells, p[0], p[1], p[2], mob.strict)) { // arrived, or a block got in the way
        mob.state = "idle"; mob.path = null;
        mob.t = mob.panic > 0 ? 0 : 1.5 + Math.random() * 5;
      } else {
        const dx = p[0] + 0.5 - mob.x, dz = p[1] + 0.5 - mob.z, dist = Math.hypot(dx, dz);
        const step = def.speed * (mob.panic > 0 ? PANIC_SPEED : 1) * dt;
        if (dist <= step) { mob.x = p[0] + 0.5; mob.z = p[1] + 0.5; mob.gy = p[2]; mob.pi++; }
        else { mob.x += (dx / dist) * step; mob.z += (dz / dist) * step; }
        if (dist > 0.05) mob.targetRy = Math.atan2(-dx, -dz); // front is -Z
        if (Math.floor(mob.x) === p[0] && Math.floor(mob.z) === p[1]) mob.gy = p[2]; // stepped onto the next block
      }
    } else { // idle
      // keep feet on the ground: a block may have been placed on it or taken from under it
      const bx = Math.floor(mob.x), bz = Math.floor(mob.z);
      if (!isFree(room.blockAt(bx, mob.gy, bz))) {
        let ny = mob.gy + 1;
        while (ny < mob.gy + 4 && !(isFree(room.blockAt(bx, ny, bz)) && isFree(room.blockAt(bx, ny + 1, bz)))) ny++;
        if (ny >= mob.gy + 4) { remove(room, mob, false); return; } // buried
        mob.gy = ny;
      } else if (!isSolid(room.blockAt(bx, mob.gy - 1, bz))) {
        let y = mob.gy - 1;
        while (y >= 1 && !isSolid(room.blockAt(bx, y, bz))) y--;
        if (y < 1) { remove(room, mob, false); return; }
        mob.gy = y + 1;
      }
      // look around, or at a player who is close
      if ((mob.lookT -= dt) <= 0) {
        mob.lookT = 2 + Math.random() * 3;
        let near = null, nd = 36; // 6 blocks
        for (const p of players) { const d = (p.x - mob.x) ** 2 + (p.z - mob.z) ** 2; if (d < nd) { nd = d; near = p; } }
        if (near && Math.random() < 0.7) mob.targetRy = Math.atan2(-(near.x - mob.x), -(near.z - mob.z));
        else mob.targetRy = mob.ry + (Math.random() - 0.5) * 2;
      }
      if (mob.t <= 0) {
        if (mob.panic > 0 && mob.threat) {
          if (budget.n > 0 || mob.panic > PANIC_TIME - 0.3) { // an animal that was just hit always gets to run
            budget.n--;
            if (planFlee(room, mob, mob.threat)) mob.state = "walk"; else mob.t = 0.4;
          }
        } else if (budget.n > 0) {
          budget.n--;
          if (Math.random() < 0.85 && planWander(room, mob)) mob.state = "walk";
          else mob.t = 1 + Math.random() * 4;
        }
      }
    }

    // turn smoothly, and move the body up or down (a step is a quick hop, a fall is faster)
    const dr = wrap(mob.targetRy - mob.ry), maxTurn = turn * dt;
    mob.ry = wrap(mob.ry + Math.max(-maxTurn, Math.min(maxTurn, dr)));
    if (mob.y > mob.gy) mob.y = Math.max(mob.gy, mob.y - 12 * dt);
    else if (mob.y < mob.gy) mob.y = Math.min(mob.gy, mob.y + 7 * dt);
  }

  // ---------- Main tick (called every 100 ms for every world) ----------
  function tick(room) {
    const now = Date.now();
    const dt = Math.min(MAX_DT, (now - room.mobLast) / 1000);
    room.mobLast = now;
    const players = playersOf(room);
    if (!players.length) return;

    // spawning
    room.mobSpawnT -= dt;
    let tries = 0;
    if (room.mobBurst > 0) { tries = Math.min(3, room.mobBurst); room.mobBurst -= tries; }
    else if (room.mobSpawnT <= 0) tries = 1;
    if (room.mobSpawnT <= 0) room.mobSpawnT = SPAWN_EVERY;
    for (let i = 0; i < tries; i++) trySpawnHerd(room);

    // despawning: far from everyone, the animal is forgotten
    for (const m of [...room.mobs.values()]) {
      let dmin = Infinity;
      for (const p of players) dmin = Math.min(dmin, Math.hypot(p.x - m.x, p.z - m.z));
      if (dmin > DESPAWN_DIST) remove(room, m, false);
    }

    // behaviour
    const budget = { n: PLANS_PER_TICK };
    const out = [];
    for (const m of room.mobs.values()) {
      update(room, m, dt, players, budget);
      if (!room.mobs.has(m.id)) continue; // removed while updating
      const x = r2(m.x), y = r2(m.y), z = r2(m.z), ry = r2(m.ry);
      if (x !== m.sx || y !== m.sy || z !== m.sz || ry !== m.sry) {
        m.sx = x; m.sy = y; m.sz = z; m.sry = ry;
        out.push([m.id, x, y, z, ry]);
      }
    }
    if (out.length) room.broadcast({ type: "mobs", m: out });
  }

  // A fresh world (or one a player just joined) gets animals right away.
  const populate = (room) => { room.mobBurst = BURST_TRIES; };

  return { tick, hurt, list, populate, spawnSpot, canStand, natH };
};
