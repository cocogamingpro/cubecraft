# Block Platform

A tiny multiplayer 3D block game: explore a generated world, then break and place blocks together.

- **Creative** and **Survival** game modes, chosen when you create the world.
- Main menu, game menu, nametags and text chat; the host can **Open World** to get a join code.
- Terrain is generated from a **seed**: oceans, beaches, deserts, grassy hills, rocky mountains and snowy peaks.
- Blocks: grass, dirt, stone, sand, wood, wood planks, leaves, cobblestone, snow (plus water and bedrock),
  and craftable blocks: crafting table, wooden button, sandstone, stone bricks. Sticks are an item.
- Oak **trees** grow in forests and scattered through grassland.
- The world is endless on x/z (up to ±30,000 blocks) and streams in around you.

## Project layout

    server.js            Node server (Express + WebSocket)
    public/index.html    The game (Three.js client)
    public/worldgen.js   Seeded world generator, shared by the server and the browser
    package.json
    render.yaml

Keep `index.html` and `worldgen.js` together: the browser loads `worldgen.js` directly and the server
`require`s it. The `public/` folder is the intended place, but if you upload everything flat (all files
next to `server.js`) the server detects that and still works. Both run the same code, so the same seed gives the same world everywhere. Only the seed and
player changes are sent over the network, not the terrain.

## Run locally

    npm install
    npm start

Open http://localhost:3000 in two browser tabs: create a world in one, press Esc and click Open World,
then join from the other tab with the code.

## How playing together works

1. **Main menu**: type your name, then either
   - **Create world** (leave the seed empty for a random world), or
   - enter a friend's 6-character code and press **Join**.
2. Press **Esc** in the game to open the **Game menu**. As the host, click **Open World**: a code such as
   `K7MQ2X` appears. Send it to your friends; they type it into the *Join a friend* box on the main menu.
3. **Close World** stops new players from joining (people already inside stay). Only the host can open or
   close the world. If the host leaves, the player who has been there longest becomes the new host.
4. Everyone gets a **nametag** floating above their head. Press **T** (or Enter) to **chat**; Enter sends,
   Esc cancels. Join/leave messages also appear in the chat.

Each world has its own seed (shown in the Game menu) and is discarded when the last player leaves.
Up to 20 worlds with 12 players each can run at once.

## Game modes

Pick the mode in the *Game mode* box when you create a world. Everyone who joins plays in the world's mode.

**Creative**: unlimited blocks, every block breaks instantly, no damage. Double-tap **Space** to fly
(Space up, Shift down, double-tap again to stop). Bedrock can never be broken.

**Survival**: you have 10 hearts and die at 0, then click **Respawn** (you keep your items).
- Damage: falling (the first 3 blocks are free, then half a heart per block), drowning (you can hold your
  breath for 10 s, then lose a heart per second) and punches from other players (1 heart, left click).
- **Hold left click** to mine. Harder blocks take longer: leaves and snow are quick, wood and planks slower,
  cobblestone and stone slowest. The block goes into your inventory, up to 64 per block type.
- The hotbar shows how many of each block you carry. Placing a block uses one up; you start with nothing.
  Press **E** to craft new blocks from what you collect (see *Inventory and crafting* below).

Health and inventory are kept by the server (like the world, they disappear when the world does).
Mining time, items and punches are checked on the server. Fall and drowning damage are reported by the
player's browser, which is fine for friends but not cheat-proof.

## Inventory and crafting

Press **E** to open your inventory (E or Esc closes it).

**Survival** has a **2x2 crafting grid** and a recipe list.
- Click an item to pick it up, then click a crafting cell to put one in. Right-click a cell to empty it.
  Or just click a recipe in the list to fill the grid for you (recipes you can't afford yet are dimmed).
- Click the result to craft once, **Shift-click** it to craft as many as you can. A stack holds at most 64.
- Nothing leaves your inventory until you take the result, and the server does the swap, so nothing is
  lost if you close the inventory or disconnect.
- Recipes work in any corner of the grid, like Minecraft.

| Result | Ingredients (2x2 grid) |
| --- | --- |
| 4 Wood planks | 1 Wood |
| 4 Sticks | 2 Wood planks, one above the other |
| Crafting table | 4 Wood planks (2x2) |
| Wooden button | 1 Wood planks |
| Sandstone | 4 Sand (2x2) |
| 4 Stone bricks | 4 Stone (2x2) |

**Hotbar:** the nine hotbar slots can now hold any block. In the inventory, click a block and then a hotbar
slot, or hover a block and press 1-9, or Shift-click a block to put it in your selected slot.
Sticks are items, not blocks, so they can't go in the hotbar.

**Creative** has no crafting. E shows every block so you can choose what goes in your hotbar.

**Buttons** are small and you walk through them. They stick to a neighbouring block (walls first, then floor,
then ceiling) and pop off back into your inventory if the block they hang on is removed.

The recipes live in `worldgen.js` (`RECIPES`), so the server and the browser use the same list.
The 3x3 crafting-table workbench is not part of the game yet: for now the table is just a block.

## Deploy (GitHub + Render)

1. Create a new GitHub repo and push this folder to it:

       git init
       git add .
       git commit -m "Block Platform"
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

## Controls

W A S D move, Space jump (or swim up), Shift run, left click break, right click place,
1-9 or mouse wheel to pick a block, E inventory / crafting, T chat, Esc game menu.

## Notes

- Terrain is regenerated from the seed, so only player edits live in server memory (capped at 40,000 changes
  per world). A world disappears when its last player leaves, and everything resets when the server
  restarts or redeploys.
- Render's free tier sleeps after ~15 minutes without traffic; the first visit afterwards takes ~30-60 s to wake up.
- If the game runs slowly on a weak computer, lower `RENDER_DIST` at the top of the script in `public/index.html`.
- Desktop only (keyboard + mouse).
