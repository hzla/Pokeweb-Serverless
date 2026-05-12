# Pokemon Rig Generation Guide

Use this guide when creating Gen 5-style Pokemon rig atlases and animation bundles. Keep this file operational. Longer examples belong in `pokemon-rig-case-studies.md`; body-shape interpretation belongs in `pokemon-shape-rig-strategy-guide.md`; whole-pose flipbook rigs belong in `pokemon-flipbook-rig-generation-guide.md`.

## Non-Negotiable Rules

- No wholesale sprite decals. Do not copy a large recognizable chunk of the full sprite into a hidden or duplicate cell to satisfy frame-0 parity, close gaps, or make the preview look correct.
- Underpaint must be small, local, and boring. It may cover only a joint socket, stump, or bridge area; it must not contain complete eyes, face, ears, feet, hands, tail, shell, torso, or other recognizable anatomy.
- Frame 0 must be assembled from visible semantic cells. Underpaint exists only to prevent transformed-frame gaps, not to make frame 0 pass validation.
- Do not visually bisect central connected body mass. Head/neck, shell/body, torso/belly, cloak/body, and upper/lower body splits must either move together, overlap safely, or be merged.
- Validate both frame 0 and transformed frames. A rig that passes frame 0 but opens background gaps during motion is invalid.
- If a clean semantic split cannot avoid separation artifacts, switch to the flipbook workflow instead of adding large duplicate safety art.
- Prefer semantic body parts over arbitrary rectangles: head, torso, shell, arm, leg, foot, ear, horn, tail, wing, fin, cloak, base, weapon, flame.
- Avoid sparse mask-like cells. Moving cells should be solid, complete local art with their own outlines and hidden interior filled enough to rotate cleanly.
- Palette pixels must be DS-rounded BGR555-safe, and transparent pixels must use real alpha transparency.
- Consult `pokemon-shape-rig-strategy-guide.md` before interpreting broad or vague motion regions.

## Preferred Workflow

1. Run the helper pipeline:

```bash
npm run pokemonanim:helper -- analyze --gif /path/to/source.gif --out work/<name> --name <name>
npm run pokemonanim:helper -- palette --bundle work/<name>
npm run pokemonanim:helper -- motion --bundle work/<name>
```

2. Inspect `front_sprite.png`, contact sheets or frame samples, `motion_report.json`, `questions.md`, and `palette_report.json`.
3. Look up the Pokemon's shape family in `pokemon-shape-rig-strategy-guide.md` and translate vague motion regions into likely body parts.
4. Choose a small semantic part set, usually 3-8 cells per side.
5. Produce `<pokemon>_front_rig_plan.json` and `<pokemon>_front_rig_cells.json`.
6. Produce DS-palette-safe assets: `<pokemon>_palette_ds.png`, `<pokemon>_front_rig_256x128_ds.png`, and `<pokemon>_front_rig_preview_ds.png`.
7. Build the animation bundle and validate frame 0:

```bash
npm run pokemonanim:helper -- validate-frame0 --bundle work/<name> --cells <name>_front_rig_cells.json --plan <name>_front_animation_keyframes.json --rig <name>_front_rig_256x128_ds.png --front-sprite front_sprite.png --out frame0_validation
```

8. Render or preview several transformed frames at maximum planned motion. Fix visible body gaps, duplicated anatomy, floating outlines, and smeared overlaps before inserting into the ROM.

## Cell Design Rules

- Atlas size is `256x128`.
- Align `cellX` and `cellY` to 8px tile boundaries, and round dimensions up to 8px.
- Keep transparent padding around rotating parts when the pivot is not visually centered.
- Record pivots in local part coordinates and keep z-order explicit.
- Put core/body under moving appendages in z-order; do not rely on file order.
- Use separate cells for clear hinges: ears, tails, wings, cloth tips, open mouths, blinking eyes, feet, claws, weapons.
- Use scale/translation for broad body bounce or squash/stretch. Do not over-split deformation into many rigid slices.
- Use alternate cells only when shape changes cannot be approximated with rotation/scale.
- Do not let a moving cell contain protruding border pixels that belong to another moving part.
- Every visible atlas element should either be referenced by a cell or documented as deliberate spare art.

## Joint And Underpaint Rules

- Cuts may be geometric, but joints cannot be transparent.
- Moving protrusions should include a short collar/root overlap, and the parent should retain a small socket fill behind the joint.
- Duplicate interior/fill pixels are acceptable at a joint; duplicated high-contrast outlines are risky unless one copy is always hidden.
- Underpaint must be labeled `underpaint`, `socket-fill`, or `joint-bridge`, and its plan note must name the exact joint it protects.
- Reject underpaint if it looks recognizable by itself as a full semantic part or includes unrelated anatomy.
- Do not create a hidden safety copy of the central body. If many joints need coverage, use several tiny local patches, reduce motion, or merge cells.
- For head/body splits, give the body a small neck/upper-body stump and let the head overlap downward. Keep head bob small unless the bridge is robust.
- For ears, horns, hair tufts, shell spikes, tails, arms, wings, and fins, leave socket/base fill on the parent cell.

## Validation Checklist

- Frame-0 reconstruction has no missing, extra, or mismatched pixels except documented intentional differences.
- No transformed frame shows background through a continuous body mass.
- No hidden or visible cell is a large recognizable duplicate of the full sprite or central anatomy.
- Single-cell inspection confirms moving parts own their outlines and do not carry border pixels from neighboring parts.
- Underpaint cells are small local patches and visually boring alone.
- Rig bounds stay within battle framing; do not let the lowest generated frame drop below the Diglett baseline.
- Empty/background atlas pixels have alpha `< 128`; no opaque magenta/checker/black key backgrounds.
- Palette import uses DS-rounded colors, with color 0 reserved for transparency.

## Asking Questions

When human input is allowed, ask in body-part language:

- Which visible body parts should become independent cells?
- Which parts should stay static or move together?
- Which parts should rotate, translate, or scale?
- Which later-frame pixels should be recovered into the atlas, approximated, or ignored?
- Are any face/mouth/eye markings painted on cloth, shell, armor, or another surface and therefore should move with that surface?

## Files To Preserve

- `*_rig_plan.json`
- `*_rig_cells.json`
- `*_palette_ds.png`
- `*_front_rig_256x128_ds.png`
- `*_front_rig_preview_ds.png`
- Motion previews, validation reports, and notes about ignored or deferred effects
