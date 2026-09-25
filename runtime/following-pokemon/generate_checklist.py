"""Render the human checklist from a static template and generated case tables."""
from pathlib import Path
HERE=Path(__file__).resolve().parent
text=(HERE/'checklist-template.md').read_text()
VERSION='0.6.32'
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
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')

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
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
print(f'Regenerated {len(DEPTH_CASES)} large-sprite priority cases; no emulator tests executed.')

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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'

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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'

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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')

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

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')
print(f'Regenerated {len(SPACING)} spacing and {len(IDLE)} stationary-animation cases; no emulator tests executed.')

SHADOW=[
('H01','Cold boot with a small follower, then a 64-pixel follower. Walk two tiles on flat outdoor ground, stop, turn and walk again.','One native ground shadow appears under the follower, tracks its feet and does not move with animation bob. The player keeps its own shadow.'),
('H02','Walk up and down stairs, across grass and a bridge, then cross a seamless map boundary.','The shadow follows native terrain height and stays below the follower. No detached or duplicate shadow appears after the boundary.'),
('H03','Open/close the X menu and PC, talk to the follower and an NPC, then enter a door or battle and return. Repeat 20 times.','The paused follower retains one shadow; recall removes it and return restores one. No leftover shadow, actor, or accumulating effect allocation.'),
('H04','Compare a grounded Pokémon (Bulbasaur or Mewtwo) with a Flying-type Pokémon (Pidgeot or Charizard) on flat ground, then on stairs. Inspect feet and shadow while idle and walking.','The grounded sprite sits at its shadow with no raised-looking transparent gap. Flying-type artwork keeps its previous height. The shadow position and player sprite remain unchanged.'),
('H05','For diagnosis only, compare a grounded follower in 0.6.28 and 0.6.29 at the same position.','The extra three pixels in 0.6.29 also move the native shadow. This is the known regression corrected by 0.6.30.'),
('H06','Cold boot 0.6.30 with a grounded small follower and Serperior. Compare their shadows with the player shadow on flat ground, then walk and cross stairs.','The follower sprites keep their lowered artwork position while their full shadows stay at ground level, in line with the player shadow. Serperior has a complete shadow rather than a cut-off upper half.'),
('H07','Cold boot 0.6.31 with Serperior. Face up and down on flat ground, then repeat while walking and on stairs. Compare the sprite and full shadow with the player.','Facing up moves the shadow about seven pixels and the artwork about five pixels upward; facing down moves both about six pixels downward. Left/right positioning and movement remain unchanged.'),
('H08','Cold boot 0.6.32 with Serperior, walk north until it overlaps the player, and compare with 0.6.31 if available. Repeat with a smaller follower and on stairs.','Serperior draws in front of the player where their sprites overlap while walking north; its confirmed artwork/shadow placement, stairs, and side-facing depth remain stable.'),
]
start='<!-- generated-shadow:start -->';end='<!-- generated-shadow:end -->'
section=start+f'\n## {VERSION} follower ground shadow — human acceptance\n\nRun H01 first in melonDS after a cold boot. All rows remain NOT RUN until the human tester records results.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {id} | {steps} | {expected} | NOT RUN |\n' for id,steps,expected in SHADOW)+end

if start in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('## Run record',section+'\n\n## Run record')

SURF_VERSION='0.6.49'
SURF_CASES=[
('SF01','Cold boot stock White 2 0.6.49 with a normal Swimming-folder Pokémon that knows Surf in party slot 1. Surf north, south, west and east.','Its four-direction swimming animation replaces the retail mount; the native seated rider and ripple remain. The rider keeps the approved ten-pixel lift while mounted.'),
('SF02','Put two Pokémon that know Surf in the party, then use L/R to follow the later one. Start Surf and repeat after selecting the earlier one.','The currently selected follower supplies the mount in both cases, even when another Surf knower appears earlier in party order.'),
('SF03','Test a shiny Surf knower and an eligible native-form variant with matching source sheets.','Matching shiny/form artwork appears. If a shiny form sheet is missing, same-form normal color takes priority over shiny base art.'),
('SF04','Select a follower that does not know Surf with L/R, with Surf knowers in later party slots. Try Surf in each move slot, then reorder the party.','The first non-Egg Surf knower in party order supplies the mount when the selected follower lacks Surf. All four move slots are honored.'),
('SF05','Try a fainted Surf knower, a move with zero PP, an Egg with Surf before a valid knower, and a party with no Surf knower.','Fainted and zero-PP members can supply art. Eggs are skipped. No qualifying member uses the retail mount; native Surf permission checks still decide whether entry is allowed.'),
('SF06','Start Surf from shore in each reachable facing direction and watch the complete hop frame by frame.','The old 3D mount is suppressed during entry, the matching custom pose appears as its textures load, the rider draw priority is unchanged, and the ripple continues.'),
('SF07','Surf and dismount repeatedly; change party order or moves, cross a map seam, enter a battle, save, and cold reload.','The mount tracks the current party, resources release on field teardown, and exactly one land follower resumes after dismount.'),
('SF08','Cold boot with Azumarill knowing Surf. Compare its size with Arceus, then move while facing down and stop at several phases, including the location of facingdown.mln.','Azumarill uses a 32-pixel texture at half its 0.6.40 display size; Arceus remains 64 pixels. The rider stays behind the south-facing mount throughout movement and idle, with no alternating overlap.'),
('SF09','Cold boot 0.6.49, Surf west onto the shore at the location of disembark.mln, and watch the last frames of the hop. Repeat in other reachable directions.','Once the mount disappears, the rider loses the ten-pixel riding lift immediately and follows the native landing arc; no brief invisible-platform pause or sudden extra drop occurs.'),
('SF10','Cold boot 0.6.49, select a Surf knower with L/R while another Surf knower is earlier in the party, and enter Surf. Select a non-Surf follower and repeat.','The selected Surf-capable follower supplies the first mount. With a non-Surf follower, the first Surf knower in party order supplies the second mount. The selected land follower returns on dismount.'),
]
start='<!-- generated-surf:start -->';end='<!-- generated-surf:end -->'
section=start+f'''\n## Start here: {SURF_VERSION}-alpha party Surf acceptance

Use `White2-Following-{SURF_VERSION}-alpha.nds` and its same-basename `.sav` from the workspace parent directory. Cold boot from an ordinary save; old emulator states contain earlier runtime code. These cases target stock US White 2; White2Upgrade Surf has separate U26 and U30 cases. The rows below are **NOT RUN** until you record results. Earlier checklist sections remain available as regression cases.

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
'''
section+=''.join(f'| {case} | {steps} | {expected} | NOT RUN |\n' for case,steps,expected in SURF_CASES)
section+='\nFor a failure, record direction, Surf animation phase, selected party member, map, ROM hash and a state made with this ROM. The following runtime exports `FollowingSurfDebug` with loaded/active, capture/draw counts, frame and failure reason. Do not resume a state created by an older build.\n'+end

if start in text and end in text:
    text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
elif start in text:
    # Repair a prior generated file that has a start marker without an end.
    text=text.replace(start,section,1)
else:
    text=text.replace('## Start here:',section+'\n\n## Start here:',1)
print(f'Regenerated {len(SURF_CASES)} Surf cases; no emulator tests executed.')

TERRAIN_CASES=[
('TE01','Cold boot stock White 2 0.6.46 with the matching save. Spawn a grounded follower in grass, then walk several tiles through grass and pavement.','A grass fringe appears under the follower when it first becomes visible in grass and on each grass tile entered. It disappears after leaving grass. The game remains responsive.'),
('TE02','Repeat TE01 with a Flying-type follower and a large grounded follower. Stop, turn, open a menu, and resume walking.','Flying followers have no grass fringe. Grounded followers retain their grass fringe while stationary. No duplicate effect, shadow loss, or freeze.'),
('TE03','Walk across dust, footprints, shallow water, stairs and bridge tiles where the player creates a native effect.','This build targets grass only; record those other missing effects for the next terrain pass. The unsafe native movement-context dispatcher remains unused.'),
('TE04','Cold boot 0.6.46 with the matching save. Walk, then run repeatedly across the Virbank Complex / Virbank City matrix-0 seam in both directions. Repeat beside another seamless zone boundary.','The follower stays visible through the seam at walking and running speed, without a recall/send-out animation or duplicate actor. Scripted player moves and warps still recall normally.'),
]
start='<!-- generated-terrain:start -->';end='<!-- generated-terrain:end -->'
section=start+'\n## Start here: 0.6.46-alpha stock grass and running seam\n\nThese checks are NOT RUN. Cold boot the matching versioned ROM and ordinary save; do not resume an older state. The supplied `noterrain.mln`, `noterrain2.mln`, `transitionrecall.mln`, and `followerfreeze.mln` contain older runtime code. This build uses the native grid-attribute query and grass task while keeping the unsafe movement-context dispatcher disabled.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in TERRAIN_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-surf:start -->',section+'\n\n<!-- generated-surf:start -->',1)
print(f'Regenerated {len(TERRAIN_CASES)} terrain cases; no emulator tests executed.')

CYCLE_CASES=[
('CY01','Cold boot 0.6.48 with three healthy non-Egg party Pokémon. On open ground tap R twice, then L once; repeat at both ends of the party order.','R advances and L reverses through eligible party slots with wraparound. Each switch recalls the old follower before sending out the next; the party order does not change.'),
('CY02','Press both shoulders together, hold one shoulder, and press either again during recall and send-out. Repeat while talking, in a menu, at a door, and during Surf.','Both shoulders together do nothing; one held press switches once. Input during an effect or another field owner cannot start another switch or leave two follower actors.'),
('CY03','Place an Egg and a fainted Pokémon between two healthy members. Try a party with only one eligible member, then a party where every non-Egg is fainted.','Eggs are skipped. Healthy members take priority when available; if all are fainted, non-Egg members can be selected. One eligible member does not recall itself.'),
('CY04','Select a follower with L/R, then open and close the menu and PC without changing the party. Reorder the party, cross a seamless zone, and try a battle.','The party order remains unchanged by cycling, and exactly one eligible follower returns after each transition. The manual choice survives actor-system replacement but may reset to the ordinary lead after a full field unload; record when that happens.'),
('CY05','Cycle between a small sprite and a 64-pixel sprite while facing left and right, first while stationary and then while walking. Repeat near stairs or a building.','The new follower appears after recall without requiring an extra player step. Its spacing, shadow, and draw priority match its species without stale art or clipping.'),
]
start='<!-- generated-follower-cycle:start -->';end='<!-- generated-follower-cycle:end -->'
section=start+'\n## 0.6.48-alpha L/R follower cycling — human acceptance\n\nCold boot the matching ROM and ordinary save. These cases are NOT RUN until recorded by the human tester; do not resume an older savestate.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in CYCLE_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-terrain:start -->',section+'\n\n<!-- generated-terrain:start -->',1)
print(f'Regenerated {len(CYCLE_CASES)} follower-cycle cases; no emulator tests executed.')

LAND_CASES=[
('LM01','Cold boot the matching stock White 2 ROM and ordinary save. Select a healthy visible follower, stop on clear outdoor ground, and press A+B together. Repeat by holding A and pressing B, then holding B and pressing A.','Each stopped A+B press order mounts or dismounts instantly, with no Poké Ball effect. Dismount restores one safe trailing follower or waits hidden for a trailing tile.'),
('LM02','Press A alone to inspect a sign, NPC and furniture. Hold B while moving and press A, then stop and press A while still holding B.','Ordinary A interactions work. Movement prevents mounting; stopped B-held plus newly pressed A mounts. L/R cycling on foot remains separate.'),
('LM03','Mount small and 64-pixel followers, including mirrored, shiny, female, and form art. Face all four directions and observe both animation poses. Repeat with Arceus facing left and right.','The rider uses each appearance’s visible two-pose midpoint. Arceus’s side rider sits ten pixels higher on its back while its up/down positions are unchanged. Rider is in front facing up/sideways and behind the Pokémon facing down; priority does not flicker.'),
('LM04','On a long flat path, compare mounts with different Personal base Speed values, such as Snorlax (30), Voltorb (100), and Arceus (120). If available, compare two Pokémon of one species at different levels or natures.','Mount pace follows Personal base Speed: Snorlax is slower, Voltorb matches bicycle pace, and Arceus is faster. Different levels or natures of the same species do not change its pace. The synthetic 0–255 curve and cap are covered by packaged tests.'),
('LM05','Cross grass, slopes, stairs, bridges, and special terrain while mounted.','Native land collision, grass and special-terrain handling remain active. Slope and scripted movement keep native timing.'),
('LM06','Run and walk across a seamless outdoor zone boundary while mounted.','The same selected mount remains visible without a recall/send-out sequence or duplicate follower.'),
('LM07','Open and close an ordinary menu, then change the party or store the mounted Pokémon in the PC.','Ordinary menus pause and resume the mount; a changed or removed party member dismounts safely.'),
('LM08','Enter a door, begin ordinary Surf while on foot, trigger a wild and trainer battle, then return outdoors.','The mount ends before unsafe modes, with no leftover mount or duplicate actor; the ordinary follower can resume afterward.'),
('LM09','Dismount in a narrow passage or beside a blocking NPC, then move until a trailing tile is free. Watch the return frame by frame.','The follower does not occupy a blocked tile or flash through the player; one ball send-out plays when it reappears on a safe trailing tile.'),
('LM10','Save while mounted and cold reload the save. Repeat mount/dismount 20 times and use L/R selection on foot.','The loaded save resumes with a normal follower. Repeated toggles do not leak graphics resources; L/R follower cycling remains unchanged on foot.'),
('LM11','Ride while walking, then hold B to run and release B on a long flat path. Watch the mounted Pokémon and rider separately, then stop.','The Pokémon’s two movement frames and the trainer’s three bike-derived hair-sway frames both speed up while moving with B held. The rider remains in a seated idle pose when stopped; no bicycle wheels, handlebars, or ground-touching stop pose appears.'),
('LM12','Mount a 64-pixel follower, hold B to run in each of the four directions, then repeat with a 32-pixel follower.','The mount alternates poses within its own texture; no flashing black rectangle or disappearing Pokémon appears in any direction.'),
('ST01','Mount a healthy Surf-knowing follower with HM03 in the Bag. Walk toward eligible water in each direction, without pressing A.','The Surf effect starts on that attempted step, the same Pokémon carries the rider one tile onto water without a jump, and the ripple and draw order remain stable.'),
('ST02','Surf to a clear shore in each direction and move onto land. Repeat at one-tile and two-tile shorelines.','The player moves through native collision without a hop and returns to the same land mount. Rider, Pokémon and shadow remain aligned.'),
('ST03','Repeat ST01 after removing HM03, removing Surf from the mounted Pokémon, and mounting one without custom Surf artwork. Keep a different Surf user in another party slot.','Automatic entry does not occur; the mounted Pokémon is not replaced by another party member, and the land mount and ordinary controls remain usable.'),
('ST04','Repeat ST01 with Surf at zero PP, then change party order and try again.','Zero PP does not block the handoff. The chosen mounted Pokémon remains the Surf mount if its party identity still matches.'),
('ST05','Surf through an outdoor map seam, then leave the water. Repeat water entry and exit twenty times.','The handoff survives safe seams, returns to the same Pokémon, and neither mount art nor ripple leaks or duplicates.'),
('ST06','While Surfing, change the party or remove the mount when the game permits, then leave the water; also test battle entry and an unsafe scripted scene.','Changed or unavailable Pokémon finish on foot. Battles and unsafe scenes do not restore a stale land mount.'),
('ST07','Mount and dismount manually several times while listening, then perform automatic water entry.','Each successful manual mount plays one stock Surf-hop sound. Failed mounts and manual dismounts are silent; automatic entry has no duplicated sound.'),
]
start='<!-- generated-land-mount:start -->';end='<!-- generated-land-mount:end -->'
section=start+'\n## Start here: 0.6.53-alpha stock White 2 land mounts and Surf handoff\n\nCold boot `White2-Following-0.6.53-alpha.nds` with its matching ordinary save. Do not resume an older state. These cases remain **NOT RUN** until the human tester records results.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in LAND_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-surf:start -->',section+'\n\n<!-- generated-surf:start -->',1)
print(f'Regenerated {len(LAND_CASES)} land-mount cases; no emulator tests executed.')

REPEL_CASES=[
 ('RP01','With a visible walking follower, let Repel expire while another Repel remains. Choose No, then repeat and choose Yes. Stand still through the prompt and move afterward.','The same follower remains visible during both choices, with no recall or send-out. Repel use and the prompt behave normally.'),
 ('RP02','Mount a follower on land, let Repel expire, and try both No and Yes. Repeat near water without entering it.','The same mount and rider remain visible and aligned throughout the prompt and after it closes. No dismount, recall, duplicate effect, or replacement occurs.'),
 ('RP03','While riding a custom Surf Pokémon on water, let Repel expire and try both No and Yes.','The same Surf artwork and rider remain visible through the prompt. The native ripple and movement resume after the choice.'),
 ('RP04','Enter a battle, doorway, or scripted warp after the Repel checks.','Those unsafe transitions still recall or end the follower/mount as before; Repel does not make other scripted events exempt.'),
]
start='<!-- generated-repel-continuation:start -->';end='<!-- generated-repel-continuation:end -->'
section=start+'\n## 0.6.62-alpha Repel continuation — human acceptance\n\nCold boot `White2-Following-0.6.62-alpha.nds` with its matching save. After Yes, confirm that one Repel is consumed and the follower or mount never recalls. The supplied `repel.mln` contains an older runtime, so do not resume it to test this build. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in REPEL_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-land-mount:start -->',section+'\n\n<!-- generated-land-mount:start -->',1)
print(f'Regenerated {len(REPEL_CASES)} Repel continuation cases; no emulator tests executed.')

SURF_SLOT_CASES=[
 ('SS01','Cold boot the 0.6.55 stock ROM with its matching save. Leave party slot 1 as the automatic follower rather than selecting it with L/R. Mount Arceus, confirm it knows Surf and HM03 is in the Bag, then press toward water.','The mounted Arceus begins Surf immediately instead of playing the blocked-movement bump. The water mount remains Arceus.'),
 ('SS02','Repeat after selecting Arceus explicitly with L/R, then remove Surf or HM03 and try again.','Both automatic and explicit selection transition when eligible. Missing Surf or HM03 leaves the land mount in place and uses the ordinary blocked-movement response.'),
 ('SS03','Leave water, remount, and repeat the crossing several times.','Shore exit restores the same land mount; repeated crossings do not duplicate mounts or leave art loaded after dismount.'),
]
start='<!-- generated-surf-slot:start -->';end='<!-- generated-surf-slot:end -->'
section=start+'\n## 0.6.55-alpha mounted Surf handoff — human acceptance\n\nCold boot `White2-Following-0.6.55-alpha.nds` with its matching ordinary save. The supplied `mounted.mln` contains an older runtime and is diagnostic evidence, not a valid acceptance state for the new build. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SURF_SLOT_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-repel-continuation:start -->',section+'\n\n<!-- generated-repel-continuation:start -->',1)
print(f'Regenerated {len(SURF_SLOT_CASES)} Surf-slot cases; no emulator tests executed.')

SURF_DIRECTION_CASES=[
 ('SD01','Cold boot 0.6.56 with Arceus mounted beside water. Face right, then press Up into the water. Repeat facing down and left before pressing Up.','The Surf Pokémon appears directly ahead, faces up from its first frame, and carries the rider onto the water tile. No sideways offset or land/water-border stall.'),
 ('SD02','At accessible shores in all four directions, enter water after first facing each of the other three directions.','The pressed direction controls both the initial Surf effect and the tile transfer on all twelve mismatched-facing cases, including opposite-facing input.'),
 ('SD03','Attempt the same turn toward a non-water obstruction or with HM03 or Surf missing, then turn and walk on land.','No Surf event starts; the rider remains mounted and ordinary facing and movement remain usable.'),
 ('SD04','Enter and leave water repeatedly after a turn, then cross an outdoor map seam and repeat.','Each entry lands on water and each exit returns to the same mount without a stuck border, duplicate sprite, or stale facing.'),
]
start='<!-- generated-surf-direction:start -->';end='<!-- generated-surf-direction:end -->'
section=start+'\n## 0.6.56-alpha mounted Surf direction — human acceptance\n\nCold boot `White2-Following-0.6.56-alpha.nds` with its matching ordinary save. `badtransition.mln` contains the previous runtime and is diagnostic evidence only. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SURF_DIRECTION_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-surf-slot:start -->',section+'\n\n<!-- generated-surf-slot:start -->',1)
print(f'Regenerated {len(SURF_DIRECTION_CASES)} Surf-direction cases; no emulator tests executed.')

SURF_ENTRY_CASES=[
 ('SE01','Cold boot 0.6.57 with mounted Arceus at the Virbank shore. Face left, then press Right toward water. Repeat with each opposite and perpendicular facing.','The first water sprite is complete and remains beneath the rider throughout the transfer; it neither starts two tiles away nor snaps into place on landing.'),
 ('SE02','Cold boot 0.6.57 at the Humilau ocean shore with mounted Arceus, HM03 in the Bag, and Surf known. Press Down into the adjacent ocean tile.','The mounted Surf handoff begins instead of a blocked-movement bump, and the rider lands on water.'),
 ('SE03','Repeat across other Surfable shoreline and ocean tiles, then try dry obstructions and missing Surf or HM03.','Every game-Surfable water type accepts the handoff; dry or ineligible attempts leave the land mount and ordinary interaction intact.'),
 ('SE04','Enter and leave water repeatedly, including after an outdoor seam.','Water art remains attached to the rider during entry, and the same land mount returns on shore without stale textures or duplicate sprites.'),
]
start='<!-- generated-surf-entry:start -->';end='<!-- generated-surf-entry:end -->'
section=start+'\n## 0.6.57-alpha Surf entry art and ocean water — human acceptance\n\nCold boot `White2-Following-0.6.57-alpha.nds` with its matching ordinary save. Supplied savestates contain the previous runtime and are diagnostic evidence only. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SURF_ENTRY_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-surf-direction:start -->',section+'\n\n<!-- generated-surf-direction:start -->',1)
print(f'Regenerated {len(SURF_ENTRY_CASES)} Surf-entry cases; no emulator tests executed.')

MOUNT_BOB_CASES=[
 ('MB01','Cold boot 0.6.58 with a grounded land mount. Walk on a flat path in each direction, then stop.','The Pokémon alternates its two walking poses and the Pokémon and seated rider rise together by one pixel on alternating poses. Both settle when stopped; the ground shadow stays fixed.'),
 ('MB02','While mounted, hold B to run, release B without stopping, then stop and resume walking.','The two-pose bounce speeds up with B, changes cadence without a large position jump, and returns to the normal walking cadence.'),
 ('MB03','Repeat with small and large follower sprites, including Arceus, and across grass, stairs and an outdoor seam.','The rider remains attached, the shadow stays at ground level, and terrain, draw order and seam continuity remain unchanged.'),
]
start='<!-- generated-mount-bob:start -->';end='<!-- generated-mount-bob:end -->'
section=start+'\n## 0.6.58-alpha land-mount movement — human acceptance\n\nCold boot `White2-Following-0.6.58-alpha.nds` with its matching ordinary save. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in MOUNT_BOB_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-surf-entry:start -->',section+'\n\n<!-- generated-surf-entry:start -->',1)
print(f'Regenerated {len(MOUNT_BOB_CASES)} mount-bob cases; no emulator tests executed.')

SHORE_MENU_CASES=[
 ('SM01','Cold boot 0.6.59 at the Humilau waterline with the same mounted Surf Pokémon. Press toward dry sand without opening a menu.','The shore exit uses the short two-tile transfer and restores the land mount on dry sand.'),
 ('SM02','Surf to the Humilau waterline, open and close the party menu without changing the party, then press toward dry sand.','The same Pokémon returns as a land mount; there is no retail walking dismount.'),
 ('SM03','While surfing, alter or remove the mounted Pokémon or its Surf move in the party menu, then leave the water.','The old mount is not restored; the native on-foot result remains safe.'),
 ('SM04','Repeat at a one-tile dry shore and at a blocked rock or object frontage.','Ordinary shore spacing is unchanged and blocked destinations remain blocked.'),
 ('SM05','Mount on land and enter water repeatedly in several directions, including a turn toward water.','No striped or corrupted pixels appear while the custom Surf art replaces the land mount.'),
]
start='<!-- generated-shore-menu:start -->';end='<!-- generated-shore-menu:end -->'
section=start+'\n## 0.6.59-alpha shore, menu, and texture handoff — human acceptance\n\nCold boot `White2-Following-0.6.59-alpha.nds` with its matching ordinary save. The supplied earlier savestates are diagnostic evidence, not a cold-boot acceptance result. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SHORE_MENU_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-mount-bob:start -->',section+'\n\n<!-- generated-mount-bob:start -->',1)
print(f'Regenerated {len(SHORE_MENU_CASES)} shore/menu cases; no emulator tests executed.')

WATER_FLAG_CASES=[
 ('WF01','Cold boot 0.6.60 in Humilau with a Surf-knowing land mount and HM03. Walk onto each light-blue Splash-only beach tile, then stop.','The player remains on the land mount through every Splash-only tile; no Surf effect, ripple, or movement lock starts.'),
 ('WF02','From the last Splash-only tile, press toward the adjacent darker tile marked Water+Splash in Pokeweb.','That attempted Water step starts the custom Surf effect once. The same Pokémon carries the rider onto water without a jump or one-tile offset.'),
 ('WF03','Repeat WF01–WF02 from each accessible direction, then return to dry sand.','Only tiles with Water set start Surf. The shore exit returns to the same land mount on dry land without a hop or corrupted sprite.'),
 ('WF04','Try another map with an ordinary Water tile, and a blocked Water frontage.','An eligible Water tile still starts Surf; a blocked frontage never starts the custom handoff.'),
]
start='<!-- generated-water-flags:start -->';end='<!-- generated-water-flags:end -->'
section=start+'\n## 0.6.60-alpha Water-versus-Splash entry — human acceptance\n\nCold boot `White2-Following-0.6.60-alpha.nds` with its matching ordinary save. The supplied image identifies the Pokeweb Water and Splash flags; it is not an emulator test. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in WATER_FLAG_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-shore-menu:start -->',section+'\n\n<!-- generated-shore-menu:start -->',1)
print(f'Regenerated {len(WATER_FLAG_CASES)} Water/Splash cases; no emulator tests executed.')

STRIPED_ENTRY_CASES=[
 ('FE01','Cold boot 0.6.61 with mounted Arceus at the Humilau Water edge. Face Right, then press Down and watch the first three transition frames.','The previous land pose stays intact until the Surf pose is ready. No striped pixels appear on the Pokémon or rider.'),
 ('FE02','Repeat the water entry after facing each other direction, including an opposite-facing turn.','Every first Surf frame is complete, correctly oriented and positioned beneath the rider.'),
 ('FE03','Repeat land-to-water and water-to-land twenty times at Humilau and at a normal one-tile shore.','No texture corruption, missed mount, stale land art, or growing slowdown occurs.'),
 ('FE04','At the Humilau City–Route 21 edge, ride south from sand into water, dismount on the small sand island, then keep holding Down into water and return to shore. Repeat while moving at full mounted speed.','The second Surf starts only from a completed centered step. Sprite, footprints, collision and adjacent tile checks remain on the same tile after every crossing.'),
 ('FE05','Repeat FE04 in the opposite direction and with a pause between each water crossing.','The shore exit completes on the visible landing tile. Map-boundary crossing does not leave the game using a neighboring tile for collision or effects.'),
]
start='<!-- generated-striped-entry:start -->';end='<!-- generated-striped-entry:end -->'
section=start+'\n## 0.6.61-alpha first-frame Surf texture handoff — human acceptance\n\nCold boot `White2-Following-0.6.61-alpha.nds` with its matching ordinary save. `strippedsprite.mln` contains the previous loaded runtime and is diagnostic evidence only. These cases are **NOT RUN** until recorded by the human tester.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in STRIPED_ENTRY_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text=text.replace('<!-- generated-water-flags:start -->',section+'\n\n<!-- generated-water-flags:start -->',1)
print(f'Regenerated {len(STRIPED_ENTRY_CASES)} first-frame Surf cases; no emulator tests executed.')

# Older runs could leave several adjacent start markers when a new generated
# section was inserted ahead of an existing one. Keep reruns idempotent.
import re
path=HERE/'EMULATOR-CHECKLIST.md'
for marker in ('terrain','follower-cycle','repel-continuation','land-mount'):
 start=f'<!-- generated-{marker}:start -->'
 text=re.sub(r'(?m)(?:^'+re.escape(start)+r'\n){2,}',start+'\n',text)

SHADOW_DEPTH_CASES=[
 ('SD01','Cold boot 0.6.63 with Rapidash walking on flat ground. Face and walk in all four directions while looking at the lower body and native shadow.','The shadow darkens ground only; no Rapidash pixels are shaded or cut off.'),
 ('SD02','With Reuniclus walking normally, repeat SD01, then press A+B to ride and repeat while stopped and moving.','Walking Reuniclus retains its previous appearance. Mounted Reuniclus stays in front of the player ground shadow, with the rider at the approved height.'),
 ('SD03','Walk and ride beside a building, overlap the player laterally, traverse stairs, then dismount and remount.','Player/Pokémon priority stays stable, the follower does not clip through the building, shadows stay on the ground, and no depth offset accumulates.'),
]
start='<!-- generated-shadow-depth:start -->';end='<!-- generated-shadow-depth:end -->'
section=start+'\n## 0.6.63-alpha follower and mount shadow depth — human acceptance\n\nCold boot `White2-Following-0.6.63-alpha.nds` with its matching save. The Rapidash and mounted Reuniclus reports are diagnostic evidence; the new presentation is **NOT RUN** until human emulator testing.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SHADOW_DEPTH_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'
print(f'Regenerated {len(SHADOW_DEPTH_CASES)} shadow-depth cases; no emulator tests executed.')

SOUTH_PRIORITY_CASES=[
 ('SP01','Cold boot 0.6.64 with Arceus following. Walk south through the same overlap shown in walkdown.mln, then stop and repeat at several step phases.','The player remains in front of Arceus wherever their sprites intersect; neither sprite shifts on screen and the follower shadow remains on the ground.'),
 ('SP02','Repeat with a small grounded follower, a wide Flying follower, then walk north and sideways beside a building and traverse stairs.','South-facing overlap remains stable without changing the previously accepted north-facing priority, lateral building order, stairs or shadow placement.'),
]
start='<!-- generated-south-priority:start -->';end='<!-- generated-south-priority:end -->'
section=start+'\n## 0.6.64-alpha south-facing follower priority — human acceptance\n\nCold boot `White2-Following-0.6.64-alpha.nds` with its matching ordinary save. `walkdown.mln` contains the prior runtime and is diagnostic evidence only. These cases are **NOT RUN** until human emulator testing.\n\n| ID | Steps | Expected | Result / evidence |\n|---|---|---|---|\n'
section+=''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in SOUTH_PRIORITY_CASES)
section+=end
path=HERE/'EMULATOR-CHECKLIST.md'
if start in text and end in text:text=text[:text.index(start)]+section+text[text.index(end)+len(end):]
else:text+='\n\n'+section+'\n'
print(f'Regenerated {len(SOUTH_PRIORITY_CASES)} south-priority cases; no emulator tests executed.')

# Replace the rendered checklist only after every section is built.
output=HERE/'EMULATOR-CHECKLIST.md'
temporary=output.with_suffix('.tmp')
temporary.write_text(text)
temporary.replace(output)
