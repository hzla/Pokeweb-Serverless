# Generic HGSS conversations — 0.4.1-alpha

The field module intercepts the result of the normal grid/non-grid event providers.
It only offers a conversation after retail providers return no event. A fresh A
press must face an idle, visible follower at compatible elevation and reach;
grid paths also query the native forward tile and collision check. Non-grid
paths use the native rail-facing tangent and rail terrain/limit checks, with
a connected recorded corridor within reach. Curved rail reach still requires human acceptance; the follower is never made blocking.

`interaction.c` owns a native GameEvent node, string, message-window slot, copied
identity/stat/name snapshot and temporary visual offsets. The exact owned event
is exempt from follower recall. Movement replay pauses while interacting. A
foreign event, fade, actor identity/generation change or teardown cancels it;
cleanup unlinks only its own live event node and never clears another event's
locks. No retail NPC script or partner state is assigned. Native event ownership
prevents player field movement during the reaction; no persistent lock is added.

On completion, a single-use ownership marker spans the final field actor update.
White 2 snapshots event presence at the start of the frame: the event pointer is
cleared when a callback finishes, but the cached running flag stays set until the
next frame. Releasing ownership immediately caused 0.4.0 to recall the follower.
The marker applies only to the same field/generation/actor with no current event;
it is consumed once and cleared on cancellation or unload. External events and
independent fade/mode/partner guards still win. The native flag is never cleared
by follower code. Actor identity, visibility and recorded trail survive dismissal.

The controller runs motion → emote → native text → close → imported wait for
each reaction step. Motion changes draw offsets and facing, leaving collision
coordinates and trail samples unchanged. Diglett/Dugtrio omit vertical offsets.
Normal/distressed cries fire at the imported sound gate, using actual selected
species/form. Distress lowers native waveform speed by 2,143 from 25,825. Sound
loading defers the cry so its native busy wait cannot stall the field. Cosmetic
allocation failure skips the effect; message failure cancels and releases control.

## Data and import

`npm run following:import-interactions -- /path/to/heartgold.nds` reads the
inspected US HeartGold IPKE layout without changing the ROM. It imports ordered
occurrences and reaction/action tables, English message bank 265, and seven
original emote texture pairs/timings. It filters environmental/reward branches
and mood conditions incompatible with zero. The resulting counts are 34 rules,
27 messages, 12 motions, seven emotes and 14 private single-frame textures.
Friendship and mood changes in source reaction trailers are intentionally ignored.
There are no Yes/No prompts, gifts, Shiny Leaves or location-dependent messages.

`interactions.json` records included rule/message IDs, excluded occurrence rows,
text, lengths and SHA-256/CRC fingerprints. The runtime `FWTK` ABI-1 file has a
48-byte header, bounds-checked tables, relative offsets and CRC. It includes the
emote NARC length and CRC. Nickname/player substitution tokens are expanded into
a bounded UTF-16 native string; native line breaks, text speed and page controls
are retained. Runtime limits are 8 KiB data and 192 text code units.

`following/interactions.bin` and `following/emotes.narc` are installed atomically
with the DLL, stock mapping, original ball/flash effects and installation receipt.
Data and emotes are fingerprinted before mutation and validated again at load.
They own their texture/palette allocations and do not recolor another actor.
A mismatched ABI, malformed rule, reference or animation bound rejects loading.

## Binary and test scope

`contract.json` records exact IRDO bytes and ABIs for the two additional overlay-36
BL sites (`0x021818bc`, `0x02181a6c`), native event/input/text/sound adapters and
structure offsets. Existing update, draw and teardown hooks remain. No reference
game source is rebuilt. `build.py` rejects unresolved imports/unexpected hooks
and checks the final RPM/DLL instructions before publication.

`verify_interactions.py` executes packaged ARM946 instructions with native-service
spies. It covers normal completion, each controller stage interrupted, foreign
event ownership, actor/generation loss, resource failure and 100 simulated talks.
`verify_conversation_return.py` also executes the pinned retail event scheduler,
cached-flag update/query and the packaged field callback. It reproduces the 0.4.0
recall and checks 100 conversations on one actor, idle/walk resumption, single-use
ownership and external transition guards. This check is required before publishing.
Native UI/actor/resource services remain mocked; DS graphics, sound and full-game
input/scheduling still require human testing.
`generate_checklist.py` maintains C01–C20 in the human checklist; those tests and
hardware validation remain separately pending. `FollowingTalkDebug` exposes
magic/version, active/stage, source rule/species, starts/ends/cancels, emote validity,
error and callback tick count for debugger inspection. `FollowingGiftDebug` records
archive validation, claim lookup, the selected rule/item/slot, and transaction result.


## Contextual assignments

`following/contextual-dialogues.narc` is a single-member follower-owned archive. Its ordered rules may require a field zone, exact species/form, either live Pokémon type, and the existing HP, status, friendship, facing, and chance predicates. Its message payload is validated before use; malformed or unavailable contextual data falls back to the ordinary generic conversation pool.

The zone selector uses the live field object's audited `ZoneID` at offset `0xE0`.
It does not use `FieldActor::ZoneID`: the player actor can report zero while the
field object holds the current zone, as observed for Aspertia City zone 427.
