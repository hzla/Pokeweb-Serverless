# Stock Black 2 Following Pokémon 0.6.24-alpha — emulator checklist

Use `Black2-Following-0.6.24-alpha.nds` with a same-basename `.sav`. Cold boot the ROM; do not resume a state made with another ROM. Emulator execution is assigned to the human tester and every row remains **NOT RUN** until results are recorded.

Start with B01–B06. If those pass, continue through B12. For a failure, save a state immediately before the trigger and record emulator/version, location, party lead, direction, and the ROM SHA-256.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| B01 | Cold boot an ordinary Black 2 save, walk one tile, then walk and run in all four directions. | Exactly one party Pokémon appears and follows the recorded route without blocking movement. | NOT RUN |
| B02 | Enter and leave a house or Pokémon Center twice, then use a door, stairs, and an elevator. | Required transitions recall once and the follower returns once after walking; controls remain responsive. | NOT RUN |
| B03 | Open and close the X menu, then use the Pokémon Center PC without changing the party. | The follower remains visible and paused, then resumes without a recall or send-out effect. | NOT RUN |
| B04 | Reorder the party and deposit or withdraw the selected Pokémon, then return from the PC and walk. | An unchanged identity is retained; a changed identity is selected safely with one follower. | NOT RUN |
| B05 | Cross the Floccesy Town / Route 20 seamless boundary in both directions while walking and running. | The same visible follower crosses without recall, send-out, duplicate actor, or stale trail. | NOT RUN |
| B06 | Talk to a follower from all four directions, then talk to a wandering NPC, read a sign, and inspect furniture. | Follower reactions work; safe external interactions keep the follower visible and paused. | NOT RUN |
| B07 | Trigger a trainer battle and a wild battle, heal, fish, cycle, Surf, and return to normal walking. | Activity guards recall before ownership changes and restore one current follower afterward. | NOT RUN |
| B08 | Use small, 64-pixel, shiny, gender-different, and alternate-form Gen 5 leads. | Correct art, palette, facing, spacing, draw order, cry, and identity are used without palette bleed. | NOT RUN |
| B09 | Walk sideways near buildings and traverse straight and diagonal stairs with a large follower. | No alternating player/follower priority, railing head clipping, stair sinking, or building clipping. | NOT RUN |
| B10 | Talk in a matching contextual-dialogue zone and claim a configured gift; repeat after saving and reloading. | Dialogue selectors match the live zone. Each gift slot is claimable once per Pokémon and persists. | NOT RUN |
| B11 | Run a story scene with forced movement and another scene where the player remains stationary. | Forced movement recalls before it starts. Verified stationary presentation retains the paused follower. | NOT RUN |
| B12 | Complete 100 mixed menu, dialogue, battle, door, seamless-map, PC, and save/reload cycles. | No freeze, duplicate actor, stuck input, lingering effect, missing NPC, or accumulating allocation is observed. | NOT RUN |

Black 2 uses its own three PMC modules and binary contract. White 2 or expansion savestates do not validate this port because they retain different loaded code and addresses.
