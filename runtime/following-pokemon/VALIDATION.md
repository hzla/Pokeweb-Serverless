# Validation record

Status: **stock White 2 0.6.63, Black 2 0.6.37, White2Upgrade 0.7.32, and Italian White 2 0.6.38 packaged and installer checks passed. Shadow presentation and prior feature acceptance remain pending human cold-boot tests.**

## Walking and mounted shadow depth, September 24

The Rapidash report concerns its own attached shadow. The supplied mounted
Reuniclus state shows the follower shadow suppressed during riding while the
player's ground shadow remains active; this explains why walking Reuniclus is
not an affected example. Native shadows are drawn in a later effects pass.
The new draw helper advances only a submitted Pokémon billboard ahead of the
ground-shadow footprint when needed. It compensates perspective scale to keep
the projected sprite pixels in place, then restores the native billboard
before the effects pass. Actor world/grid position, shadow ground anchor,
texture assets, and persistent state are unchanged.

Host projection tests passed for perspective and orthographic cameras.
Packaged ARM946 draw tests passed for shadow separation, all four mounted
directions, rider priority, billboard restoration, repeated draws, scene
ownership, and unchanged effects submission. The four profile builds passed
their existing scene, interaction, Surf, land-riding, and transition checks.
Each exported ROM passed Pokeweb install, reinstall, disable/reenable,
removal, and export/reopen; upgrading from its immediately preceding alpha
retained enabled state and authored dialogue. No game emulator was run.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.63-alpha.nds` | `601a0a862de3e6450b703cb1fc2cb8de02737c5c8ecb2a0bce3061bda3ff13bc` | 61,840 B |
| Black 2 | `Black2-Following-0.6.37-alpha.nds` | `25fb58bcf00111511f97d96d1c883c579e5c51e639c485e595c4add79e4c5ba6` | 61,712 B |
| White2Upgrade | `White2Upgrade-Following-0.7.32-alpha.nds` | `851aebf0e808eb7325b57d802b4ebcdf16d35a6906dc3abc936dc98f0373b991` | 62,700 B |
| Italian White 2 | `White2Italy-Following-0.6.38-alpha.nds` | `415baeeeedcd5231c1d634bf95fa8ea8b11d35691f34397e4cb4d81733c3c835` | 61,888 B |

The correction adds 816 bytes of fixed module payload per profile and no new
runtime heap buffer. These figures exclude native graphics allocations,
loader metadata, stack, and VRAM. Rapidash, walking and mounted Reuniclus,
player overlaps, buildings, stairs, and repeated mount cycles remain **NOT
RUN** visually; use the profile checklists before accepting the draw order.

## Black 2, White2Upgrade, and Italian White 2 feature parity, September 24

The three nonstock profiles now package the same A+B land-riding and custom
Surf modules as stock White 2, including rider animation, mounted water/shore
handoff, preferred-follower Surf selection, dismount send-out, and the scoped
Repel Yes/No retention rule. Black 2 and Italian White 2 use the Gen 1–5 Surf
catalog; White2Upgrade uses its Gen 1–9 catalog. Each has its own binary
contract, PMC modules, installer receipt, and same-profile save family.

Black 2's 34 mount hook/adapter sites and Italian White 2's 391 complete
hook/adapter signatures matched their pinned revision-0 ROMs. White2Upgrade's
34 mount signatures and source rider sheets matched its pinned ROM. Packaged
ARM946 Surf selection/draw, scene, input, rider draw, and transition tests
passed, including the Repel continuation's Yes branch, both water-entry and shore-exit paths,
directional draw order, and texture handoff. Pokeweb install, export/reopen,
disable/reenable, removal/reinstall, and upgrade from the prior delivered
versions passed for all three profiles. The upgrade checks retained enabled
state and authored dialogue. No game emulator was run; animation, terrain,
and native graphics timing require the human cold-boot checklists.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Black 2 | `Black2-Following-0.6.36-alpha.nds` | `896d308009624e00ecd517cbe2a5c7c586d2d6651d13e3ab837cf270280b3751` | 60,896 B |
| White2Upgrade | `White2Upgrade-Following-0.7.31-alpha.nds` | `0caaaca96658568973aee38efb0cbb8cab55a119faca8791c0d731e1b2a14a08` | 61,884 B |
| Italian White 2 | `White2Italy-Following-0.6.37-alpha.nds` | `aa6dbfa707d32aaee2d37f534e9d16a56aebf56f2d892b469654498ec11610ad` | 61,072 B |

The payload figures are code, initialized data, and BSS, not measured peak
heap use. The Black 2 and White2Upgrade delivery saves were copied from their
immediately preceding alpha save files without overwriting those files. No
Italian save was present to copy; no US save was used.

## Stock White 2 Repel Yes-branch retention, September 24

The user's cold-boot check found that declining another Repel kept the follower,
but accepting it still recalled the follower or mount. The earlier scene test
modeled a choice without executing the Yes branch. The pinned stock script in
`a/0/5/6` member 1248 skips item use on No; Yes executes native command
`0x2c2` before formatting the player/item names and confirming use. That
command was outside the scene policy. Stock 0.6.62 allows it only while script
10144 is active. The native item-use handler and terrain code are unchanged.

The packaged ARM946 scene test now checks both reachable branches against the
retail script bytes and native command table. It keeps the follower through
Yes and No, while the same opcode in another script still recalls. A packaged
field-update test keeps an active land mount after the Yes opcode. The full
100-cycle stock package suite, Pokeweb install/export/reopen/disable/removal,
and an installed 0.6.61→0.6.62 upgrade with authored dialogue passed. The
matching save was copied byte-for-byte from 0.6.61 without overwriting it.
No game emulator was run; RP01–RP04 remain pending human checks.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.62-alpha.nds` | `7633d16fd220505db846bc990d82457e6e687b9cc551e30e970d0aedd5c061c9` | 61,024 B |

The fixed payload is 12 bytes above 0.6.61; this is not a peak heap measure.

## Stock White 2 Surf first-frame and shoreline alignment, September 24

A headless diagnostic run resumed the supplied `strippedsprite.mln` on the
previous 0.6.60 ROM. The striped sprite lasted one frame; the next Surf draw
was complete. The saved player was already between tile centers when the
next Surf entry began: its grid was `(784,190)` while its world X/Z position
was approximately `(783.875,190.312)`. Entry now waits for a centered mounted
step, so the native transfer starts from the same tile used for collision.
The Surf textures are prepared while the land rider's texture allocations
are still live; those old allocations are released after two field ticks to
avoid reusing a key referenced by queued draw commands.

The supplied `desynced.mln` on 0.6.60 showed the player actor's world Z at
tile center `188.5` while its logical grid Z was `189`; the transition record
reported a completed two-tile Up shore exit. The 0.6.61 completion path
corrects the grid only if the actor is at a centered world position exactly
one tile away in the recorded exit direction. The saved states are in
different field zones (`0x1cf` and `0x1d1`); this is compatible with the
reported Humilau City–Route 21 route but does not establish the boundary as
the cause. The human checklist covers the repeated sand–water–island–water
route across that boundary.

Exact stock hook bytes and packaged ARM946 tests passed, including all four
shore directions, sixteen old/new facing pairs, incomplete-step rejection,
Water-versus-Splash gating, and the delayed one-shot texture release. The 39
focused web tests, production build, install/reinstall, export/reopen,
disable/reenable, removal/reinstall, artwork replacement, and
0.6.60→0.6.61 upgrade passed; authored dialogue and gifts were retained.
The fixed packaged payload is 61,012 bytes, 252 bytes above 0.6.60. This
excludes the temporary overlap of native texture allocations and is not a
measured peak heap charge. The new ROM itself was not run in an emulator;
FE01–FE05 remain pending cold-boot visual acceptance by the user. The alpha
save was copied from 0.6.60 without overwriting any existing save.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.61-alpha.nds` | `bcdc9277a9e4ffb6c7cee01eea4e01695336dcba5ab1e0cbad4c313e4d2df784` | 61,012 B |

## Stock White 2 Water-versus-Splash entry, September 24

Pokeweb exposes Water as flag `0x0002` and Splash as `0x0010`; both live in
the high half of the packed map attribute. The previous mounted Surf entry
guard checked only low-half terrain values, so a Splash-only tile with a
water-like terrain value could start Surf early. The stock 0.6.60 guard now
requires Water set and Blocked clear on the front tile in addition to the
existing party, HM03, native movement, and scene checks. It no longer rejects
Water+Splash shallows merely because their terrain value is sand (`0x17`).

The packaged ARM946 test passed Splash-only terrain values `0x17`, `0x3f`,
`0x40`, `0x41`, and `0x44`, blocked Water, ordinary Water, Humilau's
Water+Splash sand attribute `0x160017`, all four directions and sixteen
old/new facing pairs. The exact stock binary contract, 39 focused web tests,
production build, install/export/reopen, disable/reenable,
removal/reinstall, artwork replacement, and 0.6.59→0.6.60 upgrade with
authored dialogue and gifts retained passed. The fixed packaged payload is
60,760 bytes, 40 bytes below 0.6.59; this is not a measured steady-state
heap charge. No game emulator was run for 0.6.60. WF01–WF04 require a cold
boot and remain pending.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.60-alpha.nds` | `4f58024c8e385cd46deb89f6b8220df7e2742991f3eec62821d212390184b76a` | 60,760 B |

## Stock White 2 shore, party menu, and Surf texture handoff, September 24

In the supplied `humilauwater.mln`, a headless diagnostic run on 0.6.58
reached the native shore check on every Up attempt. The collision query
accepted the frontage, but its terrain ID was sand (`0x17`) with the water
flag set (`0x16` flags), so the retail shore classifier did not request the
required second tile and the final water-flag check rejected the exit. Forcing
the native two-tile branch in the diagnostic run created the ordinary exit
event and transferred the player to dry sand. Stock 0.6.59 classifies a
water-flagged frontage as a two-tile shore only during an armed land/Surf
handoff; native collision and final dry-tile flags still decide the landing.

The party menu can unload the field module, which previously discarded the
temporary mount identity. The resident event bridge now holds one menu-only
token and restores it only when the same game, location, Surf mode, party
slot, Pokémon identity, HP, and Surf move still match. A changed party or
other scene leaves the retail on-foot exit. The Surf mount draw also waits
until the field frame after its textures are uploaded; this is intended to
avoid drawing a newly recycled VRAM key during the land-rider teardown.

The supplied `glitchytransition.mln` was inspected frame by frame on the
previous ROM; the saved frame resumes after the striped interval, so the
artifact could not be reproduced from that state. The texture change requires
cold-boot visual acceptance. Diagnostic emulator observations above are
separate from packaged CPU and installer verification below.

Exact stock hook bytes and packaged ARM946 tests passed for the shore span,
native exit handoff, menu snapshot/restore, one-shot resident token, identity
rejection, and upload-frame draw guard. The 39 focused web tests, production
build, install/export/reopen, disable/reenable, removal/reinstall, artwork
replacement, and 0.6.58→0.6.59 upgrade with authored dialogue and gifts intact
also passed. The fixed packaged payload is 60,800 bytes, 820 bytes above
0.6.58; this is not a steady-state heap measurement. SM01–SM05 remain pending
on a cold boot of the new ROM.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.59-alpha.nds` | `cd3a86d33a5345029c183a6141131e27ea481d133c9f019229f44fadfb652344` | 60,800 B |

## Stock White 2 land-mount walking bounce, September 24

The retail male walking textures have a one-pixel top-edge change between
movement poses, and Arceus's installed follower art alternates between opaque
bottom rows 61 and 60 in its up/down pairs. This confirms the observed small
vertical motion is present in the stock animation frames. The mounted follower
was held in place, and the custom land draw only alternated its two-pose frame
while B was held. Stock 0.6.58 now alternates that frame every ten field ticks
while mounted and moving, or every five with B held. On the raised pose, the
submitted mount and seated rider lift together by one world pixel. The shadow,
native actor positions and stored billboards are unchanged; stopped mounts
return to the seated idle frame without a lift.

Packaged ARM946 draw tests cover normal and B-held cadence, B release, a
stationary stop, all four directions, draw priority, shadow/body isolation,
and restoration of the native billboards. The stock package, 39 focused web
tests, production build, ROM install/export/reopen, disable/reenable, removal/
reinstall and replacement artwork checks passed. The previous 0.6.57 ROM
updates without changing authored dialogue or gifts. No game emulator was run
for 0.6.58; MB01–MB03 remain pending on a cold boot.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.58-alpha.nds` | `7a1dff31a10cf71dc134542e57e56d0c65dc4815e9af94e372a299ae12bd1a05` | 59,980 B |

## Stock White 2 mounted Surf art and ocean entry, September 24

The supplied `mountedleft.mln` showed a provisional custom water sprite before
the native Surf effect had provided a mount object. In `offsetsurfer.mln`, the
effect object was roughly two tiles north of the rider during entry and only
converged after landing. Stock 0.6.57 waits for the first validated native
effect capture, then draws the custom sprite at the rider's position during
the no-hop transfer. The native effect object's transform is not rewritten;
ordinary Surf remains on its existing path.

A diagnostic headless run of the previous build from `humilau.mln` found the
adjacent ocean attribute `0x16003f`. The native frontage and height check
returned true, but the custom filter accepted only terrain IDs `0x40`,
`0x41`, and `0x44`. The stock guard now also uses the game's predicate for
`0x3d`, `0x3e`, `0x3f`, `0x42`, and `0x43`. Packaged ARM946 tests cover every
ID in `0x3d`–`0x44`, the exact Humilau attribute, dry rejection, all sixteen
old/new facing pairs, the first native effect capture, rider alignment, and
unchanged native object position. Exact ROM adapter bytes, install/export/
reopen, disable/reenable, removal/reinstall, artwork replacement, upgrade
from 0.6.56 with dialogue and gifts retained, 39 focused web tests, and the
production build passed. The prior-build emulator run was diagnostic only;
SE01–SE04 remain pending on a cold boot of 0.6.57.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.57-alpha.nds` | `2c158b81f507c54c436c0543126d15af50c654560f1f7ef297df57818a1fec06` | 59,924 B |

## Stock White 2 mounted Surf direction fix, September 24

When the player turned toward water from another facing, the native Surf task
read the actor's previous facing to place its entry effect and choose the
movement action. The custom no-hop transfer inherited that action, so a
right-facing mount pressing Up could draw to the right and an opposite-facing
mount could stop one tile short of the water. A read-only parse of the supplied
`badtransition.mln` found the transition debug record in water phase with
requested direction 0 (Up), consistent with the reported turn. Exact stock disassembly at
`0x021bac90` and `0x021bad60` confirmed the facing read; the turn adapter
at `0x02167098` copies the old face before storing the new one.

Stock 0.6.56 turns the player actor to the pressed water direction before
creating the native task, then uses the saved direction for the grounded
tile transfer. Failed task or event creation restores the prior facing. The
packaged ARM946 test covers all sixteen old/new facing pairs and both
failure stages. Exact ROM hooks and new native adapter signatures, ROM
install/export/reopen, disable/reenable, removal/reinstall, artwork
replacement, update from 0.6.55 with authored dialogue and gifts retained,
39 focused Pokeweb tests, and the production web build passed. No game
emulator was run for this build; SD01–SD04 remain pending.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.56-alpha.nds` | `3cf779b47240834c54364ab8fa37d854707b16cae39223197116e56c33be362d` | 59,856 B |

## Stock White 2 automatic-mount Surf fix, September 24

The user tested 0.6.53 and 0.6.54 and heard the blocked-movement bump when
riding Arceus toward water. Read-only inspection of `Repos/mounted.mln`
(SHA-256 `b4493c566c251d6cce535ce66eb66fa37dd670e72f451a36eeb4c2b698be2835`)
found a visible land mount whose follower selection slot was `-1`. The party
lead was Arceus with Surf, HM03 was in the Bag, and the target tile was water
attribute `0x830044`. Replaying the audited native eligibility path with right
input on the state memory accepted the tile and party member when passed party
slot 0. The old field handoff instead passed the unresolved follower slot,
which its identity guard rejected before creating a Surf event.

Stock 0.6.55 passes the active mount's resolved party slot to both the
eligibility and event-creation calls after validating that mount against the
party. The packaged field-event regression sets the follower selection slot
to `-1`, the mount slot to 0, and confirms the handoff receives slot 0.
Packaged runtime checks, the exact ROM contract, install/export/reopen,
disable/reenable, removal/reinstall, artwork replacement, 0.6.54 update with
authored dialogue and gifts retained, and the production web build passed.
The fixed payload grew 40 bytes to 59,776 bytes. No cold-boot game-emulator
acceptance was performed for this build; SS01–SS03 remain pending.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.55-alpha.nds` | `a2cc58722b80bab534c6c512d60a09f1a7f549eeda5c769302835409a88594ec` | 59,776 B |

## Stock White 2 land/Surf handoff, September 24

The stock 0.6.53 transition alpha starts the native Surf effect when a mounted
Pokémon with Surf approaches water and HM03 is in the Bag. Four exact callsite
hooks replace the native entry and shore-exit jumps with short grounded tile
movements. The native task still owns ripple, mode changes and shore collision.
The mounted party identity pins Surf art and is checked again before land
remounting. Land and Surf textures are released in opposite order on each
crossing. A successful manual A+B mount requests the native bounce sound.

The pinned ROM contract matched all new hooks and native adapters. Packaged
ARM946 checks passed for four directions, water and shore terrain, missing
HM03 or Surf, native permission rejection, task/event handoff, two-step shore
movement, remount identity and once-only sound. The complete stock package,
39 focused Pokeweb tests, production build, and ROM install, export/reopen,
disable, removal and artwork replacement passed. The current 0.6.54 package
includes this transition code; 0.6.52 and both 0.6.53 field-module
fingerprints upgraded to it while preserving authored dialogue and gifts.
No game emulator was run; ST01–ST07 in the human checklist remain untested.

The transition test ROM is `White2-Following-0.6.53-alpha.nds` (SHA-256
`e0d302c95d433999bad1a87e92291310d5b9aaf5db8127b8681f7a788991f32d`)
in `Repos/`. The existing 0.6.53 save was preserved. The current 0.6.54
package also carries the handoff; its fixed payload is recorded in the
[memory audit](MEMORY-AUDIT.md).

## Stock White 2 Repel continuation, September 24

Read-only inspection of `Repos/repel.mln` (SHA-256
`b3ce4d4456ee2bdb7593f038b54086411fb278bba74d8fbbf1305d5c62449c48`)
found script 10144's Repel continuation prompt. Its event path hit three
conservative scene-guard recalls: a native field-work wrapper, command
`0x116`, and the yes/no child callback. Stock 0.6.54 accepts the wrapper only
with its pinned native work shape; it accepts the command and child only for
the live Repel continuation script. Unknown callbacks and commands in other
scripts still recall. No changes were made to Repel choice or item behavior.

The packaged ARM946 scene regression kept the same follower through the
prompt, but its Yes fixture did not execute the item-use branch. Later human
testing found that Yes still recalled the follower. It rejected malformed
wrapper work and identical commands or child callbacks in other scripts. A
packaged field-update regression kept an active land mount and its follower
actor throughout the prompt. The full
100-cycle stock package suite and Pokeweb install, export/reopen,
disable/reenable, removal/reinstall, and artwork replacement checks passed.
The save is byte-identical to the 0.6.53 save; existing saves were preserved.
No DS game emulator was run. RP01–RP04 remain human acceptance cases.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.54-alpha.nds` | `a180d17226e2347eb850c496cd84c0f1ceba060e30c61dff00661f6326a9ad9e` | 59,736 B |

The payload is 2,800 bytes larger than the earlier 0.6.53 baseline; this build also includes the
current land-to-Surf transition code in the working tree. It is not a
measurement of the Repel guard alone.

## Stock White 2 dismount send-out correction, September 24

Dismount hides the mounted follower and clears its movement trail until a safe
trailing tile exists. The previous dismount marker suppressed the ordinary
ball send-out at that first safe tile, so the follower appeared instantly.
Stock 0.6.53 removes that exception: the follower stays hidden for the opening
effect frames and receives exactly one normal send-out when it returns.

A packaged ARM946 regression covers mounted movement without a ball effect,
the A+B dismount, stationary waiting, a safe trailing step, the send-out effect,
and visibility after its opening frames. The complete stock package suite and
ROM export/reopen/reinstall/disable/reenable/removal checks passed. No DS game
emulator was run; LM09 remains a human visual acceptance case.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 historical baseline | `build/stock/White2-Following-0.6.53-alpha.nds` | `068820fb675a3ebfd0ce03fcacd9238b45d40c5d68c49be695c4a629dd387144` | 56,936 B |

The fixed payload is 48 bytes smaller than 0.6.52. The matching `.sav` in
`Repos/` is byte-identical to the 0.6.52 save; existing saves were preserved.

## Stock White 2 base Speed and mounted B-run draw correction, September 24

Stock 0.6.52 now reads field 3 (base Speed) from the selected species and
form's native Personal record when mounting. It caches that byte for the
existing capped flat-step speed curve. Level, nature, calculated party Speed,
and temporary stat changes no longer affect mount pace. Party identity and
form changes still end the mount. The Personal getter's Thumb entry bytes
were verified against the pinned clean ROM.

Read-only inspection of `Repos/blackbox.mln` (SHA-256
`8ab81d0e5db34d730d5087dd49df17efc0a9468af6886f10b614540d558c9d36`)
found the mounted follower using material index 16 with eight frames; material
17 had no texture. The old B-run override flipped the material index between
16 and 17, so one animation pose rendered as a large black rectangle. The
override now keeps the material index fixed and alternates the two frames
within that material. A packaged ARM946 draw check reproduces that exact
material/frame layout, checks all four facing orders and restoration, and
rejects reads of the calculated Speed parameter. The host speed-curve checks,
complete stock package suite, Pokeweb export/reopen, reinstall,
disable/reenable, removal/reinstall, artwork replacement, and upgrade from
0.6.51 with authored dialogue all passed. Production build and privacy checks
passed. No DS game emulator was run; LM04, LM11 and LM12 remain human visual
and travel-rate acceptance cases.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.52-alpha.nds` | `b93111e0270b44284dc42415b7371b48c18d0775c8d44ee1ac77d865f711bacb` | 56,984 B |

The payload is 16 bytes larger than 0.6.51. The matching save was copied from
0.6.51 without overwriting existing saves.

## Stock White 2 land mounts, September 24

The stock 0.6.51-alpha package adds an A+B stationary land mount for the
selected visible, healthy follower. Its 17,236-byte ROM archive holds twelve
bike-free riding frames per trainer: the native moving bicycle head and hair
are pixel-aligned to the native seated body. Bicycle handles, wheels, and
ground-touching stationary poses are excluded. All 24 generated frames matched
the user-approved preview at every visible pixel. The 20,608-byte ROM anchor
table measures both animation poses of all 2,574 follower appearances. Only
one eight-byte anchor record and twelve rider textures are read when mounting.
The mounted follower shares the player
position while its separate shadow is suppressed; the player keeps native
ground movement and its own shadow. Mount state is not saved.

The stock binary contract matched every hook and native adapter on the pinned
revision-0 ROM. The published ARM946 package passed its existing packaged
interaction, scene, continuity, render, Surf and cycling checks. Host tests
for the actual speed-selection function passed Speed 0, 50, 100, 200, 233 and
255, including exact bike rate at 100, the one-tile-per-frame cap, and native
special-command preservation. A packaged input test checked ordinary A,
B-held then A, A-held then B, simultaneous stationary A+B, directional input, L/R, and a
duplicate event-provider call in the same frame. A packaged draw test checked
all four rider/mount submission orders, player-body suppression, billboard
restoration, three moving rider frames, faster B-held animation and seated idle.
TypeScript checks and 31 focused Pokeweb tests
passed. The delivered ROM passed export/reopen, reinstall, disable, reenable,
removal and reinstall. A replacement appearance was applied after reopening;
its land anchors were recomputed, exported and recognized on another reopen.
An existing 0.6.50 ROM with an earlier field-module fingerprint upgraded to
0.6.51 with authored dialogue intact and the exported result reopened.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.51-alpha.nds` | `2c08e0aacada86dc6931f26f2a492bd070e5f06d08c26924e31cb2bd39245159` | 56,968 B |

The new fixed payload is 4,640 bytes larger than stock 0.6.49 and 944 bytes
larger than 0.6.50. ROM art and
anchor bytes are excluded from that heap figure; native graphics allocations,
allocator overhead, stack and VRAM are also outside it. The matching save was
copied without overwriting an existing save. No game emulator was run. LM01–
LM11 in the human checklist remain **NOT RUN** for visual and gameplay
acceptance, especially draw order, seams, menus and terrain.

## Surf selection after L/R cycling, September 24

Stock White 2 and White2Upgrade now check the selected land follower first for
Surf. When it does not know Surf, the first non-Egg Surf knower in party order
provides the mount. Packaged ARM946 tests cover a later selected follower
beating an earlier knower, non-Surf fallback, stale/replaced identity, party
reordering, and the four move slots. Native Surf permission remains unchanged.
The selection adds 140 bytes to each profile's fixed code/data/BSS payload and
no permanent buffer. Both complete package builds and ROM install, export,
reopen, reinstall, disable, reenable, and removal checks passed. No DS game
emulator was run; SF10 and U30 remain human visual acceptance cases.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.49-alpha.nds` | `e0adf715cdb4b79a501306cb26369214bc2bbd1a14efcc48af09f920cce38622` | 52,328 B |
| White2Upgrade | `White2Upgrade-Following-0.7.30-alpha.nds` | `7fb6bd192888989a60fc3dcf048e97cff59384654be0ebab8a75671397c29373` | 53,064 B |

Each ROM has a matching `.sav` in `Repos/` copied byte-for-byte from its
immediately preceding version. Existing saves were preserved. Black 2 and
Italian packages were not changed by this Surf selection update.

## Horizontal L/R resummon correction, September 24

The user reported that L/R switches while facing left or right recalled the
visible follower but did not show the replacement until the player moved. The
first cycling build seeded a new trail at the old sprite position. A wide
sideways follower may stand more than one ordinary tile from the player, so
the next route sample was rejected as disconnected and the replacement stayed
hidden. The correction keeps the recorded player route through recall and
advances it while the effect runs. The new actor uses a validated point on
that route, then resumes normal following without a forced player step.

The packaged ARM946 cycling test now covers both horizontal facings with a
wide gap and player motion during recall. Stock's full packaged suite, the
White2Upgrade and Black 2 builds, and Pokeweb export/reopen/reinstall/disable/
reenable/removal checks passed. No game emulator was run by this work.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.48-alpha.nds` | `f88df1a39c5f72b19ced966738a8c57c17a8efa0a03620088a1db76fac5324f7` | 52,188 B |
| White2Upgrade | `White2Upgrade-Following-0.7.29-alpha.nds` | `5ba7efb20ca394dcf27984f26c7cd90ccec2add268bf88322ba48f7cbd28fc29` | 52,924 B |
| Black 2 | `Black2-Following-0.6.35-alpha.nds` | `024713a6a512addbf4fb931e02a3c7b5ef8ba3f2d40c745531f3a20d6cdaf61a` | 48,064 B |

Each ROM has a matching `.sav` in `Repos/`. Existing saves were preserved.
CY01–CY05, U29 and B21 remain human acceptance cases. The preceding 0.6.47,
0.7.28 and 0.6.34 cycling alphas should not be used for horizontal switching.

## L/R follower cycling, September 24

Tap R for the next eligible party member or L for the previous one while
ordinary field movement owns the follower. The selected party slot is held in
field-only follower state; no party data is written. The old actor is recalled,
then the new actor receives the existing send-out effect. Simultaneous shoulder
presses and input during another effect are ignored. Eggs are skipped; healthy
members take priority, with fainted non-Egg members available only if all are
fainted. The manual choice is matched by Pokémon identity after a party reorder.

Host selection tests and the packaged stock ARM946 keypress/effect sequence
passed, including wraparound, busy-input rejection and unchanged party bytes.
The stock package also passed its 100-cycle scene, ambient and continuity
suites, render and Surf checks. White2Upgrade and Black 2 passed their packaged
build checks. Pokeweb export/reopen/reinstall/disable/reenable/removal passed
for all three delivered ROMs. No game emulator was run.

| Profile | Delivered ROM | SHA-256 | Fixed packaged payload |
|---|---|---|---:|
| Stock White 2 | `White2-Following-0.6.47-alpha.nds` | `a3a4003faad70563ffdccb06e26241f82cb4c2e6d860ba391892f37b4f166e6f` | 52,052 B |
| White2Upgrade | `White2Upgrade-Following-0.7.28-alpha.nds` | `b06717e92eabe9622deb81fd7d995fdbad48cac6c880b8b1d587645092a6b366` | 52,784 B |
| Black 2 | `Black2-Following-0.6.34-alpha.nds` | `d31382f739b12d3528483bcdd0709e5977d362b1a965756cda3cb1cfb4bbff30` | 47,924 B |

Italian 0.6.35 was compiled but not released: its packaged scene test recalls
on action `0x54` where the test expects retention. The same failure reproduces
with the already published Italian 0.6.34 module, so it is not caused by
cycling. Italian visual and gameplay behavior was not tested here.

The user confirmed the preceding menu and PC fixes, but reported continued recall
at Floccesy Town / Route 20 in White2Upgrade. The supplied state was inspected
read-only; no game emulator was run.
The user reported that the preceding ambient-NPC fix worked. This is a user report, not completion of every checklist case.
The user confirmed that **0.3.1 fixed the melonDS overworld freeze**. This is a
user-reported result, separate from the automated checks below.
The earlier 0.2 walking module was exercised in the bundled Desmond DS emulator.
Those results do not validate the new 0.3 renderer/effects. The clean input
remains read-only. Hardware has not been tested.

## Stock White 2 0.6.46 grid grass correction, September 24

The user confirmed the 0.6.45 hang was fixed but supplied `noterrain2.mln`
with both player and grounded follower standing in grass and no follower grass
fringe. In that state, the player's cached map attribute is `0x240004`, while
the synthetic follower's cached attribute is zero. Isolated ARM946 execution
of the native grid-map query at both actors' tile centers returns `0x240004`
for each. The separate native grass entry reaches its task creator and returns
for the follower in the state RAM copy. `verify_terrain_state.py` reproduces
these checks without advancing a game frame.

Stock 0.6.46 queries the visible follower's tile after actor updates and
invokes the native grass task once per tile, including first appearance in
grass. It excludes Flying-type followers and keeps the unsafe movement-context
dispatcher disabled. The small tile cache is field-runtime state, cleared on
recall/unload; no save data or separate dynamic PMC allocation was added. Other tile
effects remain outside this focused grass pass.

The stock exact-ROM contract, packaged branch and render checks, 100 scene/
ambient/continuity cycles, Surf checks, and Pokeweb export/reopen/reinstall/
disable/enable/removal passed. The fixed packaged payload is 52,056 bytes.
The delivered ROM is `White2-Following-0.6.46-alpha.nds` (SHA-256
`a5483a9c38813bc9804fe08edd35166417336b604c2d05f8915926b8e092f725`).
Its save is byte-identical to the 0.6.45 stock save. Other profile DLLs were
not rebuilt. No game emulator was run; TE01–TE04 remain NOT RUN.

## Stock White 2 0.6.45 stability correction, September 24

The user reported that 0.6.44 froze as soon as the follower spawned. Its
`followerfreeze.mln` state was inspected read-only. ARM9 was in an exception
handler while the follower was inside the native tile-entry path with flag
`0x400` cleared. The follower's movement-context pointer at Actor offset
`0x94` was null. The native dispatcher calls through this context without a
null guard; an isolated ARM946 call against the preceding state reached a
read at address `0x2c` after the flag was cleared. This path is not safe for
our synthetic grid actor. The older call-count test failed to exercise the
real dispatcher and therefore missed the failure.

Stock 0.6.45 removes that dispatcher call completely and retains the
bounded running-seam correction from 0.6.44. The stock packaged CPU check
now fails if the synthetic follower invokes the unsafe dispatcher at any
tested movement step. The full stock package, scene, continuity, render and
Surf checks passed, as did Pokeweb export/reopen/reinstall/disable/enable/
removal. Fixed packaged payload is 50,748 bytes. The delivered ROM is
`White2-Following-0.6.45-alpha.nds` (SHA-256
`a5347fa7d7a66fa45ce898e0f67dfa1918d9be72bc967708ff5000138beeb4be`).
Its save is byte-identical to the 0.6.44 stock save. Other profile DLLs were
not rebuilt. No game emulator was run by this correction. Follower grass
effects remain absent in stock until a grid-specific native path is audited;
human stability and seam checks TE01–TE04 are NOT RUN.

## Failed stock White 2 0.6.44 terrain experiment, September 24

The user's `noterrain.mln` and `transitionrecall.mln` states were inspected
read-only. The grounded follower in the first state was visible on a grass
tile, but its actor flags included `0x400`. The exact stock native tile-entry
dispatcher calls a predicate that rejects that bit before looking up the
tile. The old CPU test only counted dispatcher calls, so it missed the early
return. Stock 0.6.44 cleared `0x400` while the visible grounded
follower crosses a tile and the native dispatcher runs, then restores the bit.
Flying followers and idle frames remain excluded. The matching stock native
predicate and dispatcher instruction bytes are pinned in `contract.json`.
An isolated ARM946 call using the supplied state returned 1 from the stock
skip predicate with `0x400` set and 0 with it cleared; the separate effect
eligibility predicate returned 1 for that same follower.

The running-transition state recorded `FollowingSceneDebug` reason 3 (player
movement), action `0x58`, and no live event pointer at that action. The
follower trail reset count was zero. The seam event had ended but the scene
pause latch still owned the follower when the player resumed running. Stock
0.6.44 added an exception for run actions `0x54`–`0x5B` and tile-bounded world steps in that
event-end window. A new live event revokes the exemption; direct placements,
large position changes, and scripted movement during a live event still
recall before commit.

The stock packaged CPU suite passed native predicate and temporary-flag
checks, eight run-action variants, bounded-step and unsafe-movement guards,
100 scene and ambient cycles, continuity, render and Surf regressions. Pokeweb
export/reopen/reinstall/disable/enable/removal passed for the delivered stock
ROM. The fixed module payload is 50,860 bytes, up from 50,720 bytes in
0.6.43. The delivered ROM is
`White2-Following-0.6.44-alpha.nds` (SHA-256
`81c2534529404d5cd8e4e0db93fe20f940f14195d207e7efcb25720aa99b110e`).
Its `.sav` is byte-identical to the prior stock 0.6.43 save; no other profile
package was rebuilt. **No game emulator was run by the build.** The user then
reported an immediate follower-spawn freeze in melonDS. The 0.6.44 terrain
change must not be used; the separate 0.6.45 correction above removes it.

## Earlier native terrain dispatcher pass, September 24

The 0.6.43 stock and corresponding other-profile builds called the same
overlay-36 tile-entry effect dispatcher
used by retail actor movement once their visible actor crosses into a new
grid tile. The selected party Pokémon's two native type values determine the
Flying exclusion. Idle frames, turns in place, hidden actors and Flying types
skip the call. The native field engine still owns effect lifetimes and the
follower's shadow, world position and movement trail are unchanged.

The dispatcher instruction bytes were checked against the exact stock White 2,
Black 2, Italian White 2 and pinned White2Upgrade binaries. All four packaged
modules passed build/relocation validation. A stock packaged CPU spy observed
one dispatch per crossed tile over three consecutive tiles, with none for
Flying or idle frames. The native effect service was mocked; this does not
establish the resulting grass, dust, water or footstep visuals in game.
The user subsequently confirmed stock grass was absent; the `0x400` native
tile-query guard explained why call-count checks alone were insufficient.
All four delivered ROMs passed Pokeweb export/reopen, reinstall, disable,
enable, removal and reinstall checks. No emulator was run by the build.

| Profile | Version | Delivered ROM SHA-256 | Fixed PMC module payload |
|---|---|---|---:|
| Stock White 2 | 0.6.43-alpha | `8b0b41721f6d4c4910e09f82554ba6f40262ea2078b5725b11f1a86966fc0bc1` | 50,720 B |
| Black 2 | 0.6.33-alpha | `867762a2bea3dce50360ccbb6033ce9790f5f0773ca28db08f28d9f192698cc4` | 46,872 B |
| Italian White 2 | 0.6.34-alpha | `83fb3c05adee0b9c17a262432ac6084f9516d94144356f64119db5d5c7dcc0e4` | 47,044 B |
| White2Upgrade | 0.7.27-alpha | `6be086bdd013fd2d4c3c9042fa9f2fc75a81f256dead0be54e0f36900e74bae7` | 51,700 B |

The stock, Black 2 and Upgrade delivery saves were copied from the immediately
preceding versions without overwriting any destination. No Italian-family
save existed, so none was copied and no US save was used. Human cases TE01–TE03,
B20, I30 and U28 remain NOT RUN.

## North-facing follower foreground depth

The user confirmed the artwork and shadow positions in the tested build, then
reported that the player drew over Serperior while both walked north. The
north-facing ground-plane anchor moves the visible sprite away from the camera;
its draw-only artwork adjustment moves it another two units vertically. The
existing depth rule then places a close foreground follower only 1/8 world
unit ahead of the player. That tiny margin does not reproduce the draw order
the user had before the anchor change.

For a close, equal-elevation north-facing follower logically in front of the
player, the final draw calculation now restores the sprite's pre-anchor camera
depth. It accounts for the seven-unit ground-plane shift and two-unit artwork
shift, moving the submitted quad along the eye ray and scaling it to preserve
the approved screen position. The corrected native shadow and logical actor
position do not move. Side-facing and unequal-height stair policies retain
their prior calculations.

Host projection tests checked the north foreground result and projected quad
corners. Packaged ARM946 tests executed the final depth function in all four
profiles, checked that side/stair results stay unchanged, and verified native
anchor ownership. The stock and Upgrade draw-pass suites also exercised the
main retail submission path, including the north regression and 12,000 frames.
Installation and previous-version update checks are separate from these
render tests. **No game emulator or hardware visual result is claimed.**

The fixed module payload is 46,728 bytes for stock White 2/Black 2, 46,900
bytes for Italian White 2, and 47,708 bytes for White2Upgrade. These are
packaged code/data/BSS measurements, not total heap peaks.

Delivered ROM SHA-256:

- stock White 2 0.6.32-alpha: `90ddf6acf2cf418ed0deee91fc5924305b1c73bc59eb6bd1171d2870ad9771ff`.
- stock Black 2 0.6.32-alpha: `8bde85a59e82e1e5a7c5da0c56fe103a2a11302c5f2dc214642e27ca7b1e594c`.
- Italian White 2 0.6.33-alpha: `f7dcc652ea7300cd28beac4ae993f228375f74150847ef4f934903e6b5b8794b`.
- White2Upgrade 0.7.23-alpha: `bd0e512a116a302b77089d7e09eef68f77c92822811935f12a858e91f40d0c57`.

Human cases H08, B19, I29 and U24 remain NOT RUN until the user tests them.

## Directional artwork and shadow anchors

After the sprite-only grounding correction, the user measured Serperior facing
up about five pixels too low and its shadow about seven pixels too low. Facing
down, both appeared about six pixels too high. The field module now changes
the follower's native control-Z offset by −7 when facing up and +6 when facing
down, resetting it to the descriptor baseline for left/right. The native
sprite and shadow read this offset, while world/grid coordinates, collision,
trail records and retail actors stay unchanged. A draw-only two-pixel
compensation makes the north-facing artwork move less than its shadow.

The packaged render verifier checked the native control byte for all four
facings and no other actor-byte changes, the two-pixel artwork difference,
billboard restoration and the unchanged effects pass. It also exercised
12,000 main-pass submissions. All four builds passed hook, relocation and
stack checks. The 2,574 stock/Black 2/Italian and 4,718 Upgrade appearance
archives passed grounding checks; existing art resources were retained.
Fresh install/export/reopen/toggle/removal passed for stock White 2, Black 2
and Italian White 2; Upgrade profile/resource verification and updates from
the immediately preceding releases passed. The Italian update retained
authored dialogue and gifts. These are automated checks with mocked native
rendering, **not game-emulator visual tests**.

The fixed module payload is 46,648 bytes for stock White 2/Black 2, 46,820
bytes for Italian White 2, and 47,628 bytes for White2Upgrade. These are not
whole-game heap peaks. Each versioned ROM has a matching save copied from its
preceding profile save without changing that source save.

Delivered ROM SHA-256:

- stock White 2 0.6.31-alpha: `8331c5d805baf9ef2e4a53da2ce0836a9833137817a707fb75b91c108f5cb131`.
- stock Black 2 0.6.31-alpha: `8c64a972f89447563bc35835841dbcda32e2508139eb5b5e867c869b391d8552`.
- Italian White 2 0.6.32-alpha: `91d7f357a33ea0d9de5fc2bdf3133176b8b9c87f9fcc2b325e1480a6e967940d`.
- White2Upgrade 0.7.22-alpha: `079f5331f734ab2db7526cbecb121868c2f925dd7723b5b58f904f25d26a1a7f`.

Human visual and hardware results are pending. H07, B18, I28 and U23 give
the specific facing and stair checks.

## Sprite-only grounding correction

The user reported that the preceding grounded-artwork offset also lowered
shadows and left only the upper part of some shadows visible, including
Serperior. The prior installer put the offset in the follower-owned descriptor;
the native shadow/effect path reads that same value. The current installer keeps
the art offset in the ROM appearance registry but restores the appended
descriptor's Y offset to zero. The field module applies the registry value only
around the synchronous sprite billboard draw and restores the actor pose before
the separate shadow/effect pass. No native retail descriptor is changed.

All four delivered ROMs passed a per-appearance comparison with their immediate
predecessors: all 2,574 stock/Italian and 4,718 Upgrade appearances retain the
same registry art offsets and resource archive bytes, all appended descriptor Y
offsets are zero, and native shadow flags remain enabled. The packaged render
test submits the sprite five pixels lower while the shadow/effect pass sees the
original pose; repeated flat-ground and stair draws do not accumulate the
offset. Packaged branch/relocation checks, installation/update and authored-data
retention, export/reopen, and applicable profile verifiers passed. The fixed PMC
payload rises from 46,356 to 46,540 bytes in stock White 2/Black 2, from
46,528 to 46,712 bytes in Italian White 2, and from 47,340 to 47,520 bytes in
White2Upgrade. These are packaged payload measurements, not whole-game heap
peaks. Same-basename saves were copied unchanged from the preceding releases.
No emulator or hardware was run for this correction.

Delivered ROM SHA-256:

- stock White 2 0.6.30-alpha: `0242cc00a2d93d06e6234a9b7b09f623a1057d43888587ad07629ec1b6b69f7b`.
- stock Black 2 0.6.30-alpha: `f537bb64432cf7592fe3b586858975e9da1df6c4f80a1d9b51eaf28cd127c168`.
- Italian White 2 0.6.31-alpha: `9fcd5e848d2baf8209ce00c9b1ca0fe7543e9d54daa77ddee49d9774e366000c`.
- White2Upgrade 0.7.21-alpha: `567a85c8bb3f673bed9a2d06a339e2113da52445389646b92dbaf83ac4cfd2fd`.

## Previous additional three-pixel grounding adjustment

The user supplied a screenshot showing a grounded follower still too high
relative to its shadow and requested three more pixels of lowering. The
preceding installer added three pixels to the existing transparent-bottom-margin
offset for non-Flying appearances. It recognized the preceding automatic
offset when upgrading an installed alpha. The user subsequently observed that
the shadow moved with the sprite and that some shadows were clipped. The
sprite-only correction above addresses this regression; its visual result
remains pending.

All four delivered ROMs passed a per-appearance comparison with their immediate
predecessors: every non-Flying descriptor was exactly three pixels lower; Flying
descriptors and the complete sprite resource archives were byte-identical.
Native shadow flags remained enabled, and native shadow code and fixed PMC
payload sizes were unchanged. Stock and Italian profiles each cover 2,266
non-Flying and 308 Flying appearances; White2Upgrade covers 4,142 and 576.
Install/update, export/reopen, authored-data retention and packaged runtime
tests passed. Same-basename saves were copied unchanged from the prior alphas.

Delivered ROM SHA-256:

- stock White 2 0.6.29-alpha: `ef5de78216d0946085600d1b5a80c2942e116993887b8db36df3369ea992357d`.
- stock Black 2 0.6.29-alpha: `942d55901063c78844c9b846f86433b460129d426026cc5fcc6d71351334699f`.
- Italian White 2 0.6.30-alpha: `3883aba0e313e5161895dd874ff631cc1877355226f1f14991e7be58194eb5bc`.
- White2Upgrade 0.7.20-alpha: `3bbbcf0923a36dd262485373ad4ec45d7adf83c8e9360a260405fe9b727a9ad4`.

## Previous transparent-margin grounding adjustment

An asset scan found transparent bottom rows in many follower frames, which made
their artwork look lifted once the shadow became visible. That installer scanned
every pose and set the follower-owned descriptor's vertical offset to the
negative of the smallest bottom margin, capped at eight pixels, for non-Flying
appearances with default offsets. Flying-type and explicitly offset artwork
retained their height. Retail descriptor rows were unchanged. The descriptor
offset also moved the native shadow, as the user later observed.

Automated archive checks covered all 2,574 appearances in each stock profile
and 4,718 in White2Upgrade. They verified descriptor offsets against the
encoded art and confirmed that native shadow flags remain enabled. Focused
install, update, export/reopen, disable/removal, relocation, and unit checks
passed. Fixed PMC payload remains 46,356 bytes for stock White 2/Black 2,
46,528 bytes for Italian White 2, and 47,340 bytes for White2Upgrade; this
descriptor-only adjustment adds no fixed PMC heap use. The user subsequently
observed that grounded artwork still appeared too high; that report prompted
the additional offset above.

Delivered ROM SHA-256:

- stock White 2 0.6.28-alpha: `743ec4d72af83cb58303784f071580d384920379c4d9f057c88318541c92474b`.
- stock Black 2 0.6.28-alpha: `de472e584dcada6e06c01098b8d6ec49351c5e79a46764cada8a41cdbd72a167`.
- Italian White 2 0.6.29-alpha: `b27bd800f99b4a5156f302232722c2eeaaea0c8060493e32be25faf2c3581a17`.
- White2Upgrade 0.7.19-alpha: `606897f690d713028cfc881cb24ae11e8c2b97518cac1b165f2a8d8d403b497e`.

Each test ROM has a same-basename save copied byte-for-byte from the preceding
alpha in its own profile. No emulator was run for this adjustment.

## Stock 0.6.27 / White2Upgrade 0.7.18 native shadow registration

The user tested White2Upgrade 0.7.17 in melonDS and reported no follower
shadow. The supplied `noshadow.mln` state (SHA-256
`95e33ef0ee67d3e740c266d659c585b0026b00c8c8970df0112147cbc468ac25`)
contains a visible follower with a shadow-enabled descriptor, but its native
`SHADOW_SET` move bit is clear (`0x300802`); the player's bit is set
(`0x4602`). Its actor and player states meet the revised registration gate.
The earlier move-start flag did not invoke native shadow registration for the
follower's direct-coordinate movement callback.

The field module now calls the game's native shadow-registration helper after
a visible follower update when the player has an active shadow and the
follower has not registered one. The helper creates the game's normal field
effect and sets `SHADOW_SET`; subsequent frames do not register duplicates.
The exact helper bytes were verified at overlay 36 `0x02194DF4` for stock
White 2 and White2Upgrade, and `0x02194DB4` for Black 2. All three packaged
field modules contain one call target for their profile's helper. The actor
is still nonpersistent; the native shadow task checks actor identity and
visibility, and destroys its billboard when the actor is removed.

The exact-ROM contracts, packaged CPU/interaction/scene/render checks,
Pokeweb production build, three ROM exports, and install/reinstall/disable/
remove round trips passed. The fixed PMC payloads are 46,356 bytes for stock
White 2 and Black 2 and 47,340 bytes for White2Upgrade, an increase of 100
bytes from the previous release. Native effect-task allocation is outside the
fixed PMC payload and was not measured in game. No emulator or hardware test
was run for this revision.

Delivered ROM SHA-256:

- stock White 2 0.6.27-alpha: `bffc65f003b9aa8a2a40c3b5b206c73f56a3c2981892a3bfc67585b71cb93f61`.
- stock Black 2 0.6.27-alpha: `38d3a618a044afc8f77d2ba2d562e4034feed8908f95662ae7a6ef5fb957ab7f`.
- White2Upgrade 0.7.18-alpha: `062ef1494f4c4bb922c7a55dde2676a77385ecec00c8582f844ac9ed28c3c7b0`.

The same-basename `.sav` files were copied from the preceding alpha without
modifying them. Human shadow cases H01–H03, B14, and U19 remain NOT RUN for
this revision. Start with White2Upgrade U19 in melonDS using a cold boot.

## Previous stock 0.6.26 / White2Upgrade 0.7.17 shadow attempt — visual failure

The prior implementation described below passed static and package checks,
but the user tested White2Upgrade 0.7.17 in melonDS and saw no follower shadow.
Those checks did not establish live shadow registration. This historical
attempt must not be treated as visual acceptance.



HGSS follower resources include species-indexed shadow sizes and vertical
offsets. This release uses the existing White 2 field-shadow effect instead:
the follower-owned descriptor enables native shadow rendering, and its first
accepted movement requests the native movement-start attribute pass. A PC
return at a preserved visible pose requests the same pass. The native shadow
task owns positioning, terrain height, visibility, and deletion; the patch
does not allocate a new PMC shadow buffer or change sprite draw priority.

The stock White 2 model archive confirms shadow type 1 on all 620 retail
Pokémon-style descriptors. The built archive verifier and exported-ROM
install/reopen tests confirm shadow type 1 on every appended follower
descriptor across all three profiles. The stock package passed field,
interaction, scene, ambient, continuity, and draw checks; Black 2 passed
packaged branch checks, and White2Upgrade passed packaged interaction and
render checks. The Pokeweb
production build and install/reinstall/disable/remove round trips passed for
all three exported ROMs. White2Upgrade retained 1,023-species coverage and
rejected mismatched runtime fingerprints and hook conflicts. None of these
checks establishes that the shadow is visually correct in game.

The fixed packaged payload increased by 20 bytes in each profile compared
with the previous alpha: 46,256 bytes for stock White 2 and Black 2, and
47,240 bytes for White2Upgrade. Native shadow-task and billboard allocations
are outside this fixed PMC audit and have not been measured in game.

Delivered ROM SHA-256:

- stock White 2 0.6.26-alpha: `9d4f810fceb51dad5abca15e4a2e3cea28d4f5a2864e02e14836fdd0f328049d`.
- stock Black 2 0.6.26-alpha: `b5cf8973e21d9608428c4389b995f635f65d283b54a9934fbf554f41570a059b`.
- White2Upgrade 0.7.17-alpha: `70fe0ea1478c875f7f452adfa4fd62428b2e39df43c48b29edabf2bd42f45e7c`.

Existing stock White 2 and White2Upgrade saves were copied to matching new
filenames without changing their sources. Black 2 received a fresh sample
save because no preceding same-prefix alpha save was present. Emulator rows
H01–H03, B14, and U19 remain NOT RUN for the human tester.

## Stock White 2/Black 2 0.6.25 / White2Upgrade 0.7.16 trail reduction

The movement trail capacity is 64 samples instead of 256. The follower sidecar
is 1,852 bytes instead of 7,228 bytes, saving 5,376 bytes in each field module.
The generated memory audit measured total fixed code/data/BSS at 46,236 bytes
for stock White 2 and Black 2, and 47,220 bytes for White2Upgrade. The expanded
module image requirements are 52,208 and 53,200 bytes respectively. These are
packaged sizes, not measured game heap peaks; native graphics, loader bookkeeping,
allocator overhead, stack, and VRAM remain outside this audit.

Host movement tests passed reversals, repeated bends, elevation, overflow and
reseeding at the 64-record bound. Stock packaged checks passed 100 conversation,
scene, ambient-NPC, menu/PC and continuity cycles; the packaged draw fixture
passed 12,000 submissions. Black 2 passed its exact-ROM contract and packaged
branch checks. White2Upgrade passed packaged interaction and render checks.
All three prior installed alphas upgraded with authored zone-427 dialogue,
enabled state, and one copy of each matching module preserved. Each delivered
ROM passed export/reopen, reinstall, disable/re-enable and removal/reinstall.
No DS emulator or hardware was run for these versions.

Delivered ROM SHA-256:

- stock White 2 0.6.25-alpha: `25ac0299a89b1d4fae03a202f92ac27064949cb26acb4deb8c7824df280eb8be`.
- stock Black 2 0.6.25-alpha: `422cc2c73fad03b16efbc15add6309582e75d9fe0bafbd6c95ad5b449a19cd0e`.
- White2Upgrade 0.7.16-alpha: `6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9`.

Matching saves were copied from the respective immediately preceding alpha;
the source saves were not overwritten. Human acceptance should focus on M05,
B13 and U18, especially slow stairs and curves with wide followers.

## Stock 0.6.24 / White2Upgrade 0.7.15 sign and furniture correction

The supplied DeSmuME state was inspected read-only. Its `FollowingSceneDebug`
ring records the actual recall as reason 1 on opcode `0x276`, repeated before
the sign message. The later `0x43` value in the diagnostic header is the last
observed sign-window opcode after the actor had already been removed; it was not
the command that caused the recall.

Opcode `0x276` reports ordinary interaction progress to the Funfest mission
subsystem. Stock sign and static-furniture scripts execute it after actor pause
and before their sound/message presentation. It does not move actors, replace
field ownership, or enter a communication activity. The allowlist now includes
this command, and the binary contract pins its handler bytes in overlay 33.
Unknown commands remain recall-before-dispatch.

The packaged scene fixture now runs the observed `pause → 0x276 → sound → sign`
sequence and the equivalent furniture sequence while a random-movement actor
has a dormant crossing action. Both retain the same follower actor and trail for
100 cycles. A real coordinate write into the follower still recalls before the
write. Both profiles also pass exhaustive opcode classification, conversation,
ambient collision, continuity, render, relocation, stack-alignment, installer,
disable/re-enable, removal/reinstall, and export/reopen checks. The production
web build and 34 focused web tests pass. No DS emulator was run for this release.
Actual installed-ROM migrations from stock 0.6.23 and Upgrade 0.7.14 retain the
enabled state and authored zone-427 dialogue, export/reopen cleanly, and contain
each runtime module exactly once.

Delivered SHA-256:

- stock 0.6.24-alpha: `b30cc2093141e47a30e961501aed581da7e28330a8de682a4f37933d19034a6b`.
- White2Upgrade 0.7.15-alpha: `62d584d044d8232b9f3f48c7e5b96779603303f3d7c341418e0bd632590a1d77`.

The stock save was copied from 0.6.23 and the Upgrade save from 0.7.14. The
supplied failure state remains evidence for the old module and must not be
resumed to test these ROMs.

## Stock 0.6.23 / White2Upgrade 0.7.14 paused-actor correction

White 2's common field-event setup sets the native movement-pause bit on
ordinary actors. The earlier route predictor still evaluated a queued action on
such an actor and could recall the follower even though an NPC conversation,
sign, or static-furniture event prevented the autonomous movement from starting.
The action observer now defers paused non-player actors to the existing
position/world-step hooks. Those hooks run before real coordinate commits, so a
script that actually moves an actor into the follower still recalls before the
conflicting write. Forced player movement remains conservative regardless of the
pause bit.

The packaged ARM946 scene fixture covers three retained presentation sequences:
NPC facing/message, sign message, and generic static-object message. Each queues
a crossing route on a paused actor and requires the same follower actor and trail
to remain. A subsequent real world-step to the follower's position must still
recall with reason 4. The existing 100-cycle scene, conversation, ambient-NPC,
continuity, render, relocation, stack-alignment, and ARM/Thumb checks pass for
both profiles. Native services are mocked in CPU tests; no DS emulator was run.

HGSS inspection found visual ball-effect calls for ordinary appearance, recall,
PC recall, and warp recall, but no paired dedicated sound call in those callers
or in the effect implementation. No speculative White 2 sound was added.

Delivered SHA-256:

- stock 0.6.23-alpha: `4c5631fedd80f44ac5806dda49f9091819d228d9f36e379bc0342cbca282eea6`.
- White2Upgrade 0.7.14-alpha: `767ea9540562d0b20869687db71af08f0cdcc466fd55dd83776f5aa869e88544`.

Each same-basename save is byte-identical to the preceding profile release.

## Stock 0.6.22 / White2Upgrade 0.7.13 follower-gift correction

The supplied DeSmuME state showed a completed generic Mew conversation and no
selected gift rule, even though its authored zone-427/Mew rule should match.
The gift path passed the field event's `GameSystem*` to native Party and Bag
accessors whose audited ABI requires `GameData*`. The corrected field module
reads `GameData*` from `Field + 0x08`; event ownership continues to use the
separate `GameSystem*`. The Bag accessor signature is now recorded in the
binary contract. Fainted selected followers are no longer rejected during
identity revalidation, matching the stated follower selection policy.

The packaged ARM946 interaction test now installs a real one-rule follower-gift
NARC and requires a zone-427 Mew to call the Party and Bag adapters with
`GameData*`. It verifies full-Bag behavior leaves the claim clear, failed Bag
insertion restores the prior metadata word, successful insertion sets slot 0,
and a repeated conversation cannot grant it again. The existing 100-conversation,
continuity, scene, ambient-NPC, render, relocation, stack-alignment and
ARM/Thumb checks passed for both profiles. Host reaction tests, 29 focused web
tests, export/reopen/reinstall/disable/remove checks, and the production web
build passed. Native services are mocked in CPU tests; no DS emulator was run.

Delivered SHA-256:

- stock 0.6.22-alpha: `880780dbaf7dea774f1dbaa31df48c5baac8dded0cc870edb54a5debb4379218`.
- White2Upgrade 0.7.13-alpha: `c365e83863a7720a9e43c65ff5e58d7436e2312550b36a3bd6c1982cdba7cd35`.
- White2Upgrade zone-427/Mew gift fixture: `58ed9124a1e0ef3235bfedeec7e1bb1edcd1f7e2c56548d172fdba920183bbf2`.

Same-basename saves are byte-identical copies of the preceding releases. The
ordinary releases keep the intentional empty gift archive; the dedicated test
ROM contains slot 0, Master Ball ×1, zone 427, species 151.

## Stock 0.6.21 / White2Upgrade 0.7.12 contextual-zone correction

The supplied DeSmuME state contains a valid two-rule contextual archive. Rule 0
requires zone 427 and species 151 and contains the authored Aspertia City text;
rule 1 is the wildcard “Mew is looking around.” fallback. Runtime diagnostics
showed contextual rule 1 selected. The selected species was 151, but both player
and follower actor zone fields were zero. The live field object contained zone
427 at verified offset `0xE0` (and again in its current spawn state at `0xE8`).

The field interaction snapshot now reads the field object's 16-bit zone ID at
`0xE0`. The binary contract records this offset. A host regression constructs
the reported mismatch—actor zone zero, field zone 427—and requires the snapshot
adapter to return 427. Both packaged field modules passed hook, relocation,
ARM/Thumb, interaction, 100-conversation, scene, continuity and render checks.
The web tests passed 29 focused cases and the production build completed.

Migration checks updated installed 0.6.20 and 0.7.11 ROMs to 0.6.21 and 0.7.12,
respectively, while retaining an authored zone-427/Mew dialogue through export
and reopen. The exact in-game custom line remains pending the user's emulator
test. Same-basename saves are byte-identical to the preceding releases.

Delivered SHA-256:

- stock 0.6.21-alpha: `095425d5e95eea20555b25d9265a663826c6d7207d257b50809d2317943b438a`.
- White2Upgrade 0.7.12-alpha: `63f18530aded8506b5db63fab2a7db6f628dc8d318af301b8d5942725a128782`.
- White2Upgrade zone-427/Mew regression ROM: `e72d3c1916dd430ff21d4f8a40c2b3caaf0fda3de0b4f89ff5c9cc52df81ec19`.

## Stock 0.6.17 / White2Upgrade 0.7.8 stationary follower animation

See [IDLE.md](IDLE.md). A visible follower in ordinary `Following` state now
runs the existing native directional billboard loop while stationary. The native
animation-pause flag remains set during follower interaction, retained external
dialogue/menu/PC and safe-scene pauses, hidden/waiting/suppressed state, and
private send-out or recall effects. Returning to ordinary exploration resumes
the loop without changing the actor position, trail, spacing, depth policy,
collision policy, registry, asset resources, save data or heap buffers.

Executed on both final packaged profiles and ROM exports:

- Host follower logic and 23 project/model tests pass. The native ARM fixture
  checks every follower state with visible/hidden and effect-busy combinations
  at three load addresses; it verifies the only enabled combination is visible
  ordinary following.
- The 100-cycle conversation-return fixture verifies that a follower freezes
  throughout its own conversation and resumes idle immediately after the owned
  event returns. The 100-cycle retained-menu/scene fixture verifies the same
  pause/resume transition for an external menu while preserving the actor and
  trail. Native UI, event, rendering and geometry services are isolated spies.
- Both full package builds pass their existing hook, relocation, stack-alignment,
  movement, conversation, scene, continuity, render and asset validations.
  Stock export/reopen/reinstall/disable/reenable and removal/reinstall pass.
  Upgrade verification confirms 4,718 appearance records, 1,256 imported
  resources without visible sentinel magenta, 362 original payloads preserved,
  and its fingerprint/conflict checks.
- The web production build passes. The fixed code/data/BSS payload is 43,212 B
  stock (+60 B) and 44,192 B Upgrade (+60 B). No new dynamic allocation,
  follower sidecar field, registry record or buffer was added. Packaged module
  symbol names remain stripped.
- Delivered same-basename saves match the preceding profile release byte for
  byte: stock 0.6.15 and Upgrade 0.7.6 respectively.

Delivered SHA-256:

- stock 0.6.17-alpha: `0aff2f33662576d78ba492d2c5736576fe89a93c51eb4c34ad2ac7439324013f`.
- White2Upgrade 0.7.8-alpha: `d6707f7b75369c93c0f3c6b0a359124f02a6e0e61dedc462e4efa36bf87edac6`.

No DS emulator or hardware execution was performed. Cold boot the copied ROM
with its matching copied save and record I01–I05 in EMULATOR-CHECKLIST.md; for
Upgrade also record U17 in WHITE2UPGRADE-CHECKLIST.md.

## Stock 0.6.15 / White2Upgrade 0.7.6 width-dependent spacing

See [SPACING.md](SPACING.md). Maximum opaque width across both sideways walk
poses/directions determines 0–6 extra native world units. Existing registry
reserved bits and a sidecar padding byte hold the value. Record sizes, ROM
registry sizes, 256-sample trail capacity and all runtime buffers stay unchanged.
Widening uses recorded trail movement, with no new rendering offset or hook.

Executed on both final packages and ROMs:

- 23 focused project/model tests, sanitized movement/selection/suppression tests,
  eight import tests and reaction suites for both roster limits. Width tests
  cover transparency, padding, mirrored/asymmetric sides, pose maxima and formats.
- Every gap 0–6, both horizontal and vertical directions, walking/running,
  reversals, idle facing, elevation and repeated bends in host trail tests.
  Packaged ARM946 trail tests execute at three relocation addresses.
- 232 immediate packaged calls checked; 100 conversation, scene, menu/PC and
  identity-return cycles per profile. Wider horizontal conversation reach accepts
  both sides and rejects obstructions, excessive distance and vertical widening.
- 12,000 rendering submissions and 3,400 native initial-NPC placements per profile;
  existing scene, wandering-NPC, teardown, rail and zone continuity fixtures pass.
- All 2,574 stock / 4,718 Upgrade appearance records match spacing recalculated
  from delivered artwork. Zekrom/Koraidon use six extra units; narrow art uses less.
- Packaged ROM-backed selection checks each appearance and fallback, cached gap,
  legacy zero-gap formats, all 65,536 object mappings, 16 injected failures and
  100 registry lifecycles with zero registry heap allocations and balanced files.
- Both install/reinstall, disable/re-enable, remove/reinstall and export/reopen
  tests pass. Migrations from 0.6.14 / 0.7.5 preserve resources/descriptors and
  install one copy of each module with the updated spacing metadata.
- Upgrade retains 362 original payloads; 1,256 imported resources decode without
  visible sentinel-magenta pixels. Both delivered saves match previous saves.
- Production web build passes. The full suite had 1,396 passes, three skips and
  three map-import timeouts; an isolated rerun passed all 15 map-import tests.
  No unrelated test or timeout configuration was changed.

Fixed code/initialized-data/BSS totals are 43,152 bytes stock (+192) and 44,132
bytes Upgrade (+244). Sidecar and BSS buffer capacities are unchanged. These are
not whole-game peak heap measurements; native graphics/UI, loader bookkeeping,
stack and VRAM are separate. See [MEMORY-AUDIT.md](MEMORY-AUDIT.md).

Delivered SHA-256:

- stock 0.6.15-alpha: `d699a75d7173cb41b42c62f1f79776affc10073639c2f7718b300bbaf3ab3918`.
- white2upgrade 0.7.6-alpha: `114de93135ebcfa1a12bb78d16d07628af05db8500b84efcf6d289d9d69847b5`.

Evidence: `build/validation-spacing-0.6.15-0.7.6.json` and
`build/spacing-validation-logs/`. Native services and GPU calls use isolated
spies; these checks do not constitute a DS emulator run. Human acceptance is
pending W01–W05 in EMULATOR-CHECKLIST.md and U16 in WHITE2UPGRADE-CHECKLIST.md.
Cold boot the versioned ROM with its matching ordinary save.

## Stock 0.6.14 / White2Upgrade 0.7.5 seamless-zone correction

See [CONTINUITY.md](CONTINUITY.md). The preceding packages reproduced a false
initial-placement collision (reason 4) and unsupported `0x1D9` recall (reason 1)
in CPU fixtures. New actor placement now checks its endpoint; initialized
movement retains its swept collision check. The verified pending NPC placement
command is allowed. No new hook, bridge ABI, heap allocation, or render change.

Executed on both final packaged profiles:

- 100 passes through all 34 NPC initial placements from the reported zones:
  3,400 native position-initialization checks preserving the follower and trail.
- Direct spawn-on-follower still recalls before writing; genuine initialized
  movement still recalls when its route crosses the follower with a clear endpoint.
- Native spawn-data helper preserves live actors and rejects out-of-range
  indices and rail entities. Floccesy Town / Route 20 setup entries contain 16
  and 27 reachable commands respectively; all are covered by the reviewed policy.
- Existing 100 zone deletion, 100 menu/PC, 100 unchanged and 100 changed identity
  storage cycles; conversation, event, ambient-collision and teardown checks.
- 223 packaged immediate calls, relocations/ABI and 12,000 rendering submissions.
- All 21 project/model tests, sanitized host logic tests, production web build.
- Both final ROMs: reinstall, disable/re-enable, removal/reinstall, export/reopen;
  migrations from stock 0.6.13 and Upgrade 0.7.4. Upgrade preserves 362 original
  payloads; 1,256 imported resources decode without visible sentinel magenta.
- Delivered `.sav` files match their preceding profile's saves byte-for-byte.

Fixed code/data/BSS payload is 42,960 bytes stock and 43,888 bytes Upgrade:
20 bytes more per profile, with no new allocation or larger buffer. This excludes
native resources, loader bookkeeping, stack and VRAM.

Delivered SHA-256:

- stock 0.6.14-alpha: `4cf1e21f7b6e240d2badd214d17f963ce342819dad60b5ce4097bd3001e264e4`.
- white2upgrade 0.7.5-alpha: `84e00af01e3b6ec9f5b2afc5b51c1a6b999ff1be8bb052e8b9f40374568cf6a2`.

Receipts/logs: `build/validation-seam-0.6.14-0.7.5.json` and
`build/seam-validation-logs/`. The supplied pre-transition state was inspected,
not advanced. CPU fixtures isolate UI, geometry, allocation and rendering;
these results are not a DS emulator run. Cold boot using the copied `.sav`,
then test X07 between Floccesy Town and Route 20 in both directions, including
walking, running, stopping and turning. Repeat X01/X04/X05 and confirm doors and
warps still recall. Current-release emulator acceptance remains pending.

## Stock 0.6.13 / White2Upgrade 0.7.4 continuity

See [CONTINUITY.md](CONTINUITY.md) for causes and exact policy. No new native
hooks were required. The contract now verifies PC overlay 33 as well as ARM9,
12 and 36; the installer loads all contract-required overlay segments.
Resident event ABI 4 adds identity to the one-shot storage snapshot. Core ABI 2,
artwork, ROM registry cache and 8 KiB conversation capacity are unchanged.

Executed on both final packaged profiles:

- 223 valid immediate calls, relocations, preserved registers, stack alignment
  and previous ARM/Thumb regressions.
- 100 menu-close and 100 PC presentation/fade cycles; exact callback validation,
  recycled event identities, unknown children and unrelated fade rejection.
- 100 unchanged-identity and 100 changed-identity storage reconstructions.
  Identical species with a different personality rejects the old pose. Hidden
  followers cannot create visible-return snapshots; ABI mismatch fails closed.
- 100 native streamed-zone deletion cycles retaining the follower and its trail
  while deleting ordinary actors. Explicit follower deletion remains effective;
  created followers independently carry zone-retention and non-save flags.
- Existing conversation, completion-frame, scene and ambient collision checks;
  12,000 render submission frames per profile with GPU calls isolated as spies.
- The actual US PC bank 1244 has 37 reachable command types; normal storage
  paths are classified, while records/mailbox/manual applications remain
  conservative. Audited Upgrade input has the same relevant script coverage
  and native hook/adapter bytes.
- Sanitized host logic and all 21 project/model tests; TypeScript/Vite build.
- Fresh installation twice; actual-ROM reinstall, disable/re-enable,
  removal/reinstall, export/reopen; migrations from stock 0.6.12 and Upgrade
  0.7.3. Upgrade verification preserved 362 original payloads and decoded 1,256
  imported resources without visible sentinel magenta.
- Both delivered saves match the preceding release saves byte-for-byte. Source
  saves remain intact.

CPU fixtures mock UI, map/rail, allocation and rendering services as documented
in each harness. They are not DS emulator execution. Cold-boot tests X01, X04,
X05 and X07, and Upgrade U07a, remain assigned to the user. Full-screen storage
reconstructs the native field; it cannot retain the original actor allocation.

Fixed payload is 42,940 bytes stock and 43,868 bytes Upgrade (+532 each), with no
new heap allocation. These totals exclude native resources, loader overhead,
stack and VRAM. See [MEMORY-AUDIT.md](MEMORY-AUDIT.md).

Delivered SHA-256:

- stock 0.6.13-alpha: `f05119ea5742062ebd0bd4bba7c737467084f8b9b2889953d7ec0a055d4745e2`.
- white2upgrade 0.7.4-alpha: `1af5659bb58c580ebe1f426cdc81ca562e9a6ba14098d4531efceae39d250f71`.

Receipts/logs: `build/validation-continuity-0.6.13-0.7.4.json`,
`build/continuity-validation-logs/` and both versioned test-build directories.

## Stock 0.6.12 / White2Upgrade 0.7.3 ambient NPC collisions

Ordinary autonomous NPC collision queries now consider the visible follower.
Their native blocked-step behavior waits/retries; player movement, trainer sight
and queries outside that callback retain retail results. Tracked scripts retain
recall priority. Before moving, the follower checks native NPC current/previous
or reserved rail positions. A blocked follower recalls and reseeds from later
safe movement. Controllers ignoring collision results trigger recall before a
conflicting world-position write. Rail fallback uses native world separation,
including when two actors are in the same grid cell.

Three new binary boundaries are pinned: overlay 12 callback dispatcher
0x021671C8, four-argument grid collision 0x0215E538, and overlay 36 rail collision
call 0x02195714. The grid trampoline preserves its live Z argument and replays
the complete displaced prologue. Event bridge ABI 3 registrations are cleared on
field unload. Core ABI 2, rendering, registry format and artwork are unchanged.

Executed automated verification for both final packages:

- 218 packaged immediate-call checks, relocations, preserved registers and stack
  alignment, including the prior ARM/Thumb regression.
- 100 ambient callback cycles using the original native grid collision scan;
  player/outside-query/script exemptions; hidden, height, dimensions, old-tile
  reservations, follower blocked-trail handling and unload behavior.
- Original wandering state-machine blocked/retry branch, followed by successful
  movement when the follower vacates the destination. RNG and terrain conversion
  are isolated test services; NPC retry instructions are original ROM code.
- Resolved rail destinations, native sphere/elevation calculation, separate
  world positions within a grid cell, native reserved endpoints, and fallback
  recall before position writes. Rail/map evaluation services are mocked.
- Existing 100 conversation, 100 conversation-return and 100 scene cycles;
  12,000 rendering submissions with GPU draw spies. Gen 6–9 conversations remain
  included in the Upgrade package tests.
- Sanitized host tests and all 21 project/model tests; production web build.
- Actual ROM reinstall, disable/enable, removal/reinstall and export/reopen;
  stock 0.6.11 and Upgrade 0.7.2 migrations. Fingerprint/conflict checks and
  preservation of the original 362 Upgrade file payloads pass.

The new fixed payloads are 42,408 bytes stock and 43,336 bytes Upgrade: an increase
of 1,328 bytes each over the preceding memory-reduction release, including only
4 additional BSS bytes. The rest is code/initialized data. No new heap allocation
or large buffer is introduced; 1 KiB registry pages and 8 KiB conversation data
capacity remain. Loader overhead, stack, native resources and VRAM are separate.

Final ROM SHA-256:

- Stock: `665c84916d4bbacefe2cd5fb831ce44f0133766c7ca0e1ddb9865b13f71f9ef5`.
- Upgrade: `5b58226facdbc4468984a36ad917814212a13302e8120fba90e98628c93f092a`.

Detailed receipts are in `build/stock-0.6.12-test/`,
`build/upgrade-0.7.3-test/` and `build/validation-ambient-0.6.12-0.7.3.json`.
ROMs and matching copies of the preceding saves are in `Repos/`; source saves
remain intact. Artwork, descriptors, registry, effects and conversation data
fingerprints match the preceding releases. Human cases N01–N08 and Upgrade U15
are NOT RUN. Cold boot from an ordinary save rather than loading an older state.
No game emulator or hardware was run for this release.

## Stock 0.6.11 / White2Upgrade 0.7.2 memory reduction

Both profiles leave the complete appearance registry in ROM, stream validation
through a 1,024-byte cache, and retain only a 16-bit species index and current
page. Core bridge ABI 2 invokes the reader synchronously and retains no callback.
All open files close before returning. Field unload clears lookup bounds/cache.
The only newly used native adapter is the audited ARM9 FS seek wrapper; its
expected bytes, ABI and instruction boundary are recorded in the contract.
No movement-history, artwork, render-correction or save-format changes were made.

Conversation capacity is 8,192 bytes, with 3,852 bytes of current data. Build,
installation and runtime reject oversized data. Upgrade reaction selection now
supports 1–1023, while stock retains 1–649 and Eggs remain invalid. Later-species
cry calls receive the actual species; no new sound assets are included.

Measured fixed code/data/BSS plus separate registry payload:

| Profile | Previous | New |
|---|---:|---:|
| Stock | 143,964 B (0.6.10) | 41,080 B (0.6.11) |
| Upgrade | 102,612 B (0.7.1) | 42,008 B (0.7.2) |

There is no separate registry allocation in either new build. The included
index/cache sizes are 1,302/1,024 bytes stock and 2,050/1,024 Upgrade. Totals
exclude loader bookkeeping, allocator overhead, stack, native graphics/UI and
VRAM. They are not measured whole-game peaks. Both DLL packages remain stripped.
See MEMORY-AUDIT.json and its generator for reproducible object measurements.

Executed automated checks:

- Sanitized host logic/reaction/import checks for both species limits; every
  reaction rule, HP/status/friendship boundaries, names, 8,192-byte acceptance and
  8,193-byte rejection. All 21 project/model tests passed; production web build passed.
- Final packaged registry tests: all 2,574 stock and 4,718 Upgrade exact appearances,
  3,872/6,764 total lookup cases, multi-page stock Unown, cache hits without reads,
  all 65,536 object codes, 100 setup/cache/unload cycles per profile, 15 failure
  cases each, zero registry allocations and balanced file opens/closes. Native
  FS seek instructions execute; the synchronous filesystem dispatcher is mocked.
- Packaged reaction selection for every species 1–649/1–1023, rejecting Eggs;
  100 Upgrade conversations rotate species 25, 649, 650, 722, 810 and 1023.
  Native message, cry, actor and effect services are mocked.
- Both builds pass 207 immediate-call checks, ARM/Thumb relocation/ABI execution,
  100 conversations, 100 conversation-return cycles, 100 scene cycles, and
  12,000 render submissions. These use CPU execution and native-service spies,
  not a DS GPU or game emulator.
- Isolated original Upgrade-state regression: three setup/cache/unload cycles
  retain all 100,332 bytes free on application heap 1 throughout. Registry heap
  allocation count is zero. This excludes actor/graphics and loader peaks.
- Both actual ROMs pass reinstall, disable/enable, export/reopen, removal and
  reinstall. Real stock 0.6.10 and Upgrade 0.7.1 migrations preserve appearance
  data, descriptors and artwork. Upgrade fingerprint/hook conflict rejection,
  all 362 original file payloads and 1,256 imported resource palette checks pass.

Delivered ROM hashes:

- Stock 0.6.11: `67be3e20df382512cba8310bebd8ede45a9f00a0eb0708a0b13731510ebcbc37`.
- Upgrade 0.7.2: `cfc2aa971ed2189661e52b6358f516eb02012da7f29998e9af397284b4612f0d`.

Build receipts, stream tests and snapshot evidence are in
`build/stock-0.6.11-test/`, `build/upgrade-0.7.2-test/` and
`build/validation-memory-0.6.11-0.7.2.json`. ROMs are copied to `Repos/` with
matching saves copied from stock 0.6.10 and Upgrade 0.7.1; originals are preserved.
Cold boot from those ordinary saves, not older emulator states. Begin with
M01–M04 in EMULATOR-CHECKLIST.md and U01/U02/U06/U13/U14 in the Upgrade checklist.
No game emulator or hardware was run for this release.

## White2Upgrade 0.7.1 startup memory correction

The user reported no follower in 0.7.0 and supplied `nofollowers.mln`. Read-only
inspection found 2,821 follower updates, no actor creations, suppression reason
1 (configuration failure), cached failed configuration, a null registry buffer,
and a live event bridge. The captured application heap has 100,332 free bytes;
0.7.0 required 146,032 bytes including its safety reserve. The previous lifecycle
test used a mocked 1 MiB heap and did not establish actual game headroom.

The 0.7.1 runtime uses lossless FWDB v2 packing: 4,718 appearance records occupy
56,648 bytes including the header. All keys, descriptor/resource references,
placeholder/size/animation flags, signed offsets and zone diagnostics survive
conversion. Sprites and descriptor archive hashes are unchanged. Stock runtime
packaging remains 0.6.10 and uses v1. Upgrade installation recognizes 0.7.0,
preserves its assets and enabled state, and stages the converted registry with
all three matching modules. `FWCG` diagnostics report setup stage and heap use.

Executed automated checks:

- 21 project/model tests, including packed metadata, corruption and v1/v2 conversion.
- Packaged runtime tests: 100 conversation, 100 scene and 100 registry lifecycle
  cycles; 12,000 render submissions; all 65,536 object mappings; species 1–1023;
  NULL/low-heap and missing/short/corrupt registry failures. Heap fixtures now use
  the captured 100,332-byte budget. 103 allocations match 103 frees.
- Isolated native heap regression using copied state RAM: the final packaged
  configuration succeeds in three load/cache/unload cycles, leaves 43,640 bytes
  free while loaded, and restores 100,332 on unload. Native allocation/free code
  and heap metadata execute; filesystem responses come from the exported ROM.
  No actor creation, GPU rendering or game emulator runs in this test.
- Real 0.7.0 upgrade/export/reopen, lossless registry migration, unchanged artwork;
  fresh install, reinstall, disable/enable, removal/reopen/reinstall; conflict
  rejection; 362 original Upgrade file payloads preserved. Production web build.

ROM SHA-256: `9986c0a6b8ed0f7f3b2242509d7521a99fe2ee9e2149f54eb23f0f259c29301f`.
Detailed receipt and snapshot evidence are under
`build/white2upgrade-0.7.1-test/` and `build/validation-white2upgrade-0.7.1-alpha.json`.
The preceding 0.7.0 ordinary save is copied to the new basename, without modifying
the original. Cold boot the new ROM and walk at least two tiles; then check doors,
PC return and battle return. User emulator acceptance and hardware remain pending.

## White2Upgrade 0.7.0 expansion profile

The user accepted stock 0.6.10 as good enough. This is a user-reported result,
not evidence that every earlier emulator checklist row was executed.

The expansion profile preserves that follower behavior and adds species 1–1023.
The installer requires the audited Upgrade runtime fingerprints, unchanged
native adapters and nonconflicting PMC relocations. No reference/source ROM
was rebuilt or modified. Existing Upgrade modules and original file payloads
are preserved; standard NARC header normalization may change container bytes.

The supplied fan-game sheets now provide normal/shiny base artwork for all 374
supported Gen 6–9 species. Converted data contains 904 PNG resources and four
HG-engine resources, covering 1,658 appearance keys with 120 explicit alternate
form substitutions. Of the PNG resources, 177 use deterministic 15-color
reduction without dithering; index zero follows alpha, not RGB. All 904 were
regenerated and compared byte-for-byte, then decoded to verify each source crop,
up/down/left/right mapping, transparency and exact unquantized palettes. A
22-species contact sheet was visually reviewed. This is asset review, not a DS
rendering result. The coverage/checklist generator was regenerated after the
new source pack replaced the earlier missing Gen 9 placeholders.

A pre-delivery memory audit caught the enlarged static registry exceeding the
small PMC heap. The expansion DLL now allocates its 113,264-byte registry from
application heap 1 with a free-space guard and the verified non-asserting core
allocator. Field code/BSS totals 43,796 bytes. Packaged CPU tests exercised 100
load/cache/unload cycles: 103 allocations and 103 frees including missing,
short and corrupt reads; low heap and NULL allocation fail safely. Actual game
heap headroom remains a human emulator check.

Additional executed checks passed:

- Packaged ARM946 instruction/relocation checks and the previous ARM/Thumb
  regression, including 206 immediate calls; 100 conversation and 100 scene
  cycles; 12,000 render submission frames and retail main-pass routing.
- Selection for all species through 1023, rejection of reserved Egg IDs, the
  complete 4,718-entry registry and all 65,536 object-code mappings.
- 1,256 imported resources decoded in all directions/animation frames with no
  visible sentinel magenta; 362 original file payloads preserved.
- Actual installation/export/reopen/reinstall, disable/reenable, removal and
  reinstall on the expansion ROM, plus the stock 0.6.10 installation regression.
- Modified expansion runtime and conflicting hook rejection before mutation.
- Twenty project tests, host logic/projection tests and production web build.

Native FS, heap, rendering, UI and actor services are mocked in CPU tests.
No DS emulator or hardware was run. Cold boot with the matching ordinary save
and follow [the expansion checklist](WHITE2UPGRADE-CHECKLIST.md). The copied
save is byte-identical to the prior 0.6.10 save; the original remains intact.

ROM SHA-256: `535e565e8f4e51421d794789d8ac623949082885142c1b5f3126b18feb2768f2`.
Field DLL SHA-256: `9b46bf7bc685e6d892da0a7fb1c4e1f1af2ced35e5ccf03dd1b0d33762587673`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.10 main actor draw routing

Human result for 0.6.9: stair/player ordering and previously improved large-sprite
sideways overlap regressed; flat-ground alternating pixels remained. This result
supersedes any implication that the 0.6.9 numerical tests validated in-game output.

Confirmed cause: the old hook at overlay 36 `0x0218122E` receives the secondary
billboard system from field offset `0xC4`. The follower belongs to the main
system from `0xC0`, drawn at `0x0218119A`. In all three supplied state fixtures,
the actor-system billboard handle equals the main handle and differs from both
secondary and effects handles. The 0.6.9 ownership guard therefore bypassed the
correction. Its removal of the old externalOffset correction exposed the native
rendering problems again. The old test fixture directly passed the actor scene
to FollowingDraw, so its 12,000 numerical checks missed the wiring error.

The field module now intercepts the main actor draw call for correction and
restoration. The existing secondary draw hook forwards normally and retains the
ball-effect draw. The native effects pass is untouched. No further depth-margin
or stair-policy retuning is included in this version.

`verify_render.py` now executes the retail main/secondary/effects argument-loading
blocks with the saved distinct scene handles and packaged Thumb call veneers.
It checks that main submission receives the corrected follower, other passes do
not alter it, all native draws occur once, and registers/stack/quad are restored.
The new check was run against 0.6.9 and failed for the missing main actor hook.
This is a CPU/native-submission test with GPU service spies, not an emulator run.

Fixtures can be reproduced without opening an emulator:

```sh
python3 runtime/following-pokemon/capture_render_bindings.py /path/to/minorheadclip.mln /path/to/stairssink.mln /path/to/stairssideclipping.mln > runtime/following-pokemon/tests/render-bindings.json
```

Executed automated checks passed: three retail scene-binding fixtures; 12,000
packaged render submission frames; 1,728 projection cases; packaged instruction,
relocation and ARM/Thumb checks; 100 conversation and 100 scene cycles; host logic,
19 project tests, field ABI/unload/save-exclusion checks, and the production web
build. Fresh install/export/reopen/reinstall, disable/reenable, removal/reinstall,
and upgrade of the actual 0.6.9 ROM to 0.6.10 all passed without duplicate modules.

The versioned ROM and matching save were delivered to the requested Repos folder.
The new save is byte-identical to the previous alpha save; existing saves remain
unchanged. Emulator and hardware execution were not performed. Human acceptance
remains pending: cold boot from the ordinary save and check Zekrom stair ordering,
large and small followers moving sideways, and building frontage occlusion.

ROM SHA-256: `cc656b280161d21b405b66440dc37cace2c9b77ee56d487dc3b08c6d493aeff8`.
Field DLL SHA-256: `273fd0278a238d033a9ad3f21976e14d0a1a65ccfbeb3de794e38aa6e926dd74`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.9 final-submission depth correction

The user reported that 0.6.7 and 0.6.8 still show alternating actor overlap and
building clipping. The earlier log identified the sideways example as Tornadus;
the inspected screenshot appears to show Sigilyph, whose imported resource is
32px and was excluded by the old correction. Historical offset assertions below
are not proof of visual correctness or successful final GPU submission.

This version removes the update-time externalOffset correction and applies a
temporary change to the owned follower's final native billboard immediately
before drawing. It uses the camera eye/target and final player/follower positions,
including native animation/control offsets. Both sizes participate. Flat ties
use 1/8 world unit plus a 1/256-unit rounding allowance; actual displacement is
only what is needed to meet separation. Perspective translation and quad scale
change together to preserve the projected artwork. Translation/scale are restored
after native drawing, including repeated draws without an intervening update.

Large-sprite stairs retain distinct native/foreground/lower-side policies; the
flat tie rule is not applied across a height difference greater than two world
units. Unsupported projection/billboard types or invalid bindings forward native
drawing unchanged. No new hooks, native locks, actor coordinates, trail state,
save fields, texture resources, or shared polygon attributes are changed.

Executed checks:

- 1,728 independent projection cases across both sizes, perspective/frustum/
  orthographic projection, 24 camera yaws, six pitches and both bob phases.
  Tests bound projected corner drift and verify stable flat depth separation.
- 12,000 final packaged DLL submission frames (100 complete 20-frame cycles per
  size/projection combination), plus camera rotation, final player offsets,
  stair cases, repeated draws and invalid binding/camera checks. The native
  draw spy observes corrected values; actor/trail/scene memory is restored.
- Packaged ARM946 instructions/relocations and the previous ARM/Thumb regression;
  100 retained-actor conversation cycles and 100 scene cycles; event command
  classification and lifecycle/ownership checks. Native GPU/UI services are
  mocked; these are not game-emulator runs.
- Sanitized host logic and eight Python test methods, 19 project tests, field
  forwarding/unload/save exclusion, core mapping and wide-offset checks, and
  production web build passed.

Fresh install/export/reopen/reinstall, disable/reenable, removal/reinstall, and
an actual 0.6.8-to-0.6.9 upgrade all passed. Runtime/data fingerprints survive
reopening, and each module appears once. Automatic ROM/save delivery completed.
The delivered save is an exact copy of the previous alpha save; existing saves
are preserved. No emulator or hardware result is claimed. Cold boot with an
ordinary save and prioritize checklist D04 (Sigilyph), D12 (building frontage),
and D07–D10 (stairs). A custom follower renderer remains outside this change.

ROM SHA-256: `ebca91ba320d606ec3be7efc752882be36af16d176f5598747af373904e965f9`.
Field DLL SHA-256: `75646645ec262e5a07dade75af572b490dddabdf1d299ef4885753b9280a813b`.
Save SHA-256: `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

## 0.6.8 flat-ground map-depth balance

The user reported that the 0.6.7 eight-pixel equal-elevation correction moved a
wide Cobalion billboard far enough behind the player that nearby facade pixels
cut into artwork which should remain in front of the building. This is the
opposite bound of the earlier two-pixel actor-order flicker.

Version 0.6.8 uses a four-pixel equal-elevation margin, midway between the two
observed failure bounds. It continues to classify lateral overlap as behind the
player and corrects animation-shifted frames, while halving the map-depth
displacement introduced by 0.6.7. Unequal-elevation stair policies, foreground
handling, 32-pixel sprites and the repaired Gen 5 palettes are unchanged.

Executed automated checks:

- Sanitized host and packaged ARM946 tests keep neutral and animation-shifted
  flat-ground cases in the behind class. The host test bounds the neutral
  correction below four pixels per world component, preventing a return to the
  0.6.7 displacement.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- The full Gen 5 palette audit still reports 17 repaired resources and 39
  repaired entries with no visible near-sentinel magenta.
- Project tests and the production web build pass. Fresh install/export/reopen,
  disable/reenable, removal/reinstall and an actual 0.6.7-to-0.6.8 upgrade pass.
- The delivered save is byte-identical to the 0.6.7 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.8-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`6279929cf0633cf265045a046cff49cf3e558a09511ba70698b22b91ac40d849`.
The field, event and core DLL hashes are respectively
`481b56d37d2be98ff8db891642f76b181c8eb1b5923d6542e6517070e33d0555`,
`51f3a5ad5aeefcef8b0403607c79ba8c8237f950adf5ec7525d091863f080636`, and
`23c286b07ba85a1576551fc56a349dfec79ff1910a5f1817c3863a4a925f7d35`.

No emulator or hardware result is claimed for 0.6.8.

## 0.6.7 flat equal-elevation separation

The user supplied two screenshots of Tornadus moving laterally through the
player on flat ground. Different animation frames place intersecting parts of
the 64-pixel follower on opposite sides of the player even though both actor
anchors remain at the same elevation. The runtime catalog confirms that both
Tornadus forms use the 64-pixel renderer.

Version 0.6.7 increases only the equal-elevation behind margin from two to eight
pixels along the camera axis. The lateral half-tile classification remains
stable, but the larger separation prevents per-frame draw offsets from crossing
the player plane. The four-pixel lower-stair clamp, elevated native-depth rule,
foreground margin and all 32-pixel native rendering are unchanged.

The user also reported opaque bright-pink pixels across every direction of an
imported Landorus. An audit of the complete imported Gen 5 set found 39 used
sentinel-magenta palette entries across 17 shiny resources. The deterministic
importer now substitutes the corresponding normal-palette entry only for those
sentinels and records every repaired index in the generated manifest. The asset
verifier decodes both animation frames in all four directions for all 624 Gen 5
appearance keys and rejects any remaining visible near-sentinel magenta.

Executed automated checks:

- Sanitized host and packaged ARM946 tests apply the stronger flat-ground
  margin with zero and animation-shifted draw offsets. Both remain in the
  behind class with negative camera-axis correction.
- The Gen 5 verifier decodes every direction and both walk frames for all 624
  appearances. It reports 17 repaired resources and 39 repaired entries, with
  no remaining visible near-sentinel magenta.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- Core, field, effects, asset-catalog, TypeScript project and production web
  builds pass.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall pass. An actual 0.6.6 export upgrades to 0.6.7 with its
  enabled state, updated follower resources and all three modules present once.
- The delivered save is byte-identical to the 0.6.6 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.7-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`bc2fe10cd0372c1ec53a63181b24174a6e4ccc2bdc25a6aabcb6965aeeb019f7`.
The field, event and core DLL hashes are respectively
`23a347b389cddcdd403b2127231424900e1ba7cc0ce58207bb5b4199580824e9`,
`9536e2f107454e71fd0b5bf23bc4fe56eaa1a46743823b770f33734fcafd0767`, and
`0b2e4aea438da6ce6920ce535ee5a4e1bbf18131032fb1fcbc36e071ea6a827b`.
The repaired Gen 5 resource NARC SHA-256 is
`0ff200ce1eebcdf3f9b02a3ea2d73bb4fc88d491899f3fa2644d4b389785fec8`.

No emulator or hardware result is claimed for 0.6.7.

## 0.6.6 partial-elevation lower-side clamp

The user reported 0.6.5 as almost correct and supplied `minorheadclip.mln`,
SHA-256
`472556aeae466f12c5ec9c808d996cb88aebccbf907499d1cfb91b5643e2a08c`,
showing a few rear-railing pixels still covering Zekrom's head. The follower is
one tile lateral while its world anchor is 32,740 fx32 units below the player,
about half a tile, with a `(−8192, 6144, −8192)` draw offset. The saved 0.6.5
diagnostic reports the behind class with zero external correction: the
eight-pixel bound considered this partial-elevation pose already close enough.

Version 0.6.6 tightens only the lower behind/side bound to four pixels. The
reported partial-elevation pose now receives a positive camera-axis correction.
Upper unequal-elevation poses still receive no correction, equal-elevation
side travel retains its two-pixel rule, and foreground handling remains eight
pixels. World, collision, trail and terrain anchors are unchanged.

Executed automated checks:

- Sanitized host and packaged ARM946 tests reproduce both the full lower-step
  case and the partial-elevation `minorheadclip` relationship. Both require a
  positive correction; the two elevated regression cases require zero.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks, including all 65,536
  opcode classifications with native services mocked.
- Core, field, effects, asset-catalog, TypeScript project and production web
  builds pass.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall pass. An actual 0.6.5 export upgrades to 0.6.6 with its
  enabled state and all three runtime modules present once.
- The delivered save is byte-identical to the 0.6.5 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.6-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`b474233528e7fcb5a37d2742bfb93abf880721a9907b2f7fce4be47077e4ee96`.
The field, event and core DLL hashes are respectively
`1ce5f2f4427e9509698a6b279c996b41fc6743e119eb068ccd87fbd2f1517576`,
`8643d9351834317c4fa8ef410db5b656283f8c7faaf2d691f662f1e91fb79501`, and
`f3e6a16dd6c9f16aa9f0318a43112e059c39f948ff7705c890c04acc41ee40bb`.

No emulator or hardware result is claimed for 0.6.6.

## 0.6.5 lower-side stair clamp

The user reported 0.6.4 as much improved and supplied `smallclipsidestairs.mln`,
SHA-256
`a73182b7cdf3a50efbad15f942186b7a884b7515d5a698e179f588452b2cecb2`,
for the remaining case. In that state, Zekrom is one tile lateral and one
elevation below the player while both actors share the same camera-depth world
coordinate. Native actor depth correctly seats the follower on the lower step,
but its 64-pixel artwork extends upward and a rear stair railing cuts through
the head.

Version 0.6.5 distinguishes the two unequal-elevation relationships. An
elevated behind/side follower keeps native map depth, preserving the 0.6.4 fix.
A lower behind/side follower receives an eight-pixel camera-axis clamp. This
limits how far the large billboard can recede behind the player without moving
its world, collision, trail or terrain anchor and without classifying it as a
foreground follower. Equal-elevation and foreground handling are unchanged.

Executed automated checks:

- The sanitized host suite and packaged ARM946 regression include the supplied
  lower-side relationship and require a bounded positive camera-axis correction.
  The two upper-side regression relationships require exactly zero correction.
- The 100-cycle publish build passes packaged relocation, ARM/Thumb,
  interaction, conversation-return and scene checks. The scene suite classifies
  all 65,536 opcodes and preserves native results with services mocked.
- Host logic, core, field, effects, asset-catalog and TypeScript project tests
  pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall checks pass. An actual 0.6.4 export upgrades to 0.6.5 with
  its enabled state and all three modules present once.
- The delivery save is byte-identical to the prior 0.6.4 save, SHA-256
  `313048122da76c5d98a025b93b67e609ad0ca2db4d1045e50c62a8e8a84e9c2a`.

Delivered `White2-Following-0.6.5-alpha.nds` and its same-basename `.sav` to
the workspace parent directory. The ROM SHA-256 is
`10f36524522cb7ea733200e06ec9ff11f39a008099c3ab83a067606d04135613`.
The field, event and core DLL hashes are respectively
`fd317e3657b7113b953adf9dbb7113a3c85c44e2d9f0c67b812646290e16a095`,
`97133db4ea175766e8f5eb0b50544cb586e4d755d05125a290f32c63e8c650cd`, and
`db255cb37a451de3b2b47aaab62cd2f42406fb03d2ed63e13a3d02554487804e`.

No emulator or hardware result is claimed for 0.6.5.

## 0.6.4 unequal-elevation map depth

The user confirmed that 0.6.3 removed the earlier mid-step player-priority
flash, then supplied two new states showing the large-follower correction
crossing map geometry:

- `stairssink.mln`, SHA-256
  `df31d37680081b55e953d98a461140efe4a71d429851e2ce7048f3ac226a3d06`,
  has Kyurem one elevation level above and one camera-depth tile behind the
  player. The 0.6.3 diagnostic offset is `(0, -41213, -28532)` in fx32 units.
- `stairssideclipping.mln`, SHA-256
  `0b9e8b0525ed8539ec6ac796ce9f42e2b34231fc74e7166423b1ebc672469f7c`,
  has Kyurem one elevation level above and one tile laterally beside the player.
  Its correction reaches `(0, -65536, -49766)`.

Both are behind/side classifications. Forcing actor order by moving the whole
billboard backward also moves it behind stair faces and railings, so the map
clips artwork that should remain in front of that geometry.

Version 0.6.4 keeps the native billboard anchor whenever a behind/side follower
differs from the player by more than two vertical pixels. The map then resolves
stairs, railings and walls using the actor's true position. Equal-elevation
side-to-side overlap retains a two-pixel tie-breaker applied before billboard
submission. Foreground followers retain the eight-pixel correction needed for
the confirmed mid-step case.

Executed automated checks:

- Sanitized host tests reproduce the descending and lateral state relationships
  and require a zero correction, while preserving flat behind and foreground
  results.
- The packaged ARM946 regression applies both unequal-elevation relationships
  to the compiled field module and requires all three external-offset components
  to remain zero.
- The final 100-cycle build passes relocation, ARM/Thumb, interaction,
  conversation-return and scene checks. The scene suite classifies all 65,536
  opcodes and preserves native return values with services mocked.
- Host logic, core, field, effects, asset-catalog and TypeScript project tests
  pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable and
  removal/reinstall checks pass without duplicate files.
- An actual 0.6.3 exported ROM upgrades to 0.6.4 with its enabled state and all
  three owned modules intact.

Delivered `White2-Following-0.6.4-alpha.nds` to the workspace parent directory.
Its SHA-256 is `54a90621ad505a65163f0b129bb98d7286f82fa76ea1bde36a96b19ebdde119b`.
The field, event and core DLL hashes are respectively
`dc5260432ee8818b30b0273b42636baf81e25e61370775986e6077291110b79c`,
`c0dece9a333277ec156f3618381d4d8f5a521325d3ebf05f1bfe04b967a5ed9b`, and
`d5034231547bc6c80fa139437d3152a0a2222d410c3ff19885df8e82620269c3`.

No emulator or hardware result is claimed for 0.6.4.

## 0.6.3 stair interpolation and X-menu/PC retention

The supplied mid-step state has a 64-pixel Kyurem follower in the foreground
while the player is interpolating upward on the stairs. Its SHA-256 is
`fd9adbd9ebda489ed66a8bf55ca2923c1a42b8429a06d8d25cfc25c62a77edbe`.
The follower movement callback and native billboard submission run inside the
native model update. Version 0.6.2 applied its final correction after that whole
update, so stair interpolation could overwrite the offset used for the current
draw and the correction became visible on the next frame.

Version 0.6.3 applies the same camera-depth decision in the follower callback,
before native billboard submission, and retains the post-update correction as a
fallback. The bounded foreground/background margin increases from two to eight
pixels to cover transient stair interpolation without changing actor world,
collision or trail coordinates. A packaged ARM946 regression invokes the actual
movement callback at the supplied stair relationship and requires the offset to
exist before the draw stage.

The native normal-field event provider exposes a dedicated X-menu flag. The
field module records that exact menu root, pauses the visible follower and keeps
its actor and trail. Unknown child applications do not inherit this exemption.

The retail PC Box application tears down and reconstructs the field. The four
audited PC opcodes now keep the follower visible during terminal presentation
and capture one bounded restore snapshot before Box teardown. Resident bridge
ABI 2 carries the snapshot across field reconstruction. A same-zone, exact
player-position check gates one-use restoration; selection is refreshed from
the current party and the actor appears at the saved follower pose without ball
effects. Stale or mismatched snapshots are discarded.

Executed automated checks:

- Sanitized scene tests cover exact X-menu ownership, unknown menu children,
  PC presentation-child scope, one-use restore transfer and stale restore
  rejection.
- The packaged movement-callback regression confirms that the stair correction
  is installed before billboard submission.
- The final 100-cycle build passed packaged relocation, ARM/Thumb, interaction,
  conversation-return and scene checks. The scene suite classifies all 65,536
  opcodes and covers 100 retained-actor cycles with native services mocked.
- Host logic, compiled core, field-hook, effects, asset-catalog and TypeScript
  project tests pass. The production web build completes.
- Fresh install/export/reopen, repeated install, disable/reenable,
  removal/reinstall and fingerprint checks pass without duplicate files.
- An actual 0.6.2 exported ROM upgrades to 0.6.3 with its enabled state, three
  owned modules and imported assets intact.

Delivered `White2-Following-0.6.3-alpha.nds` to the workspace parent directory.
Its SHA-256 is `118c36f1887997864338d0254f3d853e3469c77c29ded12f97e65b3114add632`.
The field, event and core DLL hashes are respectively
`03d328a9dc6122a5230d629b5ea7542a362b1d3c3d12775f4a67eda4f61cd90c`,
`90409eab9325a0e2f6b6e2b5c02d535fa48c9e487a6928229658b4795a8d891b`, and
`4adac80d5710801d4eb3c01c0c33742fc31fba3b9e78cf916d470e9d74479de7`.

No emulator or hardware result is claimed for 0.6.3.

## 0.6.2 large-sprite draw priority

The supplied stair state has a 64-pixel Kyurem follower at grid `(37, 5, 722)`
and the player at `(37, 6, 721)`. The follower is one tile toward the yaw-zero
camera and one elevation step lower. Its native draw callback supplies only the
retail two-unit negative-Z follower bias, which lets the higher player win the
depth test at the reported overlap. The same fixed map-axis offset cannot keep
equal-depth horizontal movement stable on rotated cameras.

Version 0.6.2 applies a bounded external draw offset only to descriptors marked
64×64. It projects the follower/player horizontal separation onto the live
camera yaw, treats the follower as foreground after a half-tile dead band, and
otherwise keeps it behind. Eight yaw sectors and nine pitch sectors avoid adding
a runtime math dependency. World position, grid position, collision, trail
history and the player actor are unchanged. The diagnostic block now records
camera yaw/pitch, depth classification, applied X/Y/Z bias and model size.

Executed checks:

- The supplied melonDS state parsed successfully with state SHA-256
  `44458687d5226a59834ef5bfd245df048d4d9187531c45a1c707785a08a32851`;
  its actor-system camera yaw is `0x0000` and pitch is `0x2594`.
- Sanitized host tests cover equal-depth horizontal travel, the half-tile dead
  band, foreground/background positions, cardinal camera rotation and diagonal
  bias.
- The final packaged ARM946 module reproduces the supplied stair coordinates,
  checks that the 64-pixel follower receives the foreground offset, checks the
  equal-depth behind offset, checks a 90-degree camera, and confirms that a
  32-pixel follower receives no new offset.
- Packaged relocation, ARM/Thumb, conversation-return and 100-cycle scene tests
  continue to pass with native services mocked.
- Fresh install/export/reopen/removal checks pass, and an actual 0.6.1 exported
  ROM upgrades to 0.6.2 with its enabled state and three owned modules intact.

Delivered `White2-Following-0.6.2-alpha.nds` to the workspace parent directory.
Its SHA-256 is `ce8cb7337389be732e11906d9634b460da75f9b09989e6cff41e03a9e351c682`.
The field, event and core DLL hashes are respectively
`0ae394f60f1e38ff08053fe54af715cd1cfc27483f14bf6f83f60835a1f24660`,
`231832269929065e6dcf6a1cc7f8195b739048376b03e57a43c92ec4ac621557`, and
`ee0d6185583576d095ab5ab538ec645153ceb7a8708b04670bf3f3fd8bcb0336`.

No DS emulator or hardware acceptance is claimed for the draw-priority change.
Run D01 and D02 first from the human checklist using a cold boot.

## 0.6.1 bundled Gen 5 follower sprites

The user reported that the 0.6.0 Gen 5 up/down frames were reversed. Inspection
confirmed that the importer reordered source pairs `2,3,0,1` even though the
source and target controller both use up/down/left/right ordering. Version 0.6.1
preserves source indices `0,1,2,3,4,5,6,7` for 32-pixel resources and
`0,1,2,3,4,5` for mirrored 64-pixel resources. The generated manifest records
these indices and the asset verifier rejects another ordering change.

The installer now stages the resident registry-extension module, a 61,808-byte
FWDB registry, an expanded descriptor archive, and an expanded model-resource
archive atomically with the existing field/event modules. It reserves extension
codes at `0x3000`, preserves all stock mappings, and uses the verified 32-bit
descriptor-offset path for rows beyond 64 KiB.

Executed checks:

- The deterministic importer mapped **624** valid Gen 5 appearance keys to
  **348** normal/shiny resources. All Gen 5 keys have explicit art; zero use the
  previous Bulbasaur placeholder. Gender differences and valid forms are keyed
  separately even when the source artwork is intentionally shared.
- Every imported resource passed size, palette, transparency, frame-count and
  four-direction decoding. The generated runtime archive has **1,323** members;
  the descriptor table has **3,582** rows and is exactly 100,300 bytes.
- The final packaged field/event/core modules passed relocation, import, ABI,
  ARM/Thumb, 100-conversation, 100-scene-cycle and teardown checks. Native
  rendering and game services are mocked in those CPU checks.
- A fresh ROM install, repeated install, export/reopen, disable/re-enable,
  three-module removal/reinstall and fingerprint checks passed without duplicate
  files. Real exported 0.5.0 and 0.6.0 ROMs upgraded to 0.6.1, retained their
  enabled state, and reopened with each of the three modules present once.

Delivered `White2-Following-0.6.1-alpha.nds` to the workspace parent directory.
Its SHA-256 is `a8aa82c5b503677eda502623ed8ada3a30509990c88286ffb0bbaefdaefa568e`.
The field, event and core DLL hashes are respectively
`5d8bd1a25a569559cb6d307176676067231ed59922eca9ef4c9cddfea38772b5`,
`1a1bffb3034910895a52aac8c00c16c750b7052a9ece1e69204927720cbc11c7`, and
`43d5a69aa8b76a3493aabd7e12c2d67744faebd87489b975dcccfd5fedb25310`.

No DS emulator or hardware acceptance is claimed for 0.6.1. Start with G501–G505
in the human checklist, using a cold boot rather than an older emulator state.

## 0.5.0 visible dialogue and safe scenes

The current package contains one resident event observer and one overlay-36
field module, staged together with bridge ABI/fingerprint ownership. The
registry-extension development core remains uninstalled. See [EVENTS.md](EVENTS.md)
for the command policy, bounds, conservative cases and diagnostics.

Executed runtime checks:

- The pinned US binary matches the expanded hook/adapter contract, including
  both opcode dispatch paths, event/VM teardown, actor action/position/allocation
  adapters and all 162 allowlisted handler entries.
- Final packaged DLLs link through one RPM data import. All immediate call
  instructions pass the ARMv5 audit; arithmetic/trail checks execute at three
  relocation addresses and preserve the earlier ARM/Thumb regression coverage.
- `verify_scenes.py` passes 100 retained-actor dialogue/scene cycles without
  deletes, changed pose/facing/trail, or new resources. It checks all 65,536
  opcode classifications, executes retail standard/extended VM dispatch,
  preserves permission checking and native event results, and checks supported
  child events and bounded concurrent VM identities. The stock script-end cleanup
  command and callback are covered, including audited finalizers, yields, unknown
  active bits, changed bits on resume and invalid cleanup work.
- Resolved actor checks cover distant/crossing grid movement, forced player
  movement, private rail-cursor inputs, world-position writes on non-grid paths,
  elevation separation, unsupported actions, pre-allocation ID/pool/space
  conflicts, unrelated deletion, follower deletion exactly once, generation
  mismatch, callback unregistration and repeated field registration.
- VM-free checks poison the already-freed environment pointer before calling
  the native hook. Sixty sequential VM lifetimes do not exhaust the bounded
  live-token table; 49 simultaneous tracked VMs fail conservatively.
- Existing tests pass 100 own-follower controller conversations and 100
  conversations through the retail event scheduler/completion latch. The 0.4.1
  same-actor return behavior remains intact.

These CPU checks isolate UI, rendering, actor allocation and geometry evaluators
with spies. They do not establish stock-scene visual behavior, actual map curve
coverage, in-game allocation trends or hardware compatibility. Human acceptance
starts with **S01–S03 and S14**, then **S07–S08 and S12** in the
[checklist](EMULATOR-CHECKLIST.md). All new human rows remain NOT RUN.

Executed packaging/application checks:

- Fresh and repeated installation, ROM export/reopen, disable/re-enable,
  two-module removal to inert stubs, and reinstall pass without duplicate files.
- 0.4.0 and 0.4.1 ROM export/reopen/upgrades preserve the disabled setting,
  configuration and unrelated imported files. They install exactly one resident
  and one field module. Modified owned data, conflicting hook bytes and corrupted
  staged module/data assets reject before project mutation.
- Sanitized C logic/reaction checks, five asset-import tests and 19 follower
  TypeScript tests pass. The full application suite passes **1,395 tests** with
  **three skipped**, across 141 files. After the final script-end cleanup change,
  the runtime build gates and focused follower suite were run again and passed.
- Compiled field/effect checks pass, including native save exclusion, hook ABI,
  private cosmetic resources and idempotent teardown. The final production build
  passes; existing bundle-size/mixed-import warnings remain.
- The contract contains 17 sites: 15 installed hooks across the resident/field
  pair and two uninstalled development core sites; 283 native adapter/table
  fingerprints are pinned. The final field DLL has 175 audited immediate calls.

Delivered `White2-Following-0.5.0-alpha.nds` to the workspace parent directory.
Existing saves were preserved. Cold boot with an ordinary save; an older emulator
state restores the earlier modules and cannot validate this build.

| Artifact | SHA-256 |
|---|---|
| Test ROM | `cfbbfb43c0ba8ae795af19b08dcf99c062ee894c7bbee34d7288e3c039c1688e` |
| Field DLL | `2922b042dab14a8f10fd711d71cf92877dda27956c716a3445fc4a4f382cab7d` |
| Resident event DLL | `c5f17239556437785e11e1e2cbf392d8a6c37d7fc129e8088874f9b45e399f90` |

The event bridge is ABI 1. Effect, interaction and emote data are unchanged
from 0.4.1; their hashes are recorded in `build/manual-test/build.json`.
**No DS emulator or hardware acceptance is claimed for 0.5.0.**

## 0.4.1 conversation completion correction

The user reported that completing a conversation in 0.4.0 always recalled the
follower. The regression was reproduced with the old packaged DLL and the pinned
retail event loop: the first completed conversation deleted the actor with
suppression reason 16 (event running).

US ARM9 `0x020169a8` updates the cached event-running byte at game-system offset
`0x35` before callbacks, then runs the field. `0x02016d74` frees a completed event
and clears its pointer without clearing that byte. The field query still reports
an event for the completion frame. The previous cleanup released follower event
ownership before the field update, misclassifying its own completed event.

The fix retains a one-use completion marker for that field update, validated
against field, generation and actor identity and rejected if any current event
exists. It preserves the actor and trail without changing the native cached flag.
Cancellation/unload clear the marker; external event, fade, mode and partner
guards remain active. No new hooks, dialogue/art changes or save fields are added.

Executed checks:

- Exact baseline verification now includes 76 native adapter signatures and the
  same seven manifest sites / five installed hooks. Eight added signatures pin
  the retail event frame order, latch and scheduler routines.
- `verify_conversation_return.py` executes the final packaged DLL with the actual
  retail event scheduler/latch on ARM946. It passes 100 conversations on the same
  actor, standing still, continued movement, one-use ownership, immediate foreign
  events/fades/mode/partner changes, stale generation, message allocation failures
  and unload. UI, actor and resource services are mocked; no DS game was run.
- Existing packaged interaction tests pass, including 100 controller simulations,
  nine interruption stages and balanced resource ownership. All 137 immediate
  calls pass instruction checks; arithmetic and movement run at three addresses.
  Sanitized host logic/reaction tests, five asset tests and compiled field ABI /
  retail save-exclusion checks pass.
- 0.4.0 export/reopen/upgrade passes with one module, unchanged configuration,
  retained disabled setting and unrelated files. Modified previous-version
  dialogue or emote assets reject the upgrade before mutation. Fresh installation,
  repeated install, disable/enable, removal, export/reopen and reinstall pass.
- The full TypeScript run passed 1,392 tests, skipped three, and hit three 5-second
  timeouts in the unrelated map GLB suite while other builds/checks were running.
  Running that file alone passed all 15 tests with the normal timeout. Production
  build passes; existing Vite bundle-size/mixed-import warnings remain.

Delivered `White2-Following-0.4.1-alpha.nds` to the workspace parent directory.
ROM SHA-256: `15250e1dab01ff45c4ae13c9ea32858f1ad4afca2961b85c7401b956b1788775`.
Field DLL SHA-256: `b649712174e9fff35c0dbf5853adeadde4866b9c74013849879035f0a57dc2d5`.
Existing saves were preserved. Human acceptance starts with **C20** in the
[checklist](EMULATOR-CHECKLIST.md): dismiss with A/B, wait five seconds, repeat
without moving, walk away, then check a normal external event/door transition.

## 0.4.0 conversation checks

Executed without starting a DS game emulator:

- Pinned IRDO bytes: seven manifest sites (five installed field hooks, two
  development core sites), 68 native adapters; new event/text/sound/input and
  rail-facing/collision adapters inspected against the US binary.
- Deterministic import: 34 neutral-mood eligible rules in original order, 27 US
  English messages, 12 motions, seven emotes / 14 private 32px I4 resources.
  Data is 3,852 bytes; emote NARC is 10,076 bytes. Reimport reproduces hashes.
- Sanitized C tests reach all 34 rules and cover every HP/status/friendship
  boundary, 649 species, bounded name substitution in all 27 messages, all 12
  motion sequences, missing/fallback conditions and malformed record checks.
- Final packaged DLL has five intended external hooks, no unresolved imports,
  and 133 valid immediate calls. Multiply/divide helpers and existing stationary
  startup/walking trail execute at three load addresses, including the prior
  ARM/Thumb regression. Native call spies assert 8-byte stack alignment and
  caller register preservation.
- Packaged controller checks pass: native event priority veneers, four facing
  directions, rotated rail tangent, obstruction/height rejection, 100 completed
  simulated conversations, all nine stages interrupted, nested foreign event
  ownership, actor/generation loss, and event/string/window/effect/VRAM failures.
  Mock allocation/free counts balance. These are **not** 100 in-game conversations.
- Existing compiled field/effect tests still pass: update/draw forwarding,
  unload prologue, actual retail NOT_SAVE loop, private palettes and cleanup.
- 19 follower TypeScript tests and 76 existing PMC/export tests pass. Actual ROM
  install/export/reopen/reinstall/disable/enable/removal/reinstall checks pass.
  File-level upgrades from 0.2.0, 0.3.0 and 0.3.1 retain disabled state, mapping
  and unrelated files while adding conversations without duplicate modules.
- Production build passes; existing Vite bundle-size/mixed-import warnings remain.

Removal replaces the owned DLL with a deterministic inert module containing no
hooks or callbacks. This preserves NitroFS file IDs after reopening; imported
assets, interaction data and shared PMC stay available for reinstall. Hash
mismatches prevent mutation. It does not claim to erase file slots or uninstall
shared PMC.

Current ROM/runtime/data hashes are recorded in `build/manual-test/build.json`.
`build-following-rom.ts` copies the versioned ROM to the workspace parent and
preserves existing sample saves. No current emulator or hardware result is
claimed. C01–C20 in [the human checklist](EMULATOR-CHECKLIST.md), especially native
input, text rendering, cries, curved paths and interruption timing, remain NOT RUN.
Regenerate the conversation rows with `generate_checklist.py`.

## 0.3.1 freeze diagnosis and correction

The user reported following/effects working in the browser emulator but a lock
on overworld entry in melonDS. Read-only inspection of `melonfreeze.mln` found
ARM9 in Undefined mode (`CPSR 0x6000009b`, `PC 0xffff0108`). The failing call
at `0x023b9eae` contains halfwords `f000 e9fd`, identical to offset `0xe1e`
of the packaged 0.3.0 DLL. The reserved low bit of the Thumb BLX suffix is set.
This is an instruction-encoding fault; the snapshot does not indicate a null
dereference. The earlier pre-effects `frozen.mln` contains the same fault.

The RPM packager's Thumb-to-ARM immediate-call encoding generated these bytes
for the 64-bit multiply helper in movement distance calculation. This calculation
also runs on the second stationary sample, explaining the freeze before walking.
Effect diagnostics in the new snapshot show resource initialization completed
and no send-out/recall started yet.

The helper now has a Thumb entry with a word-aligned local `bx pc` transition
into its ARM body. Callers use ordinary Thumb BL, with no immediate BLX packing
required. No game hook, movement policy, asset or shared PMC installation changes.

`verify_packaged.py` checks the final DLL bytes and executes its relocated code
at three load addresses. It rejects the old DLL's `f000 e9fd` call, checks all
47 immediate calls in the fixed build, tests 106 full-width multiply pairs at
each address, and exercises stationary startup and a walking trail. It preserves
SP and r4–r11. This check is now mandatory before the build publishes the DLL;
the previous checks only exercised separately linked ELF code and missed the
packager's changed instruction.

The fixed build also passes the existing field/effect checks, host/import tests,
18 TypeScript tests and production build. File-level migrations from both 0.2.0
and 0.3.0, export/reopen, repeated install and disable/enable pass without duplicate
files; the effects archive retains its previous fingerprint.

Reproduce snapshot inspection without launching an emulator:

```sh
python3 runtime/following-pokemon/inspect_state.py /path/to/melonfreeze.mln \
  --module /path/to/previous-0.3/PokewebFollowingFieldW2.dll
python3 runtime/following-pokemon/verify_packaged.py
```

No new DS game run is claimed for this fix. Cold boot the new ROM with an
ordinary save and perform A00 and FX01–FX05 in the human checklist. Loading an
old emulator state restores the broken code and cannot validate the fix.

## 0.3 effects build checks

- Imported original HGSS ball, flash model and texture animation; deterministic
  3,052-byte archive with Pokeweb's canonical nameless FNT. Length/hash/CRC
  fingerprints are checked before installation and runtime resource loading.
- Verified pinned IRDO binary: five manifest sites (three installed field hooks,
  two development-only core sites) and 39 native adapter signatures.
- Built standalone field module with exactly three intended hooks and no imports.
- Compiled instruction checks with mocked native services passed: existing render
  forwarding, preserved stack/registers, two ball ticks/eight flash frames,
  white shrinking snapshot after actor removal, unchanged shared materials,
  no per-frame allocation or texture upload, safe missing-asset/low-memory skip,
  and repeated destruction without double frees. Native render output is not tested.
- Follower host/import tests and 18 TypeScript tests pass, including effects-file
  integrity and byte-identical archive normalization. Production TypeScript/Vite
  build passes with existing bundle warnings.
- Actual ROM install/export/reopen, repeated install and disable/enable checks
  pass with byte-identical owned DLL/config/effects and no duplicate files.
  A file-level 0.2 export/reopen/update/reexport check also passes: one module,
  disabled setting and native config retained, only the new effects archive added.

The current manual-test artifact is under `build/manual-test/`; `build.json`
records its version and hashes. The export command does not start an emulator.
An initial automated game run was stopped at the user's request before acceptance;
it provides no completed 0.3 game-validation result. Further emulator testing is
assigned to the human FX checklist. In particular, door-fade timing, placement,
large Pokémon alignment, palette isolation in a rendered scene and GPU/resource
lifetime during interrupted transitions remain pending.

## Historical 0.2 game-emulator evidence (2026-09-20)

The final walking run used the production Pokeweb installer and exported ROM:
5,000 emulator frames covering Aspertia City walking and four-direction turns,
an X-menu recall/return, Pokémon Center entry, indoor movement, exit, running/
reversal inputs, and a completed save. The party lead was Mew (species 151),
resolved to native object code `0x1098`. Captures visibly show Mew behind the
player outdoors and indoors. Diagnostic traces show one owned follower at a
time and deletion/recreation across the menu and field transitions.

A separate 1,800-frame cold boot used the normal exported ROM (without the
Quick Launch startup module) and the newly written save. It reached the saved
location, recreated one follower and followed subsequent movement. No emulator
undefined-instruction/assertion/abort output was observed in either final run.
The headless harness asserts visible outdoor/indoor samples and menu recall;
it also asserts a visible follower after the cold reload.

Reproducible commands and local evidence paths:

- `npm run following:emulator -- /path/to/clean-white2.nds 5000`
- `npm run following:emulator -- /path/to/clean-white2.nds 1800 --reload`
- `build/emulator/trace.json`, `reload-trace.json`, `frame-*.png`,
  `reload-frame-*.png`, and `after-test.sav`/`.dsv`.
- `build/emulator/White2-Following-Alpha.nds` is the normal testable ROM;
  `White2-Following-Alpha-QuickLaunch.nds` is the separate harness startup ROM.
- `build/emulator/evidence.json` records artifact hashes; generated ROMs, saves,
  captures, and tool output remain ignored local artifacts.

Harness outputs can be replaced by later local runs. Check their hashes against
the historical evidence before associating a file with the 0.2 results. Use the
separate `build/manual-test/` artifact for current 0.4 human testing.

These runs are **not** the 100-cycle release soak. They do not establish rail,
ledge, non-grid, bridge, battle, partner, communication, or hardware coverage.
Saving and cold reload succeeded; unpatched-game save testing remains outstanding.

## Historical 0.2 executed checks

| Check | Result | Scope |
|---|---|---|
| Pinned clean ROM | Pass | IRDO revision 0; SHA-256 `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446` |
| Binary signatures | Pass | Object lookup, descriptor offset edit, field sites and 20 native adapter signatures; full disassembly/ABI evidence remains scoped to the exercised paths |
| Native registry inventory | Pass | 1,008 rows, 28 bytes each; 975 resources; row ordering agrees with all stock ranges |
| Field build / veneers | Pass | Standalone overlay-36 DLL, only two intended field hooks, no unresolved imports; compiled update forwarding and unload prologue ABI checks |
| Retail save exclusion | Pass | Actual IRDO save-loop and iterator executed on ARM946 emulation; bit 20 skips follower serialization |
| Core build | Pass | Standalone development PMC DLL; only intended ARM9/overlay-12 external copy relocations; no unresolved imports |
| Compiled ARM946 core | Pass | All 65,536 inputs compared against execution of retail lookup instructions; SP and r4–r11 preserved |
| Core configuration | Pass | Valid FWDB enables bounded extension; malformed data revokes previous bounds |
| Descriptor edit | Pass | Exact assembled eight-byte edit executed; offsets above 64 KiB retained |
| Portable C host checks | Pass | Address/undefined-behavior sanitizers; lead selection, identity, low HP, nested suppression, interaction interruption, trail reversals/ledge samples/rail discontinuities/overflow, object mapping |
| Follower TypeScript tests | 17 passed | Registry validation, 32/64-pixel resources, transparency, independent/mirrored sides, animation timing, transactional import failure, placeholder retention, duplicate prevention, private-file integrity, unsupported targets, data-only ROM export/reopen/update, native config bounds, fingerprinted enable/disable |
| Python import tests | 5 passed | Deterministic containers/packages, invalid input rejection, transparency, explicit HGSS indices/palette, hg-engine indexed palette preservation |
| Stock asset inventory/decoding | Pass | 649 species, 2,574 keys; 1,068 exact and 1,506 placeholder appearances; 618 resources decoded in four directions/four phases |
| Existing PMC/export regression tests | 76 passed | `pmcModel`, `pmcModelCache`, `romExport` |
| Actual alpha install/export/reopen | Pass | Install twice, disable/enable, export/reopen, reinstall, disable/reexport and reenable; unchanged owned DLL/config and no duplicate files |
| Production build | Pass | TypeScript and Vite; existing chunk-size/mixed-import warnings remain |
| Working-source privacy audit | Pass | No private machine paths in commit-eligible source |

The appearance registry is 61,808 bytes. The proposed full descriptor table
would be 100,300 bytes, confirming why a 16-bit descriptor offset is insufficient.
The editor currently stores data under `following/`; it does not append the
native table or activate these object codes.

The asset-workspace unit regression uses a synthetic ROM. A separate
`verify-following-install.ts` integration check uses the actual alpha ROM export.
The compiled-core runner emulates ARM instructions with Unicorn; it is not a DS
game emulator and does not validate PMC load/unload ordering or rendering.
Source-art import tests use generated fixtures; automatically assigning the
available HGSS/hg-engine library and reviewing those assignments is outstanding.

## Not executed / incomplete

- Complete native actor-ID/zone/script audit, resource-pressure handling and
  allocation/callback/texture/palette telemetry across all teardown paths.
- Dedicated accepted grid/ledge/rail/non-grid adapters and full ordinary
  exploration coverage. The alpha samples actual world poses with bounded history.
- Exhaustive story-partner, external script, battle, blackout, transport,
  communication and special-activity guard timing. See `GUARDS.md`.
- Human acceptance of native A-button conversations, nickname layout, cries, emote placement and rail reach.
- Runtime use of arbitrary editor replacements, map-policy controls, and
  restoration of preexisting user-modified descriptor/resource archives.
- Human validation of asymmetric and shiny rendering, lighting, shadows,
  reflections, weather, grass and representative large-sprite visuals.
- Unpatched-game save round trips, 100 mixed transitions, crowded-area soak,
  complete heap/resource traces, and DS-family hardware.

The application exposes the Gen 5 sprite alpha with these limitations. Prepared
arbitrary custom assets remain separate from the runtime archive generator. The checklist
contains NOT RUN placeholders for human results; it is not a claim that those
scenarios have passed.

## Stock White 2 0.6.40 party Surf mounts

The clean US White 2 binary contract and both mount-draw sites were verified before the stock-only package was published. The importer generated 1,455 sorted appearance records and 23,280 64-pixel texture members from the Swimming and Levitates normal/shiny source sets. Its 11,656-byte version-2 registry and 52,426,612-byte NARC remain in ROM. Every species 1–649 has normal and shiny base art; the imported native forms were checked against the stock personal archive. Numbered later-only forms were excluded, and 87 sheets used deterministic palette reduction. Source hashes and conversion metadata are in `surf-mounts.json`.

Packaged ARM946 CPU tests passed for party order, all four Surf move slots, Egg rejection, fainted members, shiny/form/female lookup and fallback, invalid registry rejection, both entry hooks, cached jump-frame rendering, draw priority, ten-pixel rider lift/restoration, and resource teardown. The existing stock continuity/render suites passed. Pokeweb installation, idempotent reinstall, export/reopen, disable/reenable, removal/reinstall and upgrade from 0.6.39 in both enabled and disabled states passed. Authored dialogue and gift archives stayed byte-identical through the upgrade. TypeScript checking and `git diff --check` passed.

The released ROM is `White2-Following-0.6.40-alpha.nds` in `Repos/`, SHA-256 `99e60d67a9a0dbf7f47d2f0407311336c42c7fc174f38c612a43c9ba5652ebc2`. Its same-basename `.sav` is byte-identical to the prior 0.6.39 alpha save. No emulator or hardware was run; visual acceptance remains with the user's cold-boot Surf checklist.

## White2Upgrade 0.7.24 party Surf mounts

The pinned White2Upgrade source ROM and both ordinary/shore-hop overlay hook bytes passed the Upgrade-specific audit. The version-2 Surf registry contains 2,324 sorted appearances and 37,184 texture members. All Gen 1–5 base species retain the stock Surf art; 360 later-generation species have matching normal base Surf art and 358 have shiny base art. Fourteen Gen 9 species lack matching Swimming/Levitates base sheets and use the retail mount. Native forms are mapped through the audited expansion appearance manifest, and every imported form is in the source ROM personal archive. Source hashes, palette reduction and missing-base IDs are recorded in the Upgrade Surf manifest.

Packaged ARM946 instruction tests checked later-generation party selection, all four Surf move slots, Egg skipping, party order, species 1023, and no Surf knower. The shared packaging/render checks passed. The exported ROM passed Pokeweb compatibility and original-file integrity checks, reinstall, disable/reenable, removal/reinstall, and upgrade from 0.7.23 with authored dialogue and gifts unchanged. TypeScript checking and production Vite bundling passed. The fixed PMC module payload is 51,560 bytes, up from 47,708 bytes in 0.7.23; the 18,608-byte Surf index and 83,738,420-byte archive stay in ROM, with only the chosen 16 textures resident. Native graphics allocations and VRAM are not included in the fixed-payload measurement.

The delivered ROM is `White2Upgrade-Following-0.7.24-alpha.nds` in `Repos/`, 577,670,904 bytes, SHA-256 `cdf84e12fa7ecf7ae51107762634baa64a8bd4213922d1f8dc89dd4f58450c0e`. Its matching `.sav` is byte-identical to the 0.7.23 expansion save. The ROM exceeds the standard 512 MiB DS cartridge size; Pokeweb can export/reopen it, but game-emulator compatibility is unverified. No game emulator or hardware was run. Human checklist U25 remains NOT RUN.

## Surf art scale and south-facing draw order, 0.6.41 / 0.7.25

The supplied `facingdown.mln` state identifies stock 0.6.40 with Azumarill selected as the Surf mount, facing south. Its source sheet uses 64-pixel cells, whereas Arceus uses 128-pixel cells. The old importer enlarged both to 64-pixel textures. The importer now preserves their intended 2:1 source-to-game scale: Azumarill becomes 32 pixels and Arceus remains 64 pixels. Other sheets with intermediate cell sizes use transparent 64-pixel textures for their halved art. The stock archive is 18,339,700 bytes with 1,387 small and 68 large appearances; the Upgrade archive is 29,081,396 bytes with 2,224 small and 100 large appearances. Both stay in ROM, with only the selected mount's 16 frames loaded.

The south-facing mount still renders in the post-player pass. The forced depth policy now keeps at least a four-world-pixel lead or lag relative to the rider, so rider bobbing cannot collapse the prior near-tie into alternating depth order. Packaged CPU tests checked both forced policies, Azumarill's downsampled alpha pixels and texture dimensions, Arceus's 64-pixel art, catalog bounds, party selection, cached shore-hop frames, and rider lift. Stock and Upgrade package builds passed. Pokeweb export/reopen, reinstall, disable/reenable, removal/reinstall, and previous-Surf-version upgrades passed for both profiles, with authored dialogue and gifts unchanged. The Upgrade ROM additionally passed original-file preservation and conflict checks. TypeScript and production bundling passed. The editor footer now includes the supplied overworld sprite credits.

The delivered ROMs are `White2-Following-0.6.41-alpha.nds` (SHA-256 `fac9cc8d29810578ed19ecec43e7e6091a93962d711a4308f78abb82c296a703`) and `White2Upgrade-Following-0.7.25-alpha.nds` (SHA-256 `dfaceabfa99dae5a365fa1fd81ac3a58ab8b57a63d9e914b4908f4a711b3caa4`) in `Repos/`, each with a same-basename save copied from its preceding alpha. No game emulator was run; visual acceptance remains pending.

## Surf dismount rider height, 0.6.42 / 0.7.26

Read-only inspection of `Repos/disembark.mln` (SHA-256 `b24e7b43e002a076b04b22ecf145d7fc59d4c6378aca664a5310312ee976e960`) found stock 0.6.41 at field tick 1204. The Surf state was still active, but the last native mount pose was captured at tick 1182. The mount draw guard therefore rejected it as stale, while the rider draw path continued to add ten world pixels to the player. At the saved frame the native player actor was six pixels above the old mount height in its shore-hop arc and 32 pixels away horizontally. The patch lift made that visible separation sixteen pixels even though the mount had vanished.

The rider lift now uses the same one-frame mount-pose freshness requirement as the mount draw path. Its ten-pixel lift continues while mounted and ends as soon as the mount disappears, even if native Surf mode remains active during the landing animation. The native actor position, jump arc, shadow, and collision are unchanged. Packaged ARM946 tests executed fresh, one-frame-old, and stale mount frames and checked rider pose, draw order, and restoration. Stock and Upgrade builds passed their packaged checks. Both delivered ROMs passed update from the immediately prior Surf alpha with authored dialogue and gifts preserved, plus install/reinstall, export/reopen, disable/reenable, removal/reinstall, and production TypeScript/Vite build. The Upgrade original-file and conflict checks passed. No DS emulator or hardware was run.

The delivered ROMs are `White2-Following-0.6.42-alpha.nds` (SHA-256 `30f4290e3cadaf061e42bf782835c6108369634cc69402ab403f6fbe845548e3`) and `White2Upgrade-Following-0.7.26-alpha.nds` (SHA-256 `37ef43a2ebb1f37de6311aa744e9423971dfc128691deb677d3541472283c530`) in `Repos/`. Each has a same-basename save copied byte-for-byte from the preceding alpha without overwriting existing saves. The fixed PMC payloads are 50,620 and 51,600 bytes, respectively; native graphics allocations and VRAM are outside this measure. Human cases SF09 and U27 remain NOT RUN.
