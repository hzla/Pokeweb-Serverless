# White 2 native cutscene format notes

These notes describe the US White 2 layout read by the existing editor and a read-only inspection of `cleanwhite2.nds` on 2026-10-21. They distinguish decoded structure from the runtime work still required for custom sequences. Addresses are specific to this executable layout; a game code alone is not a sufficient patch signature.

## Resource locations

| Data | Location |
|---|---|
| Native descriptor and command data | ARM9 overlay 293 |
| Overlay RAM base in the inspected ROM | `0x021A1BA0` |
| Decoded overlay length | 39,168 bytes, no BSS |
| Descriptor table | `0x021A6ECC` |
| Original descriptor slots | 27, including null slot 0 |
| Scene assets | NARC `a/1/5/8`, 479 members |

The archive contains 156 model, 96 skeletal animation, 76 texture-transform animation, 39 texture-pattern animation, 47 material-animation and 39 visibility-animation files, plus 26 dense camera resources. Preserve existing member indices: they are referenced from descriptors and resource tables.

The inspected source ROM SHA-256 is `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446`. Runtime installers should additionally match the local instructions and data readers they patch.

## Descriptor structure

A descriptor is 20 bytes containing five little-endian u32 values:

| Offset | Meaning |
|---|---|
| 0 | Absolute RAM pointer to 84-byte parameters |
| 4 | Pointer to playback commands |
| 8 | Pointer to end commands |
| 12 | Pointer to resource roots |
| 16 | Number of resource roots |

Pointers are not necessarily contiguous and must be bounds-checked. Slot 0 is all zero. Current parsing resolves pointers relative to the overlay base; a future installer must resolve them against the actual loaded destination rather than serializing host/file offsets as RAM addresses.

## Parameters

| Offset | Storage and interpretation |
|---|---|
| 0 | u16 camera archive member |
| 2 | u16 currently opaque parameter |
| 4 | u16 zone reference, used for scene environment context |
| 6 | u16 render flags |
| 8, 12 | FX32 horizontal and vertical FOV |
| 16 | FX32 aspect ratio |
| 20, 24 | FX32 near/far values |
| 28 | FX32 normalization range |
| 32, 34 | FX16 top/bottom projection offsets |
| 36 | 4-byte render value, not exposed by current editor |
| 40–47 | Clear color/alpha and clear buffer configuration |
| 48–61 | Fog configuration and table bytes |
| 62–77 | Eight RGB555 edge colors |
| 78, 79 | Opening fade white flag and frame duration |
| 80, 81 | Closing fade white flag and frame duration |
| 82–83 | Reserved/alignment bytes |

FX32 and FX16 values use a divisor of 4096. The current viewer normalizes near/far by the normalization range. Bit 0 of flags selects 60 versus 30 Hz rendering, and bit 1 selects two-screen 3D rendering. Native animation samples advance at 30 fps: the speed getter at `0x021A2B90` returns FX32 4096 or 2048 according to bit 0. The 60 Hz loop therefore advances half a sample per update. Additional render flags cover blending, antialiasing, fog, edges, depth behavior and alpha testing, but the current editor does not reproduce the complete DS render state.

For imported scenes, keep the full original 84 bytes. The current implementation exposes a subset and writes only existing fade fields. A custom writer must not replace the rest with assumed zero defaults. Imported nonzero Boolean bytes should retain their original encoding if unchanged.

A zone reference is not a terrain import instruction. Existing scene geometry is explicitly listed in the resource table.

## Resource trees and variants

Each root is eight bytes: u32 bundle pointer, u16 bundle count and u16 selector. Selector values are 0 for the first bundle, 1 for player model selection, 2 for a caller-supplied actor variant and 3 for season.

Each bundle is eight bytes: u32 animation-group pointer and u32 group count. Groups select time-of-day variants, with the first group used as the existing fallback. Each group contains a u32 member-ID array pointer and u32 count. Member IDs are u16 values.

A group binds a model with its associated animations. Current decoding supports these file signatures:

| Signature | Purpose |
|---|---|
| `BMD0` | Native model, materials and texture resources |
| `BCA0` | Joint translation, rotation and scale animation |
| `BTA0` | Texture transforms |
| `BTP0` | Texture/palette frame selection |
| `BMA0` | Material color and alpha animation |
| `BVA0` | Per-frame joint visibility |

One resource group can contain several actors in one model. Asset extraction must preserve joint transforms, mesh bindings, textures and animation relationships. The current compiler requires one model per model resource.

In sequence 5, camera member 288 and zone reference 427 accompany seven roots. The first spring resource groups are `[292,294,293]`, `[295,296]`, `[290,291,289]`, `[280,283]`, `[285,283]`, `[274,273]` and `[270,269]`. The petal group uses model 274 and skeletal animation 273 in that variant. Variants can reuse some members and select different others.

## Dense camera resource

The first eight bytes hold a u32 frame count, three channel-presence bytes for scale/rotation/translation and a reserved byte. Present channels contain three float32 values per frame in that order. All 26 original camera tracks inspected use rotation and translation with no scale channel, giving a 24-byte frame stride.

Rotations are degrees. The existing viewer uses YXZ camera orientation. Camera positions use dedicated scene coordinates; there is no established universal scale/translation from every native scene to matrix tile coordinates. The first Aspertia camera pose is rotation `[-15.789794921875, 0, 0]`, position `[-17, 31, -20]`.

Authoring can retain sparse shot endpoints and bake dense samples at export. Preserve reserved bytes and native channels for untouched imports. New durations require coordinating the camera frame count, animated assets, render rate and cue timings; the existing editor intentionally keeps duration fixed.

## Joint and effect animation

The animation reader decodes joint identity/base poses, constant and sampled translation, compressed rotations, scale and sampled track intervals. The joint writer independently edits translation, rotation and scale in an existing single-clip resource. It can expand an identity record or add a record for a joint previously using its bind pose. Unedited numeric sample data and packed rotation entries are preserved while offsets and pool indices may be relocated; edited channels use constant or dense native samples. Scale includes its native inverse, calculated after FX32 quantization. Newly authored zero scales and fixed-point overflow are rejected. Rotation pools use the native pivot or packed-basis representations, with 15-bit indices; joint record offsets remain 16-bit. Referenced buffers are collected into a compact resource on each write, preserving clip metadata and duration. Transform interpolation uses local XYZ Euler controls with quaternion shortest-arc interpolation. This does not create rigs, mesh weights, retargeted actions or new resource bindings, and it adds no executable adapter.

Translation is represented at 1/4096-unit precision when written through the current movement tool. Baking an edited joint quantizes that track's decompressed translation values to that precision. The full animation writer needed for compositing independently timed actor actions remains future work.

Material animation carries diffuse, ambient, specular, emission and alpha channels. Visibility animation packs frame-major joint bits. Texture-pattern clips bind texture/palette choices by material. Current preview support does not amount to a writer for every one of these formats.

Aspertia petals are a skeletal-animation resource, so “add petals” should bind a compatible native effect asset or request an effect-generation feature. It should not silently select a generic browser particle emitter that has no native export.

## Timed commands

Each command is 40 bytes: signed 32-bit opcode, signed frame number and eight signed 32-bit arguments. The terminator opcode is 19. Frame -1 occurs before playback. Preserve list order for same-frame events; sorting by frame must be stable.

| Opcode | Meaning |
|---|---|
| 0 | Null callback; omit at authoring compile time, never emit as an executable command |
| 1–5 | Play/stop sound and animate volume, pan or pitch |
| 6–9 | Play/stop/fade/change music |
| 10–11 | Screen fade and extended fade |
| 12–13 | Light color and direction |
| 14–15 | Message and 2D graphic commands |
| 16–17 | Motion blur enable/disable |
| 18 | Projection change |
| 19 | End |

The native details writer edits existing playback slots. The JSON timeline compiler can allocate a larger list for private sequence 27, emits opcode 19 and updates its descriptor pointer and registry length. End commands are a separate cleanup program and remain unchanged. The dispatcher at `0x021A3C6A` loads a callback from `0x021AB420` and calls it directly; slot 0 is null. The JSON compiler omits no-op events, and the details writer rejects opcode 0.

Native command argument packing is separate from the public scene schema. The compiler must resolve named assets, scale fixed-point fields, validate screen masks and brightness ranges and record the chosen opcode/arguments in the build report. Opaque arguments stay byte-exact for untouched imports.

Native opening/closing metadata fades are independent of playback fade commands. When an authored timeline replaces inherited fade behavior, replace the inherited visual fade with timeline brightness events. Retain a one-sample opening metadata fade to clear the field transition; zero duration leaves the test launch black.

## New ID dispatch evidence

The inspected overlay contains this ID normalizer at `0x021A2A0C`:

```text
cmp r0, #0
beq invalid
cmp r0, #27
blo return
invalid: r0 = 0
return
```

Its 12-byte signature is `00 28 01 D0 1B 28 00 D3 00 20 70 47`. A parameter getter calls it, multiplies the ID by 20 and indexes the descriptor table.

Five literal pool entries point at the descriptor's five fields:

| Literal address | Value |
|---|---|
| `0x021A2A28` | `0x021A6ECC`, parameters |
| `0x021A2C10` | `0x021A6ED0`, playback commands |
| `0x021A2C24` | `0x021A6ED4`, end commands |
| `0x021A2B60` | `0x021A6ED8`, resource roots |
| `0x021A2A5C` | `0x021A6EDC`, root count |

These are concrete patch dependencies, not a complete patch plan. Other callers, cached pointers, allocation sizes and overlay lifetime must be audited before selecting relocation versus an external registry. Raising the bound alone indexes unrelated data past the original table. Changing one table literal alone leaves other readers using the old table.

The current field-command layout catalog lists `call3_d_demo` at opcode `0x0154` with two 16-bit operands. It is a candidate for trigger integration. The new-scene installer must independently verify operand meaning, work-variable handling, blocking/completion behavior and call-site constraints before generating trigger code.

## Coordinate contracts and remaining decoding

Map rendering uses 16 world units per tile and 32 tiles per matrix chunk. Matrix tile X/Z, field event X/Y/Z fields, native scene positions and joint-local translations are distinct spaces. Terrain height is not a universal constant, especially at stairs, bridges and overlapping surfaces.

A native map conversion needs a measured map-to-scene transform, heading mapping, root transforms and ground offsets. An overworld conversion also needs sprite frame layout, directional/action bindings, billboard size and palette/transparency handling. A look-at camera needs a calibrated conversion to the native pitch/yaw conventions.

Remaining export work includes new descriptors/lists, an audited new-ID resolver, map geometry packaging, actor/billboard generation, full animation composition and verified script triggers. Preview gaps include audio, 2D overlays, exact DS lighting/reflections and complete render state. Runtime checks must cover memory/resource limits, native frame stepping and return-to-field behavior.

## Implemented sequence 27 registration

`nativeCutsceneRegistry.ts` recognizes the original readers and a complete version-1 registration. `nativeCutsceneClone.ts` appends a `PWCS` metadata header, a 28-slot descriptor table and private sequence-27 data to overlay 293. All five field-specific table literals are redirected and the ID normalizer's bound becomes 28. Original descriptors and their original pointed-to data stay intact.

The clean Aspertia clone adds 30 archive members, starting with camera member 479. The original 479 members stay byte-identical. The expanded overlay is 40,636 bytes, ending at `0x021ABA5C`; the original base and static-initializer range are retained and the exporter updates its declared RAM size. Models, animation, texture/material data and variant relationships are copied independently rather than sharing writable assets with sequence 5.

The metadata header is 32 bytes at original decoded offset 39,168: stamp, version, total decoded size, new table offset, descriptor count, source sequence ID, private camera member and copied member count. Current readers require the complete recognized registration and verify that its original descriptor prefix matches the retained table. Partial pointer/bound edits are rejected. This is a fixed scene-27 implementation, not an arbitrary sequence allocator.

The test trigger uses a new public entry in Aspertia script member 854 and a one-tile grid trigger in event member 163. Entry indices and old relative code/movement references remain unchanged. Opcode `0x0154` receives sequence ID 27 and literal user parameter 0; field close/open and explicit fade/wait commands bracket it. Its script terminates explicitly after restoring field music and control. The builder checks the native dispatch entries and callback signatures before using this transition path.

The headless run observed custom module residency from emulator frames 943–2984 and 3515–5556, with field movement between runs and no fatal core errors. This establishes the clean fixture's repeatable dispatch/return path; it is not a hardware or all-scene memory-budget certification. The later timeline test used 300 camera samples and 43 playback events, completed twice in the headless core, and restored field control. Its starts were frames 944 and 2117; module exits were 1587 and 2760. General resource/ID allocation, other duration/budget combinations and new assets still require their own checks.

## Timeline projection scope

The version-2 evaluator can interpolate vertical FOV for map previews. Native projection uses coupled angle inputs and screen offsets in `0x021A2714`; a browser perspective FOV is not an established general conversion for those fields. Native timeline keys therefore retain the template FOV, and existing raw projection cues are preserved. New native FOV animation is rejected instead of generating an uncalibrated command program.

## Converted map resources and registry version 2

Map-stage compilation keeps the version-1 `PWCS` header at offset 39168, writes version 2 and relocates the complete descriptor table to an aligned allocation when a new ID is added. The count and all five field references are updated together. IDs 1–26 remain byte-identical, and the retained private-27 camera ID still validates header field 24. ID bound/count is limited to 64 by the current compiler. Recognition still verifies the audited stock instruction signatures; it does not accept arbitrary modified readers.

Converted models have one identity node, baked chunk/prop transforms, explicit vertex colors, base UVs, native material tracks, embedded TEX0 resources and native dictionaries. Each terrain chunk and its placed props form one model group. Each resource root uses selector 0, one bundle and one group containing a BMD0 member plus optional BTA0 and BTP0 members. The camera and each model get private archive IDs. Geometry and camera share `(world - stageOrigin) / 16`; stage origin is recorded in project binding metadata. A map binding hashes its descriptor, owned metadata allocation and archive resources to reject stale native edits. Recompiling unchanged source/assets reuses the allocation.

A single-sample opening metadata fade is required by the isolated field launch: native scene brightness commands do not clear the field's separate transition fade. Runtime checks must inspect visible pixels as well as completion and field return.

## Generated map material tracks

NSBTA uses a single SRT0 clip (`M\0AT`), a native material-name dictionary with 40-byte entries and five channel descriptors (scale S/T, packed rotation, translation S/T). Scalar constants use immediate FX32 values; sampled scalar arrays use FX16 when their range permits it and FX32 otherwise. Rotation samples store signed FX16 sine/cosine pairs. Constant channels and duplicate sample arrays share storage. The clip uses the model's Maya texture convention.

NSBTP uses one PAT0 clip (`M\0PT`), separate texture/palette name tables and an 8-byte material-track record containing key count, flags, fixed-point key-density hint and relative key-table offset. Each key is four bytes: u16 frame, u8 texture index, u8 palette index. Keys hold until the next boundary; repeated source loops are sampled over the entire scene clock. Duplicate adjacent choices are collapsed. These fields were checked against local W2 resources and native playback.

The converted model's SRT materials use texture-coordinate matrix mode with identity base transforms and raw UVs. Animation is applied once by the native renderer; frame-zero transforms are not also baked into those coordinates. Pattern frames retain independent palette bindings. All frames count toward texture/palette VRAM limits, and animation bytes count toward the cutscene heap budget.

## Authored overworld NPC resources

Map scenes may append one root per authored overworld NPC. Each root's sole resource group contains an embedded-texture `BMD0`, root-translation `BCA0`, and sprite/palette `BTP0`. The map and NPC positions share `(world - stageOrigin) / 16`; the quad is local to the actor's feet and uses registry billboard dimensions divided by 16. SBC command 7 applies full camera-facing billboarding after the root transform. The one-node joint clip uses identity rotation and scale with dense FX32 translation channels (`0x240` record tag). Texture-pattern keys choose the correct facing and walking image on the same 30-fps scene clock. No field actor allocation or field movement opcode is involved.

The Route 13 fixture contains ten roots: eight map model groups and two independent NPC groups. Its two actors were audited at all 300 samples against source position and sprite images after export/reopening. The headless DS run completed twice and returned field control. A separate ROM changed only the two root movement resources to constant starting positions, keeping camera, events, sprite patterns, map/water and other assets identical. At emulator frame 1080 both images matched exactly; later paired frames differed in the moving NPC regions. This verifies native movement in that fixture, not hardware or every overworld resource/controller.

Test export recognizes its own complete launcher program and exact one-tile fixture event when reopening an earlier test ROM. It retargets that public entry and removes duplicate owned step triggers, preserving other entries and event footer data. A different trigger or unmatched script is retained. Normal ROM export does not create or retarget a test launcher.

## Authored dialogue

Typed map dialogue appends an encrypted Gen 5 message bank to `a/0/0/2` (stock US W2 has 495 banks). Native opcode 14 receives bank, message index, authored marker, duration, window X/Y and width/height. The compiler uses `[bank, message, 0x50445700 + wait, duration, 2, 15, 28, 8]`. The marker occupies the stock gender-offset argument; the adapter consumes it before constructing a message, so authored speaker/text selection is independent of player gender. Plain text is wrapped and validated before encoding. No existing bank is overwritten.

`runtime/cutscene-dialogue` produces a relocatable Thumb module installed after the scene metadata. A 24-byte `PWDL` header records version, code length and state offset. Its cue entry replaces the cue-14 table pointer at `0x021AB458`; its task callback replaces the literal at `0x021A35A4`. Unmarked cues/tasks retain stock behavior. Installation audits the native scene step loop, message constructor/cleanup and ARM9 input/task functions; partial or altered adapter installations are rejected. The `PWCS` decoded overlay size includes the adapter, within the existing 64 KiB budget.

The scene object at manager `+0x1C` has an FX32 step at `+0x14` and a camera object pointer at `+0x18`; camera offset `+0x10` is its current FX32 frame. Holding the step at zero preserves rendering while freezing camera, model/NPC and material animation. A cue dispatched during a skipped-frame loop can precede one pending half-sample of camera catch-up; the following clock stays fixed. Waiting dialogue must start before the final camera sample so native completion cannot bypass its wait. A fresh A/B press after release, with the font page complete, closes the message and restores the saved step. Abort cleanup restores it as well. Music/audio continue independently.

Authored text tasks use native window/font allocation and cleanup, retaining their handles from creation. Starting an adjacent dialogue closes the prior window before opening the next. A negative native font speed of -128 prints the validated single page in one font update. Timed mode retains the native text timer (duration doubles for the scene's 60-Hz update flag); waiting mode holds that timer until input. The native 28×8 tile window is at `(2,15)` on the top screen; the authoring contract reserves four lines wrapped at 24 characters, including the speaker.

Project bindings record message file ID, bank ID and a content hash. Reapply verifies content plus exclusive cue ownership against the current registry, stages all text/overlay/resources before publishing, and rejects intervening message changes. Removing dialogue retains the owned bank rather than shifting other bank IDs. Portable JSON carries only the text, stable speaker track ID, timing and wait mode.

## Native response branches

The version-2 `PWDL` adapter retains the cue/task hooks and replaces the four bytes at `0x021A2636` (load scene step; increment loop index) with a Thumb BL to an aligned assembly bridge. The bridge preserves stack alignment, calls the C step resolver, and performs the original loop-index increment for ordinary updates. A queued forward branch returns one adjusted delta and exits the remaining skipped-frame iterations. The camera and every model/material animation receive the same accumulated delta; scene time is not changed independently of NPC animation time.

Authored choice cue 14 uses `[bank, firstVariantMessage, 0x50445703, count, target0, target1, target2, 0]`. The private message bank contains contiguous cursor variants, each with the same prompt and all response labels. Up/Down replaces the native text page with the appropriate variant; a fresh A selects it. Choice windows use `(2,11)`, 28×12 tiles, reserving six text lines. B is ignored. Only the primary native update iteration reads fresh input edges.

Forward jump cue 14 uses `[0, targetFrame, 0x50445702, 0, 0, 0, 0, 0]`. Choice confirmation queues the same operation. After the current event tick, the step resolver reads the scene's current camera FX32 time, subtracts the delta already accumulated in the native loop, and supplies the remaining distance to the target. It resolves the sequence command program through the audited native getter, finds the first cue at/after the destination, resets manager `+0x14` (cue index), `+0x10` (last frame) and `+0x08` (END status), then exits the current update loop. The next update dispatches the destination frame's commands. This ordering avoids the current dispatch loop incrementing or overwriting the new cursor.

The installer verifies the complete callback payload, header, step branch and original cue-dispatch signatures. Exact version-1 payloads can be upgraded by appending version 2 and redirecting the three hook sites; old private allocations are retained. Original native cues delegate to the stock handler, and the step bridge returns the original animation step when no authored jump is queued.

The Route 13 branch fixture has been exercised through both responses in the headless DS core: choice 90 to reaction 120 or 240, followed by the shared wait at 360 and field restoration. Both runs retain frozen scene clocks/world pixels during each wait. This verifies the fixture, not a seamless native-to-field renderer handoff.
