"""Refresh versioned alpha sections while preserving the broader checklist."""
from pathlib import Path
HERE=Path(__file__).resolve().parent
VERSION='0.6.27'
ASSET_CASES=[
('G501',f'Cold boot {VERSION} with Snivy, Tepig and Oshawott as lead in turn; walk, run and turn in all four directions.','Each species uses its own Gen 5 art and animation. Up and down facing match the player direction; no Bulbasaur fallback, palette corruption or frame-order error.'),
('G502','Repeat G501 with shiny Gen 5 leads, including one small species and Reshiram or Zekrom.','Shiny colors are visible only on the follower; unrelated actors keep their palettes.'),
('G503','Compare male/female Unfezant, Frillish and Jellicent.','Each gender resolves to the matching artwork in normal and shiny states.'),
('G504','Test both Basculin forms, Darmanitan and Zen Mode, all Deerling/Sawsbuck seasons, Therian genies, three Kyurem forms, Keldeo, Meloetta and all Genesect drives.','Every valid White 2 form loads safely. Forms sharing source art remain stable and keep the actual party identity/cry.'),
('G505','Test Tornadus, Thundurus, Reshiram, Zekrom, Landorus and Kyurem indoors, outdoors, near doors and during follower dialogue.','64-pixel followers render without clipping or invalid resource reads; recall/send-out and conversations still complete.'),
('G506','Reorder the party between two different Gen 5 species, evolve a Gen 5 lead, then deposit/withdraw it.','Appearance refreshes to the selected party member with exactly one follower and no stale sprite.'),
('G507','Cycle species 494–649 in normal and shiny states with a prepared save/tool, including every valid form and gender difference.','All 624 appearance keys display Gen 5 art; no missing-resource crash or Bulbasaur placeholder.'),
('G508','Run 100 mixed transitions while alternating small/large and normal/shiny Gen 5 leads.','No increasing load time, duplicate actor, stuck controls, palette bleed, or accumulating actor/texture/palette allocation.'),
('G509','Test normal and shiny Landorus in both forms and inspect all four directions and both walk frames. Spot-check Victini, Gigalith, Vanillite, Ferrothorn, Golett, Terrakion, both Tornadus and Thundurus forms, Reshiram, Zekrom and all Kyurem forms.','No opaque neon-magenta pixels appear. The 17 repaired resources use their normal-palette color at source sentinel entries while retaining the remaining shiny palette colors.'),
]
start='<!-- generated-gen5-assets:start -->';end='<!-- generated-gen5-assets:end -->'
section=start+f'\n## {VERSION} Gen 5 sprite acceptance\n\nRun G509 first in melonDS for the palette correction, then G501 and explicitly check up versus down before continuing with G502–G505. These rows are **NOT RUN** until the human tester records results. Use a cold boot of the {VERSION} ROM; an older emulator state contains earlier runtime instructions and resource tables.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in ASSET_CASES)
section+='\nRecord species, form, gender, shiny state, map, emulator, ROM hash and a screenshot for any mismatch.\n'+end
path=HERE/'EMULATOR-CHECKLIST.md';text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(ASSET_CASES)} Gen 5 sprite cases; no emulator tests executed.')
CASES=[
('C01',f'Cold boot {VERSION} from an ordinary save. Walk two tiles, stop, turn toward the follower without walking into it, then tap A.','One visible follower faces the player; an HGSS motion/cry/emote and English response play. A/B closes the text; follower stays visible and movement resumes.'),
('C02','Repeat from north, south, east and west on flat open ground.','All four directions work. Facing away, standing too far away, or overlapping the follower does not start a conversation.'),
('C03','Face an NPC, sign, item or field-action target with the follower nearby. Repeat while holding A and while pressing A plus a direction.','The normal target/action takes priority. No doubled dialogue, skipped item or unintended follower event.'),
('C04','Approach across a wall, corner, ledge, bridge/underpass, disconnected floor, or vertical height difference.','Cannot talk through an obstruction or between floors. Following resumes normally after repositioning.'),
('C05','Talk on straight and curved rail paths and in non-grid exploration areas, facing each reachable direction.','Talk works where standing close and unobstructed. Record map, coordinates, facing and spacing if it fails; no broad map exclusion is intended.'),
('C06','Repeat with full HP, 75%, just below 75%, 50%, just below 50%, 25%, just below 25%, and 1 HP.','Appropriate generic HP reactions; low-HP distressed cries may sound lower. No extra duplicate cry. Exact dialogue is probabilistic.'),
('C07','Repeat with poison, bad poison, sleep, burn, freeze and paralysis using prepared test saves.','Generic condition-aware reactions; asleep takes precedence over burn/freeze/paralysis when diagnosing modified saves. Poison has highest priority. No status or HP is changed.'),
('C08','Use prepared saves with friendship 0, 1, 29, 30, 59, 60, 89, 90, 149, 150, 199, 200, 254 and 255.','Messages vary within imported friendship conditions. Repeated talking does not change friendship; mood stays neutral and is not saved.'),
('C09','Repeat with small, large, tall, floating, Diglett and Dugtrio followers inside/outside, near another Pokémon NPC.','Emotes sit above the follower and animate cleanly. Hops/turns return to the original position; Diglett/Dugtrio stay grounded. No shared NPC recoloring.'),
('C10','Use a long nickname and player name, mixed case, punctuation and supported non-ASCII name characters. Test slow/medium/fast text.','Real names display without raw tokens, garbled text or clipping. Native text speed, page advance, and A/B dismissal work.'),
('C11','Talk to a species/form currently displayed with fallback artwork. Reorder/deposit/withdraw party members, then talk again.','Nickname and cry belong to the actual selected Pokémon. New identity appears after returning to the field; no stale party pointer or old response.'),
('C12','Hold A through the entire opening motion and text; release, then press A/B. Rapidly alternate A/B and try X/Start while talking.','Opening A does not instantly dismiss; a held button does not reopen. No menu under dialogue, overlapping window, or stuck controls.'),
('C13','After talking, open/close party and summary, enter/exit a door, and trigger a battle. Repeat immediately after dismissing text.','Owned event ends, ordinary guards work, and exactly one follower returns after walking.'),
('C14','Use a nearby scripted trigger/warp to interrupt motion, emote, printing and closing where possible. Record stages inaccessible through normal input as BLOCKED.','External event wins. No lingering text, offset, bubble, callback or control lock; player and NPC events keep their own locks.'),
('C15','Talk, save normally, cold boot the same ROM, and later open a copy of that save in unpatched White 2.','No persistent conversation state or duplicate actor; ordinary saves remain usable. Do not load an old emulator state to test a new DLL.'),
('C16','Perform 100 complete conversations at normal speed, moving between each. Every tenth conversation open a menu; every twentieth enter/exit a building.','No growing pause, actor duplication, leftover bubble/window, palette corruption or stuck controls. Log heap/texture/palette counts if debugger telemetry is available.'),
('C17','Repeat near a crowded NPC area, at night, in rain/snow and in grass.','Native scene remains intact. Bubbles have correct transparency/depth; no sustained allocation growth. Record elapsed time and baseline/end resources.'),
('C18','In Pokeweb install twice, export/reopen, disable/reexport, enable/reexport, then remove runtime/reexport and reinstall.','One field module and one resident event module when installed; disabled/removed build has no follower. Artwork retained. Removal leaves two inert file slots and shared PMC; no later unrelated edits are lost.'),
('C19','Developer fixture only: omit/corrupt dialogue data, omit emotes, exhaust effect allocations, or fail message creation.','Invalid dialogue data prevents starting. Missing cosmetics are skipped. Message failure cancels safely; field control remains. Record BLOCKED if no fault-injection setup.'),
('C20','Dismiss a conversation with A, stand still for five seconds, release and talk again without moving, then walk away. Repeat using B, all four directions, and a curved rail path. Immediately after another dismissal, trigger an NPC event, X menu, or door.','No ball, disappearance, duplicate actor or new send-out after the follower conversation alone. Repeat talk works without walking first; following resumes on the existing trail. Safe NPC/sign conversations and the X menu keep it visible; doors and unsafe scenes recall, then exactly one follower returns after walking.'),
]
start='<!-- generated-conversations:start -->';end='<!-- generated-conversations:end -->'
section=start+f'\n## {VERSION} conversations — human acceptance\n\nStart with C20 in melonDS to check the recall fix, then C01–C03 and C12–C13. These rows are **NOT RUN** until the human tester records results. The automated 100-conversation tests use native-service mocks and do not count as C16.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in CASES)
section+='\nFor C16, log checkpoints 0 / 10 / 25 / 50 / 75 / 100: map, follower actor count, controls, effects, field/PMC heap, texture and palette allocations. If telemetry is unavailable, mark allocations UNMEASURED rather than PASS. Attach a normal save and a fresh emulator state for failures.\n'+end
path=HERE/'EMULATOR-CHECKLIST.md';text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(CASES)} human conversation cases; no emulator tests executed.')

SCENES=[
('S01',f'Cold boot {VERSION} from an ordinary save in Aspertia City. Walk until the follower is visible, then talk to an NPC whose normal behavior includes random walking. Repeat while the NPC is beside the follower or facing a tile the follower occupies.','The NPC freezes for the conversation and the follower remains visible at the same position and facing. No recall/send-out occurs from the NPC\'s dormant queued route; normal wandering resumes after dismissal.'),
('S02','Read an Aspertia City outdoor sign, then inspect a trash can or other static furniture, then read another sign indoors or on a route. Repeat from each reachable direction with a wandering NPC nearby.','Follower stays visible and paused for every static interaction. Unrelated paused NPC routes do not recall it. Reading or inspecting again immediately works; facing turns alone do not recall.'),
('S03','Choose both Yes and No and each list-menu option in a conversation that stays in the field. Record the NPC and save/story stage.','Choice windows work normally. Follower remains for safe choices; an option entering an application/battle/warp recalls before that action.'),
('S04','Run a saved story scene in which the player stays stationary. Record the location, story stage and script/event ID if available.','Follower remains while audited commands and child events execute. If it recalls, capture FollowingSceneDebug reason/opcode rather than marking the scene safe by appearance alone.'),
('S05','During a stationary scene with a camera pan/zoom, sound or NPC emote, watch the follower and then return to walking.','Camera/presentation alone keeps the same actor. No duplicate effect, changed palette, facing reset, snapped position or send-out on resume.'),
('S06','Arrange a scripted NPC walking away from the follower, then a route passing nearby without occupying its native tile footprint.','Follower stays visible. NPC route, timing and destination are unchanged. Record any conservative recall with its action/reason.'),
('S07','Repeat with a scripted NPC route crossing the follower, including a multi-step route that crosses only after dialogue ends or actors are unpaused.','A dormant paused route does not recall. Once movement actually commits toward the occupied space, the follower disappears before the conflicting coordinate write. It stays suppressed until the whole event chain ends, then returns after walking.'),
('S08','Trigger forced player walking, jumping, stair/rail repositioning, teleportation and an ordinary facing turn separately.','Translation/jumping/repositioning recalls before movement. A simple facing turn keeps the follower. No input lock, blocking or change in scripted route.'),
('S09','Test NPC placement/spawn at the follower and far away. Use a controlled script fixture if no repeatable stock scene is available.','Conflicting placement recalls before it executes. Distant verified placement keeps the follower. Unknown placement modes may recall with a specific diagnostic.'),
('S10','Use a developer fixture that requests the follower ID or exhausts the actor pool; also delete an unrelated actor.','Follower relinquishes its actor before native allocation. Unrelated deletion keeps the follower; no duplicate, missing story NPC or native allocation assertion. Mark BLOCKED without a fixture.'),
('S11','Repeat dialogue, facing and NPC routes on a curved rail area, a non-grid area and a bridge/underpass. Record map and coordinates.','Stationary dialogue remains visible in all exploration modes. Verified rail paths use their real curve/direction; separate elevations do not collide. Unsupported profiles recall with reason 7.'),
('S12','Take a dialogue branch into a trainer battle, map warp, full-screen application or story-partner sequence. Also take the branch that stays in dialogue.','Only the executed unsafe branch recalls. Independent battle/warp/activity/partner guards win. Safe branch keeps the actor.'),
('S13','Use nested common scripts, list-menu/camera child events, normal dialogue-end cleanup, and an unknown child event or cleanup finisher fixture.','Safe children keep the actor; unknown child recalls before its callback. Recall persists when returning to a parent script. Native command order/results remain unchanged.'),
('S14','Press A rapidly at the last page; alternate A/B, talk again immediately, talk to the follower, then walk.','No completion-frame recall, input lock, duplicate conversation or lost trail. Own-follower conversations retain the 0.4.1 completion behavior.'),
('S15','Finish dialogue that changes the party, then walk; also reorder or use the PC after a conversation.','Selection refreshes when control returns. Same identity reuses the actor; changed identity uses normal replacement. No temporary party pointer or old nickname/cry persists.'),
('S16','Enter/exit a building, battle, reload a normal save and disable/re-enable the patch after safe and recalled scenes.','Callbacks and private resources are released at teardown. Exactly one follower returns. Cold boot each exported ROM; existing saves remain intact.'),
('S17','Complete 100 mixed NPC/sign/choice conversations and supported scenes. Every tenth cycle walk, open a menu and talk to the follower; every twentieth enter/exit a building.','No duplicate actors, stuck input, accumulating actor/heap/texture/palette allocations, lingering effects or altered native events. Record checkpoints 0/10/25/50/75/100; allocations without telemetry are UNMEASURED.'),
('S18','Test an unsupported standard and extended opcode through a developer fixture, including one in an untaken branch.','Executed unknown opcode recalls before dispatch and still executes normally. Untaken branch does not recall. Record the opcode and FollowingSceneDebug ring; mark BLOCKED without a fixture.'),
]
start='<!-- generated-scenes:start -->';end='<!-- generated-scenes:end -->'
section=start+f'\n## {VERSION} external dialogue and scenes — human acceptance\n\nStart with S02 at the supplied Aspertia City sign, then test static furniture and S01. Continue with S03, S14, S07–S08 and S12. Aspertia locations are suggested repeatable dialogue targets, not claims that the corrected build was emulator-tested. For scenes without a named stock fixture, record your location/save stage or mark BLOCKED. All results remain NOT RUN until entered by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in SCENES)
section+='\nCapture the ROM hash, native script ID (if available), event origin, opcode/action, field generation, disposition and recall reason. Reason 1 = unknown command; 2 = unknown event; 3 = player movement; 4 = space conflict; 5 = actor ID; 6 = pool pressure; 7 = unsupported movement; 8/9 = event/VM capacity; 11 = actor loss; 12 = bridge failure; 13 = unsupported/invalid cleanup. `FollowingSceneDebug` begins with `FWSE` and contains a bounded 32-entry ring; do not dereference pointer-valued diagnostic identities.\n'+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(SCENES)} human scene cases; no emulator tests executed.')

MENU_CASES=[
('X01','On flat ground with the follower visible, open and close the bottom-screen menu ten times without selecting an application, using both X and touch entry.','The follower remains visible and paused at the same position and facing while the menu is open. Closing it resumes the same actor and trail with no recall or send-out animation.'),
('X02','Repeat X01 on the reported stairs with a 64-pixel follower. Frame-step several frames while the menu is open and immediately after closing it.','The follower does not move under the menu. Its stair depth ordering remains stable and closing the menu does not introduce a one-frame draw-order change.'),
('X03','From the X menu, enter Party, Bag and Pokédex, then return to the field and walk.','Each child application may use the normal conservative recall. Returning creates exactly one follower, restores controls and never reuses a stale menu event.'),
('X04','Use a Pokémon Center PC with the follower visible. Watch the terminal turn-on/run/turn-off sequence, enter the Box, then close it without changing the party.','The follower remains visible during the field-side PC sequence. Entering the Box does not play a recall effect; after the field returns, the follower is immediately visible at the preserved pose with no send-out animation.'),
('X05','Enter the Box, deposit or reorder the previous lead so another eligible Pokémon is selected, then return to the field. Repeat after withdrawing it.','If the selected Pokémon changes, the old pose is rejected. After leaving the PC dialogue and walking, exactly one follower appears with the new identity/artwork/cry. Editing other party slots or boxes keeps the unchanged follower out.'),
('X07','Cold boot and walk both ways between Floccesy Town (zone 439) and Route 20 (zone 446) 20 times, including walking/running, stopping immediately on the seam, turns, and small/64-pixel followers. Also repeat on another seamless outdoor boundary. Also enter a door or gate with a fade.','Seamless crossings retain the visible actor and trail without ball effects. Doors/warps still recall. A new-zone cutscene, actor ID conflict or occupied trail may still require recall.'),
('X06','Repeat opening/closing the X menu 20 times and entering/leaving the PC Box 20 times, alternating movement and follower conversations between cycles.','No duplicate actor, stuck input, stale pose, unwanted ball effect, increasing pause or visible resource accumulation. Record heap/texture/palette counters when available; otherwise mark those counters UNMEASURED.'),
]
start='<!-- generated-menu-pc:start -->';end='<!-- generated-menu-pc:end -->'
section=start+f'\n## {VERSION} X-menu and PC retention — human acceptance\n\nRun X01 and X04 first in melonDS. These rows are **NOT RUN** until the human tester records results. The PC Box restarts the field internally, so acceptance is based on seamless visible reconstruction at the same validated pose rather than preservation of the old actor allocation.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in MENU_CASES)
section+='\nFor any failure, record whether it occurred during the field-side PC animation, field teardown, Box UI, or field reconstruction. Include the party before/after and whether a recall or send-out effect appeared.\n'+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(MENU_CASES)} X-menu/PC cases; no emulator tests executed.')

DEPTH_CASES=[
('D01','Use Kyurem or another 64-pixel follower on flat ground. Walk left and right for at least 20 tiles, including starts, stops and reversals while the follower overlaps the player.','The follower remains consistently behind the player during side-to-side overlap. No alternating body parts or per-step priority flicker.'),
('D02','Cold boot the new ROM at the stair setup used for the reported failure. Walk upward one step at a time and frame-step or use slow motion through the middle of each step; repeat going down and after reversing direction.','There are no 3–4-frame flashes of the player over the foreground follower at any point in the step. The large follower occludes the player wherever their artwork overlaps, including during stair interpolation.'),
('D03','On the same stairs, reverse the arrangement so the follower is behind the player, then cross at the midpoint repeatedly.','The follower stays behind until it has moved more than half a tile into the foreground. The change occurs once per crossing without flicker.'),
('D04','Repeat D01 with Sigilyph (32 pixels), then another small follower. Frame-step through a complete walk/bob cycle in each direction.','Both sprite sizes receive the final-draw correction. Flat sideways overlap stays consistently behind the player; no alternating pixels, position drift or size pulse.'),
('D05','Repeat with a 64-pixel follower on a map whose camera is rotated, including a rail or non-grid area if available.','Foreground follows the camera-facing world axis. The sprite does not shift sideways, detach from its shadow, or alternate priority during screen-horizontal travel.'),
('D06','Talk to the large follower and a nearby NPC on flat ground and stairs, then trigger recall/send-out.','Dialogue motions, emotes and ball effects remain aligned. Closing dialogue resumes the same depth behavior with no accumulated offset.'),
('D07','Recreate the supplied stairssink position with a 64-pixel follower, then repeatedly walk down the stairs at normal speed and in frame advance.','The follower stays seated on its native stair anchor. It does not sink behind the stair face or lose its lower body because of an artificial backward offset.'),
('D08','Recreate the supplied stairssideclipping position. Traverse the stairs left/right while going both up and down, including reversals at mid-step.','Railings, walls and platform pieces that are behind the follower remain behind it. Geometry actually in front still occludes normally; the follower does not draw through the whole map.'),
('D09','Recreate the supplied smallclipsidestairs position with Zekrom following one step below the player. Ascend left-to-right and right-to-left at normal speed and in frame advance.','The upper part of Zekrom, including its head above the player, stays in front of the rear stair railing. Stair geometry that is actually in front still occludes the follower normally.'),
('D10','Recreate the supplied minorheadclip position partway up the stairs. Continue left-to-right and right-to-left through the step at normal speed and in frame advance.','No rear-railing pixels cover Zekrom\'s head at the partial-elevation frame. The follower remains seated on the stair path and actual foreground geometry still occludes it.'),
('D11','Use Sigilyph first, then Tornadus or another 64-pixel follower on flat ground. Walk left and right through the player repeatedly at normal speed and in frame advance, including starts, stops and reversals.','Every overlapping follower pixel remains consistently behind the player throughout each animation cycle. No wing, head or body region alternates in front for individual frames.'),
('D12','Use the wide follower from the building screenshot, then Zekrom and Sigilyph, on flat ground directly in front of a building facade. Walk left and right alongside the wall and through the player, including stops and reversals.','The follower remains consistently behind the player without sinking into facade, window, pillar or doorway pixels that are geometrically behind it.'),
]
start='<!-- generated-large-depth:start -->';end='<!-- generated-large-depth:end -->'
section=start+f'\n## {VERSION} large-sprite draw priority — human acceptance\n\nRun D04 and D12 first in melonDS, then D11, D10, D09, D07, D08 and D01–D03. These are the direct regressions for the supplied screenshots and stair states. Cold boot the {VERSION} ROM; do not resume an old state after replacing the ROM because it contains the previous field module.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in DEPTH_CASES)
section+='\nFor any failure, capture both actors at the overlap and record map, coordinates, camera angle, follower species/form, direction of travel, and whether the follower should be in front or behind.\n'+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(DEPTH_CASES)} large-sprite priority cases; no emulator tests executed.')

# Keep the entry instructions in sync with generated versioned test rows.
text=path.read_text()
a=text.index('## Start here:');b=text.index('The alpha follows automatically',a)
intro=f"""## Start here: {VERSION}-alpha sign and furniture regression

Use `White2-Following-{VERSION}-alpha.nds` and its same-basename `.sav`
from the workspace parent directory. The build copies the previous alpha save
without overwriting an existing destination save. Cold boot from an ordinary
save; old emulator states contain old runtime instructions.

Start with S02 at the supplied Aspertia City sign, then inspect a trash can or other static furniture. The follower must stay visible throughout. Continue with S01 for a random-walking NPC and CD01 using zone 427 and Mew. The user confirmed the preceding menu and PC fixes; repeat X01, X04 and X05 as regressions. Then repeat N01–N08 for wandering NPCs, simultaneous movement, conversations,
scripted routes and rail/elevation separation. The ROM registry cache and 8 KiB
conversation buffer remain in place. Follow with M01–M05 and spot-check stairs,
building frontage, menus and PC return for regressions.

The user accepted stock 0.6.10 as good enough. Its movement and main actor-pass
drawing corrections are unchanged. This does not mark every checklist row
passed; the new release has automated CPU checks only.

"""
path.write_text(text[:a]+intro+text[b:])

start='<!-- generated-memory:start -->';end='<!-- generated-memory:end -->'
cases=[
('M01','Cold boot the new ROM with its matching ordinary save, walk two tiles, talk, then enter/leave a building and battle.','Exactly one follower appears each time. No old emulator state is used.'),
('M02','Switch rapidly between Unown forms, shiny/non-shiny, gender variants and unrelated species through party/PC screens. Repeat with first/last supported species.','Every appearance updates correctly across ROM cache pages; no stale sprite or missing follower.'),
('M03','Use long nicknames/player names and all text speeds. Complete 100 conversations with menus and map changes between them.','The 8 KiB conversation buffer preserves messages, motions and dismissal. No stuck controls or accumulating effects.'),
('M04','Complete 100 mixed field/battle/PC/door cycles. Record available heap and allocation counts at 0/10/25/50/75/100 when telemetry is available.','No growing allocation or duplicate actor. Otherwise mark allocation results UNMEASURED. Startup I/O time does not grow across cycles.'),
('M05','Walk as slowly as possible on straight and diagonal stairs with a wide follower, reverse mid-step, then cross a seamless map boundary.','The 64-record trail remains continuous with no unexpected recall or shortcut. Record exact map and movement speed if it reseeds.'),
]
section=start+f'\n## {VERSION} ROM registry and buffer acceptance\n\nAll cases are NOT RUN. Automated CPU tests do not establish emulator or hardware acceptance.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in cases)+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'
path.write_text(text)

start='<!-- generated-ambient:start -->';end='<!-- generated-ambient:end -->'
cases=[
('N01','In an outdoor area with a wandering NPC, put the follower on a tile that NPC visits, stop and wait through multiple attempted steps. Repeat from all four sides.','Ordinary wandering NPCs do not enter the occupied follower tile. They wait/retry normally; follower remains visible.'),
('N02','Move away after the NPC has been blocked. Repeat 100 times, including stopping and reversing rapidly near two wandering NPCs.','NPC resumes its normal movement when space becomes free. No frozen NPC, duplicate follower or stuck player.'),
('N03','Walk toward a tile after an NPC has already begun stepping into it; repeat with crossing paths and narrow corridors.','Follower never enters the NPC reserved origin/destination. If the trail becomes blocked, follower recalls and reseeds after safe player movement rather than teleporting through the NPC.'),
('N04','Walk back through the follower and trigger a trainer sight encounter with the follower between player/trainer where practical.','Player passage works. Follower does not obstruct the trainer sight query or prevent the native event.'),
('N05','Talk to a follower/NPC, then run a scene whose scripted NPC walks across the follower tile.','Conversation remains usable; scripted movement recalls the follower before conflict and continues without waiting. No persistent native lock is added.'),
('N06','Repeat near wandering actors on stairs, bridges and different floors, then curved rail/non-grid paths where available.','Separate elevations remain separate. Rail destination uses the actual path; no direction-based false barrier. Record exact location for failures.'),
('N07','Repeat with small and large followers, shiny/form changes and, in Upgrade, Gen 6–9 leads. Recall using cycling/Surf, then observe the same NPC.','Collision uses native occupied space rather than all visible sprite pixels. Hidden/recalled followers leave no invisible blocker.'),
('N08','Enter/leave doors, battle and PC boxes near wandering NPCs; repeat save/load and disable/remove patch.','No stale collision callbacks or reservations. Unpatched/disabled behavior is restored; no follower state is saved.'),
]
section=start+f'\n## {VERSION} wandering NPC acceptance\n\nAll rows start NOT RUN. Use a cold boot and an ordinary save. Record map, NPC, direction, species, ROM hash and a fresh state for failures.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in cases)+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'
path.write_text(text)

SPACING=[
('W01','Cold boot with a narrow follower, Sigilyph, then Zekrom. Walk/run left and right for 20 tiles, stop and reverse.','Wider visible artwork receives up to six extra world units of spacing; narrow art stays closer. The gap stays stable across animation frames; no extra rendering offset or sudden sideways jump.'),
('W02','Walk north/south, then repeated L bends and tight reversals with a wide follower, including stairs, rails and non-grid paths.','North/south travel retains a one-tile delay. Corners follow the recorded route; no cutting through walls, disconnected floors or visible teleport. Record camera orientation on rotated maps.'),
('W03','After sideways travel, stop and talk facing the follower from both sides. Repeat near a wall, NPC and sign, then talk after vertical travel.','A reaches the wider-spaced follower when adjacent and unobstructed. No talk through walls, two-tile talk, NPC/sign stealing or stuck input; same gap resumes afterward.'),
('W04','With wide art, repeat D07–D12 stairs/building/overlap checks, X01/X04 menus and PC, X07 Floccesy Town/Route 20, and N01–N08 NPC collision.','Existing rendering/retention/scene guards remain effective with the longer horizontal trail. Record any new clipping or unexpected recall.'),
('W05','Switch between narrow, wide, shiny and form variants through party and PC, including a placeholder. Walk in both horizontal directions after each switch.','Spacing follows the displayed artwork and stays constant through each walk cycle. No stale width, duplicate follower or growing delay.'),
]
start='<!-- generated-spacing:start -->';end='<!-- generated-spacing:end -->'
section=start+f'\n## {VERSION} width-dependent spacing — human acceptance\n\nRun W01–W05 on both profiles. Approximate pixels depend on camera scale; spacing uses native east/west world distance. All cases are NOT RUN until the human tester records results.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in SPACING)+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)

IDLE=[
('I01','Cold boot with a small follower, then a 64-pixel follower. Stop for ten seconds facing north, south, east and west.','The follower continuously cycles its normal directional idle pose. It stays on the recorded trail position and keeps the selected facing.'),
('I02','Walk, stop, rapidly turn, stop again, then repeat on stairs, rails and a non-grid area.','The correct directional loop resumes after each stop. There is no trail movement, overlap jump, visual snap or recall caused by idling.'),
('I03','Start a follower conversation, an NPC/sign conversation, the X menu and PC presentation. Watch the follower before dismissing each.','The follower freezes on its current idle frame while the owned interaction or retained external event is active. It resumes its loop only after normal exploration returns.'),
('I04','Enter a door and trigger a battle, forced movement scene or other normal recall. Watch send-out and recall effects, then walk after returning.','Ball effects and hidden/suppressed states do not advance a visible idle loop. The normal directional loop starts only once a visible follower is following again.'),
('I05','Repeat I01–I04 with a shiny, form/gender variant and a wide follower.','Idle behavior does not alter the selected appearance, palette, width-dependent spacing, draw order, collision behavior or conversation responses.'),
]
start='<!-- generated-idle:start -->';end='<!-- generated-idle:end -->'
section=start+f'\n## {VERSION} stationary follower animation — human acceptance\n\nRun I01–I04 on both profiles after a cold boot with the matching save. These rows are **NOT RUN** until the human tester records results.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in IDLE)+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
print(f'Regenerated {len(SPACING)} spacing and {len(IDLE)} stationary-animation cases; no emulator tests executed.')

SHADOW=[
('H01','Cold boot with a small follower, then a 64-pixel follower. Walk two tiles on flat outdoor ground, stop, turn and walk again.','One native ground shadow appears under the follower, tracks its feet and does not move with animation bob. The player keeps its own shadow.'),
('H02','Walk up and down stairs, across grass and a bridge, then cross a seamless map boundary.','The shadow follows native terrain height and stays below the follower. No detached or duplicate shadow appears after the boundary.'),
('H03','Open/close the X menu and PC, talk to the follower and an NPC, then enter a door or battle and return. Repeat 20 times.','The paused follower retains one shadow; recall removes it and return restores one. No leftover shadow, actor, or accumulating effect allocation.'),
]
start='<!-- generated-shadow:start -->';end='<!-- generated-shadow:end -->'
section=start+f'\n## {VERSION} follower ground shadow — human acceptance\n\nRun H01 first in melonDS after a cold boot. All rows remain NOT RUN until the human tester records results.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in SHADOW)+end
text=path.read_text()
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
path.write_text(text)
