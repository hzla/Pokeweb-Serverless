# Following Pokémon — human emulator checklist

The generated checklist collects targeted regression cases before the baseline cases below. All rows begin NOT RUN; host and isolated-CPU checks are not game-emulator results. Cold boot the current profile export with an ordinary matching save. Record ROM hash, emulator version, map, species/form, facing, and a fresh state for failures.

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
| FX02 | With follower visible, walk into a Pokémon Center or ordinary house. Repeat slowly. | Observe white shrinking silhouette → brief ball → disappearance. Record whether the door fade cuts the sequence short. Interior loads normally. | NOT RUN |
| FX03 | Walk inside, exit, then walk away from the doorway. | Send-out replays once after a valid trail. No old-map effect or extra follower remains. Repeat entry/exit ten times. | NOT RUN |
| FX04 | Face each direction before triggering recall; walk/run through left/right turns immediately after send-out. | Ball/flash stay near the Pokémon; no offset to another tile, incorrect depth or sideways texture corruption. | NOT RUN |
| FX05 | Open/close X menu after send-out completes; immediately enter a door after closing it; repeat rapid interruptions. | X menu preserves the visible follower without an effect. Door transition cancels safely with normal input, no stuck hidden/white follower and no lingering ball. | NOT RUN |
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
