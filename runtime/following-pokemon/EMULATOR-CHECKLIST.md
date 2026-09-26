# Following Pokémon — human emulator checklist

The generated checklist collects targeted regression cases before the baseline cases below. All rows begin NOT RUN; host and isolated-CPU checks are not game-emulator results. Cold boot the current profile export with an ordinary matching save. Record ROM hash, emulator version, map, species/form, facing, and a fresh state for failures.

## In-game Followers option — all four profiles

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| O01 | Cold boot a base and full export for each profile with an existing save. Open Options using buttons and by touch, scroll to the sixth row, and switch its value both ways. | The sixth row matches the other rows' background fill, beveled label backing, turquoise border, native font, highlight, selection marker, sound, and help text. It reads FOLLOWERS: ON/OFF, or SEGUACI: SÌ/NO in Italian. Existing saves show On. The first five settings, Confirm, and Quit remain usable. | NOT RUN |
| O02 | Select Off, decline the confirmation prompt or quit, then reopen Options. Repeat with On. | The prior saved value returns after either canceled path. Confirm accepts the chosen value; a normal game save and cold boot retain it. Repeated opening and closing leaves no stale row graphics or input behavior. | NOT RUN |
| O03 | In the base package, confirm Off with a follower visible, walk and change maps, then confirm On. | The follower disappears and does not respawn while Off. On restores normal spawning without changing the party or land-follower selection. | NOT RUN |
| O04 | In the full package, confirm Off while land-mounted and again while riding a custom Surf mount on water; then confirm On. | Off ends land riding and clears pending restoration. On water, Surf itself continues and the retail mount replaces the custom one. On restores eligible custom Surf and grounded following at the next normal opportunity. | NOT RUN |
| O05 | Disable following in Pokeweb, export and cold boot with a save set to Off; re-enable and cold boot again. | The sixth row is blank while the ROM-wide switch is disabled. Re-enabling reveals the prior saved Off choice. | NOT RUN |

## Optional riding package acceptance — all four profiles

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| V01 | Cold boot a newly installed base-only ROM outdoors; walk, turn, talk, cycle with L/R, enter a building, and use native Surf. | Grounded followers, effects, recall, and walking gaps work. Native Surf uses its retail mount; A+B does not start land riding. | NOT RUN |
| V02 | Cold boot the full variant with a Surf-capable follower; mount using A+B, enter water, dismount, and repeat after a menu and Repel prompt. | Current land riding, custom Surf, rider placement, and follower return behavior remain intact. | NOT RUN |
| V03 | Convert a full installation to base by removing and reinstalling, then cold boot the exported ROM. | Grounded following still works; riding and custom Surf are absent, with no stale mount texture or effect. | NOT RUN |

## Stock White 2 current recall timing, sound and NPC priority

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| R01 | Cold boot outdoors with a visible follower, then walk into a house or Pokémon Center in all four approach directions. | The follower turns light cyan and white, holds its silhouette briefly, shrinks into the ball, and finishes before the door script advances. The player cannot take another directional step during the 12-update recall; control returns normally after transition. | NOT RUN |
| R02 | Press L or R to cycle followers, holding a movement direction through the recall and send-out. | The current follower completes its recolored shrink and ball sequence before the next appears. Player movement resumes when recall ends; L/R does not skip another party member. | NOT RUN |
| R03 | Trigger a scripted warp, battle entrance, and forced movement scene with a visible follower; repeat with a missing effects archive or low resource memory if practical. | The native event finishes after recall when the effect is available. The script never deadlocks, and missing effects do not trap player input. Save/load and repeated transitions remain usable. | NOT RUN |
| R04 | Cold boot 0.6.74 with the ordinary save used for `noani2.mln`, summon the same follower, and enter the same building. Observe the first eight recall updates. | The imported follower uses the light-cyan/white silhouette and shrink before the final four ball updates. The old state contains 0.6.69 code and cannot validate this build. | NOT RUN |
| R05 | Cold boot 0.6.74 and summon a follower, then cycle with L/R and walk into a door with a visible follower. Compare the sound with a battle send-out and switch-out on the same ROM. | One stock ball cue plays for each send-out and recall. The Sunny Day twinkle used in 0.6.71 is absent. No repeated cue while the twelve recall updates run. | NOT RUN |
| R06 | With a visible follower, open and close a safe menu or conversation; repeat a failed/unavailable effect if practical. | Staying visible makes no extra ball sound. An unavailable effect does not play a sound without its animation or trap input. | NOT RUN |
| R07 | Cold boot near the ordinary NPC in `badprio.mln`. Stand and walk behind that NPC with a follower off to the side; repeat with a large follower directly behind the player. | The NPC covers the player where their sprites overlap. A nearby follower still respects the intended player/follower order and its shadow stays on the ground. | NOT RUN |

## Stock White 2 current follower talk reach

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| G01 | Cold boot with the ordinary save near `toofar.mln`, face west toward the small follower and press A without taking a step. Repeat after walking left/right and stopping at several phases. | Dialogue opens while the follower stays at or inside the talk-reach limit. The actor, visible art and shadow remain together; no one-frame snap across a wall or NPC. | NOT RUN |
| G02 | Repeat with a 12-unit authored side gap, a follower on each side, then face up/down and converse on flat ground and stairs. | The follower remains talkable when directly ahead and close to the limit. Off-axis, obstructed or separated followers cannot be talked to through walls or elevation. | NOT RUN |

## Stock White 2 0.6.67 lighting and draw priority

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| L01 | Cold boot the current ROM in Castelia Sewers with a visible follower. Compare its brightness with the player while walking, stopping, and turning through lit and dark areas. | The follower follows the same map lighting changes as the player; its ground shadow remains correctly placed. | NOT RUN |
| L02 | Repeat while riding a land Pokémon and while using a custom Surf mount. Enter and leave each mode, including a map-lighting change. | Mount and seated rider receive compatible lighting; neither becomes full-bright, black, or detached from the native shadow. | NOT RUN |
| D06 | Put Serperior one tile north of the player facing down, then face the player up, down, left, and right without changing tiles. Walk and stop in each facing. | Serperior remains behind the player in all four facings, without flicker, overlap reversal, or moved ground shadow. | NOT RUN |

## Stock White 2 0.6.66 positioning and mounted idle

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| P01 | Cold boot the new ROM with narrow and wide followers whose gaps have not been manually edited. Walk left and right, then inspect the default gap in Pokeweb. Set a custom left/right gap, save, export, and cold boot again. | The automatic side gap is the prior artwork-based value plus six units; the editor displays 6–12. A custom value overrides that default in both side directions. Up/down spacing, shadow anchors, and party order stay unchanged. | NOT RUN |
| P02 | Set distinct X/Y rider adjustments for all four land-facing directions. Mount, move, stop, and turn. | The seated player stays at each chosen placement; mount and rider continue the one-pixel paired cadence while stopped, while the ground shadow stays fixed. | NOT RUN |
| P03 | Set distinct Surf rider adjustments for a supported Surf appearance. Enter water, face all four directions, stop, dismount, and mount again. | The selected Surf appearance uses the authored rider offsets during entry and ordinary Surf, and unload/reload does not retain a stale appearance. | NOT RUN |
| P04 | Reopen the exported ROM in Pokeweb, edit one positioning value, save, export again, then disable and re-enable following. | Authored values and receipt survive export/reopen and enable/disable; the game uses the changed value after a cold boot. | NOT RUN |

<!-- generated-gen5-assets:start -->
## 0.6.32 Gen 5 sprite acceptance

Run G509 first in melonDS for the palette correction, then G501 and explicitly check up versus down before continuing with G502–G505. These rows are **NOT RUN** until the human tester records results. Use a cold boot of the 0.6.32 ROM; an older emulator state contains earlier runtime instructions and resource tables.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| G501 | Cold boot 0.6.32 with Snivy, Tepig and Oshawott as lead in turn; walk, run and turn in all four directions. | Each species uses its own Gen 5 art and animation. Up and down facing match the player direction; no Bulbasaur fallback, palette corruption or frame-order error. | NOT RUN |
| G502 | Repeat G501 with shiny Gen 5 leads, including one small species and Reshiram or Zekrom. | Shiny colors are visible only on the follower; unrelated actors keep their palettes. | NOT RUN |
| G503 | Compare male/female Unfezant, Frillish and Jellicent. | Each gender resolves to the matching artwork in normal and shiny states. | NOT RUN |
| G504 | Test both Basculin forms, Darmanitan and Zen Mode, all Deerling/Sawsbuck seasons, Therian genies, three Kyurem forms, Keldeo, Meloetta and all Genesect drives. | Every valid White 2 form loads safely. Forms sharing source art remain stable and keep the actual party identity/cry. | NOT RUN |
| G505 | Test Tornadus, Thundurus, Reshiram, Zekrom, Landorus and Kyurem indoors, outdoors, near doors and during follower dialogue. | 64-pixel followers render without clipping or invalid resource reads; recall/send-out and conversations still complete. | NOT RUN |
| G506 | Reorder the party between two different Gen 5 species, evolve a Gen 5 lead, then deposit/withdraw it. | Appearance refreshes to the selected party member with exactly one follower and no stale sprite. | NOT RUN |
| G507 | Cycle species 494–649 in normal and shiny states with a prepared save/tool, including every valid form and gender difference. | All 624 appearance keys display Gen 5 art; no missing-resource crash or Bulbasaur placeholder. | NOT RUN |
| G508 | Run 100 mixed transitions while alternating small/large and normal/shiny Gen 5 leads. | No increasing load time, duplicate actor, stuck controls, palette bleed, or accumulating actor/texture/palette allocation. | NOT RUN |
| G509 | Test normal and shiny Landorus in both forms and inspect all four directions and both walk frames. Spot-check Victini, Gigalith, Vanillite, Ferrothorn, Golett, Terrakion, both Tornadus and Thundurus forms, Reshiram, Zekrom and all Kyurem forms. | No opaque neon-magenta pixels appear. The 17 repaired resources use their normal-palette color at source sentinel entries while retaining the remaining shiny palette colors. | NOT RUN |

Record species, form, gender, shiny state, map, emulator, ROM hash and a screenshot for any mismatch.
<!-- generated-gen5-assets:end -->

<!-- generated-conversations:start -->
## 0.6.32 conversations — human acceptance

Start with C20 in melonDS to check the recall fix, then C01–C03 and C12–C13. These rows are **NOT RUN** until the human tester records results. The automated 100-conversation tests use native-service mocks and do not count as C16.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| C01 | Cold boot 0.6.32 from an ordinary save. Walk two tiles, stop, turn toward the follower without walking into it, then tap A. | One visible follower faces the player; an HGSS motion/cry/emote and English response play. A/B closes the text; follower stays visible and movement resumes. | NOT RUN |
| C02 | Repeat from north, south, east and west on flat open ground. | All four directions work. Facing away, standing too far away, or overlapping the follower does not start a conversation. | NOT RUN |
| C03 | Face an NPC, sign, item or field-action target with the follower nearby. Repeat while holding A and while pressing A plus a direction. | The normal target/action takes priority. No doubled dialogue, skipped item or unintended follower event. | NOT RUN |
| C04 | Approach across a wall, corner, ledge, bridge/underpass, disconnected floor, or vertical height difference. | Cannot talk through an obstruction or between floors. Following resumes normally after repositioning. | NOT RUN |
| C05 | Talk on straight and curved rail paths and in non-grid exploration areas, facing each reachable direction. | Talk works where standing close and unobstructed. Record map, coordinates, facing and spacing if it fails; no broad map exclusion is intended. | NOT RUN |
| C06 | Repeat with full HP, 75%, just below 75%, 50%, just below 50%, 25%, just below 25%, and 1 HP. | Appropriate generic HP reactions; low-HP distressed cries may sound lower. No extra duplicate cry. Exact dialogue is probabilistic. | NOT RUN |
| C07 | Repeat with poison, bad poison, sleep, burn, freeze and paralysis using prepared test saves. | Generic condition-aware reactions; asleep takes precedence over burn/freeze/paralysis when diagnosing modified saves. Poison has highest priority. No status or HP is changed. | NOT RUN |
| C08 | Use prepared saves with friendship 0, 1, 29, 30, 59, 60, 89, 90, 149, 150, 199, 200, 254 and 255. | Messages vary within imported friendship conditions. Repeated talking does not change friendship; mood stays neutral and is not saved. | NOT RUN |
| C09 | Repeat with small, large, tall, floating, Diglett and Dugtrio followers inside/outside, near another Pokémon NPC. | Emotes sit above the follower and animate cleanly. Hops/turns return to the original position; Diglett/Dugtrio stay grounded. No shared NPC recoloring. | NOT RUN |
| C10 | Use a long nickname and player name, mixed case, punctuation and supported non-ASCII name characters. Test slow/medium/fast text. | Real names display without raw tokens, garbled text or clipping. Native text speed, page advance, and A/B dismissal work. | NOT RUN |
| C11 | Talk to a species/form currently displayed with fallback artwork. Reorder/deposit/withdraw party members, then talk again. | Nickname and cry belong to the actual selected Pokémon. New identity appears after returning to the field; no stale party pointer or old response. | NOT RUN |
| C12 | Hold A through the entire opening motion and text; release, then press A/B. Rapidly alternate A/B and try X/Start while talking. | Opening A does not instantly dismiss; a held button does not reopen. No menu under dialogue, overlapping window, or stuck controls. | NOT RUN |
| C13 | After talking, open/close party and summary, enter/exit a door, and trigger a battle. Repeat immediately after dismissing text. | Owned event ends, ordinary guards work, and exactly one follower returns after walking. | NOT RUN |
| C14 | Use a nearby scripted trigger/warp to interrupt motion, emote, printing and closing where possible. Record stages inaccessible through normal input as BLOCKED. | External event wins. No lingering text, offset, bubble, callback or control lock; player and NPC events keep their own locks. | NOT RUN |
| C15 | Talk, save normally, cold boot the same ROM, and later open a copy of that save in unpatched White 2. | No persistent conversation state or duplicate actor; ordinary saves remain usable. Do not load an old emulator state to test a new DLL. | NOT RUN |
| C16 | Perform 100 complete conversations at normal speed, moving between each. Every tenth conversation open a menu; every twentieth enter/exit a building. | No growing pause, actor duplication, leftover bubble/window, palette corruption or stuck controls. Log heap/texture/palette counts if debugger telemetry is available. | NOT RUN |
| C17 | Repeat near a crowded NPC area, at night, in rain/snow and in grass. | Native scene remains intact. Bubbles have correct transparency/depth; no sustained allocation growth. Record elapsed time and baseline/end resources. | NOT RUN |
| C18 | In Pokeweb install twice, export/reopen, disable/reexport, enable/reexport, then remove runtime/reexport and reinstall. | One field module and one resident event module when installed; disabled/removed build has no follower. Artwork retained. Removal leaves two inert file slots and shared PMC; no later unrelated edits are lost. | NOT RUN |
| C19 | Developer fixture only: omit/corrupt dialogue data, omit emotes, exhaust effect allocations, or fail message creation. | Invalid dialogue data prevents starting. Missing cosmetics are skipped. Message failure cancels safely; field control remains. Record BLOCKED if no fault-injection setup. | NOT RUN |
| C20 | Dismiss a conversation with A, stand still for five seconds, release and talk again without moving, then walk away. Repeat using B, all four directions, and a curved rail path. Immediately after another dismissal, trigger an NPC event, X menu, or door. | No ball, disappearance, duplicate actor or new send-out after the follower conversation alone. Repeat talk works without walking first; following resumes on the existing trail. Safe NPC/sign conversations and the X menu keep it visible; doors and unsafe scenes recall, then exactly one follower returns after walking. | NOT RUN |

For C16, log checkpoints 0 / 10 / 25 / 50 / 75 / 100: map, follower actor count, controls, effects, field/PMC heap, texture and palette allocations. If telemetry is unavailable, mark allocations UNMEASURED rather than PASS. Attach a normal save and a fresh emulator state for failures.
<!-- generated-conversations:end -->

<!-- generated-scenes:start -->
## 0.6.32 external dialogue and scenes — human acceptance

Start with S02 at the supplied Aspertia City sign, then test static furniture and S01. Continue with S03, S14, S07–S08 and S12. Aspertia locations are suggested repeatable dialogue targets, not claims that the corrected build was emulator-tested. For scenes without a named stock fixture, record your location/save stage or mark BLOCKED. All results remain NOT RUN until entered by the human tester.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| S01 | Cold boot 0.6.32 from an ordinary save in Aspertia City. Walk until the follower is visible, then talk to an NPC whose normal behavior includes random walking. Repeat while the NPC is beside the follower or facing a tile the follower occupies. | The NPC freezes for the conversation and the follower remains visible at the same position and facing. No recall/send-out occurs from the NPC's dormant queued route; normal wandering resumes after dismissal. | NOT RUN |
| S02 | Read an Aspertia City outdoor sign, then inspect a trash can or other static furniture, then read another sign indoors or on a route. Repeat from each reachable direction with a wandering NPC nearby. | Follower stays visible and paused for every static interaction. Unrelated paused NPC routes do not recall it. Reading or inspecting again immediately works; facing turns alone do not recall. | NOT RUN |
| S03 | Choose both Yes and No and each list-menu option in a conversation that stays in the field. Record the NPC and save/story stage. | Choice windows work normally. Follower remains for safe choices; an option entering an application/battle/warp recalls before that action. | NOT RUN |
| S04 | Run a saved story scene in which the player stays stationary. Record the location, story stage and script/event ID if available. | Follower remains while audited commands and child events execute. If it recalls, capture FollowingSceneDebug reason/opcode rather than marking the scene safe by appearance alone. | NOT RUN |
| S05 | During a stationary scene with a camera pan/zoom, sound or NPC emote, watch the follower and then return to walking. | Camera/presentation alone keeps the same actor. No duplicate effect, changed palette, facing reset, snapped position or send-out on resume. | NOT RUN |
| S06 | Arrange a scripted NPC walking away from the follower, then a route passing nearby without occupying its native tile footprint. | Follower stays visible. NPC route, timing and destination are unchanged. Record any conservative recall with its action/reason. | NOT RUN |
| S07 | Repeat with a scripted NPC route crossing the follower, including a multi-step route that crosses only after dialogue ends or actors are unpaused. | A dormant paused route does not recall. Once movement actually commits toward the occupied space, the follower disappears before the conflicting coordinate write. It stays suppressed until the whole event chain ends, then returns after walking. | NOT RUN |
| S08 | Trigger forced player walking, jumping, stair/rail repositioning, teleportation and an ordinary facing turn separately. | Translation/jumping/repositioning recalls before movement. A simple facing turn keeps the follower. Recall holds player movement briefly; the scripted route then completes unchanged. | NOT RUN |
| S09 | Test NPC placement/spawn at the follower and far away. Use a controlled script fixture if no repeatable stock scene is available. | Conflicting placement recalls before it executes. Distant verified placement keeps the follower. Unknown placement modes may recall with a specific diagnostic. | NOT RUN |
| S10 | Use a developer fixture that requests the follower ID or exhausts the actor pool; also delete an unrelated actor. | Follower relinquishes its actor before native allocation. Unrelated deletion keeps the follower; no duplicate, missing story NPC or native allocation assertion. Mark BLOCKED without a fixture. | NOT RUN |
| S11 | Repeat dialogue, facing and NPC routes on a curved rail area, a non-grid area and a bridge/underpass. Record map and coordinates. | Stationary dialogue remains visible in all exploration modes. Verified rail paths use their real curve/direction; separate elevations do not collide. Unsupported profiles recall with reason 7. | NOT RUN |
| S12 | Take a dialogue branch into a trainer battle, map warp, full-screen application or story-partner sequence. Also take the branch that stays in dialogue. | Only the executed unsafe branch recalls. Independent battle/warp/activity/partner guards win. Safe branch keeps the actor. | NOT RUN |
| S13 | Use nested common scripts, list-menu/camera child events, normal dialogue-end cleanup, and an unknown child event or cleanup finisher fixture. | Safe children keep the actor; unknown child recalls before its callback. Recall persists when returning to a parent script. Native command order/results remain unchanged. | NOT RUN |
| S14 | Press A rapidly at the last page; alternate A/B, talk again immediately, talk to the follower, then walk. | No completion-frame recall, input lock, duplicate conversation or lost trail. Own-follower conversations retain the 0.4.1 completion behavior. | NOT RUN |
| S15 | Finish dialogue that changes the party, then walk; also reorder or use the PC after a conversation. | Selection refreshes when control returns. Same identity reuses the actor; changed identity uses normal replacement. No temporary party pointer or old nickname/cry persists. | NOT RUN |
| S16 | Enter/exit a building, battle, reload a normal save and disable/re-enable the patch after safe and recalled scenes. | Callbacks and private resources are released at teardown. Exactly one follower returns. Cold boot each exported ROM; existing saves remain intact. | NOT RUN |
| S17 | Complete 100 mixed NPC/sign/choice conversations and supported scenes. Every tenth cycle walk, open a menu and talk to the follower; every twentieth enter/exit a building. | No duplicate actors, stuck input, accumulating actor/heap/texture/palette allocations, lingering effects or altered native events. Record checkpoints 0/10/25/50/75/100; allocations without telemetry are UNMEASURED. | NOT RUN |
| S18 | Test an unsupported standard and extended opcode through a developer fixture, including one in an untaken branch. | Executed unknown opcode recalls before dispatch and still executes normally. Untaken branch does not recall. Record the opcode and FollowingSceneDebug ring; mark BLOCKED without a fixture. | NOT RUN |

Capture the ROM hash, native script ID (if available), event origin, opcode/action, field generation, disposition and recall reason. Reason 1 = unknown command; 2 = unknown event; 3 = player movement; 4 = space conflict; 5 = actor ID; 6 = pool pressure; 7 = unsupported movement; 8/9 = event/VM capacity; 11 = actor loss; 12 = bridge failure; 13 = unsupported/invalid cleanup. `FollowingSceneDebug` begins with `FWSE` and contains a bounded 32-entry ring; do not dereference pointer-valued diagnostic identities.
<!-- generated-scenes:end -->

<!-- generated-menu-pc:start -->
## 0.6.32 X-menu and PC retention — human acceptance

Run X01 and X04 first in melonDS. These rows are **NOT RUN** until the human tester records results. The PC Box restarts the field internally, so acceptance is based on seamless visible reconstruction at the same validated pose rather than preservation of the old actor allocation.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| X01 | On flat ground with the follower visible, open and close the bottom-screen menu ten times without selecting an application, using both X and touch entry. | The follower remains visible and paused at the same position and facing while the menu is open. Closing it resumes the same actor and trail with no recall or send-out animation. | NOT RUN |
| X02 | Repeat X01 on the reported stairs with a 64-pixel follower. Frame-step several frames while the menu is open and immediately after closing it. | The follower does not move under the menu. Its stair depth ordering remains stable and closing the menu does not introduce a one-frame draw-order change. | NOT RUN |
| X03 | From the X menu, enter Party, Bag and Pokédex, then return to the field and walk. | Each child application may use the normal conservative recall. Returning creates exactly one follower, restores controls and never reuses a stale menu event. | NOT RUN |
| X04 | Use a Pokémon Center PC with the follower visible. Watch the terminal turn-on/run/turn-off sequence, enter the Box, then close it without changing the party. | The follower remains visible during the field-side PC sequence. Entering the Box does not play a recall effect; after the field returns, the follower is immediately visible at the preserved pose with no send-out animation. | NOT RUN |
| X05 | Enter the Box, deposit or reorder the previous lead so another eligible Pokémon is selected, then return to the field. Repeat after withdrawing it. | If the selected Pokémon changes, the old pose is rejected. After leaving the PC dialogue and walking, exactly one follower appears with the new identity/artwork/cry. Editing other party slots or boxes keeps the unchanged follower out. | NOT RUN |
| X07 | Cold boot and walk both ways between Floccesy Town (zone 439) and Route 20 (zone 446) 20 times, including walking/running, stopping immediately on the seam, turns, and small/64-pixel followers. Also repeat on another seamless outdoor boundary. Also enter a door or gate with a fade. | Seamless crossings retain the visible actor and trail without ball effects. Doors/warps still recall. A new-zone cutscene, actor ID conflict or occupied trail may still require recall. | NOT RUN |
| X06 | Repeat opening/closing the X menu 20 times and entering/leaving the PC Box 20 times, alternating movement and follower conversations between cycles. | No duplicate actor, stuck input, stale pose, unwanted ball effect, increasing pause or visible resource accumulation. Record heap/texture/palette counters when available; otherwise mark those counters UNMEASURED. | NOT RUN |

For any failure, record whether it occurred during the field-side PC animation, field teardown, Box UI, or field reconstruction. Include the party before/after and whether a recall or send-out effect appeared.
<!-- generated-menu-pc:end -->

<!-- generated-large-depth:start -->
## 0.6.32 large-sprite draw priority — human acceptance

Run D04 and D12 first in melonDS, then D11, D10, D09, D07, D08 and D01–D03. These are the direct regressions for the supplied screenshots and stair states. Cold boot the 0.6.32 ROM; do not resume an old state after replacing the ROM because it contains the previous field module.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| D01 | Use Kyurem or another 64-pixel follower on flat ground. Walk left and right for at least 20 tiles, including starts, stops and reversals while the follower overlaps the player. | The follower remains consistently behind the player during side-to-side overlap. No alternating body parts or per-step priority flicker. | NOT RUN |
| D02 | Cold boot the new ROM at the stair setup used for the reported failure. Walk upward one step at a time and frame-step or use slow motion through the middle of each step; repeat going down and after reversing direction. | There are no 3–4-frame flashes of the player over the foreground follower at any point in the step. The large follower occludes the player wherever their artwork overlaps, including during stair interpolation. | NOT RUN |
| D03 | On the same stairs, reverse the arrangement so the follower is behind the player, then cross at the midpoint repeatedly. | The follower stays behind until it has moved more than half a tile into the foreground. The change occurs once per crossing without flicker. | NOT RUN |
| D04 | Repeat D01 with Sigilyph (32 pixels), then another small follower. Frame-step through a complete walk/bob cycle in each direction. | Both sprite sizes receive the final-draw correction. Flat sideways overlap stays consistently behind the player; no alternating pixels, position drift or size pulse. | NOT RUN |
| D05 | Repeat with a 64-pixel follower on a map whose camera is rotated, including a rail or non-grid area if available. | Foreground follows the camera-facing world axis. The sprite does not shift sideways, detach from its shadow, or alternate priority during screen-horizontal travel. | NOT RUN |
| D06 | Talk to the large follower and a nearby NPC on flat ground and stairs, then trigger recall/send-out. | Dialogue motions, emotes and ball effects remain aligned. Closing dialogue resumes the same depth behavior with no accumulated offset. | NOT RUN |
| D07 | Recreate the supplied stairssink position with a 64-pixel follower, then repeatedly walk down the stairs at normal speed and in frame advance. | The follower stays seated on its native stair anchor. It does not sink behind the stair face or lose its lower body because of an artificial backward offset. | NOT RUN |
| D08 | Recreate the supplied stairssideclipping position. Traverse the stairs left/right while going both up and down, including reversals at mid-step. | Railings, walls and platform pieces that are behind the follower remain behind it. Geometry actually in front still occludes normally; the follower does not draw through the whole map. | NOT RUN |
| D09 | Recreate the supplied smallclipsidestairs position with Zekrom following one step below the player. Ascend left-to-right and right-to-left at normal speed and in frame advance. | The upper part of Zekrom, including its head above the player, stays in front of the rear stair railing. Stair geometry that is actually in front still occludes the follower normally. | NOT RUN |
| D10 | Recreate the supplied minorheadclip position partway up the stairs. Continue left-to-right and right-to-left through the step at normal speed and in frame advance. | No rear-railing pixels cover Zekrom's head at the partial-elevation frame. The follower remains seated on the stair path and actual foreground geometry still occludes it. | NOT RUN |
| D11 | Use Sigilyph first, then Tornadus or another 64-pixel follower on flat ground. Walk left and right through the player repeatedly at normal speed and in frame advance, including starts, stops and reversals. | Every overlapping follower pixel remains consistently behind the player throughout each animation cycle. No wing, head or body region alternates in front for individual frames. | NOT RUN |
| D12 | Use the wide follower from the building screenshot, then Zekrom and Sigilyph, on flat ground directly in front of a building facade. Walk left and right alongside the wall and through the player, including stops and reversals. | The follower remains consistently behind the player without sinking into facade, window, pillar or doorway pixels that are geometrically behind it. | NOT RUN |

For any failure, capture both actors at the overlap and record map, coordinates, camera angle, follower species/form, direction of travel, and whether the follower should be in front or behind.
<!-- generated-large-depth:end -->

<!-- generated-spacing:start -->
## 0.6.32 width-dependent spacing — human acceptance

Run W01–W05 on both profiles. Approximate pixels depend on camera scale; spacing uses native east/west world distance. All cases are NOT RUN until the human tester records results.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| W01 | Cold boot with a narrow follower, Sigilyph, then Zekrom. Walk/run left and right for 20 tiles, stop and reverse. | Wider visible artwork receives up to six extra world units of spacing; narrow art stays closer. The gap stays stable across animation frames; no extra rendering offset or sudden sideways jump. | NOT RUN |
| W02 | Walk north/south, then repeated L bends and tight reversals with a wide follower, including stairs, rails and non-grid paths. | North/south travel retains a one-tile delay. Corners follow the recorded route; no cutting through walls, disconnected floors or visible teleport. Record camera orientation on rotated maps. | NOT RUN |
| W03 | After sideways travel, stop and talk facing the follower from both sides. Repeat near a wall, NPC and sign, then talk after vertical travel. | A reaches the wider-spaced follower when adjacent and unobstructed. No talk through walls, two-tile talk, NPC/sign stealing or stuck input; same gap resumes afterward. | NOT RUN |
| W04 | With wide art, repeat D07–D12 stairs/building/overlap checks, X01/X04 menus and PC, X07 Floccesy Town/Route 20, and N01–N08 NPC collision. | Existing rendering/retention/scene guards remain effective with the longer horizontal trail. Record any new clipping or unexpected recall. | NOT RUN |
| W05 | Switch between narrow, wide, shiny and form variants through party and PC, including a placeholder. Walk in both horizontal directions after each switch. | Spacing follows the displayed artwork and stays constant through each walk cycle. No stale width, duplicate follower or growing delay. | NOT RUN |
<!-- generated-spacing:end -->

<!-- generated-idle:start -->
## 0.6.32 stationary follower animation — human acceptance

Run I01–I04 on both profiles after a cold boot with the matching save. These rows are **NOT RUN** until the human tester records results.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| I01 | Cold boot with a small follower, then a 64-pixel follower. Stop for ten seconds facing north, south, east and west. | The follower continuously cycles its normal directional idle pose. It stays on the recorded trail position and keeps the selected facing. | NOT RUN |
| I02 | Walk, stop, rapidly turn, stop again, then repeat on stairs, rails and a non-grid area. | The correct directional loop resumes after each stop. There is no trail movement, overlap jump, visual snap or recall caused by idling. | NOT RUN |
| I03 | Start a follower conversation, an NPC/sign conversation, the X menu and PC presentation. Watch the follower before dismissing each. | The follower freezes on its current idle frame while the owned interaction or retained external event is active. It resumes its loop only after normal exploration returns. | NOT RUN |
| I04 | Enter a door and trigger a battle, forced movement scene or other normal recall. Watch send-out and recall effects, then walk after returning. | Ball effects and hidden/suppressed states do not advance a visible idle loop. The normal directional loop starts only once a visible follower is following again. | NOT RUN |
| I05 | Repeat I01–I04 with a shiny, form/gender variant and a wide follower. | Idle behavior does not alter the selected appearance, palette, width-dependent spacing, draw order, collision behavior or conversation responses. | NOT RUN |
<!-- generated-idle:end -->

<!-- generated-shadow:start -->
## 0.6.32 follower ground shadow — human acceptance

Run H01 first in melonDS after a cold boot. All rows remain NOT RUN until the human tester records results.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| H01 | Cold boot with a small follower, then a 64-pixel follower. Walk two tiles on flat outdoor ground, stop, turn and walk again. | One native ground shadow appears under the follower, tracks its feet and does not move with animation bob. The player keeps its own shadow. | NOT RUN |
| H02 | Walk up and down stairs, across grass and a bridge, then cross a seamless map boundary. | The shadow follows native terrain height and stays below the follower. No detached or duplicate shadow appears after the boundary. | NOT RUN |
| H03 | Open/close the X menu and PC, talk to the follower and an NPC, then enter a door or battle and return. Repeat 20 times. | The paused follower retains one shadow; recall removes it and return restores one. No leftover shadow, actor, or accumulating effect allocation. | NOT RUN |
| H04 | Compare a grounded Pokémon (Bulbasaur or Mewtwo) with a Flying-type Pokémon (Pidgeot or Charizard) on flat ground, then on stairs. Inspect feet and shadow while idle and walking. | The grounded sprite sits at its shadow with no raised-looking transparent gap. Flying-type artwork keeps its previous height. The shadow position and player sprite remain unchanged. | NOT RUN |
| H05 | For diagnosis only, compare a grounded follower in 0.6.28 and 0.6.29 at the same position. | The extra three pixels in 0.6.29 also move the native shadow. This is the known regression corrected by 0.6.30. | NOT RUN |
| H06 | Cold boot 0.6.30 with a grounded small follower and Serperior. Compare their shadows with the player shadow on flat ground, then walk and cross stairs. | The follower sprites keep their lowered artwork position while their full shadows stay at ground level, in line with the player shadow. Serperior has a complete shadow rather than a cut-off upper half. | NOT RUN |
| H07 | Cold boot 0.6.31 with Serperior. Face up and down on flat ground, then repeat while walking and on stairs. Compare the sprite and full shadow with the player. | Facing up moves the shadow about seven pixels and the artwork about five pixels upward; facing down moves both about six pixels downward. Left/right positioning and movement remain unchanged. | NOT RUN |
| H08 | Cold boot 0.6.32 with Serperior, walk north until it overlaps the player, and compare with 0.6.31 if available. Repeat with a smaller follower and on stairs. | Serperior draws in front of the player where their sprites overlap while walking north; its confirmed artwork/shadow placement, stairs, and side-facing depth remain stable. | NOT RUN |
<!-- generated-shadow:end -->

## Run record

- Date / tester:
- ROM filename / SHA-256 / follower version:
- Emulator name / version / renderer / settings / speed:
- Save filename / SHA-256 / story progress:
- Starting map / coordinates / party (species, form, gender, shiny, HP, Eggs):
- Other installed patches:
- Evidence directory (screenshots, video, ordinary save, emulator state, traces):

Use a copy of your save. Keep a pre-test save and use the same starting save for
patched-versus-stock comparisons. For crashes, preserve both an ordinary save
from before the issue and an emulator state if available; a state from another
ROM build is not a valid clean-boot test.

## First playable smoke test

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| A00 | In melonDS, cold boot the current stock White 2 alpha from an ordinary save, load the overworld, wait two seconds, then press each direction and open/close X menu. | No startup lock; movement/menu inputs respond. If frozen, record whether music, NPCs, facing and menus still respond and save a new state. | NOT RUN |
| A01 | Cold boot with a healthy lead; load normally; walk two tiles. | Exactly one Pokémon appears automatically and follows roughly one tile behind. | NOT RUN |
| A02 | Walk ten tiles in each direction; stop for ten seconds. | Correct facing, smooth motion; follower stops; player remains controllable. | NOT RUN |
| A03 | Walk a rectangle, then alternate left/right quickly. | Follows the actual corners; no diagonal shortcut through walls, oscillation, or extra actor. | NOT RUN |
| A04 | Hold B and run; alternate walking/running; stop mid-turn. | Follower keeps the route and spacing without a persistent growing gap. | NOT RUN |
| A05 | Reverse directly into the follower; stand on its tile; walk past it. | Player can overlap/pass through; no collision or stuck input. | NOT RUN |
| A06 | Open/close the X menu ten times; open party and summary, then return. | The X menu keeps the same visible paused follower. Child applications return safely with exactly one follower and working controls. | NOT RUN |
| A07 | Enter/exit a Pokémon Center five times, then another building. | Recall during transition; destination initializes normally; one follower reconstructs. | NOT RUN |
| A08 | Reorder the first two healthy party members; return and walk. | New selected Pokémon appears; old actor and artwork disappear. | NOT RUN |
| A09 | Save while the follower is visible; fully restart; load and walk. | Normal save/load; one follower, no saved duplicate. | NOT RUN |
| A10 | Press A facing the follower in this alpha. | One generic HGSS conversation; A/B dismissal restores control. See C01–C19. | NOT RUN |

## HGSS send-out and recall effects

Use normal speed first, then slow motion/frame advance to inspect the short
effects. Report whether recall is complete, partly hidden by the fade, or absent.
The X menu and Pokémon Center PC Box path should not show a recall effect. Other
system/application transitions may recall. A persistent ball, white Pokémon,
duplicate, stuck control or crash is always a failure.

| ID | Steps | Expected / observation needed | Result / evidence |
|---|---|---|---|
| FX01 | Cold boot outdoors with a healthy small Pokémon; walk two tiles, then stop. | One brief Poké Ball, then a flash revealing one normal-color follower. The effect ends and walking still works. | NOT RUN |
| FX02 | With follower visible, walk into a Pokémon Center or ordinary house. Repeat slowly. | Observe light-cyan/white silhouette → shrink → brief ball → disappearance. The door script waits until recall completes. Interior loads normally. | NOT RUN |
| FX03 | Walk inside, exit, then walk away from the doorway. | Send-out replays once after a valid trail. No old-map effect or extra follower remains. Repeat entry/exit ten times. | NOT RUN |
| FX04 | Face each direction before triggering recall; walk/run through left/right turns immediately after send-out. | Ball/flash stay near the Pokémon; no offset to another tile, incorrect depth or sideways texture corruption. | NOT RUN |
| FX05 | Open/close X menu after send-out completes; immediately enter a door after closing it; repeat rapid interruptions. | X menu preserves the visible follower without an effect. Door transition waits for the recall and then proceeds with normal input, no stuck hidden follower and no lingering ball. | NOT RUN |
| FX06 | Mount/dismount the bicycle; enter/leave Surf where available. | Recall on activity entry; one fresh send-out after returning to on-foot exploration and walking. | NOT RUN |
| FX07 | Test a large, tall and floating Pokémon inside/outside. | Shrink/ball/flash align acceptably with the artwork. Record drift or clipping; size-specific HGSS positioning is not yet enabled. | NOT RUN |
| FX08 | Trigger recall near another Pokémon NPC, ideally the same species; repeat at night and in weather. | Other actors retain their palettes; follower returns in its normal colors. Lighting/map rendering stays intact after the effect. | NOT RUN |
| FX09 | Reorder party in menu; return and walk; then faint/change the lead. | New eligible Pokémon appears; recall never uses the previous Pokémon's silhouette after the new follower is visible. | NOT RUN |
| FX10 | Trigger dialogue, a cutscene, a battle and a forced warp during/after send-out. | Gameplay proceeds, effect can cancel, no callback/actor survives into the wrong scene. | NOT RUN |
| FX11 | Save after repeated recalls; cold boot; then disable following through Pokeweb and export/restart. | Normal save loading; one follower after walking when enabled; no follower/effect when disabled. | NOT RUN |
| FX12 | With debug instrumentation, corrupt/remove only `following/effects.narc`; separately test resource pressure. | Missing/malformed effects safely fall back to plain follower appearance; no parser assertion or lost player control. | NOT RUN |

For the first feedback, send FX01–FX05 results, emulator/version, Pokémon species,
building/location, and a short video or the first failing frame. No need to finish
the full future-release matrix before reporting a problem.

## Party selection and appearance

For invalid party fixtures, use an isolated test save or a controlled test harness.
Do not report an unreachable setup as passed.

| ID | Steps | Expected for completed feature | Result / evidence |
|---|---|---|---|
| P01 | Healthy lead followed by healthy Pokémon. | First non-Egg Pokémon with HP follows. | NOT RUN |
| P02 | Faint lead, leave second healthy; repeat with several fainted members. | First healthy non-Egg follows. | NOT RUN |
| P03 | Put an Egg first, then a healthy Pokémon; repeat with multiple Eggs. | Eggs are skipped. | NOT RUN |
| P04 | All Pokémon fainted, before/during/after blackout. | Selection fallback is first non-Egg, but no follower during blackout; clean recovery afterward. | NOT RUN |
| P05 | Egg-only party; separately empty-party test fixture. | No actor, no invalid access, normal control. | NOT RUN |
| P06 | Deposit/withdraw the lead, swap boxes, heal party, then return. | Current party is used; no stale PC/party pointer. | NOT RUN |
| P07 | Replace the Pokémon in the same slot with the same species but a different individual. | Identity refreshes correctly; nickname/cry interaction uses the new individual. | NOT RUN |
| P08 | Evolve lead, hatch an Egg, trade/receive a Pokémon; return to field each time. | Current species and appearance; one follower. | NOT RUN |
| P09 | Change form without changing slot; test persistent and battle-only form reversion. | Valid overworld form or an explicitly documented substitute. | NOT RUN |
| P10 | Test male/female differences, genderless species, and shiny variants. | Exact supported art; every substituted appearance is identified in the asset catalog. | NOT RUN |
| P11 | Cycle all 649 species and valid form/gender/shiny combinations using prepared saves. | No missing-resource crash; exact asset or recorded placeholder for every key. | NOT RUN |
| P12 | Use deliberately missing art and a missing shiny palette. | Visible placeholder; identity remains the actual Pokémon; no shared-actor recoloring. | NOT RUN |
| P13 | Test small, 64-pixel, tall, wide, floating, and asymmetric followers indoors/outdoors. | All sizes allowed indoors; expected offsets, frames, and direction mirroring. | NOT RUN |

## Movement, collision, and terrain

| ID | Steps | Expected for completed feature | Result / evidence |
|---|---|---|---|
| M01 | Walk/run straight, make L/U turns, reverse mid-step, repeatedly tap direction. | Records accepted movement; no wall-seeking or corner cutting. | NOT RUN |
| M02 | Hold movement against a wall and move away; repeat at map edges. | Blocked inputs do not add phantom trail steps. | NOT RUN |
| M03 | Circle a single obstacle and a narrow corner; reverse while adjacent. | Traverses the player's route; does not teleport through scenery. | NOT RUN |
| M04 | Jump one ledge, then consecutive ledges in different directions. | Reaches ledge before jumping; correct elevation and landing timing. | NOT RUN |
| M05 | Traverse stairs, slopes, bridges above another walkable floor, and tunnels. | No interpolation through floors; correct depth and height. | NOT RUN |
| M06 | Cross streamed map seams repeatedly in both directions. | Continuous compatible trail; no disappearance or stale-map actor. | NOT RUN |
| M07 | Walk curved rail paths and rail junctions; reverse at a connection. | Follows distance along the real rail, including junctions; no broad rail-map exclusion. | NOT RUN |
| M08 | Walk non-grid areas and transitions between grid/rail/non-grid controllers. | Follows the sampled route; no broad non-grid exclusion or coordinate jump. | NOT RUN |
| M09 | Test ice, conveyors, falling, narrow traversal, gym machinery, and scripted transport separately. | Verified ordinary travel works; special controlled activities recall with a documented reason. | NOT RUN |
| M10 | Cross moving NPC paths and crowded doorways; let an NPC walk through follower. | NPC and player cannot be blocked by follower. | NOT RUN |
| M11 | Walk near trainer sight, switches, items, doors and encounter tiles with follower crossing first/last. | Only player actions activate player-only triggers; no duplicate encounters/events. | NOT RUN |
| M12 | Stop for five minutes, then move; use slow tiny steps to stress the history bound. | No queue growth while stationary; safe recall/reseed on overflow. | NOT RUN |
| M13 | Teleport/warp with a test tool; force a coordinate discontinuity or stale generation. | Visible follower is recalled; no cross-map/floor interpolation. | NOT RUN |

## Field lifecycle and nested guards

| ID | Steps | Expected for completed feature | Result / evidence |
|---|---|---|---|
| L01 | Doors, gates, stairs, elevators, cave exits and forced warps, each in both directions. | Cleanup before transition; recreate only after destination is ready. | NOT RUN |
| L02 | Use Fly, Escape Rope/Dig, escape effects, and other transport. | No actor left in old map; correct restoration after ordinary exploration resumes. | NOT RUN |
| L03 | Open bag, party, Pokédex, options, save, C-Gear and ordinary dialogue. | Pause/recall as appropriate; refresh party on return; no stuck input. | NOT RUN |
| L04 | Trigger a cutscene that moves the player or creates/deletes/moves NPCs. | Safe scene/NPC activity keeps the follower. Forced player movement, conflicting NPC routes or unknown actions recall before execution; script completes unchanged. | NOT RUN |
| L05 | Enter a wild battle and trainer battle; win, flee, lose, and complete a double battle. | No field actor/callback survives teardown; correct current follower on return. | NOT RUN |
| L06 | White out with the lead fainted; heal and leave the destination. | No follower during blackout; normal healing and reconstruction. | NOT RUN |
| L07 | Join/leave every available story companion sequence; enter its joint battle. | Follower absent throughout; partner flags, trainer ID and battle parties remain unchanged. | NOT RUN |
| L08 | Mount/dismount bicycle; enter/leave Surf and Dive; fish; use a field-move scene. | Recall throughout the activity; restore only after ordinary walking is available. | NOT RUN |
| L09 | Enter/leave Union Room, Entralink, Funfest and other communication/special ownership modes. | No duplicate actor or cross-mode callback; safe return. | NOT RUN |
| L10 | Chain guards: menu→warp, dialogue→battle, partner→Surf, blackout→healing script. | Ending one reason does not release any remaining suppression. | NOT RUN |
| L11 | Save with follower visible, hidden, on a seam, indoors and after party reorder; cold boot each. | Actor is not serialized; reconstruct once from party and destination. | NOT RUN |
| L12 | Load a save written by patched game in an unpatched IRDO game; walk, battle, save and reload. | No phantom NPC, altered partner state or save corruption; ordinary progress retained. | NOT RUN |
| L13 | Reset during loading, menu return, and battle return using a previous ordinary save. | Clean reconstruction; no dependence on prior module RAM. | NOT RUN |

## Rendering and interaction regression

| ID | Steps | Expected for completed feature | Result / evidence |
|---|---|---|---|
| V01 | Review all four idle/walk directions for small and large sprites. | Native ordering/timing, transparency and palette indices; no flicker or clipped frame. | NOT RUN |
| V02 | Compare mirrored and deliberately asymmetric left/right artwork. | Independent side controller respects distinct artwork. | NOT RUN |
| V03 | Test day/night, weather, interiors and dynamic lighting beside a native NPC. | Appropriate native lighting; no shared palette changes. | NOT RUN |
| V04 | Walk through tall grass, shallow water and reflective areas; behind/in front of structures. | Correct terrain effects, shadow/reflection and depth; no duplicate effects. | NOT RUN |
| I01 | Face idle follower within reach and press A; try side/back/out-of-range presses. | Normal reach/facing rules; correct cry and nickname response when valid. | NOT RUN |
| I02 | Compare healthy and low-HP responses, including placeholder art. | Imported HP-dependent text as appropriate; actual Pokémon cry/identity; no stat changes. | NOT RUN |
| I03 | Interrupt follower dialogue with a transition; repeat A quickly. | Own interaction keeps actor visible/paused; external guard wins; no repeated locks. | NOT RUN |

## Installation, assets, fault handling

| ID | Steps | Expected for completed feature | Result / evidence |
|---|---|---|---|
| T01 | Install twice, export, reopen, enable/disable, then update. | One module per role and one follower; state persists; disabled retains imported art. | NOT RUN |
| T02 | Try another region/revision and an overlapping patch. | Refused before project mutation; clear compatibility reason. | NOT RUN |
| T03 | FUTURE: replace one PNG and a batch; export/reload game without rebuilding DLLs. | Only selected appearances change; unrelated NPCs/resources remain identical. | NOT RUN |
| T04 | FUTURE: remove with matching fingerprints; repeat after modifying an owned resource. | Only owned matching changes restored; later unrelated edits preserved. | NOT RUN |
| T05 | Remove/truncate/corrupt follower configuration in a test ROM. | Follower suppresses safely; player and existing NPCs still work. | NOT RUN |
| T06 | FUTURE: malformed/missing texture, palette, descriptor, oversized count and >64-KiB descriptor offset. | Valid large offsets work; unsupported/malformed data rejected or safely suppressed. | NOT RUN |
| T07 | Fill actor pool; occupy candidate follower IDs; reduce resource heap in a debug setup. | No eviction/assertion; safe suppression; later safe retry. | NOT RUN |
| T08 | Trigger external script allocation while follower exists; unload overlay during recall. | No conflicting actor ownership or callback into unloaded module. | NOT RUN |
| T09 | FUTURE: stock NPC object codes before/after extension, including last valid rows. | Every original mapping/render remains unchanged; fixed native caches stay bounded. | NOT RUN |

## Soak and release record

Run **at least 100 mixed transition cycles**. One cycle means one departure and
return (for example outdoor→Center→outdoor, field→menu→field, field→battle→field).
Include all three categories, party changes, a blackout, and activity recall.
Record the sequence and failure cycle, not just a total. Then spend **30 minutes**
walking/running through a crowded area with repeated direction changes.

| Metric | Before | After 25 | After 50 | After 75 | After 100 | After crowded-area session |
|---|---|---|---|---|---|---|
| Live follower / total actor count | | | | | | |
| Field heap used/free | | | | | | |
| PMC heap used/free | | | | | | |
| Texture/palette allocations | | | | | | |
| Follower callbacks / resource requests | | | | | | |
| Suppression reasons after return | | | | | | |
| Crashes / stuck input / unintended encounters | | | | | | |

The alpha's `FWDG` diagnostic block reports update/spawn/delete counts,
suppression bits, selected species/object code, actor/player addresses, visibility
and trail resets. It is transient; counters restart if the module reloads.
These counters do **not** measure all heaps, GPU allocations, or external resource
requests. Collect those separately; missing telemetry is NOT RUN, not zero.

Alpha suppression bits compose by OR: `0x001` invalid/disabled configuration,
`0x002` actor-system initialization or movement/drawing stopped, `0x004` player
absent/hidden/paused, `0x008` non-walking mode, `0x010` event/fade, `0x020` story
partner, `0x040` no eligible party member, `0x080` actor-pool reserve exhausted,
`0x100` candidate IDs occupied, and `0x200` resource-heap reserve insufficient.
A zero reason allows following but still requires a tile of valid trail to appear.

A completed release requires no accumulating allocations, duplicate follower,
stuck input, incorrect battle/encounter behavior, or callback after unload.
All ordinary grid/rail/non-grid modes must pass. Every exception needs a map or
activity, a technical reason, and a reproducible test. Keep untested hardware
compatibility explicitly unverified.

## Bug report template

- Checklist ID / PASS→FAIL regression build:
- ROM hash, emulator version/settings, installed patches:
- Starting ordinary save and location; party details:
- Exact inputs and timing, including preceding transitions:
- Expected / observed behavior:
- Reproduction rate (for example 3/5 cold boots):
- Screenshot/video and before/after state/trace paths:
- Whether stock ROM reproduces the underlying event issue:

## 0.6.24 contextual dialogue — human acceptance

| ID | Procedure | Expected result | Result |
|---|---|---|---|
| CD01 | In Pokeweb, add zone 427 + Mew #151 with 100% chance and text containing `{nickname}`, `{player}`, and `{location}`. Export, cold boot in Aspertia City, and talk to Mew. | The authored contextual text replaces “Mew is looking around.” The live field zone is used even though the player actor's zone field is zero; all substitutions are readable. | NOT RUN |
| CD02 | Change the same rule to a nonmatching species, then to a nonmatching type. | The generic follower conversation resumes; no input lock, crash, or stale text. | NOT RUN |
| CD03 | Add two matching rules in reverse textual order, with distinct text. | The first listed rule always wins. | NOT RUN |
| CD04 | Add a type rule for a dual-type follower and test on both stock and White2Upgrade where applicable. | A match against either native type triggers the contextual line. | NOT RUN |

For the preceding location regression, `White2Upgrade-Following-0.7.12-alpha-Mew-Aspertia-test.nds`
already contains CD01's zone-427/Mew rule and a wildcard fallback. Use its
same-basename save and cold boot; do not resume the supplied state because it
contains the preceding field module in RAM.

## 0.6.24 / 0.7.15 one-time follower gifts — human acceptance

The ordinary release archives are intentionally empty. The dedicated 0.7.13
Mew gift test ROM contains the I01 rule described at the start of this file.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| I01 | In Pokeweb, author slot 0 for a reachable zone/species with a normal Bag item. Export, cold boot, talk to the matching follower, save, reload, and talk again. | The first interaction gives the configured quantity, plays the follower presentation and configured text, then persists the claim. The second interaction falls through to contextual/generic dialogue. | NOT RUN |
| I02 | Fill the relevant Bag pocket, then talk to an otherwise matching follower. Free space and repeat. | The full-Bag message appears and the claim stays clear. The gift succeeds after space is available. | NOT RUN |
| I03 | Author rules that differ by zone, species, form, type, HP, friendship, status and facing. Check boundaries and reorder the rule list after claiming one slot. | The first matching ordered unclaimed rule wins. Stable slots keep prior claims after reorder. | NOT RUN |
| I04 | Claim several slots on one follower, then reorder party, PC-store/withdraw, evolve, battle, save/reload, and obtain up to ten slots. | Claims remain with the individual Pokémon through ordinary save and party operations. No duplicate rewards or Battle Log counter changes. | NOT RUN |
| I05 | Author more than ten gift rules, including multiple rules that reuse one claim slot for different zones or species. Claim one of them, then test another Pokémon and another rule sharing the slot. | The archive accepts the ordered rules. The original Pokémon cannot claim another rule in the consumed slot; another Pokémon can claim its own matching rule in that slot. | NOT RUN |

Record ROM hash, rule slot, Pokémon PID/species/form, item/quantity, zone, Bag state, and save/reload evidence. Test external save/transfer tools separately because claim bits occupy legacy PK5 metadata.


<!-- generated-memory:start -->
## 0.6.32 ROM registry and buffer acceptance

All cases are NOT RUN. Automated CPU tests do not establish emulator or hardware acceptance.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| M01 | Cold boot the new ROM with its matching ordinary save, walk two tiles, talk, then enter/leave a building and battle. | Exactly one follower appears each time. No old emulator state is used. | NOT RUN |
| M02 | Switch rapidly between Unown forms, shiny/non-shiny, gender variants and unrelated species through party/PC screens. Repeat with first/last supported species. | Every appearance updates correctly across ROM cache pages; no stale sprite or missing follower. | NOT RUN |
| M03 | Use long nicknames/player names and all text speeds. Complete 100 conversations with menus and map changes between them. | The 8 KiB conversation buffer preserves messages, motions and dismissal. No stuck controls or accumulating effects. | NOT RUN |
| M04 | Complete 100 mixed field/battle/PC/door cycles. Record available heap and allocation counts at 0/10/25/50/75/100 when telemetry is available. | No growing allocation or duplicate actor. Otherwise mark allocation results UNMEASURED. Startup I/O time does not grow across cycles. | NOT RUN |
| M05 | Walk as slowly as possible on straight and diagonal stairs with a wide follower, reverse mid-step, then cross a seamless map boundary. | The 64-record trail remains continuous with no unexpected recall or shortcut. Record exact map and movement speed if it reseeds. | NOT RUN |
<!-- generated-memory:end -->


<!-- generated-ambient:start -->
## 0.6.32 wandering NPC acceptance

All rows start NOT RUN. Use a cold boot and an ordinary save. Record map, NPC, direction, species, ROM hash and a fresh state for failures.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| N01 | In an outdoor area with a wandering NPC, put the follower on a tile that NPC visits, stop and wait through multiple attempted steps. Repeat from all four sides. | Ordinary wandering NPCs do not enter the occupied follower tile. They wait/retry normally; follower remains visible. | NOT RUN |
| N02 | Move away after the NPC has been blocked. Repeat 100 times, including stopping and reversing rapidly near two wandering NPCs. | NPC resumes its normal movement when space becomes free. No frozen NPC, duplicate follower or stuck player. | NOT RUN |
| N03 | Walk toward a tile after an NPC has already begun stepping into it; repeat with crossing paths and narrow corridors. | Follower never enters the NPC reserved origin/destination. If the trail becomes blocked, follower recalls and reseeds after safe player movement rather than teleporting through the NPC. | NOT RUN |
| N04 | Walk back through the follower and trigger a trainer sight encounter with the follower between player/trainer where practical. | Player passage works. Follower does not obstruct the trainer sight query or prevent the native event. | NOT RUN |
| N05 | Talk to a follower/NPC, then run a scene whose scripted NPC walks across the follower tile. | Conversation remains usable; scripted movement recalls the follower before conflict and continues without waiting. No persistent native lock is added. | NOT RUN |
| N06 | Repeat near wandering actors on stairs, bridges and different floors, then curved rail/non-grid paths where available. | Separate elevations remain separate. Rail destination uses the actual path; no direction-based false barrier. Record exact location for failures. | NOT RUN |
| N07 | Repeat with small and large followers, shiny/form changes and, in Upgrade, Gen 6–9 leads. Recall using cycling/Surf, then observe the same NPC. | Collision uses native occupied space rather than all visible sprite pixels. Hidden/recalled followers leave no invisible blocker. | NOT RUN |
| N08 | Enter/leave doors, battle and PC boxes near wandering NPCs; repeat save/load and disable/remove patch. | No stale collision callbacks or reservations. Unpatched/disabled behavior is restored; no follower state is saved. | NOT RUN |
<!-- generated-ambient:end -->


<!-- generated-shadow-depth:start -->
## 0.6.63-alpha follower and mount shadow depth — human acceptance

Cold boot `White2-Following-0.6.63-alpha.nds` with its matching save. The Rapidash and mounted Reuniclus reports are diagnostic evidence; the new presentation is **NOT RUN** until human emulator testing.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| SD01 | Cold boot 0.6.63 with Rapidash walking on flat ground. Face and walk in all four directions while looking at the lower body and native shadow. | The shadow darkens ground only; no Rapidash pixels are shaded or cut off. | NOT RUN |
| SD02 | With Reuniclus walking normally, repeat SD01, then press A+B to ride and repeat while stopped and moving. | Walking Reuniclus retains its previous appearance. Mounted Reuniclus stays in front of the player ground shadow, with the rider at the approved height. | NOT RUN |
| SD03 | Walk and ride beside a building, overlap the player laterally, traverse stairs, then dismount and remount. | Player/Pokémon priority stays stable, the follower does not clip through the building, shadows stay on the ground, and no depth offset accumulates. | NOT RUN |
<!-- generated-shadow-depth:end -->


<!-- generated-south-priority:start -->
## 0.6.64-alpha south-facing follower priority — human acceptance

Cold boot `White2-Following-0.6.64-alpha.nds` with its matching ordinary save. `walkdown.mln` contains the prior runtime and is diagnostic evidence only. These cases are **NOT RUN** until human emulator testing.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| SP01 | Cold boot 0.6.64 with Arceus following. Walk south through the same overlap shown in walkdown.mln, then stop and repeat at several step phases. | The player remains in front of Arceus wherever their sprites intersect; neither sprite shifts on screen and the follower shadow remains on the ground. | NOT RUN |
| SP02 | Repeat with a small grounded follower, a wide Flying follower, then walk north and sideways beside a building and traverse stairs. | South-facing overlap remains stable without changing the previously accepted north-facing priority, lateral building order, stairs or shadow placement. | NOT RUN |
<!-- generated-south-priority:end -->
