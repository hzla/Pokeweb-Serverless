# Pokemon Rig Generation Guide

Use this guide in future chats when creating Gen 5-style Pokemon rig atlases from GIFs or static sprites.

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

## Preferred Rig Workflow

1. Run the helper pipeline first:

```bash
npm run pokemonanim:helper -- analyze --gif /path/to/source.gif --out work/<name> --name <name>
npm run pokemonanim:helper -- palette --bundle work/<name>
npm run pokemonanim:helper -- motion --bundle work/<name>
```

2. Inspect these generated files before asking questions:

- `front_sprite.png`
- `frame_samples_x4.png` or a contact sheet if present
- `motion_report.json`
- `questions.md`
- `palette_report.json`

3. Ask user questions using body-part language:

- Which parts should be independent cells?
- Which parts are static?
- Which parts should rotate, translate, or scale?
- Which later-frame pixels should be recovered into the rig atlas?
- Which weird effects should be ignored?
- What z-order should overlapping parts use?
- Are any face/mouth/eye-looking markings actually painted-on cloth, armor, shell, or another surface that should move with the parent part instead of animating as anatomy?

4. Produce two rig planning files:

- `<pokemon>_front_rig_plan.json`: human-readable part plan, pivots, z-order, notes.
- `<pokemon>_front_rig_cells.json`: importable Pokeweb cell metadata with `cellX`, `cellY`, `width`, `height`, `spriteX`, `spriteY`, `pivot`, and `z`.

5. Produce DS-palette-safe image assets:

- `<pokemon>_palette_ds.png`
- `<pokemon>_front_rig_256x128_ds.png`
- `<pokemon>_front_rig_preview_ds.png`

Use the DS-rounded palette image when importing the palette. Use the DS-rounded rig image when importing/replacing the rig PNG.

6. Validate frame-0 parity before building the final browser bundle:

```bash
npm run pokemonanim:helper -- validate-frame0 --bundle work/<name> --cells <name>_front_rig_cells.json --plan <name>_front_animation_keyframes.json --rig <name>_front_rig_256x128_ds.png --front-sprite front_sprite.png --out frame0_validation
```

Review `frame0_validation/frame0_diff.png` and `frame0_validation/frame0_validation_report.json`. Red pixels mean the rig reconstruction is missing front-sprite art, blue pixels mean extra/generated art, and yellow pixels mean color mismatches.

## Rig Atlas Rules

- Atlas size is `256x128`.
- Align every part's `cellX` and `cellY` to 8px tile boundaries.
- Prefer part dimensions rounded up to 8px boundaries.
- Keep transparent padding around rotating parts when the pivot is not visually centered.
- Record the intended pivot in local part coordinates.
- Keep z-order explicit. Do not rely on file order alone.
- Put static core/body pieces first conceptually, but sort final NMCR nodes by z-order.
- Use separate cells for clear hinges: ears, tails, wings, cloth tips, open mouths, blinking eyes, feet.
- Use scale/translation for broad body bounce or squash/stretch when exact silhouette changes are not critical.
- Use alternate cells only when the sprite changes shape in a way rotation/scale cannot explain.
- Before building the import bundle, scrub every important cell in single-part view. Check that all outline pixels for a moving object are inside that same moving object cell, especially tails, wings, ears, claws, cloth edges, and mouth pieces.
- Avoid duplicate seam pixels. If two neighboring cells both contain the same black outline or highlight, the preview can look smeared once the cells rotate or scale independently.
- Check all-frame bounds after keyframes are written. The bottom of the lowest generated frame should stay above the Diglett baseline; the top should leave enough room for the battle camera/canvas crop.
- Prefer solid, complete art regions inside each rig cell. Transparent padding around a part is fine, but transparent holes or disconnected islands inside a part are warning signs unless they are deliberate negative space in the Pokemon design.
- Do not let one cell contain protruding border pixels from another moving part. If a protrusion reads as a limb, ear, horn, tail, wing tip, claw, cloth flap, or antenna, make it a separate rig part unless it is definitely moving in tandem with the parent region.
- When extracting from GIF frames, redraw or fill hidden interior pixels where needed so each part can rotate/scale as a coherent piece. Do not simply preserve the exact sparse visible mask if that mask only worked because another part covered it in the source frame.
- Keyframe 0 should reconstruct the static front sprite as closely as possible. If the validator reports missing border pixels, assign those pixels to the correct moving cell before tuning animation. If the rig is intentionally shifted for battle placement, shift the exported front sprite by the same amount before validating.
- Before packaging a rig atlas, assert that all empty/background pixels have alpha `< 128`. Do not rely on magenta, black, checkerboard, or any other keyed color to mean transparent unless the file writer converts it to real alpha first.
- Frame-0 validation is not permission to duplicate art. If the validator shows missing pixels, fix ownership by moving those pixels into the correct small part, adding a small missing part, or redrawing a local seam. Do not paste a large front-sprite rectangle over the rig to hide the difference.
- Every visible piece in the rig atlas should either be referenced by a cell or deliberately documented as spare art. Delete stale experiments and unused copied sprites before making an import bundle; leftover art confuses manual inspection and can accidentally become part of a future cell.

## Palette Pitfalls

- Do not trust visually identical RGB values. Gen 5 palette import validates exact RGB values after DS BGR555 rounding.
- If a PNG import fails with a pixel-not-in-palette error, regenerate the rig PNG using the DS-rounded palette, then import that palette first.
- Color 0 is transparency. Keep the transparent color black unless there is a reason not to.
- Source GIFs that are already 16-color indexed can still need DS rounding.

## Question Style

Bad:

- "What should candidate region 2 become?"
- "Sparse/intermittent region needs a decision."

Good:

- "The lower-left yellow jagged cloth appears and disappears. Should it be a separate flap that scales outward, or should we ignore the disappearing pixels?"
- "The brown tail is mostly one connected piece. Should it rotate around the base behind the body?"
- "The upper body squashes on downbeat. Should we approximate with scale, or draw alternate body cells?"

## Files To Preserve

Keep the following files in the work bundle after a rigging pass:

- `*_rig_plan.json`
- `*_rig_cells.json`
- `*_palette_ds.png`
- `*_front_rig_256x128_ds.png`
- `*_front_rig_preview_ds.png`
- Any notes about ignored effects or deferred alternate cells

These become the source of truth for animation-file generation.
