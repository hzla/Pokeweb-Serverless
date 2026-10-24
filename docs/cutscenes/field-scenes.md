# Field scenes and seamless player handoff

The first live field-tour backend is implemented for US White 2. Open
**Maps → Field tours** on localhost. Camera moves, holds, actual
player/NPC walking and facing, cries, camera shakes, paged dialogue, and a mandatory Return control action share a strict
`pokeweb.field-scene` version-1 JSON document. Sources persist in projects and
can be imported, exported and edited visually. Route 13 (zone 370) is the
verified fixture. The version-2 dedicated native sequence timeline remains a
separate backend; its response branches are not yet field actions.

The field tour uses existing game field-script instructions. Ordinary movement/dialogue tours add no
executable adapter; seasonal tours install the field environment extension described below. Test downloads use the app's existing quick-launch startup
patches, append a private script/step trigger to the download, and supply the
bundled save unchanged. Press **Down** in Aspertia to warp to Route 13 and begin.
There is an initial map-loading transition. After that, the tour, player entry,
camera return and restored input all stay in the same live field. Normal ROM
export does not install field-tour triggers; use Download W2 test ROM here.

Ordinary tours require a following gameplay camera with no dynamic
regions and a final coordinate inside its supported camera bounds. The stationary
Aspertia environment tour can return to its captured region-camera pose. Export checks
all player and NPC tiles for known blocked/water permissions and rejects native camera
interpolation overflow. Permission checks are conservative; they do not simulate
NPC occupancy, terrain scripts, ledges or doorways. Preview height comes from
rendered terrain and overall script scheduling is approximate. The game resolves
the real player appearance and collision height. Preview uses
spring for ordinary tours; environment previews sample their authored seasons. Ordinary runtime tours keep the game's season, lighting, music and animated materials.
Choices, skip/cancel and door exit choreography
still need field-specific compilation and verification.

## Player movement preview

Choose **Nate** or **Rosa** under Preview player. This uses the active ROM's W2
walking sprites (registry entries 232 and 240); the choice is saved with the
project and does not change the actual player binding or exported scene JSON.
The pose strip highlights the sprite texture shown in the preview. Nate's
controller uses an additional standing texture for each direction; that appears
as a fourth pose instead of being substituted with a walking frame.
Previous/Next display frame advances one 60 Hz display frame, or half of a
30 Hz source frame. The numeric Preview frame control also accepts half frames.

Standard standing and normal walking animation programs are read from the active
US W2 field overlay. Their texture order and hold durations drive the preview;
dense position samples do not restart the walking animation. Normal walking
advances two world units per 30 Hz update (eight updates per tile), holds position
on the intervening display frame, and retains the alternating foot through stops.
Changing direction resets the foot. The initial texture upload on the first walk
follows the fresh-map test fixture's one-display-frame delay. Later controller
changes queue immediately; graphics commits can still differ by one display
frame when actors run concurrently.

The native audit compares every displayed sprite and X/Z position relative to
each action's start, across all four walking directions, repeated same-direction
walks, stops and facing changes. It does not establish exact global VM scheduling,
ground height or camera-relative facing for rotated cameras. Run/jump/gesture
programs are not exposed by these tracks.
Original dedicated sequence animation continues to use its native scene resources.

To repeat the movement audit, build a test ROM with the supplied
[multi-direction scene](../../examples/cutscenes/route13.sprite-motion-audit.field-scene.json),
then run:

```sh
npx vite-node scripts/build-field-scene-test.ts CLEAN.nds AUDIT.nds examples/cutscenes/route13.sprite-motion-audit.field-scene.json
npx vite-node scripts/verify-field-sprite-motion.ts AUDIT.nds AUDIT.sav examples/cutscenes/route13.sprite-motion-audit.field-scene.json OUTPUT_DIR
```

This checker expects separate walking blocks and facing changes after walking.
It reads the live actor and billboard texture from emulator memory; it does not
use the camera's copied follow-position vector as an actor identity.

## NPC tracks

Choose **Add NPC**, then use **NPC placement** to select a sprite, name, entry tile,
entry facing and handoff behavior. **Pick NPC entry on map** places its feet on a
clicked tile; Free view helps reach offscreen coordinates. The catalog currently
accepts standard human controllers 1, 3 and 6, including their native standing
and walking textures. Other sprite controllers and 3D overworld models require
separate animation decoding and are rejected rather than given guessed cycles.
Up to eight authored NPCs may be present in one tour.

Each NPC has a lane beneath the camera/player action blocks. Click an empty cell
to add a walk or facing action, or an existing cell to edit it. **NPC movement**
lets you move the action to another named block, change direction/distance or
delete it. There is one NPC action per actor per block. Actions in the same column
start together; the next column waits for the camera, player and every NPC to
finish. A longer NPC walk extends the block, without slowing a shorter walk or
stretching a camera move. Add Hold blocks to create additional timing boundaries.
Reordering blocks keeps NPC actions attached to their stable block IDs; deleting
a block also deletes its associated NPC actions.

**Inspect poses** can select either the player or an NPC. Each track has its own
native controller programs, facing, alternating foot and position clock. Empty
cells hold the actor's last position/facing. Source times remain 30 Hz; stepping
inspects 60 Hz display samples. Native actor tasks may start between field ticks,
and graphics commits can differ by one display frame. The runtime audit reports
that phase/texture latency separately from exact matches. Overall VM scheduling,
terrain height and camera-relative facing with rotated cameras remain estimates.

NPC tracks are optional `actors` in the version-1 JSON source. A language author
can say “while the player enters, walk the guide four tiles south” by attaching a
guide action to that player's block ID:

```json
{
  "id": "guide",
  "name": "Coast guide",
  "overworldId": 232,
  "entry": { "tileX": 698, "tileZ": 244, "facing": "left" },
  "endBehavior": "stay",
  "actions": [
    { "id": "guide-walk", "stepId": "player-entrance", "type": "walk", "direction": "down", "tiles": 4 }
  ]
}
```

Export allocates unused actor IDs from 128–254 after scanning the ROM's static
NPC events, creates transient actors using native `0069`, starts each track with
`0064` and waits for the group using `0065`. By default it changes no NPC event records or
save data. Replays clear only the assigned transient IDs before recreating them.
With `placement: "map"`, export instead appends a stationary ordinary NPC record
to the target map, and the tour reuses that actor without deleting or creating it.
This mode requires `endBehavior: "stay"`. The Aspertia environment adapter also
restores a missing assigned map actor when Continue resumes an older cached NPC
list; it checks for the actor ID first, so re-entry does not duplicate it.
**Stay until map unload** retains the actual actor after input returns; it is not
a persistent story NPC and has no authored interaction script. **Remove when tour
ends** uses native `006c` before unlocking the player. All actors finish their
movements before handoff. Path validation covers loaded ground permissions, not
actor occupancy, event scripts, ledges, stairs or doors.

The [two-NPC Route 13 example](../../examples/cutscenes/route13.npc-field-tour.json)
exercises camera overlap, concurrent player/NPC walking, all four NPC walking
directions, facing, retention and removal. Build and verify it with:

```sh
npx vite-node scripts/build-field-scene-test.ts CLEAN.nds NPC_TEST.nds examples/cutscenes/route13.npc-field-tour.json
npx vite-node scripts/verify-field-npc-tracks.ts NPC_TEST.nds NPC_TEST.sav NPC_TEST.scene.json NPC_TEST.manifest.json OUTPUT_DIR
```

The checker reads actual actor IDs/models, billboard textures and X/Z positions,
checks stable standing poses, verifies simultaneous player/NPC movement and both
cleanup choices, then exercises player input after camera return. Its report
separates inferred actor-clock half-frame phase and one-display-frame texture
commit latency; neither is presented as an exact global timeline match.

## Dialogue

Choose **Dialogue** in New field action, then **Add action before return**. Select
the Player or an existing NPC as **Speaker**, enter its speech, and choose
**Pause until player advances**. With that option off, **Hold per page after
printing** sets a duration in 30 Hz field updates. Apply action saves the change
to the same JSON/project source used for export. Dialogue cards can be moved or
removed like other actions. Reassign a speaker before removing its NPC.

Text accepts plain Western characters, up to 512 characters per block. Words
wrap at 24 characters; each native page contains at most two lines and each block
at most twelve pages. Explicit newlines are supported; raw game control codes are
rejected. A native balloon points to the selected actor. The browser labels the
speaker above its page controls; it does not reproduce the game's balloon layout
or font exactly.

Input mode holds the camera and all actors until each page is confirmed. Use
**Continue / Enter** (also A/B when not typing) in preview; W2 requires a fresh
**A/B** press after printing finishes. A key held from the preceding page does
not dismiss the next page. Timed mode holds each page after native printing
completes, then advances automatically. The preview shows whole pages immediately,
so native printing adds time beyond the nominal source clock. Ambient map materials
and music keep running during dialogue. Actors hold; the camera holds unless a
timed dialogue block includes its own `camera` move. NPC track
cells are disabled on dialogue blocks. Insert movement/hold blocks between speeches
to choreograph facing or walking.

The strict source represents a waiting speech as:

```json
{
  "id": "guide-talk",
  "type": "dialogue",
  "speakerId": "guide",
  "text": "Welcome to Route 13!\nEnjoy the ocean view.",
  "waitForInput": true
}
```

Use `speakerId: "player"` for the actual player. Timed speeches instead use
`waitForInput: false` and `durationFrames: 45`, for example. Waiting blocks have
a one-frame timeline marker; the player's reading time is additional. Timed
blocks reserve `durationFrames × pageCount` source frames. The next action starts
after every page completes, with the prior camera/actor pose intact.

Export appends a private bank in the **story text archive `a/0/0/3`**, preserving
existing banks. Native `003c` selects that bank, page and actual actor ID and waits
for printing; `0031` waits for fresh A/B input, or a native sleep holds a timed
page. `003e` closes the balloon at the end of the speech. This backend adds no
dialogue executable adapter. Choose **Dark translucent narration** to use
native `0034` / `0036` instead. This window reads the map's default story bank,
so export appends its messages there while retaining the original encrypted
message payloads and metadata. Native narration is currently verified only in
the on-site Aspertia fixture. It also supports automatic closing.

Timed dialogue can contain `camera: {target, pitch, yaw, distance,
durationFrames, fov?}`. The move begins before printing, runs under the text,
and is awaited before the next block. The browser shows whole text immediately;
the native printer therefore adds time that is not represented in the preview.

Test export stages text and scripts only in the
download; the project and bundled save remain unchanged. Field choices, branches,
portraits and voice tracks are not implemented.

The [dialogue example](../../examples/cutscenes/route13.dialogue-field-tour.json)
contains timed NPC text, a two-page waiting speech and a player reply, followed
by seamless camera/control return. Build and check the recognized fixture with:

```sh
npx vite-node scripts/build-field-scene-test.ts CLEAN.nds DIALOGUE.nds examples/cutscenes/route13.dialogue-field-tour.json
npx vite-node scripts/verify-field-dialogue.ts DIALOGUE.nds DIALOGUE.sav DIALOGUE.scene.json DIALOGUE.manifest.json OUTPUT_DIR
```

The checker verifies visible glyph pixels in all four native pages, timed holds,
fresh A/B confirmation including an already-held key, fixed camera/actor positions
while reading, NPC cleanup and player input after handoff. Captures provide the
text-content check; the glyph-pixel check detects blank balloons, not spelling.
This is a headless DS-core test; hardware and melonDS need separate validation.

## Reference behavior

The supplied area-tour video was inspected through its first 23 seconds. After
an initial room transition, roughly seconds 3–12 tour the room with a moving
camera. Around 12–14, characters emerge through the upper doorway and walk
into view. Dialogue and facing changes continue in that same visible room.
The requested segment still contains dialogue near its end; the exact input
handoff is not established by these images. The appearance alone does not
establish which renderer or script implementation the video uses.

The requested outcome is an area tour followed by the actual player walking
in, or leaving a house, and becoming controllable without a fade, reload,
duplicate actor, position jump or camera discontinuity.

## Playback design

Use a field scene backend for this class of scene. Keep the current map,
lighting, animated materials and player actor alive. Acquire camera/input
control, detach the event camera, perform the tour, move the **existing player
actor**, and blend the camera back to the gameplay camera at that actor's
final coordinate. Release input only after movement and camera return finish.
Retain the final player position, height, facing and appearance. A duplicate
billboard using a fixed overworld ID cannot satisfy this contract.

The broader timeline should expose a Player binding alongside NPC bindings, an entry
path and an explicit Return control action. The Player binding resolves the
current game's player identity/appearance at runtime. A branch may lead to a
different entry path or final coordinate, but every reachable exit must clean
up camera/input ownership. Skip and cancellation need an explicit final-state
policy, rather than abandoning the player halfway through movement.

Camera keys, stable event IDs, dialogue and response UI can share the authoring
workspace. Export must select the appropriate backend and validate supported
operations. The version-2 native source does not accept invented player or
handoff fields. The separate field-scene source makes the actual player binding and final
control return explicit. Field NPC tracks now use native actors; future migrations can add branches;
those operations must not be silently interpreted as dedicated-renderer events.

## Native field contract and verification

The field compiler emits lock (`002e`), entry facing with movement actor `00ff`,
event-camera init/unbind (`013f`, `0141`), move/wait (`0143`, `0145`), player
movement/waits (`0064`, `0065`), default camera return/wait (`0147`, `0145`),
rebind/end (`0142`, `0140`) and unlock/halt (`002f`, `0002`). Camera movement
operands are pitch/yaw in unsigned turn units, distance and absolute target
X/Y/Z in signed fx32, then duration in 30 Hz updates. Native angle interpolation
uses the shortest turn. Keep linear moves within the signed multiplication
range; export reports when intermediate moves are needed.

Return uses the gameplay default recalculated at the player's **final** position.
The saved-start-pose return command (`0144`) would be wrong after player movement.
The test-only prefix contains native no-ops so exports can recognize their own
previous launch trigger. Exact older native-sequence fixture triggers are removed;
unrecognized overlapping triggers are rejected, preserving user scripts/events.
Ordinary tours consume no persistent story work or save flags. The optional saved-calendar adapter reserves one W2 story-work value, described below.

The source has `format`, `version`, `target`, `fps`, stable `id`, `name`, `zoneId`,
`entry: {tileX,tileZ,facing}` and ordered `steps`. Camera steps specify
`target: [worldX,worldY,worldZ]`, `pitch`, `yaw`, `distance`, `durationFrames`,
and optional `fov` (vertical degrees). Omitted FOV restores the gameplay
preset; native projection overrides currently require the live environment adapter.
Other step types are `wait`, `player.walk` (`direction`, `tiles`), `player.face`
(`direction`), `dialogue` (speaker/text and input or timed hold) and `control.return`
(`durationFrames`, exactly once at the end).
Every step has a unique stable `id`. Unknown fields fail validation.
See [the JSON Schema](field-scene.schema.json) and [the editable example](../../examples/cutscenes/route13.field-scene.json).

`pokemon.cry` takes `species` (1–649) and `form` (0–31). `camera.shake` takes
`amplitudeX`, `amplitudeY` (0–32 world units), `periodFrames` (2–60), and
`cycles` (1–60); its source duration is period × cycles, capped at 1800 frames.
Cries begin playback without waiting for their sound to end, so a following shake
can overlap the cry. Cries, shakes, dialogue and holds may precede the first
`camera.move`; they form a prelude on the normal gameplay camera. The music and
live environment clock start when the first camera move takes ownership.
All environment/tree frame coordinates still use the complete source timeline,
including that prelude. The exporter subtracts its duration for native samples.
`compileFieldScene` can emit a body without the test warp, for installation by
an author-controlled field trigger that enters at the declared player coordinate.

Build and verify the Route 13 fixture with:

```sh
npx vite-node scripts/build-field-scene-test.ts CLEAN.nds NEW_TEST.nds
npx vite-node scripts/verify-field-scene-emulator.ts NEW_TEST.nds NEW_TEST.sav OUTPUT_DIR
```

The emulator checker is calibrated to the supplied Route 13 example, not an
arbitrary field scene. It inspects every frame across the tour/handoff, verifies
the stable player binding, ignores attempted input while locked, checks final
player position, verifies the restored native camera and exercises movement
and the deep-water boundary after input returns. Camera/movement handlers are
checked against the recognized US W2 binary before test export. Field and native
renderer overlays remain byte-identical to the input; existing quick-launch
startup patches are separate from scene compilation.

Broader scene acceptance requires a capture spanning the tour, player entrance, camera
return and the first user-controlled steps. Check every frame for black/fade
or loading frames; verify the same actor remains visible with the same final
position/facing, normal map collision and camera follow. Replay, each branch,
skip/cancel and return from a doorway need their own checks. A native sequence
returning to the field through the temporary launcher is not this proof.


## Dialga lookout time travel

Import [the Dialga example](../../examples/cutscenes/aspertia.dialga-time-travel.field-scene.json) in Field tours. The real player and a native Dialga overworld face north at Aspertia’s lookout. The trigger is X35/Z709, height 144, with no launch warp. Dialga is an ordinary map NPC at X37/Z709, visible before the tour and on re-entry. It is not a party-following controller. Its registry rendering origin is lowered four world units; its collision position and shadow stay on native ground. The original sprite resource is unchanged. This special sprite currently supports standing north only.

The camera tour lasts 870 source updates at 30 fps (29 seconds), including zoom out and camera return. Its prelude adds Dialga's native cry, a camera shake and the timed message “Dialga uses Roar of Time!”. The source prelude is 151 frames, so the complete authoring timeline is 1021 frames. Native text printing and event scheduling add playback time. Import the supplied video with Source start 9 and Source end 38. Audio is stored as a private `field-tours/audio/*.strm` project asset; importing JSON alone does not include the sound bytes. Both previews and the exported ROM start the stream after the prelude. “Years flash by...” appears halfway through the source camera tour and closes automatically. Both captions use the native dark translucent narration window. Input-waiting dialogue is rejected for live environment scenes.

The midpoint cuts to a tree view and pans right for 90 source frames under its caption before cutting back. The framing uses a head-on northward view (yaw 0), a 40° vertical FOV and the central 30% of the originally requested rightward travel to keep the backdrop and Route 19 boundaries outside the shot. The underlying camera move is native; the environment adapter applies FOV through the native projection setter alongside the native camera instructions. A temporary four-byte camera-dispatch redirect, like the eight-byte transfer-queue redirect, is restored on map-module unload.

In Maps → Map Editor, the **Live camera** panel displays eye position, look-at target, pitch, yaw, distance, FOV and viewport aspect continuously. **Copy camera coordinates** copies a pose JSON for sharing. Those values describe the rendered web camera. Converting them into this field tour accounts for the native lookout's 75-unit look-at offset: subtract 75 from the copied target Y, then solve native pitch/yaw/distance from the copied eye to that anchor. W2 renders at 4:3, so a wider web viewport does not have identical horizontal framing. Native screenshots are needed to check exposed map boundaries; neighboring scenery in the web editor does not extend native geometry.

`seasonCycles: 2` traverses two full seasonal laps and then reaches autumn from summer. `dayCycles: 16` sets the number of visual day/night cycles. `ambientSpeed: 16` sets the first plateau. `tempo` smoothly accelerates over the first 30% of the transition. An optional `boost: {startFrame, durationFrames, multiplier}` then raises the plateau to 32× after the midpoint caption; the final 14% brakes to normal speed. The integrated clock keeps cloud, water and flower animation continuous, without a phase jump at the second acceleration. Player and NPC motion retain normal speed. The authored tint does not change the hardware RTC or simulate seasonal encounter/event changes.

Four original seasonal texture endpoints are retained without colour reduction. Converting a four-colour source texture also clears its four-colour palette-address flag; retaining that flag made the grass fringe around rocks select black palette entries on the DS. Palettes use 32 RGB555 blend levels; changing binary outlines dissolve through ordered pixel coverage, and translucent textures keep the native alpha format. This is a bounded Aspertia W2-US exporter, with matching seasonal geometry and a final autumn state.

`persistSeason: true` installs the guarded resident saved-calendar policy. At completion it writes marker `0xA7C2` to saved story work `0x41AE`; native Save persists that value and the calendar hook reapplies autumn on cold load. The unmarked save keeps the original RTC policy. The native force-season flag remains clear so the Save menu stays available. This is runtime code plus data, not solely retail script commands. It requires a supported original binary layout and rejects a script archive already referencing the reserved work ID. Existing input saves are never edited by the exporter.

`ageHumanNpcs: true` enables a temporary Aspertia appearance change at the end of the seasonal transition. The Time travel form exposes **Age Aspertia human NPCs after transition (ROM)**. The exporter reads the map's original NPC records and builds a reviewed gender mapping to native old man sprite 28 or old lady sprite 29. The runtime calls the native appearance changer on each matching actor, preserving its identity, facing, movement, position and event binding. The player, Dialga, items and existing elders are excluded. This covers the outdoor Aspertia zone, not building interiors. No aging save flag is added; a fresh map load restores the original appearances, including actors cached by native Save. Autumn persistence is independent. The browser preview does not currently show this transformation of the map's ordinary NPCs; verify it in the exported ROM.

The field runtime lives in the expanded Aspertia gimmick overlay and retains the original map callbacks. Canonical sources are `runtime/field-environment/` and `runtime/field-season/`; generated browser assets include byte signatures and SHA-256. Camera movement, actor movement, cries, shakes and timed messages use existing W2 field opcodes. Continuous season blending, the animation-speed envelope, stream coordination, tree growth, projection selection, old-save map-actor restoration, temporary NPC aging and saved-season policy use runtime extensions. The camera returns to its captured entry pose before input is unlocked, with no fade or map reload.

Texture changes are coalesced into sparse aligned ranges. A retained display task batches their bank mappings, and a temporary native transfer-queue guard defers late texture work. Interrupts are masked only while a texture bank is temporarily unavailable to the renderer. This prevents streamed-audio service from interrupting a bank restore across the 3D scanline deadline. The original queue entry bytes are restored when the Aspertia module is freed.

`trees` contains up to 36 tracks with `id`, world `position`, `startFrame` and `endFrame`. The example grows 36 trees from 2% to full size, including 24 on the distant plateau and 12 nearer the lookout. Starts are staggered with smooth easing. Each complete footprint is checked at 25 points for level grass, avoiding cliffs and water; the render anchor uses the native tree template's five-unit offset. They copy the original five-face geometry and reuse its seasonal materials: 180 additional polygons, 720 submitted vertices and no additional texture bytes. New vertex commands are appended to four existing shapes; original display lists, materials and collision members are preserved. The 65,180-byte chunk stays below its 64 KiB native buffer limit. Growth curves and original vertex coordinates live in the separate environment data, and the runtime changes only new vertices. Equal-duration growth tracks share quantized curves and retain separate start times, reducing this example’s resident environment data by about 60 KiB and leaving room for native Save buffers. Trees remain grown after the tour and are restored to full size after loading a saved autumn override. This prototype does not add tree collision or general object tracks.

The automated melonDS checker captures scene frames for solid-color/black flashes, checks both automatic messages, the native cry and music order, all four seasons, 32× peak speed, final tree vertices, camera continuity and player input. When NPC aging is enabled, it also checks the appearance changes happen after the transition, preserve actor bindings and positions, and exclude the player and Dialga. Supply the actual headless core and its Python bindings; the report records their description separately from hardware acceptance:

```sh
python3 scripts/verify-field-tour-melonds.py TEST.nds TEST.sav NEW_OUTPUT \
  --core /path/to/libmelonds_headless.dylib --bindings /path/to/python \
  --core-description 'Exact melonDS build description'
```

The runner uses private ROM/save copies. Inspect the midpoint start/end screenshots for framing; numerical camera matches alone do not establish that scenery edges are hidden. Saving normally and cold restarting is a separate native save-menu check. No hardware acceptance is claimed.

### Previewing an exported example

Open an original W2 ROM such as `cleanwhite2.nds` in localhost Pokeweb, then choose **Maps → Field tours → Import JSON** and select the release's `.scene.json`. Under **Music excerpt**, set Source start to 9 and Source end to 38 and import the matching `.music.strm`. The clip is already cropped; those fields describe its original interval. Press **Play**, or change **Preview frame** to inspect a pose. Save the project to retain both the editable scene and audio.

An exported test ROM contains compiled scripts, assets and runtime data, rather than a recoverable editable scene. Its seasonal map bindings are prepared for the runtime, so use the original ROM plus the authoring files for the four-season browser preview. Field tours and the separate native-sequence Cutscenes editor use different scene formats.

### Current GUI coverage

The Field tours GUI can author camera targets, angles, distance, FOV, cuts and moves; holds; player/NPC walks and facing; map NPC placement; cries and shakes; automatic or input-waiting dialogue; narration windows; a camera move under timed dialogue; audio cropping; seasonal cycles, day/night cycles, acceleration, a second boost and braking; the saved final season; temporary Aspertia NPC aging; and the seamless return to control. Live seasonal scenes require automatic dialogue so an input pause cannot desynchronize the environment clock.

Growing tree positions and growth intervals are currently edited in the JSON source. There is no visual tree-placement or growth-track inspector yet. The original-map camera readout provides useful coordinates, but converting its web pose to a field-tour camera still requires the native anchor-offset and framing checks described above.

Bundling the runtime into the Code Injection installer would cover the engine extensions, not automatically author or install a scene. Scene configuration, prepared seasonal assets, audio, scripts and the trigger still need to be exported together. **Download W2 test ROM** performs that integration for this prototype. The seasonal exporter remains restricted to the supported Aspertia W2-US profile; general seasonal tours on arbitrary maps and general object growth are not yet supported.
