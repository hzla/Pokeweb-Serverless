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
- PNG import for the logo, scrolling background, credits, and Press Start,
  with resizing, adjustable cropping, and a converted preview.
- **Preview in game**, which boots the current exported project in the
  built-in emulator with a temporary blank save. Press Enter (Start) to skip
  the opening movie and reach the title. Reopen it after making further edits.

## Import PNG artwork

Open **2D composition** and choose **Import PNG** under the layer to replace.
The importer accepts PNG artwork such as a full-color, transparent logo.

- **Fit entire image** keeps the original proportions, scales the image to
  fit, and adds transparent padding. This is the default.
- **Scale to fill** scales both axes to the destination dimensions.
- **Crop to fill** preserves proportions while filling the canvas. Drag the
  preview or use the horizontal, vertical, and zoom sliders to select the crop.

The logo defaults to the visible 256×192 screen, with an optional full
256×256 layer destination. A native-size 256×256 logo export selects the full
layer automatically. Scrolling background and credits use their native map
dimensions. Press Start uses the existing sprite artwork bounds; a 256×256
Press Start frame export is extracted at its original centered origin.

The converted preview shows the actual palette and tile result. The logo and
background use an 8bpp, 256-entry RGB555 palette, with index zero reserved for
transparency. Replacing either preserves the other layer's used colors and
tiles. Credits and Press Start use 4bpp, 16-entry palette banks. Colors are
automatically reduced when necessary. Alpha below 50% becomes transparent;
other pixels become opaque. Palette reduction and resizing are lossy.

Logo/background graphics share a 512-tile allocation. Dense artwork may need
tile approximation, which is reported before import and shown in the converted
preview. Credits also stay within their graphics allocation. Press Start keeps
its existing sprite layout, blank blink cells, and animation timing; artwork
outside those sprite rectangles cannot appear. Custom affine or conflicting
shared-pixel sprite layouts require native imports.

Choose **Import PNG** in the dialog to apply the converted resources, then
inspect the composition and use **Preview in game**. Cancel leaves the project
unchanged. Use **Export ROM** to save an edited `.nds` file. PNG inputs are
limited to 16 MiB, 8192 pixels per side, and 16 megapixels.

## External native editing workflow

1. Export a bundle, or select an asset and choose **Export native**.
2. Edit with an external tool that can produce the same Nintendo DS native
   resource format. Use the 2D composition importer for PNG artwork; a Blender
   file alone is not a native replacement.
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

- Manual palette editing, numerical camera editing, and title timing or
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

Tests cover sampled and constant channels, sparse node
bindings, long timelines, compensated joint scales, weighted matrices, UV
transforms, loop boundaries, and optional local B2/W2 resource integration.
