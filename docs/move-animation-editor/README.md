# Move Animation Editor Guide

This guide documents the Gen 5 move animation workflow in Pokeweb-Serverless. It is written for end users editing animations in the browser UI and for future AI agents that need to reason about what a decompiled move animation script will produce visually.

## Core Rule

Visible battle animation behavior belongs in the move animation VM script and SPA particle assets whenever possible. C or C++ hooks may choose when an animation starts or update battle state, but visual choreography such as particles, fades, sounds, waits, shakes, camera movement, and reveal timing should live in the script/SPA animation path.

## What Lives Where

Move animation scripts control sequence and staging:

- Which SPA files are loaded.
- Which emitters/resources are spawned.
- Waits and synchronization.
- Camera movement.
- Battler sprite movement, opacity, color, shake, freeze, and visibility.
- Background loading, movement, distortion, alpha, priority, and palette fades.
- Sound playback and sound-side controls.

SPA particle files control particle appearance and simulation:

- Texture images and texture formats.
- Resource tint, child tint, color curves, alpha curves, scale curves, and texture animation.
- Spawn shape, radius, length, base position, axis, velocity, lifetime, and density.
- Child particles.
- Behaviors such as gravity, random force, magnet, spin, collision, and convergence.

If a recolored particle keeps drifting back to the donor color, a projectile ignores script scale, or copied particles spawn unexpected child effects, inspect the SPA first.

## Recommended Workflow

1. Identify the donor move ID, actual animation member, referenced SPA IDs, resource IDs, texture IDs, backgrounds, and sounds.
2. Preview the donor animation before editing.
3. Edit script-only timing/camera/sound/background pieces first.
4. Clone or append donor SPAs when particle appearance needs to change.
5. Scrub donor SPA fields deliberately instead of assuming texture replacement is enough.
6. Preview one layer at a time.
7. Test in-game after major reintroductions.

## Semantic Script Parameters

BW2 move animation scripts still compile to the game's original numeric VM bytecode, but the editor can display and accept friendlier tokens for parameters with known swan constants.

- Enum-like parameters can use names such as `MOVE_INTERPOLATION`, `CAMERA_DEFENDER`, `SIDE_NONE`, `SIDE_ATTACKER`, `POS_A`, `POKEMON_ATTACKER`, `SE2`, and `WAIT_PARTICLE`.
- Exact swan-style names such as `BTLEFF_PARTICLE_PLAY_SIDE_NONE` are also accepted for mapped parameters.
- Legacy aliases remain accepted where useful, such as `CAMERA_DEFENCE`, `SIDE_ATTACK`, `POKEMON_TARGET`, and `DEFENSE` spellings for source constants that use `DEFENCE`.
- FX32 multiplier parameters can use `1x`, `0.5x`, and `2x`; these compile to `4096`, `2048`, and `8192`.
- FX32 world-coordinate, offset, radius, and height parameters can use `1px`, `0.5px`, and `2px`; these also compile to `4096`, `2048`, and `8192`. This includes the Emit family (`Emit`, `EmitFromCoordinates`, `EmitOrtho`, `EmitAll`, `EmitProjectile`, projectile coordinate variants, and circle emitters) where the swan VM treats the field as a world-space distance.
- FX32 projectile movement duration parameters can use `1f`, `10f`, and `30f`; these compile to `4096`, `40960`, and `122880`. Raw fixed-point values still compile.
- Raw signed decimal and hex integers still compile everywhere, so old scripts remain valid.
- Color commands still use numeric RGB5 channel values in V1, but the code editor highlights color-bearing parameters with the resolved color.

Only parameters with known semantic metadata are rewritten to friendly names during decompile. Unknown or unusual values remain numeric so round-tripping stays exact.

## Documentation Map

- [Command Reference](command-reference.md): exhaustive command and parameter docs generated from `src/assets/data/moveAnimationCommandDocs.json`.
- [SPA Particle Reference](spa-particle-reference.md): archive, emitter, texture, curve, child, and behavior fields.
- [Workflow Guides](workflow-guides.md): common edits from recolors to projectiles and animation splicing.
- [Script vs SPA Boundary](script-vs-spa.md): what can be changed in script only and what requires SPA edits.
- [AI Agent Orientation](ai-agent-orientation.md): prompt/template and guardrails for future animation work.

## In-App Help

The Move Animation editor includes:

- Command click help in the left reference sidebar.
- Selected Command summaries for long `Emit*`, projectile, and circle commands, using the current parameters to describe the effect in plain English.
- A searchable Docs tab.
