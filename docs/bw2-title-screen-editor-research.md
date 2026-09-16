# BW2 title-screen editor: feasibility research

Research date: 2026-09-15. Scope: the two title screens shown in the supplied screenshot, including their animated presentation, asset export/import, and numerical settings. No editor implementation or ROM changes were made.

## Assessment

**Feasible, with a useful first version available before building a complete browser animation renderer.** The recommended approach is a title-specific asset editor with PNG/native Nitro export and import, numerical camera/2D controls, and an in-app emulator preview. A synchronized, scrubbable Three.js reconstruction is a second substantial workstream. General Blender-to-Nitro conversion inside the browser is the largest optional extension.

The original assumption needs two refinements:

- The logo screen combines tiled backgrounds and an animated sprite. Its background scrolls; it is not a single static bitmap.
- The other screen combines three model resources, skeletal animations, texture-coordinate animation, camera animation, and a 2D credit layer. The camera is fixed during the idle loop, but moves through the full title sequence. The sequence also swaps which physical screen displays 3D.

## Evidence and confidence

Primary runtime reference: [BW2 title.c](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:50). This is Japanese BW2 source, not BW1.

Read-only checks used the local `cleanwhite2.nds` (game code IRDO, revision 0) and `cleanblack2.nds` (IREO, revision 0):

1. Both contain the expected 15-member title graphics archive at `a/0/2/6`.
2. Both contain a 479-member demo archive at `a/1/5/8` (file ID 505 in these ROMs).
3. All 16 B2/W2 title model, animation, and camera members in that archive match the corresponding reference files byte-for-byte, using SHA-256 comparisons. Both games carry both sets of 3D title assets.
4. Existing Pokeweb functions decoded the logo, scrolling background, credits, and Press Start cell animation in both ROMs without parser warnings.
5. Existing Pokeweb model decoding produced geometry and textures for all six title models without parser warnings. This establishes parser coverage, not visual or animation accuracy.
6. Camera binaries were parsed directly and compared across frames, confirming moving camera tracks and a fixed idle-loop camera.
7. Pokeweb's NARC writer rebuilt both archives in memory for both games; reparsing preserved every member's bytes. This was an archive round-trip check, not a modified-ROM boot test.

Exact executable offsets for English title settings, modified-ROM compatibility, Blender round trips, and final emulator visual fidelity were **not** established in this pass.

## What produces the screens

### Logo screen

The runtime sets up separate logo and background layers, sharing character graphics and palette data. It also creates an animated cell actor for Press Start. A separate text window is initialized but explicitly hidden in the active update path; editing a message string alone would not replace the visible Press Start artwork.

Source: [2D setup](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:884), [scrolling update](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:993), [Press Start actor](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:1366).

Verified `a/0/2/6` member mapping, with zero-based indexes:

| Members | Role | Formats |
| --- | --- | --- |
| 0, 1, 2 | Logo graphics, tilemap, palette | NCGR, NSCR, NCLR |
| 3 | Scrolling background tilemap, using member 0 graphics and member 2 palette | NSCR |
| 4, 5, 6, 7 | Press Start palette, graphics, cell layout, animation | NCLR, NCGR, NCER, NANR |
| 8, 9, 10 | Developed by Game Freak credit layer | NCLR, NCGR, NSCR |
| 11–14 | Adjacent corporate splash graphics | NCLR, NCGR, two NSCRs |

Members 0, 1, 3, 5, 9, 10, 12, 13, and 14 are LZ10 compressed in both tested ROMs. The runtime requests decompression for these resources, so import must restore suitable compression rather than write decoded bytes directly.

Observed layout constraints:

- Logo: 256×256 tilemap, 8 bits per pixel, 512 graphics tiles and a 256-color palette. A DS screen displays a 256×192 viewport.
- Scrolling background: 256×192 tilemap, sharing the logo's 512-tile graphics allocation and palette. Replacing one layer must preserve or rebuild the other's references.
- Credits: 256×192 tilemap, 4 bits per pixel, 48 graphics tiles.
- Press Start: two cells and two animation entries, with durations 32 and 64 ticks in both tested ROMs. The source's `PUSH_TIMER_WAIT` definition is not used by the active sprite-animation path; NANR is the relevant timing data.

PNG export is straightforward. PNG import needs tile allocation, palette quantization, transparency handling, and shared-resource validation. It cannot be implemented correctly as a generic bitmap replacement.

### 3D screen

For each version the runtime explicitly loads three NSBMD model resources, three NSBCA skeletal animations, one NSBTA texture-coordinate animation for the third model, and one camera binary. Models supply their own textures. The credit artwork is composited as a 2D layer.

Source: [resource and animation tables](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:1075).

Verified `a/1/5/8` mapping:

| Resource | Black 2 | White 2 |
| --- | ---: | ---: |
| Model 01 skeletal animation | 446 | 454 |
| Model 01, primary Kyurem mesh | 447 | 455 |
| Model 02 skeletal animation | 448 | 456 |
| Model 02, additional geometry | 449 | 457 |
| Model 03 skeletal animation | 450 | 458 |
| Model 03, environment/effect geometry | 451 | 459 |
| Model 03 texture-coordinate animation | 452 | 460 |
| Camera track | 453 | 461 |

Model 01's node/texture names identify Kyurem. Model 02 also contains Kyurem textures; its precise visual role should be labeled after animated inspection rather than guessed from its filename. Model 03 contains mist/stone-like textures. Preserve all three scene components when exporting an editable bundle.

The existing decoder produced these diagnostic results:

| Version | Model 01 triangles/textures | Model 02 triangles/textures | Model 03 triangles/textures |
| --- | ---: | ---: | ---: |
| B2 | 1,749 / 9 | 1,205 / 4 | 1,695 / 3 |
| W2 | 2,075 / 10 | 1,360 / 6 | 1,620 / 3 |

These are triangulated decoder outputs, not DS hardware polygon counts or proof that all geometry is visible simultaneously.

## Camera and title sequence

The camera format is particularly accessible. Its original converter and runtime reader are present: [ica_converter.rb](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/tools/ica/ica_converter.rb:26), [LoadAnimeInfo](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/system/ica_anime.c:576), [UpdateBuf](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/system/ica_anime.c:697).

The file has an 8-byte header: a little-endian frame count, scale/rotation/translation presence bytes, and padding. Each frame then contains the enabled XYZ triples as 32-bit floats, in scale, rotation, translation order. The runtime converts these floats to fixed-point values. Camera rotations are degrees; the camera adapter derives forward/up vectors from them.

Both tested cameras contain 7,781 frames, rotation and translation only: `8 + 7781 × 24 = 186752` bytes. Both change from frame 1 onward. Frames 7300–7780 have one identical camera transform per version, confirming the fixed idle-loop view.

Source-defined sequence events include:

| Setting | Source value | Storage/meaning |
| --- | --- | --- |
| Initial display routing | 3D to lower screen | Executable setup |
| Automatic screen swap | Title wait counter 1740 | Executable event; roughly 29 seconds at nominal 60 Hz |
| Title timeout | `60 × 113` ticks | Executable counter; distinct from asset timeline length |
| Cry/start scene seek | Animation frame 7001 | Executable seek into camera and all model animations |
| Idle-loop start/end | 7300 / 7780 | Executable synchronized seek/loop |
| Cry species/form | Kyurem; B2 form 2, W2 form 1 | Executable audio call |
| Camera projection | 60° FOV; near 0.1, far 2048; frustum width scale 0.1 | Executable camera setup |
| Background scroll | B2 increments; W2 decrements; offset uses counter / 2 | Executable update |
| Motion-blur blend | Normal 12/4; cry scene 8/8 | Executable display-capture parameters |

Do not treat the title wait counter as identical to the animation frame counter: animation advances during fades and code can seek to later scenes. A future preview needs explicit scene presets and both concepts.

Source: [sequence logic](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:325), [projection](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:1205), [camera orientation](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/system/ica_camera.c:25).

## Numerical editing: what is data and what needs a patch

**Resource edits:** camera position/rotation per frame, frame counts, palette colors, tile placement, cell offsets, sprite frame durations, and supported model/material properties. These can be presented as ordinary fields and written into assets, with format validation.

**Executable settings:** projection, lighting, global draw transform, scroll behavior, initial sprite origin, screen swap, loop/cry event frames, fades, motion blur, audio selection, and model-resource selection. These are compiled constants/tables/logic, not one existing title configuration file. Some require instruction changes rather than replacing a contiguous data record.

A clean editor can still expose them as settings, but its writer needs version-specific patch definitions, expected-byte checks, and compatibility handling. Japanese source is excellent semantic evidence; Japanese addresses are not valid English patch addresses. English title-overlay offsets remain a separate investigation.

Some requested transforms can be baked into camera or model assets to avoid executable changes. The UI must distinguish those baked edits from runtime settings and from preview-only camera controls.

## What Pokeweb already provides

| Existing component | Reuse | Remaining work |
| --- | --- | --- |
| [nitroBg.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/nitroBg.ts:49) | Palette/tilemap decoding and image composition | Title layer composition and import constraints |
| [nitroCell.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/nitroCell.ts:73), Pokemon sprite tooling | NCER/NANR decoding, preview, editing patterns | Title-specific adapter, positions and persistence |
| [moveBackgroundCompiler.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/moveBackgroundCompiler.ts:64) | Quantization and tile-building techniques | Existing writer is tailored to 4bpp, six palettes, 512×512 maps; title logo requires a different 8bpp/shared-resource writer |
| [battleModelScene.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/battleModelScene.ts:23), Maps 3D | NSBMD geometry and texture decoding, Three.js infrastructure | Skeletal playback, texture animation, title camera and DS rendering details |
| NARC/ROM writers and project persistence | Replacing assets and rebuilding ROMs | A title model/route and consistent edit ownership |
| [testBattleEmulatorMain.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/testBattleEmulatorMain.ts:401) | Browser DS emulator, supplied ROM bytes, pause, stepping and savestates | A title launch mode and title-oriented controls |

The present model reader accepts BMD0/BTX0 containers. It does not load title NSBCA/NSBTA animations. Its [NODEMIX handling](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/map3dModel.ts:1672) deliberately uses a static bind-pose approximation. Animated preview requires retaining the joint hierarchy, inverse bind matrices and vertex influences, then evaluating animation tracks; adding only a Three.js playback button is insufficient.

The existing export path gives loaded NARC stores precedence over filesystem replacements. Use one authoritative owner for each title archive and merge edits through it, so a generic file-editor change cannot silently compete with a title-editor change. See [exportRom.ts](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/src/pokeweb/exportRom.ts:64).

## Preview recommendation

Provide two complementary views:

1. **Asset/composition preview:** immediate 2D layers, texture previews and model inspection. Extend this into synchronized animation with an idle-loop preset, scene selection, frame stepping and scrubbing. Display at native 256×192 per screen with optional integer scaling.
2. **In-game preview:** build a temporary ROM from current project edits and launch it through Pokeweb's existing emulator infrastructure in a dedicated title mode. This runs the game's actual composition, animation, camera, fades and screen-switch code.

The emulator is the practical reference for fidelity, subject to emulator accuracy. Reconstructing every DS effect in Three.js is more work, especially transparency ordering, fixed-point transforms, lighting, and the frame-history blend implemented by [display capture](/Users/andylee/Repos/Port-Pokeweb/reference_repos/REDACTED_REFERENCE/prog/src/title/title.c:746).

For iteration, reload the edited ROM and re-enter the title. A savestate captured after title assets are loaded can restore stale geometry/textures from RAM and VRAM; it is not a reliable way to preview arbitrary new asset edits. A validated checkpoint before title resource loading could be investigated later. This title mode should be independent of test-battle preparation and its game-flow patches.

## External editing workflow

### 2D

Export separate PNG layers/sprite sheets, original native resources, and a manifest recording member IDs, palette/tile sharing, compression and dimensions. Import PNG edits through a title-aware compiler, preview the resulting indexed colors, then write the complete dependent resource group.

### 3D

Export the original NSBMD/NSBCA/NSBTA files and camera data as the authoritative bundle. Offer GLB/Collada and texture PNGs for convenience once conversion support is available.

[Apicula](https://github.com/scurest/apicula) can convert models and skeletal animation to common 3D formats. Its README says material and texture-pattern animations are not converted, but a subsequent code inspection found an experimental UV-offset export path using `EXT_property_animation` in the local GLTF converter. This is not complete NSBTA support or verified Blender compatibility. A GLB export therefore cannot be the sole lossless representation of this title scene; preserve NSBTA and the custom camera separately. See [the map export feasibility note](/Users/andylee/Repos/Port-Pokeweb/Pokeweb-Serverless/docs/map-blender-export-feasibility.md) for the code-level findings.

Blender output also needs conversion back into DS-native assets. Local CTRMapV includes [NSBMDWriter](/Users/andylee/Repos/Port-Pokeweb/reference_repos/CTRMapV/src/ctrmap/formats/ntr/nitrowriter/nsbmd/NSBMDWriter.java:19) and NSBCAWriter, exposed through its CreativeStudio integration. Upstream [NSBMD export settings](https://github.com/ds-pokemon-hacking/CTRMapV/blob/master/src/ctrmap/creativestudio/nitroplugin/NSBMDExportDialog.java) and [NSBCA export settings](https://github.com/ds-pokemon-hacking/CTRMapV/blob/master/src/ctrmap/creativestudio/nitroplugin/NSBCAExportDialog.java) confirm these capabilities. The [NNS Blender plugin](https://github.com/jellees/nns-blender-plugin) provides another route through intermediate model/animation formats, which still need binary conversion.

These are candidate external workflows, not a tested end-to-end BW2 title round trip. Start by accepting validated, already-compiled Nitro resources. Direct arbitrary `.blend`, FBX or GLB import into a game-ready title should be treated as a separate converter project.

## Suggested implementation stages

| Stage | Deliverable | Relative difficulty |
| --- | --- | --- |
| 1 | BW2 resource catalog; native export/import; PNG export; 2D composition; camera inspector; title-mode emulator launch | Moderate; strong existing foundations |
| 2 | PNG reimport; palette/tile/cell editing; camera track editing with CSV/JSON exchange; import validation | Moderate |
| 3 | NSBCA/NSBTA playback; shared timeline and camera; editable supported material settings; accurate scene composition | High; principal new rendering work |
| 4 | Verified B2/W2 executable settings for lighting, projection, timings, screen routing and audio | Moderate–high; per-build binary work |
| Optional | Fully integrated Blender/common-format-to-Nitro conversion | High; separate feature with substantial compatibility work |

Stage 1 is already useful for externally compiled replacements and in-game verification. Stage 2 completes a practical 2D/camera editing loop. The native assets remain the source of truth throughout.

## Acceptance checks for implementation

- Preserve every unrelated member of both archives, especially the shared 479-member demo archive.
- Verify export/import without edits preserves member payloads and resource relationships.
- Exercise logo/background edits together, including shared palettes, tile budgets and compression.
- Validate model/animation bindings, animation lengths, and all event seeks. Original model and camera timelines contain 7,781 frames; shorter replacements need compatible sequence behavior.
- Use the game's memory allocations as import constraints: source title heap is `0x120000`, texture allocation 256 KiB and texture-palette allocation 32 KiB. Compressed file size alone does not measure runtime memory use.
- Check idle, moving-camera, screen-swap and Start/cry phases in both B2 and W2. Compare reconstructed preview with the game renderer.
- Enable executable settings only for verified target builds; identify modified or unsupported code explicitly.

**Recommendation:** proceed with a scoped asset/config editor and emulator preview first. The assets and formats are accessible, and existing Pokeweb code covers much of the plumbing. Faithful standalone animated preview and seamless Blender round trips are the parts that deserve separate milestones.
