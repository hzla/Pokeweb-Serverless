# SPA Particle Reference

[Back to Move Animation Editor](Move-Animation-Editor)

SPA files are particle archives. A move animation script can load a SPA and spawn one or more resources from it, but most visible particle properties are stored inside the SPA.

## Archive Shape

A parsed SPA archive contains:

- `resources`: emitter resources. Each resource describes one particle effect.
- `textures`: images used by resources and texture animations.
- `warnings`: parser warnings for unsupported or partially decoded data.

Move animation SPAs live in the move SPA NARC, `a/0/0/6`, for the Gen 5 move animation editor.

## Resource Fields

Emitter and spawn control:

- `emissionType`: point, sphere, circle, cylinder, hemisphere, and related spawn shapes.
- `emissionAxis` and `axis`: orientation for circular/cylindrical emitters and directional movement.
- `emitterBasePos`: baked X/Y/Z offset relative to the script spawn point.
- `emitterLifeFrames`: how long the emitter keeps producing particles.
- `emissionCount`: particles created per emission.
- `emissionIntervalFrames`: frames between emissions.
- `startDelayFrames`: delay before the emitter begins.
- `radius` and `length`: spawn volume dimensions.

Particle appearance and lifetime:

- `textureIndex`: selected texture.
- `drawType`: billboard, directional billboard, polygon, directional polygon, or centered directional polygon.
- `color`: base tint multiplied into the texture. White keeps texture colors closest to original.
- `baseScale`: default size before scale animation and script-side placement.
- `aspectRatio`: stretches the texture without changing base scale.
- `baseAlpha`: base opacity.
- `particleLifeFrames`: lifetime of each individual particle.
- `textureTileCountS/T` and `flipTextureS/T`: texture repeat and mirroring.
- `polygonX/Y`, `polygonRotAxis`, `polygonReferencePlane`: polygon placement/orientation data.

Motion:

- `initVelPosAmplifier`: velocity away from spawn position.
- `initVelAxisAmplifier`: velocity along emitter axis.
- `airResistance`: damping over time.
- `hasRotation`, `randomInitAngle`, `initAngle`, `minRotation`, `maxRotation`: particle spin and starting angle.
- `variance.baseScale`, `variance.lifeTime`, `variance.initVel`: randomization.
- `followEmitter`: particles remain attached to the moving emitter.
- `hideParent`: parent particle is hidden and only child particles render.

## Optional Curves

These are common donor leakage sources.

- `scaleAnim`: start/mid/end scale curve. This can override or mask script scale changes.
- `colorAnim`: start/end color curve, random start color, loop, and interpolation. This can pull recolored particles back toward donor colors.
- `alphaAnim`: opacity curve. This can cause flicker or perceived color changes.
- `texAnim`: texture frame sequence. This can briefly show stale donor textures after texture changes.

## Child Resources

`childResource` describes secondary particles emitted by parent particles. Check it whenever you see extra glows, duplicate circles, unexpected sparks, or off-center particles.

Important child fields:

- `textureIndex`
- `color` and `useChildColor`
- `emissionCount`, `emissionDelay`, `emissionIntervalFrames`
- `lifeFrames`
- `scaleRatio`
- `velocityRatio`
- `hasScaleAnim`
- `hasAlphaAnim`
- `usesBehaviors`

## Behaviors

Behaviors run after the script spawns the emitter.

- `gravity`: pushes particles in a direction.
- `random`: adds random force at intervals.
- `magnet`: pulls toward a point.
- `spin`: rotates around an axis.
- `collision`: collides with a plane and may bounce.
- `convergence`: pulls toward a target.

Example: when adapting Rock Slide-style falling rocks into Thousand Arrows, collision/bounce behavior is wrong if arrows should hit and stick.

## Textures

Editable/import formats:

- Format 7, Direct Color: best color fidelity, larger data.
- Format 6, A5I3: 3-bit palette index plus 5-bit alpha. Useful for glow, symbol, and translucent particles.
- Format 1, A3I5: 5-bit palette index plus 3-bit alpha. More palette range, less alpha precision.

Other indexed/compressed formats can often be previewed, but replacement is safest through the supported writable formats above.

Best practices:

- Use power-of-two texture dimensions between 8 and 1024.
- Use transparent pixels in the source PNG when the particle should have clean cutouts.
- Use A5I3 for small glowing particles.
- Use direct color when hue fidelity matters more than archive size.
- After deleting texture N, references to later textures shift down by one. Verify resource texture, child texture, texture animation frames, and shared texture sources.

## Vanilla Examples

- Spark: expanding circles/glow and useful sound timing.
- Shock Wave: layered glowing particles.
- Leaf Tornado: tornado-like orbiting motion.
- Rain Dance: screen-wide falling particle pattern.
- Explosion: beams and burst-style effects.
- Dark Void: portal, sink, and pop-out staging.
- Aurora Beam: repeated traveling ring/shape particles with color variation.
- Draco Meteor: sky camera and falling projectile staging.
- Rock Slide: falling object donor with collision behavior to scrub when bounce is unwanted.

