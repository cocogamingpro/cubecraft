# Cubecraft

**Version 1.12.1 Biome Update Fix**

A tiny multiplayer 3D block game: explore a generated world, then break and place blocks together.

- **Creative** and **Survival** game modes, chosen when you create the world.
- Main menu, game menu, nametags and text chat; the host can **Open World** to get a join code.
- Terrain is generated from a **seed**: oceans, beaches, deserts, grassy hills, rocky mountains and snowy peaks.
- Blocks: grass, dirt, stone, sand, oak log, oak planks, leaves, cobblestone, snow (plus water and bedrock),
  and craftable blocks: crafting table, wooden button, sandstone, stone bricks, **furnace**, **chest**. Sticks are an item.
- **Chests** to store items (27 slots, shared by everyone in the world), and **dropping items** on the ground with Q.
- **Caves** under the ground (tunnels and chambers, some opening to the surface), with minerals showing on their walls.
- **Minerals** hidden in the rock: coal, iron and diamonds (see *Minerals, furnace and tools* below), and wooden,
  stone, iron and diamond tools and **swords**.
- Oak **trees** grow in forests and scattered through grassland.
- A **day and night cycle**: 10 minutes of day, 10 minutes of night, with a sun, a moon and stars crossing the sky from
  east to west, orange sunrises and sunsets, and a dark (but never black) moonlit night. Craft **torches** to light it up.
- **Animals**: pigs, cows and sheep wander the grasslands with their own AI. Hit them for meat, cook it in a furnace
  and eat it: survival also has a **hunger bar** (see *Animals* and *Hunger and food* below).
- **Farming** (1.9): **tall grass** grows on some grass blocks and sometimes drops **seeds**. Make a **hoe**, till the ground into
  **farmland**, plant the seeds, keep them near **water** and harvest **wheat** after 10 minutes. Wheat makes **bread**. See *Farming and water*.
- **Flowing water** (1.9): water spreads, falls and dries up, and a **bucket** (3 iron ingots) picks it up and puts it down again.
- **Building** (1.10): **stairs** (that turn into corners next to each other), **slabs**, **ladders**, **trapdoors** and **doors**, all made of
  planks (ladders of sticks). Where you click and which way you look decides how they are placed. See *Building*.
- **Biomes** (1.11): plains, forests, deserts, snowy lands, mountains, beaches and oceans, each with its own surface, trees, plants, colours and animals.
  New worlds have them; worlds made before keep their old terrain. See *Biomes*.
- The world is endless on x/z (up to ±30,000 blocks) and streams in around you.
- **Saved worlds**: every person can keep up to **3 worlds**. They are saved automatically, and the game remembers every
  player who joined (name, position, items, health, hunger). See *Saved worlds* below.

## Project layout

    server.js            Node server (Express + WebSocket)
    mobs.js              Animals: spawning, AI and pathfinding (server only, lives next to server.js)
    farming.js           Flowing water, wet farmland and growing wheat (server only, lives next to server.js)
    biomemap.js          Development tool: draws a PNG map of the biomes of a seed (the game doesn't use it)
    public/index.html    The game (Three.js client)
    public/worldgen.js   Seeded world generator, shared by the server and the browser
    package.json
    render.yaml
    data/worlds/*.json   The saved worlds (created by the server; set DATA_DIR to put them somewhere else)

Keep `index.html` and `worldgen.js` together: the browser loads `worldgen.js` directly and the server
`require`s it. The `public/` folder is the intended place, but if you upload everything flat (all files
next to `server.js`) the server detects that and still works. Both run the same code, so the same seed gives the same world everywhere. Only the seed and
player changes are sent over the network, not the terrain.

## Run locally

    npm install
    npm start

Open http://localhost:3000 in two browser tabs: create a world in one, press Esc and click Open World,
then join from the other tab with the code.

## Saved worlds

The main menu lists **your worlds** (up to **3**). Press **Play** to go back into one, or **Delete** (click twice) to throw
one away and free the slot. When you have 3, the *Create a new world* form disappears until you delete one.

- **Who is "you"?** There are no accounts. Your browser keeps a random key (in `localStorage`) and the server recognises
  your worlds by it, so you see the same worlds every time you open the site **from the same browser**. Clearing the
  browser's site data, or using another browser or device, makes you a new person. (Only a hash of the key is stored.)
- **What is saved:** the seed and game mode, every block that was changed, furnaces, chests, items lying on the ground,
  the day/night clock, and, for **every player who ever joined**, their name, colour, position, health, hunger,
  inventory and selected hotbar slot. Animals are not saved: they spawn again around you.
- **Players are remembered by name.** Friends who join your world with the code come back with their stuff and at the
  spot where they left, when they join again with the same name from the same browser. A name belongs to the person who first
  used it in that world: someone else typing it gets an error, so nobody can take over another player's items. (Each world
  remembers up to 60 different players.)
- **Dying:** if you leave while dead you come back alive at the world's spawn area, with your items.
- **When it saves:** every 20 seconds while the world is running, every time someone leaves, and when the server is shut
  down or redeployed.
- Opening the same world in two tabs: the newer tab takes over and the older one is sent back to the menu.
- Deleting is only possible while nobody is playing that world.
- Only the person who made a world can pick it from the menu. Friends reach it through the **code** the host gets with
  **Open World** (a world is only reachable while its owner has it running).
- Creative-mode hotbar choices are kept in the browser, not in the world, so they are not saved.

**Where the files are:** `data/worlds/<id>.json`, one per world (`DATA_DIR` environment variable to change the folder).
On a host whose disk is wiped on every restart, the saves are wiped with it: see *Deploy* below.

## How playing together works

1. **Main menu**: type your name, then either
   - **Create a new world** (give it a name; leave the seed empty for a random world),
   - press **Play** on one of your saved worlds, or
   - enter a friend's 6-character code and press **Join**.
2. Press **Esc** in the game to open the **Game menu**. As the host, click **Open World**: a code such as
   `K7MQ2X` appears. Send it to your friends; they type it into the *Join a friend* box on the main menu.
3. **Close World** stops new players from joining (people already inside stay). Only the host can open or
   close the world. If the host leaves, the player who has been there longest becomes the new host.
4. Everyone gets a **nametag** floating above their head. Press **T** (or Enter) to **chat**; Enter sends,
   Esc cancels. Join/leave messages also appear in the chat.

Each world has its own seed (shown in the Game menu) and is saved to disk when the last player leaves.
Up to 20 worlds with 12 players each can run at once, and the server keeps at most 300 saved worlds.

## Game modes

Pick the mode in the *Game mode* box when you create a world. Everyone who joins plays in the world's mode.

**Creative**: unlimited blocks, every block breaks instantly, no damage. Double-tap **Space** to fly
(Space up, Shift down, double-tap again to stop). Bedrock can never be broken.

**Survival**: you have 10 hearts and die at 0, then click **Respawn** (you keep your items).
- Damage: falling (the first 3 blocks are free, then half a heart per block), drowning (you can hold your
  breath for 10 s, then lose a heart per second), hits from other players (1 heart bare-handed, more with a sword or axe; left click; see *Combat* below) and
  **starvation** (see *Hunger and food*). Hearts slowly **regenerate** while you are well fed.
- **Hold left click** to mine. Harder blocks take longer: leaves and snow are quick, wood and planks slower,
  cobblestone and stone slowest. The block goes into your inventory (stone gives cobblestone).
- Your hotbar is the first row of your inventory. Placing a block uses one up; you start with nothing.
  Press **E** to open your inventory and craft (see *Inventory and crafting* below).

Health and inventory are kept by the server and saved with the world (see *Saved worlds*).
Mining time, items and punches are checked on the server. Fall and drowning damage are reported by the
player's browser, which is fine for friends but not cheat-proof.

## Inventory and crafting

Press **E** to open your inventory (E or Esc closes it).

**Survival inventory:** 27 slots (3 rows of 9) plus the 9-slot hotbar. There are no fixed hotbar blocks any more:
whatever you pick up goes into the first free spot, starting with the hotbar from the left, then the top-left of the
inventory, row by row. Items of the same kind stack (64 max; tools don't stack).
- Click an item to pick it up, then click another slot to move it (stacks merge, different items swap).
- **Shift-click** sends a stack to the other half (hotbar <-> inventory).
- Hover an item and press **1-9** to swap it with that hotbar slot.
- Right-click anywhere (or click the same slot again) to put an item back down.

**Full inventory:** an item that doesn't fit drops on the ground. Walk over it to pick it up again, as long as you have
room. (You can also drop items on purpose with **Q**, see *Chests and dropping items*.) Items on the ground disappear after 5 minutes, and a world keeps at most 200 of them.

**Mining:** stone gives **cobblestone**. The right tool makes mining faster: a pickaxe for stone, cobblestone,
stone bricks, sandstone, ores and furnaces; an axe for wood, planks and crafting tables; a shovel for dirt, grass,
sand and snow. The better the material, the faster: wooden 2x, stone 4x, iron 6x, diamond 8x.
(Tools don't wear out yet.)

**Crafting** works in the 2x2 grid of your inventory, and in a 3x3 grid when you **right-click a crafting table**
(hold **Shift** while right-clicking to place a block against the table instead).
- Click an item to pick it up, then click a crafting cell to put one in. Right-click a cell to empty it. Or just click a
  recipe in the list to fill the grid for you (recipes you can't afford yet are dimmed).
- Click the result to craft once, **Shift-click** it to craft as many as you can.
- Nothing leaves your inventory until you take the result, and the server does the swap, so nothing is lost if you
  close the screen or disconnect. A result that doesn't fit drops at your feet.
- Recipes work in any position, and the axe may be mirrored, like Minecraft.

| Result | Ingredients | Grid |
| --- | --- | --- |
| 4 Oak planks | 1 Oak log | 2x2 |
| 4 Spruce planks | 1 Spruce log | 2x2 |
| 4 Sticks | 2 planks, one above the other | 2x2 |
| Crafting table | 4 planks (2x2) | 2x2 |
| Wooden button | 1 planks | 2x2 |
| 4 Torches | 1 Coal, with 1 Stick below it | 2x2 |
| Sandstone | 4 Sand (2x2) | 2x2 |
| 4 Stone bricks | 4 Stone (2x2) | 2x2 |
| Wooden pickaxe | 3 planks in a row, 2 Sticks below the middle one | crafting table |
| Wooden axe | 2 planks on top, 1 planks + 1 Stick below them, 1 Stick under that | crafting table |
| Wooden shovel | 1 planks, 2 Sticks below it | crafting table |
| Wooden sword | 2 planks, one above the other, 1 Stick below them | crafting table |
| Chest | 8 planks in a ring (the middle stays empty) | crafting table |
| Furnace | 8 Cobblestone in a ring (the middle stays empty) | crafting table |
| Wooden hoe | 2 planks side by side on top, 2 Sticks below one of them (left or right) | crafting table |
| Stone / Iron / Diamond hoe | same shape, with Cobblestone / Iron ingots / Diamonds | crafting table |
| Bucket | 3 Iron ingots in a V (two on top with a gap, one in the middle below) | crafting table |
| Bread | 3 Wheat in a row | crafting table |
| Oak stairs (4) | 6 Oak planks in a staircase: 1 in the top row, 2 in the middle, 3 in the bottom row (or the mirror image) | crafting table |
| Oak slabs (6) | 3 Oak planks in a row | crafting table |
| Oak trapdoors (2) | 6 Oak planks, 3 wide and 2 high | crafting table |
| Oak doors (3) | 6 Oak planks, 2 wide and 3 high | crafting table |
| Spruce stairs / slabs / trapdoors / doors | the same shapes as the oak ones, made of **Spruce planks** (4 / 6 / 2 / 3) | crafting table |
| Ladders (3) | 7 Sticks in an H: a column of 3 on each side and 1 in the middle | crafting table |
| Stone pickaxe / axe / shovel / sword | same shapes as the wooden tools, with Cobblestone instead of planks | crafting table |
| Iron pickaxe / axe / shovel / sword | same shapes, with Iron ingots | crafting table |
| Diamond pickaxe / axe / shovel / sword | same shapes, with Diamonds | crafting table |

## Farming and water

**Tall grass.** Short plants grow scattered over the grass blocks of the world (never on sand, stone or snow, and never on all
of them: there are thick meadows and bare lawns). You walk straight through them, and **breaking one is instant**. Each one has a
**1 in 10 chance** to drop a **wheat seed**. You can build a block straight into tall grass: it is replaced.

**Hoe → farmland.** Craft a hoe (see the table; wood, stone, iron or diamond, they all work the same: tools don't wear out). **Right-click**
grass or dirt that has air (or tall grass) above it: it becomes **farmland**, with furrows. Mining farmland, wet or dry, only gives **dirt**.
A block placed on top of farmland squashes it back into dirt.

**Wet farmland.** Farmland turns into **wet farmland** (darker) when a **water source** is within **4 blocks** of it sideways
(and up to 1 block above or below). Take the water away and it dries out again. Only still water (a source: a lake, the sea or a
poured bucket) counts, not water that is just flowing.

**Planting and growing.** **Right-click farmland with seeds** to plant one. Wheat then grows for **10 minutes** (`FARM.GROW_TIME` in
`worldgen.js`), but **only while the soil is wet**: on dry farmland the clock stops and carries on when water is back. It has 4 looks:
just planted, **33%** grown, **66%** grown and **fully grown** (golden, with heads). It keeps growing as long as the world is running
(like in Minecraft it does not grow while nobody is in the world), and every plant's progress is saved with the world.

**Harvesting.** Breaking **fully grown wheat** gives **1 wheat and 2 seeds**. Breaking it too early gives your seed back. Dig up the farmland under
a plant and the plant pops off (and gives what breaking it would). Wheat is not trampled by walking.

**Bread.** 3 wheat in a row (crafting table) make 1 **bread**. Hold right click to eat it like any food: it restores **2.5 drumsticks**, which
is better than raw meat (1 to 1.5) and not as good as cooked meat (3 to 4).

**Bucket.** Craft it from 3 iron ingots. **Right-click a water source** with an empty bucket to scoop it up (the bucket
becomes a **water bucket**; empty buckets stack to 16, full ones don't stack). **Right-click a block** with the water bucket to pour a **water source**
into the space in front of it. Only still water can be scooped, not flowing water. In **creative** the buckets never run out.

**Flowing water.** Water is no longer frozen in place. It is worked out by the server a few times a second:
- A **source** spreads sideways as **strength 1**, flowing water spreads on one weaker, **7 blocks** at most. The weaker, the lower the water looks.
- Water **falls** into empty space below it, so you get waterfalls and can fill a shaft. Where falling water lands it spreads out again.
- Water that has nothing solid under it falls instead of spreading, and it flows **around** solid blocks, never through them.
- **Two sources side by side** with a floor under the gap make a **new source** (like Minecraft), so a pond can't be emptied by scooping up one block.
- **Take the source away and the flow dries up** by itself.
- You can build into flowing water. You swim in it (it only slows you down, it does not push you).
- The sea and lakes do not flow by themselves: they only start when something next to them changes (dig a ditch next to the sea
  and water runs in). A trench next to a field is the usual way to irrigate it: put the source in a hole **at the level of the farmland** so the
  flow doesn't cover the farmland itself (flowing water only goes into empty blocks, so it can't wash plants away, but it can stop you from planting).

All the numbers are in `worldgen.js` (`FARM`, the recipes, `FOOD`) and in `farming.js` (water speed and limits).

## Biomes

The terrain is no longer one big meadow with a desert here and there. A slow **temperature** and a slow **humidity** pattern (neither follows the hills) decide what kind of land you are
in, and the height decides the rest. The **HUD** line at the top (XYZ ...) now says which biome you are standing in.

| Biome | What it is | Surface | Trees and plants | Animals |
|---|---|---|---|---|
| **Plains** | gentle low hills, the grassiest land | grass | a few oaks, lots of tall grass, **flowers** (poppies and dandelions in patches) | pigs, cows, sheep |
| **Forest** | wet land | grass | **dense oak forests**, some flowers, less tall grass | more pigs, fewer cows and sheep |
| **Desert** | hot and dry, flatter with low dunes | sand on top, then 4 layers of **sandstone** | **cacti** (1 to 3 high, never side by side), **dead bushes**, no grass | none |
| **Snowy** | cold land | **snowy grass** on dirt, cold lakes and seas are **frozen** on top (ice) | **spruces** (tall narrow cones) | sheep and a few cows (no pigs) |
| **Mountains** | high ground (the same as before: rock, snow at the top; the snow starts lower in the cold and higher in the heat) | stone, snow | none | none |
| **Beach**, **Ocean** | at and under sea level | sand, dirt or sand on the sea floor | none | none |

Roughly, of the land: plains 31%, forest 26%, desert 13%, snowy 15%, mountains 8%, beaches 8%. A biome is typically a few hundred blocks across, with ragged borders; the hills change smoothly from one to
the next (no cliffs at the borders), and so do the **colours**: the grass, the leaves and the water have a slightly different green in every biome (a warm yellow-green in the plains, a deep green in the forest,
dry in the desert, cold in the snow), and the **fog and the horizon** take a hint of the biome you are in, slowly, as you walk.

New things:
- **Cactus.** It pricks you for **half a heart** (at most twice a second) when you touch it, so walking into one hurts; you can die from it. It is a bit thinner than a block. It only grows on **sand** (put one on sand, or on top of another cactus);
  break the bottom one and the ones above fall off. A cactus drops itself. Water doesn't wash it away.
- **Flowers** (poppy, dandelion) and **dead bushes.** Walk-through, break at once. A flower drops itself and can be planted on grass or dirt; a dead bush gives 0 to 2 sticks and can only stand on sand or dirt. They pop off when the ground under them goes.
  Like tall grass they are replaced when you build into them, and a hoe tramples them.
- **Ice.** Cold water is covered with a layer of ice. It is a whole block; breaking it leaves nothing, and puts the water back if it froze over water.
- **Spruce logs and leaves.** A spruce log gives a **spruce log** (you can make spruce planks from it, see *Building*), spruce leaves give ordinary leaves.
- **Snowy grass** gives dirt; a hoe can turn it into farmland, and animals appear on it.
- Creative has all of these in its block list.

**World versions.** Each world remembers which generator made it. Worlds created before this update (or saved without a version) keep their **exact old terrain**, so nothing moves under your buildings; they only
gain the HUD biome name. New worlds get biomes. (The version is stored as `gen` in the world's save file: `1` = before biomes, `2` = with biomes. A made-up value counts as 1.)

**Looking at a seed.** `node biomemap.js <seed> [pixels] [blocks per pixel] [centre x] [centre z] [file.png]` draws a map (ocean blue, beach pale, plains light green, forest dark green, desert yellow, snowy white, mountains grey) and
prints how much of the land each biome covers, e.g. `node biomemap.js farm-test 800 8`.

All the numbers (where the biomes start, their colours, which animals they have) are in `worldgen.js` (`CLIMATE`, `BIOME_INFO` and `column2`).

## Building

**Oak and spruce.** The wood is called **Oak log** / **Oak planks** (it used to be "Wood") and there is a darker **Spruce log** (from the spruces of the snowy lands) with **Spruce planks**. One log makes 4 planks.
Stairs, slabs, trapdoors and doors come in **both woods**, with their own darker textures; spruce planks work wherever oak planks are asked for (sticks, a crafting table, tools, a chest...), but stairs, slabs, trapdoors and doors need
**planks of one wood only** (6 oak planks make oak stairs, 6 spruce planks spruce stairs, mixed planks make nothing). Stairs of different woods join into corners like stairs of the same wood, but two **slabs** only merge into a whole
block of planks if they are the **same wood**.

All of these are made of planks (the ladder of sticks), are mined fastest with an axe, and give themselves back whichever way they stand.
The way they stand is decided when you place them, by **where you click** and **which way you look**.

**Stairs.** Click the **lower half** of the side of a block and you get a normal stair; click the **upper half** (or the underside of a block above you)
and it is **upside down**. On the ground it is a normal stair. The high side is **the way your body is facing**. When you put two stairs next to each other that
face different ways, one of them **bends into a corner**, as in Minecraft: if the stair in front of it faces sideways, only one quarter at the back stays high (an outer corner);
if the stair behind it faces sideways, the back half plus one more quarter stays high (an inner corner). Stairs facing the same way, or opposite ways, stay straight.
Seen from above, with the high parts as `1` and the low parts as `0` (rows from north to south):
```
11    10        11   10          10    11        11   11
00    10   ->   00   00          10    00   ->   10   00
(a stair facing north next to one facing     (a stair facing west next to one facing
west: the right one bends: outer corner)     north: the left one bends: inner corner)
```
The shape is worked out from the stairs around it every time, so breaking a neighbour straightens the other stair again, and everybody sees the same.
You walk up stairs and slabs just by walking (you step up anything up to 0.6 blocks high; a whole block still needs a jump).

**Slabs** (half blocks). Click the **upper half** of a block's side (or under a block) for a **top slab**, the lower half or the ground for a **bottom slab**.
Put the other half into the same block (click the top of a bottom slab, or the underside of a top slab) and the two **make a whole block of planks**.

**Ladders.** Only on the **side of a whole block**, and they need that block: **break the block and the ladder breaks too** (you get it back). Climb with **Space or W**
(the same physical key as **Z** on an AZERTY keyboard) and **if you press nothing you slide down**. Keep climbing at the top to get over the edge. Holding a ladder ends a fall.

**Trapdoors.** A quarter of a block thick. Like slabs there are only two places: the **lower** part or the **upper** part of the block (the half you click, or the top / bottom for
the ground / ceiling). **Right-click to open and close** them: an open one stands up against the edge it is hinged on (the wall you clicked, or the far side if you clicked the ground
or ceiling).

**Doors.** Two blocks high and a quarter of a block thick. Aim at a block and the door is put in the space in front of the face you click (on top of the block if you click the top), on the
**edge of that space that is nearest to you**, so you choose the side by where you stand. It needs something solid under it and 2 free blocks. **Right-click either half to open and close it**
(the hinge is on your left when you place it; open, it lies along that side). Break either half and the whole door goes (you get one door); dig away what it stands on and it pops off.
Hold **Shift** while right-clicking a door or trapdoor to build against it instead of opening it.

Details: a closed door or trapdoor stops you, an open door can be walked through (it is thinner for walking, 3/16, than it looks, so you fit through a doorway), and if a door
shuts on you you can walk out of it. Water doesn't flow into stairs, slabs, ladders, trapdoors or doors. Torches and buttons need a **whole** block to stick to, not a slab or stair.

## Day and night

A day is **20 minutes**: **10 minutes of daylight** and **10 minutes of night**. A new world starts one minute after sunrise.
The server keeps the clock, so everyone in a world sees the same sky (the top of the screen shows *Day 1: 7:42 to sunset*).
- The **sun** rises in the **east** (+X), crosses the sky and sets in the **west** (-X). The **moon** and the **stars**
  (white pixels) do the same during the night: they rise in the east and set in the west.
- **Sunrise and sunset** turn the sky and the distance orange for about a minute, with the sun low and orange.
- **At night** the sky is deep blue and the world is dark but never black: you still see the terrain by moonlight (a high
  moon gives a little more light). Players and animals get darker too.
- The cycle never stops and has no sleeping. The clock is saved with the world and carries on from the same time when it is loaded again.
- All of it is tuned in `worldgen.js`: `DAYNIGHT` (lengths of day and night, the time a new world starts at) and
  `SKY_COLORS` (sky colours and how dark the night is, `nightTint`: bigger numbers = brighter nights).

## Torches

**Craft** 4 torches from **1 coal with 1 stick below it** (a 2x2 recipe, no crafting table needed). Coal comes from coal ore.
- A torch **stands on the floor or leans on a wall**, never hangs from a ceiling. It pops off (and comes back to you in
  survival) when the block it stands on is removed. You walk through torches.
- It **lights up the area around it** with warm light, up to about **9 blocks**. The light goes around corners but **not
  through walls**, so a torch in a closed room lights only that room, and a hole in the wall lets the light out.
- Torch light is easy to see at night and in caves, and only a faint glow by day.
- A torch breaks almost instantly. In Creative it is one of the blocks you can pick.

## Animals

**Pigs, cows and sheep** live in every world (Creative and Survival).
- They spawn in small herds on **grass** with open sky above them, a little way from the players. Never in water, on or
  under trees, or in caves and cave mouths, and they never walk into water or down into caves and pits either.
  They are generated around the players as you explore, and forgotten again when you are far away
  (at most 48 per world).
- Each one has its own **AI**: it stands around and looks about (sometimes at a player who is close), now and then
  picks a spot nearby and walks the shortest route there (up or down one-block steps), and **runs away** when hit.
  The server runs the animals; everyone in the world sees them in the same place.
- **5 hearts** each. In survival a bare-handed punch (left click) does 1 heart, so 5 hits kill one; swords and axes do more, and hitting an animal knocks it back (see *Combat*). In creative one punch is enough
  and nothing drops.
- Drops (1-2): the pig drops a **raw pork chop**, the cow **raw beef** and the sheep **raw mutton**.
- All the numbers (health, speed, size, drops) are in `worldgen.js` (`MOBS`); spawning and AI settings are at the top of
  `mobs.js`.

## Hunger and food

Survival has a **hunger bar** of 10 drumsticks next to your hearts (20 points, 2 per drumstick).
- It goes down when you **walk** (a little), **run** (more), take **damage**, and **regenerate hearts**.
- While you have **6 drumsticks or more**, your hearts come back: half a heart every 3 seconds, each one costing
  hunger. Below that you no longer regenerate.
- With **3 drumsticks or fewer** (the bar pulses) you **can't run** any more, only walk.
- At **0** you are starving and take half a heart every 4 seconds, which can kill you.
- **Eat** by holding **right click** with food in your hand for 1.6 seconds (a small bar shows the progress).
  Respawning gives you full hunger again (you keep your items).

| Food | Restores | Where from |
| --- | --- | --- |
| Raw pork chop | 1.5 drumsticks | pig |
| Cooked pork chop | 4 drumsticks | cook a raw pork chop |
| Raw beef | 1.5 drumsticks | cow |
| Steak | 4 drumsticks | cook raw beef |
| Raw mutton | 1 drumstick | sheep |
| Cooked mutton | 3 drumsticks | cook raw mutton |

**Cooking** is smelting: put the raw meat in the top slot of a **furnace**, add fuel, and it comes out cooked after
10 seconds per item (see *Minerals, furnace and tools*). The hunger numbers are in `worldgen.js` (`HUNGER`, `FOOD`).

## Combat

Hit another player or an animal with **left click** (survival; in creative you can only hit animals, and one hit is enough).
Weapons have a **damage**, a **cooldown** and a **knockback**.

**Cooldown.** After every hit your weapon recharges (a small bar under the crosshair fills up and disappears when you
are ready). You *can* hit again before it is full, but the hit is **weaker**: with no charge at all it does only 20% of the
damage and pushes much less, and the damage grows smoothly as the bar fills. Clicking like crazy therefore never beats
good timing, and you can't swing faster than about a third of the cooldown anyway. The recharge is shared by everything
you hold: switching from the axe to a sword right after a hit does not give you a free full-power hit.

**Axe vs sword.** The axe hits harder than the sword of the same material (2 hearts more) and pushes further, but it needs
**twice as long** to recharge. A sword wins a long fight with fast, steady hits; an axe is for one big hit that takes half a
player's health or kills an animal at once (iron and diamond).

| Weapon | Damage per full hit | Cooldown | Hits to kill an animal (5 hearts) | Hits to kill a player (10 hearts) |
| --- | --- | --- | --- | --- |
| Bare hands | 1 heart | 0.4 s | 5 | 10 |
| Wooden sword | 2 hearts | 0.5 s | 3 | 5 |
| Stone sword | 3 hearts | 0.5 s | 2 | 4 |
| Iron sword | 4 hearts | 0.5 s | 2 | 3 |
| Diamond sword | 5 hearts | 0.5 s | 1 | 2 |
| Wooden axe | 3 hearts | 1.0 s | 2 | 4 |
| Stone axe | 4 hearts | 1.0 s | 2 | 3 |
| Iron axe | 5 hearts | 1.0 s | 1 | 2 |
| Diamond axe | 6 hearts | 1.0 s | 1 | 2 |

(Pickaxes, shovels, blocks and food hit like bare hands.) Damage can be a fraction of a heart, so a weak hit may only
take a part of a heart: the hearts show your health rounded up.

**Knockback.** A hit pushes the target away from you and makes it hop a little. A player slides about 1.4 blocks (hands),
1.8 (sword) or 2.2 blocks (axe) at full charge, less for a weak hit; a wall stops the slide. Animals are pushed the same way,
but never off a ledge into a pit or through a wall, and they are dazed for a moment before they run away. Your own browser
moves you when you are hit (the server tells it how hard and which way), like falling and drowning damage.

**Red when hit.** When a player takes damage, everybody sees that player's body turn **red** for 0.4 seconds (animals turn
red too). You see a red flash over the screen and the camera shakes a little.

All of the numbers are in one place, `worldgen.js`: `SWORD_DAMAGE`, `AXE_DAMAGE` and the `ATTACK` table (cooldowns,
knockback speeds and distances, how weak an early hit is, how long you stay red). The server and the browser share them.

## Caves

The ground is hollowed out by **caves**, generated from the world seed (the same in Creative and Survival, and the same
for every player).
- Long winding **tunnels**, usually wide and tall enough to walk through, and a few bigger **chambers**. Many are linked
  together into large systems; some break through to the surface in a few places (look for dark holes in hills).
- They run from just under the surface down to the layer above the bedrock. Bedrock and the floor above it are never
  carved, and **seas, lakes and beaches keep a thick roof**, so water is never broken into.
- Caves cut through stone, so **ores show up on their walls**: that is the easiest way to find coal, iron and diamonds.
- **Underground is darker.** The deeper a spot is below the natural ground, the darker it looks (down to about half
  brightness), and at night darker still. This also applies to pits you dig. Put up **torches** to see (see *Torches*). To change it, edit `DARK_MIN` in `index.html`
  (1 = no darkening).
- You can change how many caves there are in `worldgen.js` (`TUNNEL` = tunnel width, `ROOM` = chamber size,
  `ENTRANCE` = how often caves open to the sky).
- In survival, careful: falling into a cave hurts (see *Damage*).

## Chests and dropping items

**Chest:** craft it from 8 planks (oak or spruce) at a crafting table, place it, then **right-click it** (hold **Shift** to place a
block against it instead). The screen shows the chest's **27 slots (3 rows of 9) above your whole inventory** (27 slots +
hotbar), so you can move things in both directions:
- Click a stack to pick it up, then click a slot (in the chest or in your inventory) to put it there. Stacks of the same
  item merge, different items swap. Click the same slot again to put it back.
- **Shift-click** a stack to send it to the other side (inventory -> chest, chest -> inventory).
- Hover a slot and press **1-9** to swap it with that hotbar slot.
- A chest is shared by everyone in the world: if a friend has it open too, you see their changes live. You must stay
  within reach of it; walk away and the screen closes.
- Breaking a chest drops everything that was in it, and you get the chest back. Its contents are kept by the server only
  (like furnaces and inventories) and are saved with the world.
- Chests are for **survival**: Creative has no inventory slots, so a chest there is just a block.

**Dropping items (Q):** press **Q** to throw the item in your hand (the selected hotbar slot), one at a time (hold it to
keep dropping); **Shift+Q** throws the whole stack. In the inventory or chest screen, hover one of your slots and press
**Q** (or **Shift+Q**) to drop from it. (It is Q, like in Minecraft, because **A** is already "move left". To use another
key, change `DROP_KEY` in `index.html`.)
- The item flies about 2 blocks in front of you and lands there (less if there is a wall). **Every player in the world
  sees it** on the ground, and anyone can pick it up.
- **To pick an item up you have to walk up close to it** (about 1.5 blocks), and you need room for it in your inventory.
  A thrown item can't be picked up for about 1.5 seconds, so you don't grab it straight back.
- Items on the ground disappear after 5 minutes, and a world keeps at most 200 of them.

## Minerals, furnace and tools

**Minerals** are found underground and are the same in Creative and Survival (they come from the world seed). They are
fairly rare: dig straight down and about 1 hole in 8 reveals coal, 1 in 12 iron, and only about 1 in 100 diamonds (near the
bedrock). The easy way to find them is to look at the walls of **caves** (see *Caves* above). Each mineral spawns in small veins:

| Mineral | Where | Biggest vein | You get | Mined with |
| --- | --- | --- | --- | --- |
| Coal ore | close to the surface | 12 blocks | Coal (fuel) | anything (a pickaxe is faster) |
| Iron ore | medium depth, between the surface and the bedrock | 8 blocks | Raw iron (smelt it) | anything (a pickaxe is faster) |
| Diamond ore | right above the bedrock | 8 blocks | Diamond (use it as it is) | **iron or diamond pickaxe only** |

Without the right pickaxe a diamond ore block simply can't be broken (the game tells you what you need).
Veins of the same mineral never touch each other, so a vein is never bigger than the maximum above.

**Furnace:** craft it from 8 cobblestone at a crafting table, place it and **right-click it** (hold **Shift** to place
a block against it instead). It has an input slot (top), a fuel slot (bottom) and a result slot.
- Smelts **raw iron into iron ingots** and **cobblestone into stone**, and **cooks raw meat** (pork chop, beef, mutton),
  one item at a time, **10 seconds** each. (Diamonds don't need smelting.)
- Fuel: **1 coal smelts 8 items**, **1 log 4** (oak or spruce), **1 planks 1**. The fuel is used when an item starts smelting,
  and whatever it has left over is kept for the next items.
- Click an item in your inventory, then click the furnace slot (or shift-click the item: it goes to the right slot by
  itself). Click a furnace slot to take everything out of it. If your inventory is full the items stay in the furnace.
- Furnaces are shared by everyone in the world and **keep working while nobody is looking at them**, even if you walk
  away. Breaking a furnace drops what is inside it.

**Tools:** stone tools are made from cobblestone and sticks, iron tools from iron ingots and sticks, diamond tools from
diamonds and sticks (same shapes as the wooden ones, see the table). Raw iron has to be smelted into ingots first.

**Swords and axes** are weapons (see *Combat* below). Swords don't mine faster; axes still chop wood faster.

The recipes, the smelting rules and the ore generation are all in `worldgen.js` (`RECIPES`, `SMELT`, `FUEL`,
`ORES`), so you can tune them in one place.

**Creative** has no crafting and no inventory slots. E shows every block so you can choose what goes in your hotbar
(click a block, then a hotbar slot; or hover it and press 1-9).

**Buttons** are small and you walk through them. They stick to a neighbouring block (walls first, then floor, then
ceiling) and pop off back to you if the block they hang on is removed.

The recipes live in `worldgen.js` (`RECIPES`), so the server and the browser use the same list.

## Deploy (GitHub + Render)

1. Create a new GitHub repo and push this folder to it:

       git init
       git add .
       git commit -m "Cubecraft"
       git branch -M main
       git remote add origin https://github.com/YOUR_USER/block-platform.git
       git push -u origin main

2. On https://render.com: New + > Web Service > connect the repo.
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
   (Or choose New + > Blueprint, which reads `render.yaml` automatically.)

3. When the deploy finishes, open your `.onrender.com` URL and share it.

**Saved worlds need a disk that survives restarts.** Render's *free* instances have no persistent disk: everything the
server writes is lost when it sleeps (after ~15 minutes without traffic), restarts or redeploys. That is why `render.yaml`
uses the **Starter** plan with a 1 GB disk mounted at `/var/data` and sets `DATA_DIR=/var/data`. If you prefer to stay on the
free plan, remove the `disk` and `DATA_DIR` lines and set `plan: free`: everything works, but saved worlds only last
until the next restart. Any other host works too, as long as `DATA_DIR` points to a folder that is kept.

## Controls

W A S D move, Space jump (or swim up), Shift run, left click break (or hit an animal / player: swords and axes hit harder, wait for the bar under the crosshair to hit at full power), right click place,
hold right click to eat the food in your hand (or place torches: right click),
1-9 or mouse wheel to pick a hotbar slot, E inventory / crafting, right-click a crafting table for the 3x3 grid,
right-click a furnace to smelt, right-click a chest to store items, Q drop the item in your hand, T chat, Esc game menu.
**Right-click a door or trapdoor** to open or close it; with **stairs, slabs, ladders, trapdoors or doors** in hand, right-click a block to place them (aim at the upper or lower half
of its side to choose the half). With a **hoe** right-click grass or dirt to till it, with **seeds** right-click farmland to plant, with an **empty bucket** right-click water to scoop it,
with a **water bucket** right-click a block to pour.

## Notes

- Caves and minerals come from the seed too (same seed = same caves and ore veins). Caves cost a little extra when new
  terrain loads, so a very weak computer may want a lower `RENDER_DIST`. Furnace and chest contents are kept by the server and saved with the world.
- Terrain is regenerated from the seed, so only player edits are stored (capped at 40,000 changes per world). A world is
  kept in server memory while someone is in it and written to its save file; when the last player leaves it is saved and
  removed from memory. Saves are written to a temporary file first and then renamed, so a crash can't leave a half-written save.
- Render's free tier sleeps after ~15 minutes without traffic; the first visit afterwards takes ~30-60 s to wake up.
- If the game runs slowly on a weak computer, lower `RENDER_DIST` at the top of the script in `public/index.html`.
- Day and night is drawn by the browser from the clock the server sends (`time` messages), and torch light is worked out
  when each piece of terrain is built, so lots of torches in one place cost a little extra when that area loads.
- Animals are only kept in server memory (they are not saved and spawn again when a world is loaded) and the server needs
  `mobs.js` next to `server.js`, also in the flat upload layout. A world with many players and wide exploring costs more
  CPU; lower `MOB_CAP_ROOM` in `mobs.js` if the free tier struggles.
- Hunger, health, eating, hit damage and the weapon cooldown are decided by the server; walking and running distance is reported by the player's
  browser, which is fine for friends but not cheat-proof. So is knockback: the server tells the hit player's browser to move.
- Water flow and crop growth are run by the server (`farming.js`, which has to sit next to `server.js`, also in the flat upload layout).
  A world with a huge flood costs a little CPU: flowing water is limited to a few hundred blocks per step, and every changed block counts toward
  the world's 40,000-edit cap. Flowing water, wet farmland and wheat stages are saved as ordinary block changes.
- Not in 1.11 yet: swamps, savannas, jungles, rivers, snow layers on the ground, biome-specific caves or ores, new animals. Animals don't appear in the desert, but a herd can wander in from a
  neighbouring biome.
- Not in 1.10 yet: stairs and slabs only come in planks, doors have no hinge choice (always on your left) and don't pair up into double doors, animals treat doors as walls
  (open or closed), trapdoors can't be climbed like ladders, and water doesn't flow through the gaps of these blocks.
- Not in 1.9 yet: farmland is not trampled by jumping on it, there is no bone meal, water does not push you along, and crops don't grow while the world is empty.
- Desktop only (keyboard + mouse).
