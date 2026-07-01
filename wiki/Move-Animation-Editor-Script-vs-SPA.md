# Script vs SPA Boundary

[Back to Move Animation Editor](Move-Animation-Editor)

This page answers the recurring question: can this be changed with script commands alone, or does it require SPA editing?

## Usually Pure Script

- Command sequencing.
- Wait timing.
- Camera movement and screen shake.
- Battler sprite movement, shake, opacity, freeze, tint, distortion, mosaic, and visibility.
- Background load, apply, move, alpha, priority, color, palette animation, and distortion.
- Sound playback, panning/side, stop, and adjustment.
- Which SPA archive/resource is loaded or spawned.
- Rough spawn placement and projectile route for SPA commands.

## Usually Requires SPA

- Particle texture image.
- Texture format and alpha.
- Emitter color/tint.
- Color animation curves.
- Alpha animation curves.
- Scale animation curves.
- Texture animation frames.
- Particle base scale and aspect ratio.
- Spawn shape, radius, length, axis, and baked base position.
- Child particles.
- Behaviors such as gravity, collision, spin, magnet, convergence, and random force.

## Mixed Script And SPA

Projectiles:

- Script selects the projectile command, anchors, offsets, and speed/timing.
- SPA controls the visible particle shape, base size, scale curve, rotation, collision, and texture.

Recolors:

- Script can recolor sprites/backgrounds and some object palettes.
- SPA controls particle texture pixels, resource tint, child tint, color curves, and alpha curves.

Layered effects:

- Script controls when layers appear and disappear.
- SPA controls how each particle layer looks and evolves after it spawns.

## Practical Examples

Mega Evolution sphere:

- Script stages particles, waits, screen shake, sounds, and form-swap timing.
- SPA controls sphere textures, alpha/scale timing, crack beams, symbol particles, and orbiting particles.

Thousand Arrows:

- Script stages launch sounds, rain-like falling pattern, dimming, and target shake.
- SPA controls arrow texture width, scale, falling emitter density, and whether donor collision/bounce remains.

Hyperspace Hole/Fury:

- Script stages portal sequence, sprite vanish/reappear, camera, and impact donor section.
- SPA controls portal texture, ring color, placement offsets, scale, and orientation.

Dragon Ascent:

- Script stages takeoff, sky camera, meteor wait, crash timing, sound, shake, and target flattening.
- SPA controls meteor flame texture, color shift, base scale, trajectory helpers, and donor meteor multiplicity.

