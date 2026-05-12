# Pokemon Flipbook Rig Generation Guide

Use this guide when a Pokemon is better represented as a short flipbook of whole-pose cells than as a semantic skeletal rig. This is useful when part splitting creates unacceptable gaps, duplicated outlines, or body separation.

## When To Use

- Use flipbook rigs for small sprites with strong whole-body motion, squash/stretch, jumps, or body shapes that do not separate cleanly into rigid parts.
- Prefer a semantic rig when independent appendage motion is important and the body can be split without visible gaps.
- Treat this as a visual-fidelity tradeoff: fewer unique poses, but no head/body/limb separation artifacts.

## Hard Rules

- The Pokemon must be visible on every animation frame. No generated timeline frame may map to an empty cell or hidden node.
- Use one always-visible display node and animate that node's `cellIndex` through whole-pose NCER cells.
- If a pose is split into macro chunks for atlas packing, keep every chunk cell below the vanilla-style OAM budget. Large whole-pose cells may preview correctly in the browser but drop lower chunks in-game.
- When chunks must be separate nodes, group by source frame: create one NMCR multi-cell per unique sampled pose, put only that pose's chunks in that multi-cell, and let NMAR select the current pose group. Do not animate chunk slots as independent parallel timelines; that can display cells from different source frames at the same moment.
- Do not create many full-pose nodes and hide inactive poses with `xScale=0` or `yScale=0`; this can produce disappearing frames in-game.
- Do not use end-weighted sampling by default. Preserve a loopable resting idle first, then append the later special action.
- Keep the atlas `256x128`; fit more poses by tile-deduplicating shared 8x8 graphics across whole-pose cells.
- Every whole-pose cell must contain explicit OAM entries and at least one visible tile.
- Generated NMCR files must provide two valid multi-cell entries, even when both entries reference the same always-visible display node. Vanilla battle code may touch the second multi-cell during send-out/idle paths; a one-entry NMCR can make the game read nearby bytes as extra nodes and render duplicated atlas chunks.
- Bound each source frame as tightly as possible without losing visible Pokemon pixels, then round the bounds outward to 8px tile alignment.
- Validate generated cell count, tile count, non-empty cells, animation duration, ROM load, and Pokedex names before accepting the result.

## Loop-Rest Timeline Strategy

Most imported GIFs contain a repeating idle for the first majority of the clip, followed by a short flourish. Build the flipbook timeline around that structure.

1. Load the normalized GIF frames and frame delays.
2. Compare frame 0 against candidate frames in the early/middle region.
3. Prefer searching from about 25% through 60% of the source GIF. If no good loop closure is found, expanding the search to 75% is acceptable.
4. Choose the candidate that most closely matches frame 0 as the resting loop endpoint.
5. Build the rest loop from `frame 0` through that endpoint.
6. Repeat the rest loop 2 or 3 times so the animation behaves like a longer in-game idle.
7. Append the remaining source frames after the loop endpoint as the special action or flourish.
8. Do not drop frames that contain unique late action unless the atlas tile budget forces a documented reduction.

For a 100-frame GIF, a typical search window is around frames 25-75, with a preference for a closure near or before frame 60.

## Tile-Deduplicated Packing

- Convert every packed tile to the target 16-color DS palette before hashing it.
- Hash each visible 8x8 tile after palette rounding; store only one copy of identical tiles in the rig atlas.
- Build each whole-pose NCER cell from OAM entries that reference the shared tile dictionary.
- Position each OAM so the pose reconstructs in the original 96x96 battle-frame coordinate space.
- Skip fully transparent tiles, but reject any pose that becomes fully transparent.
- Stop generation if the dictionary exceeds the available `256x128` tile budget.

## Validation Checklist

- `visibilityValidation.invisibleFrameCount` is `0`.
- Every NCER whole-pose cell has at least one OAM.
- The preview sheet shows Froakie/Pokemon present in every sampled timeline frame.
- The generated ROM loads through the Pokeweb project loader.
- Static front/back sprites and palettes are preserved.
- Pokedex names for touched species IDs still match the intended names.
- The report records loop endpoint, loop count, timeline source frames, unique pose count, unique tile count, atlas occupancy, warnings, and inserted files.

## Visual Risks

- Tile-dedup flipbooks may look choppier than skeletal rigs because only a limited number of whole poses fit.
- Palette rounding can merge near colors and alter subtle antialiasing.
- A poor loop endpoint can create a visible idle snap. If that happens, review the selected endpoint and choose a closer frame manually or narrow the search window.
- If the late special action consumes too many unique tiles, reduce duplicate near-identical frames before removing the action's most distinctive poses.
