# Pokemon GIF Import And Editing Reference

Use this as a handoff document for debugging or extending the Pokemon sprite GIF import workflow. It summarizes the current editor behavior, generated files, file-format assumptions, packing strategies, and the known failure areas around macro-block flipbooks.

Related docs:

- `docs/pokemon-flipbook-rig-generation-guide.md`: high-level flipbook strategy and hard rules.
- `docs/pokemon-animation-file-generation-guide.md`: NCER/NANR/NMCR/NMAR/NCEC generation rules.
- `docs/pokemon-rig-animation-generation-guide.md`: semantic skeletal rig guidance.

Primary code:

- `src/pokeweb/pokemonFlipbookRig.ts`: GIF decode, sampling, packing, palette generation, and animation bundle generation.
- `src/ui/pokemonSpriteEditor.ts`: editor UI, GIF import controls, manual frame sampling, preview, and ROM/project mutation.
- `src/pokeweb/pokemonSpriteWriters.ts`: binary writers for Pokemon sprite animation files.
- `src/pokeweb/pokemonSpriteModel.ts`: parsers, project model, import/export helpers.

## Current Editor Workflow

The sprite editor's GIF workflow is now centered in the top Animation section.

1. Choose side: `Front` or `Back`.
2. Choose palette target: `Normal` or `Shiny`.
3. Choose packing mode:
   - `Pose Blocks`
   - `Rotated Pose`
   - `Macro Blocks`
   - `Tile Nodes` still exists in code as `tile-node-dedup`, but the UI should not present it for normal use because it is noisy, browser-heavy, and not currently a good production mode.
4. Choose sampling strategy:
   - `Loop Rest`
   - `Keyframes`
   - `Even`
5. Optionally set:
   - `Source %`
   - speed slider
   - timeline loop range/count
   - rest loop count
   - finish on/off
6. Drag/drop or choose a GIF.
7. The importer writes the selected side's sprite, rig atlas, palette, and animation bundle into the in-memory project. It duplicates the male sprite/rig to the female variant.
8. The GIF viewer shows the loaded source GIF frames. The manual sampling input shows the selected source GIF frame numbers.
9. Editing manual frame numbers and applying rebuilds the rig and animation from the last imported GIF bytes.

The editor currently hides `Max Frames`; the code still uses the default `maxUniqueFrames = 96`. The tile budget is fixed at `512`, which is the full `256x128` rig atlas in 8x8 tiles.

## Important Controls

- `Source %`: limits how much of the original GIF auto-sampling considers. `100` means all frames; `50` means only the first half. Manual sampling ignores this and can reference any loaded frame.
- `Speed`: scales generated NANR frame durations after import. Faster speeds reduce durations; slower speeds increase durations. It does not increase OAM count by itself.
- `Timeline Loop`: post-import rewrite of the generated animation timeline. If start/end/count are `1-50 x3`, it repeats frames 1 through 50 three times, then plays the remaining frames.
- `Rest Loops`: used only by `Loop Rest` auto-sampling. `Auto` chooses 2 or 3 repeats based on source/rest duration.
- `Finish`: when enabled, `Loop Rest` appends later GIF frames after the repeated rest loop.
- `Paired Palette Import`: imports front and back GIFs together and builds one shared palette for both sides.

## GIF Decode And Frame Normalization

GIFs are decoded with `gifuct-js`.

The decoder:

- Parses GIF frames with disposal handling.
- Maintains a composited canvas across GIF frames.
- Applies disposal type 2 by clearing the patch rectangle.
- Applies disposal type 3 by restoring the previous canvas.
- Emits `PokemonFlipbookFrameEntry` records:
  - `index`: original GIF frame index.
  - `width` / `height`: source GIF dimensions.
  - `delayMs`: frame delay, clamped to at least 10ms.
  - `pixels`: RGBA pixels of the composited frame.

Normalization then:

- Computes the union alpha bounds across all decoded frames.
- Centers a `96x96` crop on that union.
- Crops every source frame into the same `96x96` battle-frame coordinate space.
- Later alpha bounds are computed inside this normalized 96x96 frame.

The ground clamp rule is applied during packing: no visible sprite bottom should end below 3 units under the center teal editor dot. Code uses `MAX_GROUND_BOTTOM_Y = 3` and shifts generated OAM/cell positions upward when needed.

## Sampling Strategies

### Loop Rest

Best default for Pokemon GIFs that mostly idle, then do a flourish.

- Searches for a loop endpoint between roughly 25% and 75% of the considered frame window.
- Chooses the frame most similar to frame 0.
- Samples a rest segment from frame 0 to that endpoint.
- Repeats the rest segment 2 or 3 times.
- Optionally appends sampled finish/flair frames after the loop endpoint.

### Keyframes

Uses image-difference sampling to select distinctive frames up to the frame budget. Good when the whole GIF is action and no resting loop should be emphasized.

### Even

Samples evenly across the considered source window. Good as a predictable baseline when keyframe scoring chooses awkward frames.

### Manual

Not a named strategy in the mode buttons; it is activated by entering explicit GIF frame numbers after a GIF has been imported.

Manual sampling:

- Reuses the last uploaded GIF bytes.
- Uses the typed frame numbers in order.
- Rebuilds the rig atlas and animation immediately.
- Updates the manual field to the selected source frame list reported by the build.

Manual sampling is the preferred workflow when debugging which exact GIF frames cause missing chunks or duplicated chunks.

## Generated Assets And Sprite File Indices

Pokemon sprite entries use 20 files:

| Index | Meaning |
| --- | --- |
| 0 | Front male static sprite |
| 1 | Front female static sprite |
| 2 | Front male rig atlas |
| 3 | Front female rig atlas |
| 4 | Front NCER cell bank |
| 5 | Front NANR per-cell animation |
| 6 | Front NMCR multi-cells |
| 7 | Front NMAR multi-cell animation |
| 8 | Front NCEC/Frost rig-cell metadata |
| 9 | Back male static sprite |
| 10 | Back female static sprite |
| 11 | Back male rig atlas |
| 12 | Back female rig atlas |
| 13 | Back NCER cell bank |
| 14 | Back NANR per-cell animation |
| 15 | Back NMCR multi-cells |
| 16 | Back NMAR multi-cell animation |
| 17 | Back NCEC/Frost rig-cell metadata |
| 18 | Normal palette |
| 19 | Shiny palette |

Compression expectations:

- NANR files (`5`, `14`) are LZ11-compressed.
- NCER (`4`, `13`), NMCR (`6`, `15`), NMAR (`7`, `16`), and NCEC (`8`, `17`) are stored raw.
- Static sprite/rig/palette storage follows the existing project model and writers.

The import UI calls `importPokemonAnimationBundle`, which writes the generated side's animation files into the project. ROM export then includes those edited project files.

## File Format Roles

### Rig Atlas PNG / NCGR-Like Graphics

The rig atlas is a `256x128` RGBA image in the editor. It represents the DS tile graphics that NCER OAM entries point into. It is not enough to replace only the PNG; NCER/NCEC metadata must match the atlas layout.

### NCER

NCER is the cell bank. A cell is a list of OAM rectangles. Each OAM references a tile index in the rig atlas and has local x/y placement.

Flipbook modes use NCER differently:

- Pose Blocks: one NCER cell per full pose.
- Rotated Pose: one NCER cell per full pose, some stored rotated in the atlas and displayed with NANR rotation.
- Macro Blocks: one NCER cell per macro chunk plus transparent cell 0.
- Tile Nodes: one NCER cell per unique 8x8 tile. Diagnostic only.

### NANR

NANR is the per-cell animation timeline.

For full-pose modes:

- One visible display node is animated through `cellIndex` values, one per sampled pose.
- Each frame duration comes from the GIF delay scaled by the speed control.

For macro-block mode:

- The current code generates one NANR sequence per chunk slot.
- Each slot sequence swaps the cell index to the corresponding chunk for the current pose, or transparent cell 0 if that pose has no chunk in that slot.
- This is the area most likely related to missing/duped macro-block parts, because all slots must advance in exact lockstep and must not mix chunks from different source poses.

### NMCR

NMCR defines multi-cell hierarchies, i.e. which animated parts/nodes are visible together.

Hard requirement:

- NMCR must contain two valid multi-cell entries. If only one hierarchy is needed, duplicate it. The game can touch the second entry during battle paths.

Known prior bug:

- A bad NMCR caused duplicated sprites and severe lag. Replacing file 16 alone did not fix the duplication; replacing NMCR restored normal behavior in one probe path. Treat NMCR as highly suspect when in-game duplication appears.

### NMAR

NMAR animates/selects the whole multi-cell. In simple full-pose imports it is usually a single loop with total duration equal to the generated NANR loop duration.

NMAR is not where individual pose chunks are swapped; that currently happens in NANR for macro-block mode.

### NCEC

NCEC is Frost/Pokeweb rig-cell metadata used by the editor for green boxes, rig-cell display, and interaction. It must match the atlas and NCER cells.

In-game behavior depends on NCER/NANR/NMCR/NMAR, not the editor green boxes directly, but stale NCEC makes debugging misleading because the visible boxes no longer describe the actual file data.

## Packing Modes

### Pose Blocks (`mcss-safe`)

Goal: simplest stable flipbook.

- Each unique sampled pose is tightly alpha-bounded.
- Bounds are rounded out to 8x8 tile alignment.
- The whole pose block is copied into the `256x128` atlas.
- One NCER cell represents that whole pose, split into DS OAM rectangles internally.
- NANR swaps the single visible node's `cellIndex`.

Strengths:

- Most stable in game.
- Easiest to reason about.
- Avoids independent chunk timelines.

Weaknesses:

- Large sprites fit very few frames.

### Rotated Pose Blocks

Goal: fit a few more full poses by storing tall/wide poses sideways when that helps atlas packing.

- Similar to Pose Blocks.
- Some poses are stored 90 degrees clockwise in the atlas.
- NANR uses a display rotation to unrotate them at render time.

Known constraint:

- Ground placement must be checked carefully. Incorrect rotated geometry can render the sprite too low.

### Macro Blocks

Goal: fit large sparse poses by splitting one pose into several rectangular chunks.

Current algorithm:

- Starts with the full padded pose bounds.
- Splits chunks along 8px boundaries when a split saves enough tiles or when a chunk is too large/OAM-heavy.
- Maximum chunks per pose: `8`.
- Tries to keep each chunk to about `4` OAM rectangles or less.
- Stores all chunks from all unique poses into the atlas using first-free placement.
- Creates transparent cell 0.
- Creates one NCER cell per macro chunk.
- Creates slot-based NANR sequences: slot 0, slot 1, etc.
- Creates NMCR nodes for each slot.

Known risk:

- This approach relies on "slot 0 from pose N", "slot 1 from pose N", etc. all being displayed together. If sequence/frame selection, durations, NMCR node mapping, or chunk ordering gets out of sync, the renderer can show chunks from different source frames at once, omit chunks for a frame, or duplicate stale chunks.

Current symptom set:

- Browser preview may show missing legs or extra overlaid frame parts.
- In-game may show a frame where a macro chunk is missing for a split second.
- In-game may show atlas-like duplicated body parts if the wrong NCER cell or stale slot is used.
- A large sprite can appear as multiple partial copies if many chunk slots are effectively alive at once or if NMCR/NANR timelines are not synchronized.

Important debugging hypothesis:

- Macro-block mode should probably move away from independent chunk-slot timelines unless proven safe.
- A more robust design may be "fixed maximum chunk slots, but each timeline frame always selects a complete pose group" or "one NMCR multi-cell per pose group and NMAR selects the active group"; see `pokemon-flipbook-rig-generation-guide.md`.

### Tile Nodes (`tile-node-dedup`)

Diagnostic/experimental. It decomposes poses into individual 8x8 animated nodes.

Do not use for normal imports:

- It can create huge node counts.
- It is hard to visually inspect.
- It lags the browser.
- It is too chaotic for production animation authoring.

## Palette Behavior

Single GIF import:

- Builds a 16-color palette from the selected timeline frames.
- Writes that palette to the selected palette kind (`Normal` or `Shiny`).
- Remaps sprite, rig atlas, and animation tiles to that palette.

Paired front/back import:

- Decodes and samples front and back together.
- Builds one palette from both sides' selected timelines.
- Uses that unified palette for both front and back outputs.
- This avoids front/back palette mismatch when both GIFs visibly use the same colors but quantize differently if imported separately.

Risks:

- Palette rounding can merge subtle colors.
- Importing a front GIF with a back GIF's palette, or vice versa, can create expected color artifacts even when geometry is fine.

## Validation Already In Code

The builder reports and/or enforces:

- `sourceFrameCount`
- `normalizedFrameCount`
- `selectedSourceFrames`
- `timelineFrames`
- `uniquePoseCount`
- `uniqueTileCount`
- `atlasOccupancyPercent`
- `packingMode`
- `maxOamsPerPose`
- loop plan details for `Loop Rest`
- `groundValidation`
- `visibilityValidation`
- warnings

Hard failures:

- GIF contains no frames.
- Any generated timeline frame is fully invisible.
- Ground clamp fails.
- Packing cannot fit within `512` atlas tiles and OAM limits after adaptive thinning.

Limitations:

- Visibility validation currently checks whether a packed timeline frame has visible content, not whether every macro chunk belonging to that source pose is visible in the browser/game at every moment.
- Macro-block validation should be expanded to assert that all chunks for the current source pose are selected together on every displayed tick.

## Useful Debugging Scripts

- `scripts/inspect-gif-flipbook.ts`
  - Builds a flipbook from one or more GIFs and prints report JSON.
  - Supports `--side`, `--strategy`, `--packing-mode`, `--source-percent`, `--max-frames`, `--max-tiles`, `--duration-scale`.

- `scripts/compare-pokemon-sprite-entry.ts`
  - Compares sprite-entry file metadata across ROMs/project states.
  - Useful for checking file lengths, signatures, compression, and high-level parser summaries.

- `scripts/inspect-pokemon-nmcr.ts`
  - Focused NMCR inspection helper.

- `scripts/replace-pokemon-sprite-files-from-rom.ts`
  - Useful for one-by-one vanilla file replacement probes.

- `scripts/apply-gif-flipbook-to-pokemon.ts`
  - Scripted GIF-to-Pokemon import path outside the browser UI.

Example inspection:

```bash
npx vite-node scripts/inspect-gif-flipbook.ts \
  --side back \
  --strategy loop-rest \
  --packing-mode macro-blocks \
  /path/to/Docs/grim-back.gif
```

## Macro-Block Debugging Checklist

When macro blocks show missing or duplicated parts:

1. Reproduce with manual frame numbers and the smallest failing frame set.
2. Record:
   - source GIF path
   - side
   - palette kind
   - packing mode
   - sampling strategy or manual frame list
   - speed
   - timeline loop settings
3. Inspect the report:
   - `selectedSourceFrames`
   - `timelineFrames`
   - `uniquePoseCount`
   - `uniqueTileCount`
   - `maxOamsPerPose`
   - warnings
4. Inspect generated NCER:
   - Cell 0 should be transparent for macro-block mode.
   - Every macro chunk cell should have at least one OAM.
   - OAM `characterName` should point inside the `256x128` atlas tile range.
5. Inspect generated NANR:
   - Macro slot sequences should have the same frame count.
   - Durations should match per timeline tick across every slot sequence.
   - For a given timeline frame, all non-transparent slot cell indices should belong to the same source pose.
6. Inspect generated NMCR:
   - There must be two valid multi-cell entries.
   - Both entries should have the expected slot node count.
   - Node `sequenceNumber` and `cellAnimationIndex` should be in range.
7. Inspect generated NMAR:
   - Total duration should match the generated loop duration.
   - It should not introduce unexpected multi-cell switching unless that is the intended design.
8. Compare browser preview and in-game:
   - If browser and game both fail, suspect build model/timeline grouping.
   - If browser passes but game fails, suspect binary writer assumptions, NMCR/NMAR semantics, or DS renderer constraints.
9. Perform file replacement probes:
   - Replace one generated file at a time with vanilla NCER/NANR/NMCR/NMAR/NCEC to isolate which file class triggers duplication/crash.
   - Prior probes showed NMCR/NMAR-like files can be decisive; do not assume the visible atlas/cell sizes are the root cause.

## Known Lessons From Recent Debugging

- Large full-pose cells alone are not the only cause of duplication. A single-cell Dracovish bob still duplicated in one probe ROM, so the issue was not simply "large OAM rectangles repeat."
- Replacing vanilla files one by one narrowed a duplication/lag probe to the multi-cell side of the animation files, especially NMCR/NMAR behavior.
- A bad NMCR can look acceptable in the editor but break battle startup or cause duplicated sprites in-game.
- Pose Blocks have been the most stable in-game path so far.
- Macro Blocks can save atlas space, but they introduce a stronger invariant: all chunks for one source frame must be grouped and displayed in lockstep.
- Missing macro chunks can be caused by a valid-looking transparent fallback cell if a pose has fewer chunks than another pose and slot timelines drift or slot ordering changes.
- Browser preview must not be trusted as complete proof. It uses the project parser/render model; the DS battle renderer may touch a second NMCR entry or interpret multi-cell animation details differently.

## Suggested Next Deep-Dive Direction

For macro-block mode, build a probe that emits a machine-readable manifest mapping:

```json
{
  "timelineIndex": 0,
  "sourceFrame": 12,
  "slotCells": [4, 5, 6],
  "chunks": [
    { "slot": 0, "cellIndex": 4, "sourceBounds": [0, 40, 64, 32], "atlasBounds": [0, 0, 64, 32] },
    { "slot": 1, "cellIndex": 5, "sourceBounds": [16, 0, 48, 40], "atlasBounds": [64, 0, 48, 40] },
    { "slot": 2, "cellIndex": 6, "sourceBounds": [24, 72, 40, 24], "atlasBounds": [112, 0, 40, 24] }
  ]
}
```

Then validate after writing and parsing NCER/NANR/NMCR/NMAR back from bytes:

- Every timeline tick reconstructs exactly one source frame.
- No tick references a chunk from a different source frame.
- Every non-empty chunk in the original pose appears in the parsed frame.
- All slot sequences have identical duration partitions.
- The two NMCR records are identical or intentionally equivalent.

If this invariant cannot be made robust with slot timelines, switch macro-block mode to a group-select design where a displayed frame is selected as a whole unit rather than assembled from independently animated slot sequences.
