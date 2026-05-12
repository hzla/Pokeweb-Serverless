# Pokemon Rig Case Studies

Use this file for historical lessons from specific rigging attempts. Keep the main generation guide short and operational; move long postmortems here.

## Mimikyu Lessons

The Mimikyu rig took extra time because several separate problems were easy to confuse:

- The generated rig PNG, palette PNG, and rig-cell boxes are three different assets. Importing only the rig image is not enough; NCER/NCEC metadata must also match the atlas layout.
- The first rig PNG used source RGB colors that looked right visually but did not match the DS-rounded BGR555 palette values. This caused import errors such as `Pixel 7,0 is not in the selected 16-color palette`.
- Motion-analysis regions were too generic at first. Labels like `Part 0` and `middle pale-yellow region` slowed the user down. Use art labels like `brown tail`, `left ear tip`, or `yellow jagged cloth flap`.
- The black arm appendage appeared in later frames but was intentionally ignored. Always record ignored/deferred elements explicitly so they do not reappear as mystery missing pixels later.
- Some apparent motion was deformation, not rigid motion. Mimikyu's body squash was better approximated with scale and translation than by over-splitting the body.
- The lower cloth needed semantic splitting: left animated flap, center static cloth, right animated flap. Pure connected-component output did not discover this cleanly.
- The first Mimikyu insert sat too low in the battle preview. Use Diglett's in-game ground placement as the absolute lower bound reference: no generated custom animation should extend below Diglett's visible bottom edge. Shift the generated rig-cell `spriteY` values upward before bundling if any frame drops below that baseline.
- The watery or blurry look on Mimikyu's upper head and ears came from rig-authoring choices, not the Nitro writers: adjacent cells reused overlapping outline/highlight pixels and then moved at slightly different transforms. Keep cells mostly mutually exclusive unless an overlap is deliberately hidden by z-order.
- Tail/cloth separation was another source of visual noise. Cell 9, the right yellow cloth edge, accidentally contained black outline pixels that belonged to the brown tail. When the tail rotated, those pixels stayed behind and looked like floating black debris.
- Existing official rigs usually use solidly filled parts, not sparse cutouts with holes inside the cell art. Mimikyu cells 0, 7, 8, and 9 were too mask-like; future generated cells should prefer complete filled regions so seams, outlines, and shadows stay coherent during transforms.
- The brown tail also lost some source outline ownership in the generated rig. This happened because the atlas was made from cropped part masks without validating the reconstructed keyframe-0 image against `front_sprite.png`. Frame 0 must be treated as a required parity check, not just a visual preview.
- Mimikyu's face should not be treated like a biological mouth. The face is a drawing on cloth, so apparent mouth-region motion should usually be handled as head/cloth tilt, squash, or whole-face movement unless the user explicitly asks for a mouth-like alternate cell.
- Transparent rig/background pixels must be true alpha transparency, not a visible keyed color such as magenta. Pokeweb's bundle import remaps every opaque PNG pixel into the selected 16-color palette, so an opaque placeholder background becomes real sprite data.
- Do not satisfy frame-0 parity by copying large chunks of the full front sprite into one rig cell. The whole point of the rig is that frame 0 is assembled from smaller semantic parts; wholesale sprite decals create duplicated ears/limbs/outlines and cause motion-blur-like overlap when parts move.
