# Cutscene timeline and language authoring

The implemented editor uses `pokeweb.cutscene` **version 2**, defined by [scene.schema.json](scene.schema.json). The GUI, JSON import and assistant edits share this source. Version 1 is not accepted by this editor.

## Create and edit

Open **Maps → Cutscenes** on localhost with US White 2 loaded. **Add Cutscene** asks for a target map and a name, then creates an independent 300-frame timeline. Each scene owns one zone and season. A zone can span multiple terrain chunks; this is a deliberate authoring scope, not a claim that the native engine forbids multi-map scenes.

The initial camera looks toward the selected map's terrain bounds. It is an editable starting pose, not a guarantee that every map fits the frame or that the camera is unobstructed. Map stages include terrain, placed buildings and texture animation. Authored NPC sprite tracks are previewed; weather and field scripts are not simulated.

- Seek with the playhead and **Go to frame**, frame controls or the ruler. Add a camera keyframe or event at the current frame.
- Select a marker or use **Selected item**. Change its frame and values, then **Apply item**. Drag markers to move them; arrow keys move a focused marker one frame, Shift + arrows one second. Removing the final camera keyframe is rejected.
- Choose linear, smoothstep or hold for the selected keyframe's outgoing segment. Use **Free view** to orbit/pan/zoom, then **Use free-view camera** and **Apply item** to capture a pose.
- Use **Undo/Redo** for source edits. Every applied edit enters normal project autosave and project downloads. Invalid JSON, duplicate camera frames, unsupported event types and out-of-range timings leave the previous source intact.
- Events include play/stop music, play sound, fades and map-stage dialogue. Native templates also expose raw native commands so imported behavior is retained. Audio IDs are numeric game IDs, not browser asset names. Preview audio remains silent.

**Import scene JSON**, **Download JSON** and the expandable JSON source panel provide the same document used by the GUI. Imports do not execute scripts or make network calls. Unknown fields are rejected instead of being discarded. Apply or reset a pending JSON draft before making other timeline edits; the GUI does not silently overwrite it. The source contains no overlay addresses, compiled resources or ownership snapshots.

## Timing and coordinates

Version 2 uses integer frames at **30 fps**. `frameCount` is the number of samples; valid keyframe/event frames are `0 .. frameCount - 1`. Raw native preload commands alone may use `-1`. Original sequences 18 and 21 also contain native commands beyond the imported camera sample range. Such raw events remain at their original frame (up to 65535), are marked **After camera range** at the timeline edge, and are not previewed by this document. Their original in-game scheduling has not been checked. The sequence-27 fixture completes at its authored camera duration. Typed events must stay inside the active timeline. Duration-bearing typed events must finish by `frameCount`. Same-frame event order follows document order. A camera holds before its first keyframe and after its last; keyframe arrays may be unordered but cannot have duplicate frames.

A keyframe's `easing` controls interpolation to its next keyframe. Position and vertical FOV interpolate numerically in the source evaluator; native timelines keep their template FOV until native projection conversion is calibrated. Existing raw projection cues remain unchanged. Euler angles use the shortest arc with exact half-turns taking the negative direction. `hold` keeps the earlier pose until the next keyframe. Rotations are degrees in **YXZ** order. Position and angle components must be finite and have magnitude below 524288.

For `stage.kind: map`, positions use **whole-matrix world coordinates**, 16 units per tile, Y up, north negative Z and east positive X. X/Z do not reset at a chunk boundary. Y is absolute world height, including any matrix elevation. Choose a height explicitly for a bridge or raised platform. The context export supplies chunk origins and existing actor coordinates; actor locations are reference data, not editable action tracks.

For `stage.kind: native-template`, positions use that template's dedicated scene coordinates. Do not convert them to map coordinates by multiplying by 16. The stage binding is fixed for a timeline; create a separate cutscene to target another map.

## Natural language workflow

1. Open or create the scene and choose **Download authoring context**. It includes the current source, revision, stage, coordinate convention, supported events and map chunk/actor reference data.
2. Give an assistant that context and a request such as: “Over the first five seconds, pan eight tiles east; hold for a second, then return to the starting camera over four seconds. Fade to black over the last half second.”
3. The assistant edits the version-2 source with stable scene/item IDs, explicit frames and numeric poses. Eight tiles east means +128 world X only for a map stage. It must not invent NPC actions, asset IDs, terrain heights or native format fields.
4. Import the returned `.scene.json` or paste it into **JSON source → Apply JSON**. Keep the scene ID to edit it; use a new ID to import a separate scene. Replacing another existing ID requires opening that timeline first. Preview and undo use the same source.

There is no in-app model/chat service. Natural language authoring means an assistant produces validated JSON, which this editor can import. The shared functions are `readCutsceneScene`, `validateCutsceneScene`, `sampleCutsceneCamera`, `storeCutsceneScene` (with expected revision), `compileCutsceneTimeline` `applyNativeTimeline` and `applyMapCutscene`.

[Route 13 example](../../examples/cutscenes/route13.timeline.scene.json) is an importable version-2 coastal flyover with three camera keys and two fades. Its Route 13 stage (zone 370, spring) has been converted into a playable sequence 28.

## Skeletal joint tracks

In an existing native sequence, open **Edit JSON timeline**. For W2 installation use the independent **Aspertia clone (27)**. The **Skeletal tracks** inspector lists the rigs and joints in the current preview variant. Choose a rig and joint, seek a frame, then choose **Pose joints**. Cyan points select joints directly; colored rotation rings and scale handles pose them in local axes. **Frame joint** centers the free camera. Drag release records one key and one undo step; Escape or pointer cancellation restores the pre-drag pose. The normal scene camera remains unchanged.

Each joint gets a separate timeline lane. Add keys with **Add joint keyframe here**, drag or arrow-key markers to retime them, and use the inspector to edit local translation, XYZ rotation in degrees, scale and outgoing interpolation. A rotation drag enables the rotation channel; a scale drag enables scale. The track's **Animated channels** controls which stored values actually replace the original animation. Remove keys or the whole track, with Undo/Redo available. Deleting the final key removes its track.

Version 2 has an optional `skeletal` array. Each track contains `id`, `name`, archive `modelId`, archive `animationId`, `jointIndex`, `channels` and `keys`. Each key contains `id`, `frame`, `translation`, `rotationDegrees`, `scale` and `easing` (`linear`, `smoothstep` or `hold`). IDs are globally unique. Only one track may own a given clip/joint. Use **Download authoring context** for the loaded ROM's resource IDs, joint names and native frame limits; IDs from a different ROM are not portable.

Rotation uses shortest-arc quaternion interpolation; translation and scale use componentwise interpolation. Intermediate rotation keys are needed for full revolutions. Replacement is inclusive between the first and last key; outside that span, all native motion is retained. A single key changes one frame. Other joints and unselected channels retain their native samples. Scale channels must remain nonzero at native precision, and interpolated scale cannot cross zero; hold keys can change sign.

**Apply timeline to W2** bakes tracks into native NSBCA resources alongside the camera/events. **Download test ROM** exports the applied result. No extra skeletal-animation runtime injection is used. Projects retain original and last-applied clip snapshots so removing tracks and reapplying restores the original animation; external edits to an owned clip produce a conflict. Keep the project file to preserve these snapshots; source JSON alone describes the authored keys, without bundling original ROM assets.

This requires existing native-template rigs and single-animation clips; it does not rig new meshes, retarget actions, resize clips, or turn field/map NPC sprites into 3D skeletons. Keys must fit the native clip and scene duration. Short clips repeat at their original length, including the edited segment. Billboard geometry retains its native camera-facing behavior. Original native sequences support timeline preview; the existing installation path remains private sequence 27. Map-stage timelines keep their separate NPC-track backend.

## NPC tracks

For a map-stage timeline, choose **Add NPC track**. Click a surface in the preview to place the NPC's feet, or edit the selected key's X/Y/Z. **NPC track** selects a character; **NPC name**, **Overworld ID**, and **Frames per sprite step** change its shared settings. The ID is an index in the W2 overworld registry (`a/0/4/7`), resolving its sprite resource in `a/0/4/8`; it is not a cutscene actor ID or an aliased field object code. The ID input suggests available sprite entries. 3D overworld models and missing sprites are rejected rather than substituted.

Seek and choose **Add NPC keyframe here** to add a waypoint. Each NPC has its own purple lane. Select, drag, retime, remove and undo its keys using the same controls as camera keys. A track must retain one key; use **Remove NPC track** to remove the whole character. **Pick NPC position on map** places the selected waypoint on a clicked surface. This also works in free view. Y is explicit height, in the same whole-matrix coordinates as map cameras: **16 world units per tile**. A sampled surface can include a prop; choose clear ground when placing a walker.

Each outgoing key controls its segment's position interpolation (`linear`, `smoothstep`, `hold`), `facing` (`up`, `down`, `left`, `right`) and `action` (`idle`, `walk`). Before the first key, position holds at that key; after the last key, position holds while its action continues. Use a final idle key to stop walking. Facing changes at keys; it does not automatically follow the path. Idle uses sprite frame zero. Three-frame walking sprites cycle **0, 1, 0, 2**; other sprite sets cycle their available frames. `frameStep` is the number of 30-fps timeline samples per sprite step, restarting at each key. Paths interpolate directly and do not resolve collisions, avoid props, or follow terrain heights automatically.

The optional `actors` array preserves compatibility with earlier version-2 scenes. Each track contains `{id, name, overworldId, frameStep, keys}`. Keys contain `{id, frame, position, facing, action, easing}`. IDs must be unique across tracks, camera keys, NPC keys and events. At most 16 NPC tracks are supported, subject to shared native memory budgets. All authored NPCs exist for the entire scene; spawn/despawn, arbitrary gestures and 3D/skeletal actors are not implemented. Native-template timelines do not accept new NPC tracks.

Export creates an independent camera-facing NSBMD quad, dense NSBCA root movement and NSBTP sprite/palette selection for each NPC. The camera and actors share the same map-to-scene transform. Reapply after changing a track, then export the ROM or download the test. Normal project saves and JSON import/export retain the source tracks. The [Route 13 NPC example](../../examples/cutscenes/route13.npc-tracks.scene.json) adds two independent walkers to the coastal flyover. **Download authoring context** includes supported overworld IDs and the same actor contract for language authoring.

## Dialogue

For a map-stage timeline, choose **Dialogue** in **New event type**, seek to its start and choose **Add event here**. Select an NPC track in **Speaker**, or **Narration**, and enter **Dialogue text**. The NPC track name appears above its text. Change the frame, drag the event marker, or remove it with the normal timeline controls. Removing a referenced NPC is rejected until its dialogue is reassigned or removed.

**Pause until player advances** holds scene time: camera movement, NPC movement, walking sprite frames and material animation remain at the dialogue frame. In browser playback choose **Continue** or press **Enter**, **Space**, **A** or **B** with focus outside a text input. In W2, release any held A/B button and press **A** or **B** again. A held button cannot dismiss a newly opened window. Music and already-playing sound effects continue; this is a scene-animation pause, not a pause of the audio engine. The text appears as a complete page in the native top-screen window. Advancing closes it and resumes the same scene clock without skipping animation frames.

Uncheck the option for timed dialogue, then set **Display duration (frames)** at 30 fps. Camera and NPCs continue moving while that window is visible; it closes automatically. Preview seeking skips earlier waiting events and shows a wait when seeking exactly to its start. Restart or seek backwards to replay a conversation. The Play button may remain active while waiting; Continue then resumes it.

```json
{
  "id": "coastal-greeting",
  "type": "dialogue",
  "frame": 90,
  "speakerId": "hero",
  "text": "The sea looks great today.",
  "waitForInput": true,
  "durationFrames": 90
}
```

`speakerId` is the stable ID in `actors`, not an overworld sprite number; use `null` for narration. `durationFrames` is required and retained in both modes, but ignored for waiting dialogue. Text supports printable Western ASCII, Latin-1 and curly quotation marks, plus actual newline characters. Native control codes and backslashes are rejected. Text wraps at 24 characters per line, with **at most four lines including the speaker name**. Long words and excess lines are rejected; split a longer speech into separate events. Response choices and forward branches are described below; portraits and voice tracks are not implemented. Dialogue windows cannot overlap/share a start frame, and a waiting event cannot start during an active screen fade. A waiting event must start before the final camera sample, leaving a frame for native completion after advance. A new dialogue added inside a fade is placed just after that fade.

Apply the timeline before exporting. The compiler appends a private encrypted message bank to `a/0/0/2` and emits native message cues. A small W2-US adapter handles authored text and holds the native animation step for waiting events; original message cues still use their original callback. Reapply reuses the scene's owned bank, verifies its contents/ownership and rejects concurrent text edits. Existing message banks remain unchanged. The portable source has no compiled bank IDs or runtime addresses.

The [Route 13 conversation example](../../examples/cutscenes/route13.dialogue.scene.json) contains two waiting NPC lines and one timed reply. Import it into the localhost workspace to edit it or ask an assistant to author further conversation with the same contract.

## Response choices and branches

Choose **Response choice** in the event menu and **Add event here**. Edit the speaker, prompt, response labels and each **target frame** in the inspector. Two responses are required; response 3 is optional. Enter its label to add it, or clear the third label to remove it. Each label is one line of at most 22 characters. The complete speaker/prompt/response page must fit six native lines wrapped at 24 characters. The choice always holds scene time.

Click a response in preview, or use Up/Down and Enter/A/Space. W2 uses **Up/Down then A**; B does not select a response. Selection jumps the scene clock to the chosen destination. Camera and all NPC/material tracks immediately sample that destination; the native event cursor skips the intervening commands. Events in the unchosen section do not run. Camera/NPC poses should match at each branch entrance and join if a continuous visual result is intended. Already-playing audio is not rewound or restarted by a jump.

```json
{
  "id": "route-choice",
  "type": "dialogue.choice",
  "frame": 90,
  "speakerId": "hero",
  "text": "Where should we go?",
  "choices": [
    { "id": "beach-response", "text": "Explore the beach", "targetFrame": 120 },
    { "id": "cliff-response", "text": "Take the high path", "targetFrame": 240 }
  ]
}
```

Put each reaction's dialogue, NPC keys and camera keys in its own timeline section. At the end of the earlier section, add **Jump / rejoin** to skip the later section and reach a common ending:

```json
{ "id": "beach-join", "type": "timeline.jump", "frame": 210, "targetFrame": 360 }
```

The [Route 13 choice example](../../examples/cutscenes/route13.choices.scene.json) demonstrates this layout: choice 90 → beach reaction 120 → join jump 210 → shared ending 360, or choice 90 → high-path reaction 240 → shared ending 360. The Companion follows different position/facing/walk samples along the selected route. Branch destination buttons in the inspector seek to those sections for editing. Manually seeking resets response history and treats earlier events chronologically; restart and select responses to test the actual control flow. Preview brightness uses only reached fade events during playback.

Targets must be later frames **before the final camera sample**. Choices/jumps require their own event frame, outside active screen fades and timed messages. Targets cannot land partway through those duration events; start the required state at the branch entrance instead. Backward jumps, loops, variables, flags and persistent story decisions are outside this version. Target frames are explicit numbers: retiming a destination item does not automatically move its branch link. Update the choice/jump destination too. Response IDs are stable and globally unique like other scene item IDs.

Native export uses the version-2 dialogue adapter to implement selection and clock/cursor jumps. W2 provides the window, font, key input and native animation samplers; the custom branching control is injected code. The installer recognizes the exact version-1 adapter shipped in v0.5.2 and appends an upgraded private adapter, keeping older scene data and message banks. Unknown/altered adapters still fail validation. Reapply a source before exporting. This workflow does not provide a seamless handoff to the live field player; see [field scene and player handoff requirements](field-scenes.md).

## Native installation and current limits

**Edit JSON timeline** imports an installed native sequence's camera losslessly as one keyframe per sample, with playback commands and metadata fades represented in source. Object/particle animations and native end commands remain inherited resources. Editing camera timing does not retime those animations; their existing loops continue. **Reduce camera keys** is an explicit, undoable approximation bounded to 0.01 position units/degrees/FOV at every original sample. It makes dense imported paths easier to edit; it is not applied automatically.

Reopening an exported ROM also lists installed custom sequences, using labels such as **Custom map sequence 28**. Native timeline imports accept installed IDs through 63. For a converted map sequence, import its original map-stage `.scene.json` to make changes for export; the imported native-template view of that sequence cannot be applied through the timeline compiler.

**Apply timeline to W2** supports map-stage sources and the independent native-template **sequence 27**. For sequence 27, It bakes a new dense camera, lowers typed events, emits an END record and relocates a larger playback command list within the supported overlay budget. It preserves original sequences, resource bindings and the separate cleanup/end program. A source fingerprint blocks overwriting native camera/cue changes made since import. Repeated unchanged compilation reuses the current command-list allocation.

For a map-stage source, Apply converts the current terrain and placed props into self-contained native models with embedded texture/palette banks. Geometry and camera positions use the same transform: subtract the recorded stage origin, then divide world units by 16. Placed prop rotation and height are baked into geometry. Native fixed-point geometry introduces normal DS coordinate quantization. Colors remain in RGB555; conversion rejects textures requiring additional color reduction.

A clean ROM first reserves the independent Aspertia clone at 27, then allocates the first map scene at **28**. Further scenes allocate subsequent IDs up to 63, subject to the 64 KiB overlay limit. Original entries/resources and the existing clone are retained. Reapplying a map timeline reuses its sequence/member IDs and metadata allocation when it fits. Source bindings and build manifests live in project data, outside portable scene JSON. Native resource or registry changes made outside the owner timeline cause compilation to reject a stale replacement.

Map exports require **fixed 40° FOV** and include native texture-coordinate transforms (NSBTA) plus texture/palette swaps (NSBTP). Tracks are baked at 30 fps for the scene duration, sampling each source clip with its own looping period. Water scrolling, shore waves, foam/rock highlights and flower frames retain their source phase. Materials with different animation are kept separate even when their frame-zero textures match. Only explicitly authored NPC sprite tracks are packaged; existing field NPCs, weather, field scripts and neighboring zones are not imported automatically. Missing assets/warnings, unsupported geometry, color reduction and texture/palette budget overflow are rejected. Each model must fit 2,048 polygons / 6,144 submitted vertices; aggregate texture/palette limits are 256 KiB / 32 KiB, and model-plus-animation-plus-camera data is capped at 1 MiB within the cutscene heap. Full-stage polygon demand also depends on camera framing; only the Route 13 sample path has been verified at runtime. Other maps require their own playtest.

Route 13 includes eight terrain chunks and **112 placed props**, 61 unique textures including animation frames, 93,440 bytes of resident texture pixels, 6,208 bytes of palette allocations, 499,080 bytes of model data and 27,108 bytes of animation resources. There are 33 texture-transform tracks and 16 texture/palette tracks across eight model groups. Four chunks have a second seasonal permission section before placements; the loader and placement editors now resolve that section correctly.

**Download test ROM** first applies the selected timeline, then builds an isolated step-trigger fixture and unchanged raw `.sav`. Put both files in the same folder in melonDS. Resume the supplied save in Aspertia, then walk **one tile down** onto matrix tile **X 53, Z 731**. After the cutscene returns, walk up and down to replay. Normal **Export ROM** includes applied scene assets/registration, but does not add or retarget this temporary trigger. **Download test ROM** reuses the recognized fixture when the input is an earlier cutscene test ROM, so its step launches the newly selected scene. Reapply after changing map assets or timeline JSON. Creating a JSON source alone does not install it. Original native templates other than 27 remain read-only through the timeline compiler.

The field transition uses a one-sample native opening fade to clear the prior field fade. Authored brightness fade events then operate normally. Setting both metadata fades to zero would leave this launch path black even though camera playback and return complete.

General skeletal actions, reactions, new particle bindings, audio preview and an arbitrary story-trigger editor remain outside version 2. Unsupported fields/actions fail validation. General installation must verify these features in-game before claiming support.

## Verification

Run `npx vitest run src/test/cutsceneScene.test.ts src/test/nativeCutsceneClone.test.ts src/test/projectDocument.test.ts`. The pure tests cover interpolation, same-frame order, invalid-source retention, stale revisions, project persistence and binary lowering. `scripts/verify-cutscene-timeline.ts` audits lossless native camera import, variable event counts, duration changes, stale-write rejection, repeatable compilation and ROM export/reopening. Its optional output is an isolated sequence-27 test ROM; use `scripts/verify-native-cutscene-emulator.ts` for runtime replay/field-return checks.

To build the Route 13 fixture from a local clean US W2 ROM:

```sh
npx vite-node scripts/build-map-cutscene-test.ts /path/to/cleanwhite2.nds /path/to/new-Route13-test.nds
npx vite-node scripts/verify-native-cutscene-emulator.ts /path/to/new-Route13-test.nds /path/to/new-Route13-test.sav /path/to/proof
```

The builder checks repeatable compilation, preservation of original definitions/resources, project binding persistence and export/reopening. It writes a matching source and manifest beside the ROM. The headless checker requires two triggered completions, field control/replay and visible scene captures; it uses a DS core distinct from melonDS.

## Material animation export

Apply recompiles the chosen season's field-material samplers into native per-material tracks. Existing static map bindings upgrade in place, retaining their sequence ID and private camera; additional animation members are allocated privately. The fingerprint protects models and animation resources together. Repeating an unchanged Apply reuses the member IDs and overlay allocation.

Geometry uses untransformed source UVs for SRT materials, enabling the native texture matrix on those materials. Texture/palette frames are embedded in each model's TEX0 bank and selected by name from NSBTP. The exporter rejects missing raw animated UVs, inconsistent pattern frame dimensions, color reduction and native name/offset/resource limits. Vertex geometry and actor actions are not newly authored by this conversion. The optional environment prototype below adds authored material-colour tracks.

`npx vite-node scripts/verify-map-cutscene-materials.ts /path/to/cleanwhite2.nds /path/to/previous-static-test.nds` verifies native sample changes, clip durations and an in-place upgrade using the previous test's matching scene/manifest files. Synthetic tests also cover independent palette changes, held pattern keys, signed FX16/FX32 channels and packed rotation channels.

NPC verification: `src/test/cutsceneActors.test.ts` covers source persistence, bounds/conflicts, deterministic sampling and native billboard/movement/pattern round trips. `scripts/verify-cutscene-npc-export.ts ROM.nds SCENE.json [NEW_CONTROL.nds]` audits every exported NPC sample and optionally writes a control ROM with constant root positions. It reads the build's matching `.manifest.json`. Run the standard cutscene emulator checker on both ROMs at 30-frame capture intervals, then `scripts/verify-cutscene-npc-motion.ts DYNAMIC_CAPTURES CONTROL_CAPTURES` to compare the Route 13 fixture before and after movement.

Dialogue verification: `src/test/cutsceneDialogue.test.ts` covers speaker/layout validation, pause/advance/seek timing, private bank ownership, concurrent edits, native cue lowering and adapter signature/relocation checks. Build the conversation fixture with:

```sh
python3 runtime/cutscene-dialogue/build.py
npx vite-node scripts/build-map-cutscene-test.ts /path/to/cleanwhite2.nds /path/to/new-Route13-dialogue.nds examples/cutscenes/route13.dialogue.scene.json
npx vite-node scripts/verify-cutscene-dialogue-emulator.ts /path/to/new-Route13-dialogue.nds /path/to/new-Route13-dialogue.sav /path/to/proof 3900 180 2
```

The dialogue harness holds each wait for 180 emulator frames before a fresh A/B press, checks the fixed native clock/zero animation step and matching world pixels during the hold, and requires both triggered playbacks to return to the field. The native skipped-frame loop may finish a pending half-sample when entering a wait; subsequent updates must hold exactly. These checks use the headless DS core, not automated melonDS or hardware testing.

Branch verification: `src/test/cutsceneBranches.test.ts` covers control flow, skipped fades, source bounds, response layout, private text variants, native cue arguments and version-1 adapter upgrades. `scripts/verify-cutscene-branches-emulator.ts` runs the Route 13 example twice, selects each response, requires the route clocks `[90,120,360]` and `[90,240,360]`, checks frozen world pixels during waits, and verifies field return/replay. Build with `build-map-cutscene-test.ts` using `examples/cutscenes/route13.choices.scene.json`, then run the branch checker with ROM, save, proof directory, `4300 180 2`.


## Time travel prototype

Import [the Route 13 time-travel scene](../../examples/cutscenes/route13.time-travel.scene.json)
with **Import scene JSON**. This is an independent dedicated sequence, not a live
field tour. It uses one wooded coastal matrix cell (map 86, matrix X 21 / Z 6),
its 27 placed props and original spring/winter artwork. The camera zooms out over
three seconds. Frames 60–660 run eight smooth day/night tint cycles while the
seasonal blend slowly advances to winter; the last two seconds settle on winter.
The scene then fades back to the unchanged field.

The **Time travel** panel edits target season, start/end frames, cycle count and ambient texture speed.
Apply time travel updates the same source JSON and supports Undo/Redo. The optional
`environment` object has `targetSeason`, `startFrame`, `endFrame`, `dayCycles`, and optional `ambientSpeed` (1–16, default 1).
The starting season is `stage.season`. Optional `stage.bounds` specifies west,
north, width and height in tiles, aligned to complete 32-tile matrix cells. Bounds
scope an independent stage; they do not modify the original map. As with the zone,
changing bounds requires importing under a new scene ID. Optional `stage.includeNeighbors` includes surrounding scenery and panorama props inside those bounds. Environment export conservatively drops surfaces whose world bounding boxes miss every authored camera frame; camera edits rebuild visibility, and may append newly visible assets.

This is a **visual clock**. Day/night uses an authored daylight → sunset → blue
night → dawn material-colour curve; it does not reproduce every retail area light,
window or weather rule. Seasonal blending uses actual endpoint artwork, including
changes to pixel patterns. Joint colour-pair indices retain both textures in one
index image; 32 quantized RGB555 palette samples supply intermediate colours.
The source palettes do not need matching indices. Native NSBTP selects the sampled
palettes, NSBMA supplies the independently sampled tint, and source NSBTA/NSBTP
water/flower animation continues. Ambient texture time advances at `ambientSpeed` during the transition and 1× before/after, retaining accumulated phase at both boundaries. Camera, fades, day/night and seasonal blend timing stay on the scene clock. No new executable adapter is installed by this
effect. The existing private sequence registry and test launcher remain necessary.

The path requires matching seasonal geometry, placement and UVs, plus representable joint colour palettes. Flat vertex shading is retained through separate material colours; gradients within a triangle remain unsupported. Fixed translucent alpha uses a native alpha-indexed format. For changing binary masks, common artwork and appearing/disappearing texels use separate coplanar masked surfaces. Shared RGB555 palettes blend colour while at most eight A3I5 alpha patterns fade the outlines; no full texture bank is generated for each scene frame. Transitions involving changing translucent endpoint masks, geometry replacements, colour reduction and NPC environment tint are rejected. Small model groups bound the native palette dictionaries; larger
stages can still exceed the existing model/VRAM/heap budgets. This is a bounded
prototype, not coverage of every map or season pair. DS colour precision and the
32 blend levels mean the transition is sampled rather than mathematically continuous.

The [Aspertia lookout example](../../examples/cutscenes/aspertia.lookout-time-travel.scene.json) starts at the region camera pose for tile X35.5/Z709.5, player Y144 (zone 427), then pulls back 45% over three seconds. It blends summer into autumn during frames 60–660 with eight visual day/night cycles and `ambientSpeed: 4`. The cloud panorama, flowers, pond and shore tracks all use the accelerated clock, returning to 1× after frame 660. Three matrix cells supply the visible stage, including the neighboring sky/cloud props; off-camera city props are culled. Field NPCs/player are excluded from this terrain/prop prototype. Native translucent layer IDs preserve clouds over the opaque panorama while opaque surfaces share ID zero to avoid extra edge-marking seams.

The real DS clock, gameplay season, collision data and save are unchanged. Ending
in winter here does not install a winter playable map or provide a seamless
seasonal field handoff.

```sh
npx vite-node scripts/build-map-cutscene-test.ts CLEAN.nds NEW_TEST.nds examples/cutscenes/route13.time-travel.scene.json
npx vite-node scripts/verify-native-cutscene-emulator.ts NEW_TEST.nds NEW_TEST.sav CAPTURES 6000 60 2
npx vite-node scripts/verify-cutscene-environment.ts NEW_TEST.nds NEW_TEST.scene.json NEW_TEST.manifest.json CAPTURES
```

The fixture audit checks native material tracks against the source curve, changing
palette bindings and seasonal endpoint texels, repeated playback/field return,
and captured day/night plus same-light-phase seasonal colour changes. Its fixed
capture regions/times are calibrated to this example. Browser lighting remains
an approximation of DS rendering; melonDS and hardware need separate playtests.


For the Aspertia fixture, build with `examples/cutscenes/aspertia.lookout-time-travel.scene.json`, run the same native emulator capture command, then use `scripts/verify-aspertia-time-travel.ts TEST.nds TEST.scene.json TEST.manifest.json CAPTURES`. That fixture audit checks the original cloud/water SRT samples against an independently integrated 4× clock, original flower PAT artwork against native output, backdrop inclusion, endpoint changes, repeated completion and captured day/night/season changes. Capture regions are calibrated to this lookout shot.
