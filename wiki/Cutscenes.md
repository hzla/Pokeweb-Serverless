# Native cutscenes

For the implemented camera/event timeline, map selection, JSON import/export and assistant workflow, see [cutscene timeline authoring](../docs/cutscenes/authoring.md). **Add Cutscene** creates a scene for one chosen map. Map stages can be applied to private native sequences, starting at 28 on a clean project. Route 13 is the first tested map; export includes texture scrolling and texture/palette animation, and requires fixed 40° FOV. Choose a native sequence and **Edit JSON timeline** for its timeline, or keep its native details view below.

Open **Maps → Cutscenes** with a US White 2 ROM loaded. The navigation link is currently visible only on localhost and loopback addresses. The **Sequence** dropdown opens any of the 26 original native entries, plus sequence 27 after creating the custom clone, including the Aspertia flyover (5), ship and plane scenes, Ferris wheel, title scenes and legendary transformations. Labels describe native assets; not every scene label has been confirmed in an emulator. These dedicated animated scene resources are separate from field map camera regions and streamed video.

## Live player tours

Choose **Maps → Field tours** for the separate live field
backend. The Route 13 example tours the coast, walks the actual player in from
above the view, blends to the gameplay camera and unlocks movement without an
ending fade. Edit ordered action cards, target coordinates or JSON; map picking
and free-view camera capture are available. **Download W2 test ROM** supplies an
unchanged save: press Down in Aspertia to warp to the target and start the tour.
Choose **Nate/Rosa** for the preview avatar and use the previous/next frame buttons
to inspect every 60 Hz display frame. The highlighted pose strip and texture index
follow the ROM's standard standing/walking animation records, including alternating
feet through stops. Avatar selection affects only the preview. Overall field-script
scheduling and terrain height remain estimates.
Use **Add NPC** for a native overworld actor. Choose its sprite/entry under **NPC
placement**, then click its track cells to add walks or facing changes under **NPC
movement**. Actions in one column run alongside the camera/player; the next block
waits for all actors. Inspect poses can target any NPC. Choose whether it stays
until map unload or is removed at handoff. Supported standard human sprite
controllers use their own native animation records. Actor task timing and texture
uploads can differ by one display frame from the browser's nominal clock.
Choose **Dialogue → Add action before return** for a speech. Select its NPC or
Player speaker, enter text and apply. **Pause until player advances** waits for
Continue/Enter in preview or a fresh A/B press in W2; turn it off for a timed
hold per page after printing. Speeches wrap into two-line pages. Camera and actors
hold while ambient map animation continues. The preview shows complete pages;
native text printing adds runtime. Export uses native field messages and a private
story-text bank, with no dialogue code injection.
There is an initial loading transition. Field choices, skipping and doorway
choreography are not implemented in this backend.
See [field scenes](../docs/cutscenes/field-scenes.md) for source format, native
commands, test workflow and current camera/path restrictions.

## Create sequence 27 and test it

Choose **Create Aspertia clone (27)** to register one independent copy of the currently saved sequence 5. This button creates that fixed clone; map-stage Apply allocates further private slots. It copies all 30 referenced asset members (including the camera), parameters, resource/variant tables, playback cues and end commands. Original entries 1–26 and their archive members remain unchanged. Creation is saved to the project and survives normal autosave/project downloads.

Sequence 27 appears in the dropdown and supports the same camera, object, fade and cue controls. Its resources are private, so editing its camera or petals does not edit sequence 5. Saving still keeps animation durations and cue-slot counts fixed.

**Download 27 test** builds a separate launch ROM and matching raw `.sav` for melonDS. Save or revert applied drafts first. Put both files together, load the ROM, and walk one tile down from the fixture's initial Aspertia position. The trigger is at matrix tile **X 53, Z 731** in the clean W2 fixture. Step off and back onto it to replay. The test script fades out, closes the field, calls sequence 27, reopens/fades in the field, restores map music and returns control. It does not consume a story flag or edit the fixture save. Normal **Export ROM** includes the registered scene but does not add this temporary trigger.

The launch ROM uses the app's existing test startup preparation. Its appended script entry and step trigger affect only that download, not the editor project's map scripts/events. Existing user saves are never replaced. The first version targets the recognized US W2 revision-0 sequence readers and transition callbacks; changed native layouts are rejected.

## Preview and navigation

Use **Play**, the timeline, frame stepping, or the frame number and **Go**. Space toggles playback and left/right step frames when the canvas has focus. Playback speed and looping affect only the preview. Native animation samples advance at 30 fps; the render-rate flag can select a 60 Hz render loop with half-frame animation steps. Most scenes start paused at frame 60; title scenes start near their title-screen section at frame 7300. **Restart** returns to frame 0.

**Preview variants** contains season, time, player model and, where applicable, actor variants. These select existing native resources and do not change the game's variant selection. Two-screen scenes show stacked top and bottom screens. Projection and screen fades are evaluated from the selected frame, including when seeking backwards.

Applied unsaved edits stay in a draft for each sequence while this page remains open. Choose **Save changes to project** before leaving or reloading. Saved edits use normal project autosave and project downloads. Use **Export ROM** from the main menu to produce a modified ROM.

## Camera tab

- Seek to a frame, change camera X/Y/Z or pitch/yaw/roll, and choose **Apply frame**. Positions are scene coordinates, rather than field map tiles; angles are degrees.
- Switch to **Camera path** to orbit by dragging, pan with right-drag and zoom with the wheel. The gold path contains the native samples. Click it to seek. The cyan marker and frustum identify the selected camera frame. **Use free-view camera** writes the current free camera pose to that frame.
- Edit both endpoint frames, set a start and end, and choose **Fill camera range**. Linear or ease-in/out interpolation changes only interior frames. Angles interpolate along the shortest route.
- **Scene camera** returns to native framing. Camera duration, scale channels and reserved header data remain fixed.

Sequences can share resources. For example, sequences 14 and 15 share a camera; editing it changes both. The header identifies shared cameras. Clean drafts refresh when a shared resource is saved elsewhere. Saving a stale edited draft is blocked to avoid overwriting newer work.

## Time travel prototype

Import `examples/cutscenes/route13.time-travel.scene.json` for a wooded Route 13
section that zooms out, cycles day/night eight times and blends spring artwork
into winter over twenty seconds. **Time travel** edits the target season, transition
frames, cycle count and ambient texture speed; apply the timeline before exporting W2. Water and flowers
keep animating. This uses generated palette transitions and native material tint,
with no new runtime hook. It changes visual time only: the playable map, game
clock and save remain unchanged after the scene. Matching seasonal surfaces are
required; changing binary outlines fade through native alpha patterns. Geometry replacements, changing translucent masks and NPC tint remain unsupported.

`examples/cutscenes/aspertia.lookout-time-travel.scene.json` moves the prototype to the Aspertia lookout (zone 427, tile X35/Z709, Y144), blends summer into autumn, and runs cloud scrolling, water and flower texture tracks at 4× during the twenty-second transition. Neighboring panorama props are included. After the transition, texture playback returns to 1× with continuous phase. The camera pulls back 45%; field characters are excluded.
See the [prototype contract and test commands](../docs/cutscenes/authoring.md#time-travel-prototype).

## Map timeline NPC tracks

In a map-stage timeline, use **Add NPC track**, click the preview to place its feet, and choose the overworld ID. Seek and **Add NPC keyframe here** to create movement waypoints. Each NPC has a separate timeline lane with facing, idle/walk animation, height and interpolation. Drag or edit key times, remove keys/tracks, and undo changes. Apply the timeline before exporting W2. See the [NPC authoring contract](../docs/cutscenes/authoring.md#npc-tracks) and [Route 13 sample](../examples/cutscenes/route13.npc-tracks.scene.json).

## Map timeline dialogue

Choose **Dialogue** in the event menu, then **Add event here**. Select the NPC speaker (or Narration), enter text, and choose **Pause until player advances** or a timed display duration. Waiting holds camera, NPC and material animation; use **Continue / Enter** in preview and a fresh **A/B** press in W2. Music continues. Text is limited to four wrapped native lines including the speaker; split longer speeches into additional events. Choose **Response choice** for two/three answers and forward destinations; **Jump / rejoin** skips another reaction section to a shared ending. W2 selection uses Up/Down then A. Native export includes an injected runtime adapter for waiting and branching. Apply the timeline before exporting. The [dialogue contract and example](../docs/cutscenes/authoring.md#dialogue) are also usable for language-authored JSON.

## Skeletal timeline and posing

For a private W2 edit, create **Aspertia clone (27)**, then open **Edit JSON timeline**. Under **Skeletal tracks**, select a rig/joint, seek a frame and choose **Pose joints**. Click cyan joints in the preview; drag rotation rings or scale handles to record a key at the playhead. Escape cancels the drag. **Frame joint** centers the free camera without changing the authored camera.

Joint lanes support adding, moving and removing keys, numeric local transforms, linear/smooth/hold interpolation, channel selection and Undo/Redo. Selected channels replace native animation between the first and last key; other frames/joints retain the original motion. **Apply timeline to W2**, then Export ROM or Download test ROM. Track removal restores original clips when reapplied; save the project to retain those baselines. See the [skeletal JSON contract and limits](../docs/cutscenes/authoring.md#skeletal-joint-tracks).

`npx vite-node scripts/verify-skeletal-timeline.ts /path/to/cleanwhite2.nds /path/to/NEW-Timeline-Test.nds` builds a three-key character/petal fixture through the JSON timeline compiler. It verifies native export/reopening, matching preview/export assets, deterministic reapplication, selected-channel preservation, original-sequence preservation and restoration after track removal. The fixture and control have completed twice in melonDS with retail geometry limits; native-clock captures differ within the edited interval and match afterward. Hardware has not been tested.

## Objects tab

Select an **Object** and **Joint / piece** to inspect its skeletal animation. A cyan marker identifies the selected joint. Characters, vehicles and the Aspertia flying petals use these resources; the petals are animated geometry rather than a field weather effect.

Edit local **Translation**, **Rotation (degrees · XYZ)** and **Scale**, then choose **Apply joint transform**. A root transforms its hierarchy; child joints transform parts relative to their parent. Joints using an identity or bind pose can be edited, including joints absent from the original clip's record table. Changes are visible in the preview and support Undo/Redo. The sidebar scrolls as a whole so all transform and range controls remain reachable.

To animate a section, apply transforms at both endpoint frames, set **Start/End**, choose linear or ease-in/out interpolation, select **Channels**, and choose **Fill joint range**. Translation and scale interpolate componentwise; rotation uses quaternion interpolation along the shortest arc. Intermediate poses are necessary for a full revolution. Unselected channels and all other joints keep their native sample values. Only changed fields are applied, so editing scale alone does not rewrite rotation. Scale values must remain nonzero at native precision; a range crossing zero is rejected.

Native camera-facing billboards can replace a joint's orientation while drawing. A rotation on their parent still changes the hierarchy's positions, while the billboard continues to face the camera. This preserves the asset's original rendering behavior.

Object animation can have a shorter loop than the camera. The panel shows the object's own frame, and edits affect every loop and every scene/variant sharing that resource. Translation and scale use native 1/4096-unit precision; inverse scales are generated from the quantized scale. Rotations use the native packed matrix pools. Rebuilding an edited channel may quantize its interpolated samples; untouched channels retain their existing compressed samples. Resource pools are rebuilt from referenced data so repeated edits do not keep appending abandoned samples. **Save changes to project**, then **Export ROM** writes the native animation data with no new runtime code injection. Use an independent clone to avoid changing resources shared by original scenes.

This edits joint transforms in existing single-clip skeletal resources. It does not create rigs, change mesh weights, retarget action clips, change animation duration or bind a new clip to an object without an animation resource. Editing assets through **Native details** invalidates an owning JSON timeline's asset fingerprint; reapplying that timeline requires resolving its ownership conflict rather than silently overwriting the native edits.

## Cues tab

Edit opening/closing fade color and duration, or select an existing timed command. Change its start frame, command and named arguments, then choose **Apply cue**. Frame -1 executes before playback. **Go to cue** seeks to its start. Repurpose an existing slot here, or remove/disable a command through the JSON timeline. Native opcode 0 has a null callback and cannot be written as a disabled command.

Editable commands include music and sound IDs, sound parameters, music fades, screen fades, lighting, messages, 2D graphics, motion blur and projection. IDs are native game IDs. Screen fades and projection update the preview; other commands are saved for the game. Audio remains silent, and raw native messages, 2D graphics, cue-driven lighting and motion blur are not simulated. Authored map timeline dialogue has its own preview and export path. Opening/closing fade durations are 0–255 frames.

This native details view keeps cue counts, END records and end-command lists fixed. The JSON timeline can add/remove events and resize the camera for private sequence 27; it preserves the separate end-command list. Map timelines allocate private IDs and package terrain/props, material animation and explicitly authored overworld NPC tracks. Custom story-trigger authoring is not supported yet.

## Saving and preview limits

**Undo**, **Redo** and **Revert unsaved** cover applied camera, movement, fade and cue edits. Saved edits can be undone and saved again while their history remains available. Shared resources change every scene using them. No-op saves retain original archive members. Camera and movement edits merge with the current archive; cue/fade edits touch only their existing fields in overlay 293. Stale source data is checked before writes.

The renderer supports joint animation, camera-facing geometry, texture transforms, texture swaps, material color/alpha animation and joint visibility animation. Lighting and reflections are approximate; DS edge rendering is not reproduced. The sequence-27 clone completed twice through its player-triggered test path in the headless DS core, including field restoration and replay. Screen framing has not been compared frame by frame with an emulator. Only US White 2 is supported. No ROM assets are distributed with the viewer.

## Developer validation

Run targeted tests with:

```sh
npx vitest run src/test/nativeCutscene.test.ts src/test/nativeCutsceneFormats.test.ts src/test/nativeJointAnimation.test.ts src/test/romViews.test.ts
```

These cover camera editing, stale-save protection, cue/fade persistence, material and visibility decoding, joint translation/rotation/scale writing, inverse scales, identity/bind-pose joints, shortest-arc interpolation, native quantization bounds, repeated-edit size bounds, sibling/channel preservation and ROM buffer ownership.

`npx vite-node scripts/verify-native-skeletal.ts /path/to/cleanwhite2.nds /path/to/NEW-Skeletal-Test.nds` creates a sequence-27 fixture with joint translation, compound rotation and nonuniform scale on a character and petals, plus an unedited `.control.nds` for comparison. It checks every animation frame, unrelated joints, scale/inverse-scale consistency, original sequence resources and export/reopening. Between the control and edited ROM, skeletal edits change only the sequence asset archive, including no ARM9 or overlay code changes. The matching save is unchanged. Resume it in melonDS and step down onto X53/Z731; step off/back onto the tile to replay. Playback, synchronized native-camera-clock screenshots, field return and replay have been checked with a standard-geometry melonDS headless core; hardware has not been tested.

`npx vite-node scripts/verify-native-cutscene.ts /path/to/white2.nds` checks no-op camera round trips for all 26 entries, compiles and samples every unique resource combination across season/time/player/actor variants, and edits each camera plus a character, petals, music and fades. It exports and reopens the ROM, compares scene archive members, and checks that ARM9 and unrelated NitroFS files remain unchanged. Overlay 293 retains its decoded memory layout, with changes limited to the edited commands and fade fields. An optional second path writes the verification ROM.

For the clone path:

```sh
npx vitest run src/test/nativeCutsceneClone.test.ts
npx vite-node scripts/verify-native-cutscene-clone.ts /path/to/cleanwhite2.nds
npx vite-node scripts/build-native-cutscene-test.ts /path/to/cleanwhite2.nds /path/to/White2-Cutscene27-v0.1.2.nds
npx vite-node scripts/verify-native-cutscene-emulator.ts /path/to/White2-Cutscene27-v0.1.2.nds /path/to/White2-Cutscene27-v0.1.2.sav /path/to/proof-directory
```

The builder creates new files exclusively and returns the unchanged bundled raw save. The headless harness wraps that save as a DSV in memory for its test core; it does not rewrite the supplied save. It drives the step trigger, waits for completion, moves off/back onto it and requires a second completion without emulator fatal errors. The ROM audit verifies independent camera/movement/cue/fade edits, project persistence, all original members, and export/reopening across the registered layout.

## Export a new map cutscene

Use **Add Cutscene**, select the map, author the camera/events, then **Apply timeline to W2**. **Native details** opens the installed assets; editing them there invalidates the owner timeline snapshot. Restore its saved project snapshot or import the source with a new scene ID to keep those native edits separate. **Download test ROM** produces a ROM, matching raw save and trigger manifest. Resume the fixture in melonDS and walk one tile down in Aspertia; walk up/down to replay. Normal Export ROM includes applied assets but omits the temporary test trigger.

Import `examples/cutscenes/route13.timeline.scene.json` for the coastal sample. It packages eight terrain chunks, 112 props and 61 unique textures including animation frames into eight models. NPCs and neighboring zones are excluded. Native texture animation is included: 33 transform tracks and 16 texture/palette tracks. Reapply an older static timeline to upgrade its existing native sequence in place. Unsupported/incomplete assets and resource-budget overflow fail conversion. See the [authoring guide](../docs/cutscenes/authoring.md) for limits and the reproducible build command.
