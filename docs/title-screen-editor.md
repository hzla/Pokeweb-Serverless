# Title Screen editor

Load a Black 2 or White 2 ROM and open **More → Title Screen**.

## What is available

- A catalog of 19 native assets for the active version: title graphics,
  palettes, tilemaps, sprite cells/animation, three models, their animations,
  and the camera track.
- A 256×192 composition preview with scrolling background and blinking
  Press Start, plus PNG export for the screen, individual layers, and model
  textures.
- A bottom-screen animation preview that combines all three models, their
  skeletal animations, the environment texture animation, and the recorded
  camera. It opens at idle frame 7300, with play/pause, a frame scrubber,
  direct frame entry, and idle/full-sequence looping.
- Model inspection with orbit/zoom, evaluated at idle frame 7300, including
  weighted joints and Maya segment scale compensation. This fixes the
  oversized, detached eyes/parts in the earlier static viewer.
- Camera frame inspection and JSON export, including the idle-loop frame 7300.
- Native resource export/import, individually or as a ZIP bundle.
- **Preview in game**, which boots the current exported project in the
  built-in emulator with a temporary blank save. Press Enter (Start) to skip
  the opening movie and reach the title. Reopen it after making further edits.

## External editing workflow

1. Export a bundle, or select an asset and choose **Export native**.
2. Edit with an external tool that can produce the same Nintendo DS native
   resource format. A Blender file or PNG alone is not a native replacement.
3. Import the compiled resource, or repackage the bundle while preserving its
   manifest and filenames. Exported native files are decompressed; Pokeweb
   restores the compression required by the game.
4. Inspect the result and use **Preview in game**. Use the application's
   **Export ROM** action to save the edited `.nds`.

Imports are validated before either title archive is changed. A no-op import
preserves the original compressed bytes. Existing edits to unrelated archive
members are retained. Changes participate in normal project persistence and
ROM export; development mode reloads a fresh ROM on each page refresh.

## Animation preview

The viewport renders at the native 256×192 resolution and advances at 60
frames per second. **Loop idle** repeats frames 7300–7780; **Sequence start**
turns that off so the whole 7781-frame 3D sequence can be inspected.
**Cry pose** jumps to event frame 7001 (the preview has no audio).
The game camera is used for playback and remains read-only. Scrubbing does
not change the model files, animations, or camera data in the ROM.

The decoder compiles model commands once, then samples NSBCA joint tracks
and NSBTA material tracks into reusable geometry buffers. It preserves native
model units, separate position/normal matrices, inverse bind matrices, and
per-vertex matrix selections. This title-specific path does not change the
map/building renderer. Original title materials mostly use baked vertex
colors; the browser preview keeps those display values without adding an
sRGB lighting conversion.

## Current limits

- PNG import, palette editing, numerical camera editing, and title timing or
  event configuration belong to later stages. Camera values are read-only.
- The browser scene is an asset preview, not a DS emulator: screen swaps,
  event fades, music/cry audio, exact DS antialiasing, polygon sorting and
  fixed-point rasterization are not reproduced. Credits appear during the
  idle interval. Use **Preview in game** for the complete presentation.
- Animation sampling uses integer frames. The native title resources for both
  games are supported; unsupported commands in externally compiled models
  report a preview error rather than silently dropping geometry. Arbitrary
  material lighting effects may differ from the game.
- Replacements must preserve compatible model/animation bindings and the
  title timeline. Animation and camera imports must include frame 7780.
  Structural validation cannot establish that an arbitrary externally compiled
  model will meet the game's runtime limits.
- The profile targets the standard BW2 archive layout (`a/0/2/6` and
  `a/1/5/8`); heavily rearranged ROMs may be unsupported. Corporate splash
  assets and unrelated opening-movie resources are outside this editor.

See [the source research](bw2-title-screen-editor-research.md) for resource
mapping and the remaining implementation stages.

Tests cover sampled and constant channels, sparse node
bindings, long timelines, compensated joint scales, weighted matrices, UV
transforms, loop boundaries, and optional local B2/W2 resource integration.
