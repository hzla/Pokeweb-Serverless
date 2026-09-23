# Italian White 2 follower — human melonDS checklist

Cold boot a versioned IRDI ROM from an ordinary Italian save. Do not load a savestate created by a US ROM or an older alpha. Record emulator version, ROM SHA-256, save origin, map/coordinates and screenshots for failures. All cases below are **NOT RUN** until you test them.

| ID | Action | Expected result | Result |
|---|---|---|---|
| I01 | Cold boot 0.6.33 from an ordinary Italian IRDI save. Walk and run in four directions with a healthy non-Egg lead. | Exactly one follower appears after walking; movement and controls remain responsive. | NOT RUN |
| I02 | Try an empty party, Eggs only, a fainted lead, and an all-fainted party before blackout. | Selection follows the stock rules; no invalid actor or access during blackout. | NOT RUN |
| I03 | Use small and large species, normal and shiny, alternate forms and gender differences; inspect up/down frames. | Correct species/form palette and direction, with no placeholder except identified missing art. | NOT RUN |
| I04 | Idle, turn rapidly, reverse into the follower and walk laterally beside a building. | Idle animation works; overlap is passable and depth priority remains stable without building clipping. | NOT RUN |
| I05 | Walk up/down stairs and across left/right stair segments with a large Zekrom or Kyurem follower. | No player/follower priority flicker, sinking or railing clipping beyond the known visual limits. | NOT RUN |
| I06 | Traverse ledges and consecutive jumps; cross bridges and floors at different heights. | Recorded transitions replay without a visible teleport or following across disconnected geometry. | NOT RUN |
| I07 | Walk a curved rail path and a non-grid area, then return to normal grid movement. | Follower trails the actual route with no recall solely because of movement mode. | NOT RUN |
| I08 | Cross a seamless boundary such as Floccesy Town to Route 20 and back repeatedly. | The same follower remains visible without recall/send-out animation. | NOT RUN |
| I09 | Enter/exit doors, stairs, elevators and a warp; use Fly or escape where available. | Required recalls happen before field replacement and one follower returns after walking. | NOT RUN |
| I10 | Open/close the bottom menu, party, summary and Bag repeatedly. | Follower stays visible and paused; no control freeze or duplicate actor. | NOT RUN |
| I11 | Open the PC, view boxes without changing the lead, then deposit/withdraw or replace that Pokémon. | Unchanged lead stays out; changed selection refreshes after field control returns. | NOT RUN |
| I12 | Talk to stationary NPCs, moving NPCs, signs and furniture/trash cans. | Safe dialogue keeps the follower visible; idle NPC routes do not force an unnecessary recall. | NOT RUN |
| I13 | Trigger a stationary scene, camera pan, emote and sound cue; then an NPC route crossing the follower. | Safe presentation retains the actor; a true occupied-space conflict recalls before movement. | NOT RUN |
| I14 | Trigger scripted player walking/jumping, a battle, a story partner and a field teardown. | Follower recalls before unsafe actions and never changes native partner or battle state. | NOT RUN |
| I15 | Talk to the follower from all four directions, including on rail/non-grid maps. | Pokémon faces player, performs reaction/cry/emote and resumes following after dialogue. | NOT RUN |
| I16 | In 0.6.31, talk with full HP, low HP, poison, sleep, burn, freeze, paralysis and varied friendship. | Italian generic reactions follow the same HGSS conditions and probability order; accented è renders correctly. | NOT RUN |
| I17 | Try nicknames/player names with supported accented characters and advance text at slow/fast speeds. | Name substitutions and native text pagination render without raw tokens or truncation. | NOT RUN |
| I18 | Author one Aspertia City species/zone dialogue rule in Pokeweb, export and cold boot. | Matching lead gets authored text; other leads use Italian generic reactions. | NOT RUN |
| I19 | Author a one-time gift, claim it, save/reload, then talk again; repeat with a full Bag. | First successful claim adds one item; claim persists; full Bag displays the Italian retail response without consuming the claim. | NOT RUN |
| I20 | Reorder party, use PC, evolve or hatch a Pokémon, then talk and test a gift. | Identity, nickname, cry and per-Pokémon gift claim belong to the current Pokémon. | NOT RUN |
| I21 | Cycle, Surf, Dive, fish and return to walking; visit communication or special activity modes if available. | Follower recalls only for guarded activities and reconstructs afterward. | NOT RUN |
| I22 | Save, close the emulator, cold boot the same ROM/save, and separately open a copy of the save in clean Italian White 2. | One reconstructed follower in patched game; save remains readable by clean Italian game. | NOT RUN |
| I23 | Repeat 100 mixed conversations and transitions; every tenth cycle use a menu or PC and every twentieth cross a map seam. | No stuck input, duplicate follower, accumulating allocations or lingering emotes/window/locks. | NOT RUN |
| I24 | Compare prior language and grounding alphas with 0.6.31 only if diagnosing a regression. | Italian dialogue and the lower sprite position remain; 0.6.31 separates sprite positioning from the native shadow. | NOT RUN |
| I25 | Compare grounded Bulbasaur or Mewtwo with Flying-type Pidgeot or Charizard on flat ground and stairs; inspect feet and shadows while idle and walking. | Grounded artwork sits at its existing native shadow without a transparent-row gap. Flying artwork keeps its prior height; shadow position, player sprite and stair depth stay unchanged. | NOT RUN |
| I26 | For diagnosis only, compare the same grounded follower at the same position in 0.6.29 and 0.6.30. | 0.6.30 adds three pixels to the sprite but also moves the native shadow; this is the reported regression corrected by 0.6.31. | NOT RUN |
| I27 | Cold boot 0.6.31 with a small grounded follower and Serperior; compare their shadows with the player on flat ground and stairs. | The sprite keeps its lowered artwork position while its full shadow stays at ground level, aligned with the player shadow. Serperior has a complete shadow rather than only its top half. | NOT RUN |
| I28 | Cold boot 0.6.32 with Serperior. Face up and down on flat ground, then walk in both directions on stairs. Inspect the full shadow as well as the sprite; check left/right afterward. | Facing up shifts shadow about seven pixels and art about five pixels upward; facing down shifts both about six pixels downward. Left/right positioning stays unchanged. | NOT RUN |
| I29 | Cold boot 0.6.33 with Serperior, walk north until it overlaps the player, then check stairs and lateral movement beside a building. | The north-facing follower draws in front of the player at the overlap; the confirmed sprite/shadow position and other depth cases remain stable. | NOT RUN |

For any recall in I12–I14, capture `FollowingSceneDebug` reason/opcode/action and the field generation if possible. At I23, note actor count, heap use and texture/palette allocations when telemetry is available; mark them UNMEASURED otherwise.
