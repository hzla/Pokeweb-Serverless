# SPA Editing Reference For Move Animation Workflows

This document captures lessons from the custom Mega Evolution animation work that should generalize to future Gen 5 move animation and SPA particle editing. It is intended for future agents editing move animation scripts, cloning donor particle archives, or importing custom textures through the Pokeweb SPA editor.

## Core Rule

Visible animation sequencing should live in the move animation script VM whenever possible. C/C++ hooks may choose when to start an animation, route battle state, or perform gameplay state changes, but visual effects such as fades, particles, screen shakes, sounds, waits, and reveal timing should be driven through the battle/move animation VM commands.

Reasons:

- VM commands already synchronize with battle animation timing.
- C-side visual hacks can desynchronize from waits or crash if they re-enter client animation state at the wrong time.
- VM-scripted effects are easier to preview, copy, diff, and reuse.

## IDs: Move ID, Animation Member, SPA ID

Do not assume a move ID equals its animation member. They are often different.

Before copying a donor:

1. Look up the move ID.
2. Resolve the actual move animation member/file used by that move.
3. Decompile that animation member and list its referenced SPA IDs.
4. Record donor move ID, animation member ID, SPA IDs, resource IDs, texture IDs, and any background/sound commands you copied.

This matters because using the wrong animation member can silently copy the wrong move, as happened during donor selection for SolarBeam, Rapid Spin, and Recover.

## Recommended Donor SPA Workflow

1. Clone or append donor SPA files instead of modifying the donor in place.
2. Copy only the resource(s) and texture(s) needed for the new effect.
3. Keep the original donor files around for comparison.
4. Rename or document new SPA IDs and resource roles in a manifest or notes.
5. Repoint the move animation script with `LoadSPA` and `Emit*` commands.
6. Preview one visual layer at a time before combining layers.
7. Test in emulator after every meaningful reintroduction.

When building complex effects, reintroduce components in small stages:

- Start with a known safe donor animation.
- Add one cloned SPA resource.
- Add one texture swap.
- Add one timing/fade/sound command group.
- Build and emulator-test before adding the next layer.

This incremental workflow made it possible to isolate crashy fade/reveal timing and particle data issues in the Mega Evolution animation.

## Donor Particle Scrub Checklist

When a prompt says "use particle X from move Y, but in color/size/style Z", do not only replace the texture or base color. Donor resources often carry animation curves and behavior flags that continue to affect the result.

Review and intentionally keep, remove, or overwrite these fields.

### Main Resource Fields

- `textureIndex`: make sure the resource references the intended texture after adding/removing textures.
- `drawType`: billboard, directional billboard, polygon, and directional polygon render differently.
- `emissionType`: point, circle, sphere, cylinder, and hemisphere emitters create very different spreads.
- `emissionAxis` and `axis`: control orientation for circular/cylindrical emitters and directional motion.
- `emissionCount` and `emissionIntervalFrames`: donor density may be too heavy after scaling up.
- `startDelayFrames`, `emitterLifeFrames`, `particleLifeFrames`: donor timing may make effects appear too early, too late, or persist too long.
- `radius` and `length`: donor spawn volume can be too small or too wide for the new effect.
- `initVelPosAmplifier` and `initVelAxisAmplifier`: donor burst direction/speed can overpower the new placement.
- `baseScale` and `aspectRatio`: donor size may be baked here even when script scale changes are used.
- `baseAlpha`: donor opacity can make imported textures look washed out or invisible.
- `color`: donor tint multiplies the texture and can shift colors.
- `airResistance`: donor damping affects how particles slow down over time.
- `hasRotation`, `randomInitAngle`, `minRotation`, `maxRotation`, `initAngle`: donor spin may be unwanted.
- `variance.baseScale`, `variance.lifeTime`, `variance.initVel`: donor randomness can make a precise effect flicker or wobble.
- `loopFrames` and `randomizeLoopedAnim`: donor loop behavior can desynchronize texture or scale animation.
- `followEmitter`: determines whether particles move with the emitter or leave trails behind.
- `hideParent`: donor may only render child particles.
- `drawChildFirst`: affects parent/child layering.
- `textureTileCountS`, `textureTileCountT`, `flipTextureS`, `flipTextureT`: donor texture repeat/flip can make custom textures appear duplicated or mirrored.
- `polygonX`, `polygonY`, `polygonRotAxis`, `polygonReferencePlane`, `offsetPos`, `cameraOffset`, `dpolCenter`: especially important for pane, slash, ring, and beam particles.

### Optional Animation Curves

These are the most common source of surprising donor leakage.

- `scaleAnim`: scrub when the new particle should keep a constant size or when script-side scale should control growth.
- `colorAnim`: scrub when recoloring a donor. A leftover color curve can darken, tint, or shift the imported color over time.
- `alphaAnim`: scrub when opacity should be stable. A donor alpha curve can cause flicker, early disappearance, or unexpected fade timing.
- `texAnim`: scrub or update when the donor cycles through multiple texture frames. Make sure every frame references the intended texture IDs.

Mega animation lesson: the pink sphere appeared to darken, turn orange, and flicker because donor color/alpha/scale animation behavior was still active. Replacing the texture alone was not enough; the donor animation curves had to be removed or overwritten.

### Child Resource Fields

If the donor uses child particles, decide whether the child system is part of the desired effect. If not, remove it. If yes, scrub it separately.

Watch:

- Child `textureIndex`
- Child `drawType`
- Child `color` and `useChildColor`
- Child `emissionCount`, `emissionDelay`, `emissionIntervalFrames`
- Child `lifeFrames`
- Child `velocityRatio`, `scaleRatio`, `endScale`
- Child `hasScaleAnim`, `hasAlphaAnim`
- Child `usesBehaviors`
- Child texture repeat/flip fields
- Child rotation and polygon fields

Child particles can make a copied donor look like it is spawning extra circles, extra sparkles, or off-center duplicates.

### Behavior Blocks

Review every behavior copied from a donor:

- `gravity`
- `random`
- `magnet`
- `spin`
- `collision`
- `convergence`

These can keep pulling particles toward old points, spinning them around old axes, or pushing them in directions that made sense only for the donor move.

## Texture Import And Format Notes

The SPA editor supports replacing and adding textures from PNG/WebP/JPEG/GIF, with explicit import formats.

Useful formats:

- Format `6 (A5I3)`: 8-color indexed texture with 5-bit alpha. Good for soft fades and glow-like sprites with a small palette.
- Format `1 (A3I5)`: 32-color indexed texture with 3-bit alpha. Good when color variety matters more than alpha precision.
- Format `7 (direct color)`: direct color with 1-bit alpha. Good for crisp opaque sprites, but not soft transparency.

Important DS/rendering limitation:

- Do not expect CSS-like continuous opacity behavior.
- Hardware blending, palette alpha, resource base alpha, and alpha animation can interact with the background and sprites.
- If a texture changes color as it scales or fades, check donor `colorAnim`, `alphaAnim`, base `color`, and base `alpha` before assuming the PNG is wrong.

When importing custom textures:

1. Remove unwanted background pixels before import.
2. Pick A5I3 for glow/soft-alpha effects with few colors.
3. Pick A3I5 for more color variation with coarser alpha.
4. Use direct color when alpha only needs to be transparent or opaque.
5. Verify texture references after adding/removing texture slots.

Texture IDs are positional. If texture `3` is deleted, old texture `4` becomes new texture `3`, and references must shift down. The SPA editor's remove-texture flow warns about direct references and compacts later references, but agents should still review main resource, child resource, and texture animation frame references after deletion.

## Script Composition Notes

Prefer script VM commands for:

- `LoadSPA`
- `Emit`
- `EmitFromCoordinates`
- `EmitOrtho`
- `EmitProjectile*`
- `EmitCircle`
- `Wait`
- `LetCMDsFinish`
- `PlaySound`
- screen shake commands
- background/fade/palette commands

When copying donor scripts:

- Remove donor sounds unless explicitly requested.
- Remove donor background setup and cleanup as a group if the new animation should not use them.
- Preserve waits around copied effect groups.
- Keep `TerminateMoveScript` paths intact.
- Confirm every `Emit*` command has a matching loaded SPA.
- Confirm source/target parameters before editing particle data for placement.

Mega animation lesson: screen fade/reveal work should be introduced through VM script commands. C-side fade experiments created freezes because the battle client animation state was being touched outside the VM timing path.

## Layering And Priority Notes

Particle visibility problems are not always texture problems.

Check:

- Is the resource positioned at user, target, center, or screen space?
- Is a particle behind a battler because of depth/layering?
- Is `drawChildFirst` changing parent/child order?
- Is `drawType` causing the sprite to face or tilt unexpectedly?
- Is `followEmitter` causing particles to trail instead of staying on the subject?
- Is scale large enough to cover the intended battler?
- Are source/target params in the `Emit*` command correct?

For effects intended to cover a battler, validate on both player-side and opponent-side positions. Opponent-side effects may need different script scale, position, or timing if the perspective makes them visually too large or too small.

## Sound And Timing Notes

Do not leave donor sounds in place accidentally.

When adding sound:

- Use exact `PlaySound` parameters from a known working donor when requested.
- Remove donor sound commands from copied sections unless they are intentionally part of the new effect.
- Place sounds near the visual moment they support, then adjust by a few frames in emulator.

For timing:

- A 30-frame interval is about one second.
- Add pauses in small increments first, usually 2 to 6 frames.
- If something crashes or freezes, strip back to the last known safe layer and reintroduce one command/resource at a time.

## Preview And Emulator Testing

Use the SPA editor for fast iteration:

- Texture panel: inspect imported texture dimensions, format, palette size, and references.
- Add/replace texture controls: import PNGs into new or existing texture slots.
- Remove texture control: warn and compact references before deletion.
- Emitter Preview tab: preview a selected emitter without requiring a full move script.

Then test in emulator for final validation:

- Player-side and opponent-side positions.
- Wild and trainer battles if the effect is battle-state dependent.
- Single, double, or triple battle contexts if particle count or layering could matter.
- Repeated use across battles if the animation is tied to gameplay state.

The editor preview is an aid, not the final authority. Always validate DS-side rendering when the effect depends on blending, screen fades, sprite priority, or battle-camera placement.

## Handoff Checklist For Future Agents

When finishing a custom move animation or SPA edit, report:

- Final animation member ID or binary path.
- Donor move IDs and donor animation member IDs.
- Donor and final SPA IDs.
- Resource IDs used and their roles.
- Texture IDs used and their formats.
- Fields scrubbed from donor resources, especially `scaleAnim`, `colorAnim`, `alphaAnim`, and `texAnim`.
- Sounds intentionally kept or removed.
- Background/fade commands intentionally kept or removed.
- Known preview limitations.
- Emulator checks performed.
