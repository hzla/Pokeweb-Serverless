# Pokemon Animation File Generation Guide

Use this guide after a rig atlas and rig-cell plan exist. It covers generating NCER/NANR/NMCR/NMAR/NCEC files for Pokeweb import.

## Current Command

Generate an importable front animation bundle:

```bash
npm run pokemonanim:helper -- build-animation --bundle work/<name> --side front --plan <plan-with-keyframes>.json --loop-duration <ticks> --out work/<name>/generated-keyed
```

The output package is:

```text
work/<name>/generated-keyed/front_animation.pkanimbundle
```

For one-step browser import, package it into a `.pkmonspritebundle` with `build-custom-bundle`, then import it from the sprite editor sidebar `Bundle` drop zone.

## Required Inputs

- A rig-cell JSON file, usually `*_front_rig_cells.json`.
- A rig plan JSON file, usually `*_front_rig_plan.json`.
- Optional keyframe plan JSON with `frames` on each part.
- Matching palette and rig image already imported into the sprite files.

The bundle import writes:

- File 4 or 13: NCER cell bank.
- File 5 or 14: NANR per-part animation.
- File 6 or 15: NMCR multi-cell hierarchy.
- File 7 or 16: NMAR whole-multi-cell animation.
- File 8 or 17: NCEC/Frost-style rig-cell metadata.

NCER/NANR/NMCR/NMAR are LZ11-compressed in the bundle. NCEC rig-cell metadata is raw.

## Mimikyu Lessons

- The first static bundle was importable but not meaningfully animated because every part had one SRT frame. For real preview value, create a keyed plan with repeated frames per part.
- Use a shared loop length. Mimikyu had 63 GIF frames at 100ms each, so a first-pass Gen 5 loop used 9 keyframes of 7 ticks each.
- Keep every part as SRT even if it only translates in V1. This lets the sprite editor rotate/scale it later without converting sequence types.
- NMCR should contain one multi-cell with all nodes sorted by z-order.
- NMAR can be a simple looping sequence selecting multi-cell 0 for the total loop duration.
- Pivots matter before animation starts. If rotation looks wrong, inspect NCER padded bounds and local pivot assumptions, not only NANR keyframes.
- Battle placement matters too. Mimikyu initially imported below the expected battle baseline; use Diglett as the lowest allowed visual reference and shift generated rig-cell `spriteY` values upward if any animation frame sits lower.
- Face-opening poses can split apart if the upper head moves more than the lower face/body. Keep mouth, head, and connected face pieces on compatible `y` motion unless the open-mouth art is an explicit alternate cell designed to cover the seam.
- Floating black pixels usually mean an outline was assigned to the wrong cell. In Mimikyu's first pass, the right yellow cloth cell kept tail-border pixels, so the tail rotated away and left those pixels behind.
- Missing borders on frame 0 usually mean no generated rig cell owns those pixels. Validate the reconstructed first animation frame against the generated front sprite before accepting the bundle.

## First-Pass Keyframe Strategy

For a new rig, create a conservative keyed plan before trying to match the GIF exactly:

- Body: translate up/down and apply slight `xScale/yScale` squash on the downbeat.
- Head: follow body with slightly smaller translation and mild rotation.
- Ears/wings/tails/cloth: rotate around their recorded pivot.
- Lower cloth or fringes: use tiny x translation plus scale to imply extension.
- Static parts: still provide frames matching loop length if they should bob with the body; otherwise use one frame.
- Ignored effects: leave them out explicitly in the plan notes.

Example frame shape:

```json
{
  "duration": 7,
  "cellIndex": 3,
  "x": 0,
  "y": -1,
  "rotation": 8,
  "xScale": 1,
  "yScale": 1
}
```

## Preview Checklist

After generating and importing the bundle:

- Confirm the rig image is visible in Rig Cells.
- Confirm green cell boxes line up with actual art.
- Confirm Animation preview shows all parts, not just one part.
- Scrub the frame slider before pressing Play.
- Test `Visible Part` for a few important parts.
- If a part rotates around the wrong point, fix its pivot/cell padding and regenerate NCER/NMCR/NCEC.
- If a part moves correctly but the timing feels wrong, edit NANR keyframes or use the animation editor.
- If the sprite looks correct in the editor, export ROM and reload to test persistence.
- If a frame looks blurry, watery, or double-exposed, inspect overlapping neighboring cells at that frame. Reduce duplicate pixels, damp one part's motion, or move seam pixels into exactly one owner cell.
- If a mouth/open-face frame looks split, compare head, mouth, and body `y` keyframes first. Large opposing translations are usually the cause.
- If the bottom of the custom Pokemon falls lower than Diglett's visible bottom edge, fix the rig-cell base placement before tuning individual keyframes.
- Run `validate-frame0` after rig-cell placement and before final bundling. Red diff pixels are missing source art, blue pixels are extra owned pixels, and yellow pixels are palette/color mismatches.

## Common Failure Modes

- Empty rig preview: rig PNG was not imported, or palette/rig image did not match.
- Pixel not in palette: regenerate DS-rounded palette and rig PNG; import the palette first.
- Green boxes do not match art: NCEC rig cells were not imported or were generated from stale atlas coordinates.
- Parts rotate from their visual center instead of a hinge: pivot padding was wrong in NCER generation.
- Animation imports but does not move: the plan had only one frame per part, or all keyframes used identity transforms.
- Parts draw in front/behind incorrectly: update `z` in the rig plan and regenerate NMCR.

## What To Ask The User During Iteration

Ask for concrete visual corrections:

- "Should the left ear tip rotate more or less?"
- "Should the brown tail swing behind the body or peek in front?"
- "Is the body bounce too soft, too high, or too slow?"
- "Should the lower-left yellow cloth flap stretch outward or rotate?"

Avoid vague prompts like:

- "Is the animation right?"
- "Which frame is wrong?"

Ask for a part name, frame number if possible, and the desired direction of correction.
