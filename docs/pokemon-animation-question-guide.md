# Human-Assisted Pokemon Animation Question Guide

Use this guide when turning GIF analysis reports into questions for the user.

## Region Naming

Prefer identifiable art language over generic motion-analysis language.

Good examples:
- "upper-right brown tail region"
- "lower-left yellow waving jagged cloth"
- "left ear tip"
- "face shadow under the head"

Avoid relying only on:
- "candidate region"
- "Part 0"
- "the sparse component"

It is fine to include the part number and bounds as secondary context, but the primary wording should help the user find the pixels on the sprite.

## Useful Answers

When asking which regions should become rig cells, ask for:
- body-part name
- whether it should be one cell or split into smaller cells
- pivot point for rotation
- likely z-order
- whether missing/new pixels should be recovered from later frames, approximated, or ignored

## Deformation Advice

Recommend the least complex option that preserves the read:
- Use whole-part x/y translation for simple bounce.
- Add scale only for broad squash/stretch where exact pixels are not critical.
- Split into more cells when bending needs clear hinges, like ears, tails, wings, or cloth tips.
- Draw alternate cells when the silhouette changes in a way rotation/scale cannot explain.

For Pokemon battle sprites, mild squash/stretch can usually be approximated with scale and translation. Strong silhouette changes, occlusion, blinking, mouths, feet, or cloth tips usually need separate cells or alternate cells.
