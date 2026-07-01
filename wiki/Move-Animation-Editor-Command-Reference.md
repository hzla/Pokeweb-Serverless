# Move Animation Command Reference

[Back to Move Animation Editor](Move-Animation-Editor)

This file is generated from `src/assets/data/moveAnimationCommandDocs.json`, the same command documentation used by the Pokeweb-Serverless editor. It covers every known BW2 move animation VM command, its friendly decompiled name, reference name, opcode, parameters, notes, and script/SPA boundary guidance.

## Parameter Conventions

- Parameters are signed 32-bit integers unless a command-specific note says otherwise.
- Parameters with known swan preset values may be written as uppercase symbols. For example, `MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9` compiles to the same bytes as `MoveCamera 1, 11, 16, 0, 9`.
- SPA placement commands accept side/position symbols such as `SIDE_NONE`, `SIDE_ATTACKER`, `SIDE_DEFENDER`, `POS_A`, and exact swan aliases like `BTLEFF_PARTICLE_PLAY_SIDE_NONE` where that parameter is a known selector.
- FX32 multiplier parameters such as particle `radius`, `life`, `scale`, `speed`, and sprite/object scale values may use `1x`, `0.5x`, or `2x`; raw values like `4096` remain valid.
- FX32 world-unit parameters such as Emit-family coordinates, offsets, circle radii, and projectile arc heights may use `1px`, `0.5px`, or `2px`; raw values like `4096` remain valid. The `px` suffix is an authoring shorthand for one fixed-point world unit, which maps one-to-one with screen pixels in orthographic contexts.
- FX32 projectile movement duration parameters such as `move_frame` may use `1f`, `10f`, or `30f`; raw values like `4096` remain valid. For these fields, `4096` is 1 frame, so `30f` compiles to `122880`.
- RGB command docs use 5-bit channel values when expanded in the editor.
- Frame parameters are usually 30 FPS battle animation frames.
- SPA commands reference SPA archive IDs and resource indices inside those archives.
- Camera and sprite selector values are not interchangeable. Common sprite selectors include user 14 and target 16; common camera selectors include user 9 and target 11.
- Visible battle animation choreography should live in the move animation VM script and SPA assets, not C-side animation injection.
- Friendly names are the default decompile output; legacy macro names and `CMD_hex` aliases still compile for older scripts.

## Camera

### MoveCamera

- Opcode: 0 (0x00)
- Handler macro: `CAMERA_MOVE`
- Reference name: `MoveCamera`
- Current Pokeweb name: `MoveCamera`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move the battle camera to a preset camera position.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `move_pos` | `p1` | Preset camera target/move position. |
| 2 | `frame` | `p2` | Duration in frames. |
| 3 | `wait` | `p3` | Delay/wait in frames. |
| 4 | `brake` | `p4` | Camera/movement braking/easing amount. |

### AdjustCamera

- Opcode: 1 (0x01)
- Handler macro: `CAMERA_MOVE_COODINATE`
- Reference name: `AdjustCamera`
- Current Pokeweb name: `AdjustCamera`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move the battle camera to explicit coordinates.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `pos_x` | `p1` | X coordinate, fixed-point where used by scripts. |
| 2 | `pos_y` | `p2` | Y coordinate, fixed-point where used by scripts. |
| 3 | `pos_z` | `p3` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 4 | `tar_x` | `p4` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 5 | `tar_y` | `p5` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 6 | `tar_z` | `p6` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 7 | `frame` | `p7` | Frame count. |
| 8 | `wait` | `p8` | Frame count. |
| 9 | `brake` | `p9` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

### CameraMoveAngle

- Opcode: 2 (0x02)
- Handler macro: `CAMERA_MOVE_ANGLE`
- Reference name: `CameraMoveAngle`
- Current Pokeweb name: `CameraMoveAngle`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move the battle camera by polar/spherical angle.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `angle_phi` | `p1` | Angle value. |
| 2 | `angle_theta` | `p2` | Angle value. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `brake` | `p5` | Camera/movement braking/easing amount. |

Notes:

- Legacy alias CMD_2 is still accepted; new scripts decompile to CameraMoveAngle.

### ShakeScreen

- Opcode: 3 (0x03)
- Handler macro: `CAMERA_SHAKE`
- Reference name: `ShakeScreen`
- Current Pokeweb name: `ShakeScreen`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Shake the battle camera.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `dir` | `p0` | Direction selector. |
| 1 | `value` | `p1` | Immediate value to compare or assign. |
| 2 | `offset` | `p2` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

### CameraProjection

- Opcode: 4 (0x04)
- Handler macro: `CAMERA_PROJECTION`
- Reference name: `CameraProjection`
- Current Pokeweb name: `CameraProjection`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Change camera projection mode.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `pos` | `p1` | Target battle position/object selector. |

Notes:

- Legacy alias CMD_4 is still accepted; new scripts decompile to CameraProjection.

### CameraPosPush

- Opcode: 5 (0x05)
- Handler macro: `CAMERA_POS_PUSH`
- Reference name: `CameraPosPush`
- Current Pokeweb name: `CameraPosPush`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Push/save the current camera position.

Parameters: none.

Notes:

- Legacy alias CMD_5 is still accepted; new scripts decompile to CameraPosPush.

## Particles

### LoadSPA

- Opcode: 6 (0x06)
- Handler macro: `PARTICLE_LOAD`
- Reference name: `LoadSPA`
- Current Pokeweb name: `LoadSPA`
- Boundary: SPA dependency

Load a SPA particle archive.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `datID` | `p0` | Archive/data ID. For particle commands this is the SPA datID; BW2 remaps only special ball/capture particle archives at runtime. |

### Emit

- Opcode: 7 (0x07)
- Handler macro: `PARTICLE_PLAY`
- Reference name: `DoSPAAnimation`
- Current Pokeweb name: `Emit`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create one particle emitter from a loaded SPA archive.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `start_pos` | `p2` | Emitter/start battle position selector. |
| 3 | `dir_pos` | `p3` | Destination/direction battle position selector. If SIDE_NONE (8), start is reused. |
| 4 | `ofs_y` | `p4` | Y offset applied to the command logic and destination positions. |
| 5 | `dir_angle` | `p5` | Extra Y-axis direction angle value; the adjacent dummy field is unused. |
| 6 | `dummy` | `p6` | Unused padding/dummy value read and ignored by the VM. |
| 7 | `radius` | `p7` | Emitter radius multiplier, normally FX32. |
| 8 | `life` | `p8` | Emitter particle-life multiplier, normally FX32. |
| 9 | `scale` | `p9` | Scale multiplier, normally FX32. |
| 10 | `speed` | `p10` | Emitter velocity/speed multiplier, normally FX32. |

Notes:

- Start and destination are read separately; destination SIDE_NONE (8) is replaced with start. When start and destination differ, the VM rotates the emitter axis toward the destination and updates magnet/convergence targets.
- Radius/life/scale/speed are FX32-style multipliers; 4096 is 1.0.

### EmitFromCoordinates

- Opcode: 8 (0x08)
- Handler macro: `PARTICLE_PLAY_COORDINATE`
- Reference name: `DoSPAScreenAnimation`
- Current Pokeweb name: `EmitFromCoordinates`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create one particle emitter using explicit start/direction coordinates.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `start_pos_x` | `p2` | X coordinate, fixed-point where used by scripts. |
| 3 | `start_pos_y` | `p3` | Y coordinate, fixed-point where used by scripts. |
| 4 | `start_pos_z` | `p4` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 5 | `dir_pos_x` | `p5` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 6 | `dir_pos_y` | `p6` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 7 | `dir_pos_z` | `p7` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 8 | `ofs_y` | `p8` | Y offset applied before emission/rendering. |
| 9 | `dir_angle` | `p9` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 10 | `dummy` | `p10` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 11 | `radius` | `p11` | Radius value or multiplier, normally FX32. |
| 12 | `life` | `p12` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 13 | `scale` | `p13` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 14 | `speed` | `p14` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

### EmitOrtho

- Opcode: 9 (0x09)
- Handler macro: `PARTICLE_PLAY_ORTHO`
- Reference name: `DoSPAAnimation2`
- Current Pokeweb name: `EmitOrtho`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create one particle emitter using orthographic projection.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `start_pos` | `p2` | Emitter/start battle position selector. |
| 3 | `dir` | `p3` | Direction selector. |
| 4 | `ofs_x` | `p4` | X offset applied before emission/rendering. |
| 5 | `ofs_y` | `p5` | Y offset applied to the command logic and destination positions. |
| 6 | `ofs_z` | `p6` | Z offset applied before emission/rendering. |
| 7 | `radius` | `p7` | Radius value or multiplier, normally FX32. |
| 8 | `life` | `p8` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 9 | `scale` | `p9` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 10 | `speed` | `p10` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

### EmitAll

- Opcode: 10 (0x0a)
- Handler macro: `PARTICLE_PLAY_ALL`
- Reference name: `DoSPAAllAnimations`
- Current Pokeweb name: `EmitAll`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create emitters for every resource in a loaded SPA archive.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `start_pos` | `p1` | Emitter/start battle position selector. |
| 2 | `dir_pos` | `p2` | Destination/direction battle position selector. If SIDE_NONE (8), start is reused. |
| 3 | `ofs_y` | `p3` | Y offset applied to the command logic and destination positions. |
| 4 | `dir_angle` | `p4` | Extra Y-axis direction angle value; the adjacent dummy field is unused. |
| 5 | `proj` | `p5` | Projection flag: 0 = perspective, 1 = orthographic. |
| 6 | `radius` | `p6` | Emitter radius multiplier, normally FX32. |
| 7 | `life` | `p7` | Emitter particle-life multiplier, normally FX32. |
| 8 | `scale` | `p8` | Scale multiplier, normally FX32. |
| 9 | `speed` | `p9` | Emitter velocity/speed multiplier, normally FX32. |

Notes:

- Start and destination are read separately; destination SIDE_NONE (8) is replaced with start. When start and destination differ, the VM rotates the emitter axis toward the destination and updates magnet/convergence targets.
- Radius/life/scale/speed are FX32-style multipliers; 4096 is 1.0.
- Unlike PARTICLE_PLAY, there is no resource-index argument; the command applies to every resource in the loaded SPA.
- Legacy alias CMD_a is still accepted; new scripts decompile to EmitAll.

### DeleteParticle

- Opcode: 11 (0x0b)
- Handler macro: `PARTICLE_DELETE`
- Reference name: `DeleteSPA`
- Current Pokeweb name: `DeleteParticle`
- Boundary: SPA dependency

Delete/unload a loaded particle archive.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |

Notes:

- Legacy alias CMD_b is still accepted; new scripts decompile to DeleteParticle.

### EmitProjectile

- Opcode: 12 (0x0c)
- Handler macro: `EMITTER_MOVE`
- Reference name: `DoSPAProjectileAnimation`
- Current Pokeweb name: `EmitProjectile`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create an emitter and move it from a start position to a destination position.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `move_type` | `p2` | Emitter movement type; see emitter movement constants below. |
| 3 | `start_pos` | `p3` | Emitter/start battle position selector. |
| 4 | `end_pos` | `p4` | Destination battle position selector. |
| 5 | `ofs_y` | `p5` | Y offset applied to the command logic and destination positions. |
| 6 | `move_frame` | `p6` | FX32 emitter movement duration; 4096 is 1 frame, so `30f` compiles to 122880. Raw fixed-point values remain valid. |
| 7 | `top` | `p7` | Arc height/top value used by curved emitter movement. |
| 8 | `life` | `p8` | Emitter particle-life multiplier, normally FX32. |
| 9 | `speed` | `p9` | Emitter velocity/speed multiplier, normally FX32. |
| 10 | `wave` | `p10` | Wave count/frequency for wave emitter movement. Zero is corrected to 1 by the command logic. |

Notes:

- The command expects start and destination to be different. move_type creates an emitter movement callback; wave value 0 is corrected to 1.
- For OFFSET movement, the handler swaps start/destination and then offsets destination by start.
- Important correction for the preview tool: p2 is move_type, p3 is start_pos, and p4 is end_pos. Treating p2 as a position is what makes many projectile effects originate from the wrong side.

### EmitProjectileFromCoordinates

- Opcode: 13 (0x0d)
- Handler macro: `EMITTER_MOVE_COORDINATE`
- Reference name: `DoSPAProjectileAnimation2`
- Current Pokeweb name: `EmitProjectileFromCoordinates`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create a moving emitter from explicit coordinates to a destination position.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `move_type` | `p2` | Emitter movement type; see emitter movement constants below. |
| 3 | `start_pos_x` | `p3` | X coordinate, fixed-point where used by scripts. |
| 4 | `start_pos_y` | `p4` | Y coordinate, fixed-point where used by scripts. |
| 5 | `start_pos_z` | `p5` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 6 | `end_pos` | `p6` | Battle position/object selector. |
| 7 | `ofs_y` | `p7` | Y offset applied before emission/rendering. |
| 8 | `move_frame` | `p8` | FX32 emitter movement duration; 4096 is 1 frame, so `30f` compiles to 122880. Raw fixed-point values remain valid. |
| 9 | `top` | `p9` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 10 | `life` | `p10` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 11 | `speed` | `p11` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 12 | `wave` | `p12` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

Notes:

- Uses explicit XYZ start coordinates, then a battle-position selector for the destination.

### EmitOrthoProjectile

- Opcode: 14 (0x0e)
- Handler macro: `EMITTER_MOVE_ORTHO`
- Reference name: `DoSPAProjectileAnimation3`
- Current Pokeweb name: `EmitOrthoProjectile`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create a moving emitter using orthographic projection.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `move_type` | `p2` | Emitter movement type; see emitter movement constants below. |
| 3 | `start_pos` | `p3` | Emitter/start battle position selector. |
| 4 | `end_pos` | `p4` | Destination battle position selector. |
| 5 | `ofs_y` | `p5` | Y offset applied to the command logic and destination positions. |
| 6 | `move_frame` | `p6` | FX32 orthographic emitter movement duration; 4096 is 1 frame, so `30f` compiles to 122880. Raw fixed-point values remain valid. |
| 7 | `top` | `p7` | Arc height/top value used by curved emitter movement. |
| 8 | `life` | `p8` | Emitter particle-life multiplier, normally FX32. |
| 9 | `speed` | `p9` | Emitter velocity/speed multiplier, normally FX32. |
| 10 | `wave` | `p10` | Wave count/frequency for wave emitter movement. Zero is corrected to 1 by the command logic. |

Notes:

- Creates/uses a personal orthographic particle camera when needed. ATTACKOFS has special offset handling.
- The command expects start and destination to be different. move_type creates an emitter movement callback; wave value 0 is corrected to 1.
- For OFFSET movement, the handler swaps start/destination and then offsets destination by start.
- Same projectile layout as EMITTER_MOVE, but rendered through the orthographic particle path.

### EmitOrthoProjectileFromCoordinates

- Opcode: 15 (0x0f)
- Handler macro: `EMITTER_MOVE_ORTHO_COORDINATE`
- Reference name: `DoSPAProjectileAnimationOrthoCoordinate`
- Current Pokeweb name: `EmitOrthoProjectileFromCoordinates`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create a moving orthographic emitter from explicit coordinates.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `move_type` | `p2` | Emitter movement type; see emitter movement constants below. |
| 3 | `start_pos_x` | `p3` | X coordinate, fixed-point where used by scripts. |
| 4 | `start_pos_y` | `p4` | Y coordinate, fixed-point where used by scripts. |
| 5 | `start_pos_z` | `p5` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 6 | `end_pos` | `p6` | Battle position/object selector. |
| 7 | `ofs_y` | `p7` | Y offset applied before emission/rendering. |
| 8 | `move_frame` | `p8` | FX32 orthographic emitter movement duration; 4096 is 1 frame, so `30f` compiles to 122880. Raw fixed-point values remain valid. |
| 9 | `top` | `p9` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 10 | `life` | `p10` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 11 | `speed` | `p11` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 12 | `scale` | `p12` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

Notes:

- Unlike EMITTER_MOVE, the last parameter is scale, not wave. Do not apply wave-count correction to this command.
- Legacy alias CMD_f is still accepted; new scripts decompile to EmitOrthoProjectileFromCoordinates.

### EmitCircle

- Opcode: 16 (0x10)
- Handler macro: `EMITTER_CIRCLE_MOVE`
- Reference name: `DoSPACircleAnimation`
- Current Pokeweb name: `EmitCircle`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create an emitter that orbits around a start/target/center anchor.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `center_pos` | `p2` | Circle center selector: attacker left/right, defender left/right, or screen center left/right. |
| 3 | `radius_h` | `p3` | Horizontal radius, normally FX32. |
| 4 | `radius_v` | `p4` | Vertical radius, normally FX32. |
| 5 | `offset_y` | `p5` | Y offset applied before emission/rendering. |
| 6 | `frame` | `p6` | Frame count. |
| 7 | `wait` | `p7` | Frame count. |
| 8 | `count` | `p8` | Repeat count / number of cycles. |
| 9 | `rotate_after_wait` | `p9` | Frame count. |

### EmitOrthoCircle

- Opcode: 17 (0x11)
- Handler macro: `EMITTER_CIRCLE_MOVE_ORTHO`
- Reference name: `DoSPAOrthoCircleAnimation`
- Current Pokeweb name: `EmitOrthoCircle`
- Boundary: Script + SPA: script chooses archive/resource/placement/timing; SPA controls visible particle data.

Create an orbiting emitter using orthographic projection.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `num` | `p0` | Loaded particle archive slot / particle datID used by the VM. |
| 1 | `index` | `p1` | Resource index inside the loaded SPA archive. |
| 2 | `center_pos` | `p2` | Circle center selector: attacker left/right, defender left/right, or screen center left/right. |
| 3 | `radius_h` | `p3` | Horizontal radius, normally FX32. |
| 4 | `radius_v` | `p4` | Vertical radius, normally FX32. |
| 5 | `offset_y` | `p5` | Y offset applied before emission/rendering. |
| 6 | `frame` | `p6` | Frame count. |
| 7 | `wait` | `(not exposed in current macro)` | Frame count. |
| 8 | `count` | `(not exposed in current macro)` | Repeat count / number of cycles. |
| 9 | `rotate_after_wait` | `(not exposed in current macro)` | Frame count. |

Notes:

- The current Pokeweb macro exposes fewer parameters than the full command form. Scripts using all command parameters need p7, p8, and p9 preserved.
- Current Pokeweb macro exposes 7 argument(s), but the command supports 10.
- Legacy alias CMD_11 is still accepted; new scripts decompile to EmitOrthoCircle.

## Pokemon/Trainer

### ShakeSprite

- Opcode: 18 (0x12)
- Handler macro: `POKEMON_MOVE`
- Reference name: `PokemonMove`
- Current Pokeweb name: `ShakeSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move a Pokemon sprite/model.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `move_pos_x` | `p2` | Target X delta/coordinate for movement. |
| 3 | `move_pos_y` | `p3` | Target Y delta/coordinate for movement. |
| 4 | `frame` | `p4` | Duration in frames. |
| 5 | `wait` | `p5` | Delay/wait in frames. |
| 6 | `count` | `p6` | Repeat count / number of cycles. |

### MoveSprite

- Opcode: 19 (0x13)
- Handler macro: `POKEMON_CIRCLE_MOVE`
- Reference name: `PokemonCircleMove`
- Current Pokeweb name: `MoveSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move a Pokemon in a circular/orbiting path.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `axis` | `p1` | Axis selector. |
| 2 | `shift` | `p2` | Phase/position shift for circular movement. |
| 3 | `radius_h` | `p3` | Horizontal radius, normally FX32. |
| 4 | `radius_v` | `p4` | Vertical radius, normally FX32. |
| 5 | `frame` | `p5` | Frame count. |
| 6 | `rotate_wait` | `p6` | Frame count. |
| 7 | `count` | `p7` | Repeat count / number of cycles. |
| 8 | `rotate_after_wait` | `p8` | Frame count. |

### MoveSpriteSine

- Opcode: 20 (0x14)
- Handler macro: `POKEMON_SIN_MOVE`
- Reference name: `PokemonSineMove`
- Current Pokeweb name: `MoveSpriteSine`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move a Pokemon along a sine-wave path.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `dir` | `p1` | Direction selector. |
| 2 | `start_angle` | `p2` | Starting sine angle. |
| 3 | `end_angle` | `p3` | Ending sine angle. |
| 4 | `radius` | `p4` | Emitter radius multiplier, normally FX32. |
| 5 | `frame` | `p5` | Duration in frames. |

Notes:

- Legacy alias CMD_14 is still accepted; new scripts decompile to MoveSpriteSine.

### ScaleSprite

- Opcode: 21 (0x15)
- Handler macro: `POKEMON_SCALE`
- Reference name: `PokemonScale`
- Current Pokeweb name: `ScaleSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Scale a Pokemon sprite/model.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `mode` | `p1` | Scale motion mode. Use MOVE_DIRECT, MOVE_INTERPOLATION, MOVE_ROUNDTRIP, or MOVE_ROUNDTRIP_LONG. |
| 2 | `scale_x_offset` | `p2` | X offset scale target/amplitude as FX32; 4096 is 1x. In roundtrip modes this is added away from the current offset scale and then reversed. |
| 3 | `scale_y_offset` | `p3` | Y offset scale target/amplitude as FX32; 4096 is 1x. Negative values squash on this axis while the paired axis may stretch. |
| 4 | `frame` | `p4` | Duration in frames. |
| 5 | `wait` | `p5` | Delay/wait in frames. |
| 6 | `count` | `p6` | Repeat count / number of cycles. |

Notes:

- This command animates MCSS offset scale, not the default base sprite scale. Param 1 is a scale motion mode, not an axis selector.
- Legacy alias DistortSprite is still accepted; new scripts decompile to ScaleSprite.

### RotateSprite

- Opcode: 22 (0x16)
- Handler macro: `POKEMON_ROTATE`
- Reference name: `PokemonRotate`
- Current Pokeweb name: `RotateSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Rotate a Pokemon sprite/model.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `rotate` | `p2` | Rotation amount/target. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

Notes:

- Legacy alias TiltSprite is still accepted; new scripts decompile to RotateSprite.

### AdjustSpriteOpacity

- Opcode: 23 (0x17)
- Handler macro: `POKEMON_ALPHA`
- Reference name: `SpriteOpacity`
- Current Pokeweb name: `AdjustSpriteOpacity`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Change Pokemon alpha/opacity.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `alpha` | `p2` | Alpha/opacity target. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

### ApplySpriteMosaic

- Opcode: 24 (0x18)
- Handler macro: `POKEMON_MOSAIC`
- Reference name: `PokemonMosaic`
- Current Pokeweb name: `ApplySpriteMosaic`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Apply Pokemon mosaic/pixelation.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `mosaic` | `p2` | Mosaic/pixelation amount. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_18 is still accepted; new scripts decompile to ApplySpriteMosaic.

### ToggleSpriteBlink

- Opcode: 25 (0x19)
- Handler macro: `POKEMON_SET_MEPACHI_FLAG`
- Reference name: `PokemonBlinkFlag`
- Current Pokeweb name: `ToggleSpriteBlink`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Control Pokemon blinking/eye animation.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `wait` | `p2` | Delay/wait in frames. |
| 3 | `count` | `p3` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_19 is still accepted; new scripts decompile to ToggleSpriteBlink.

### ToggleFreezeSprite

- Opcode: 26 (0x1a)
- Handler macro: `POKEMON_SET_ANM_FLAG`
- Reference name: `PokemonAnimationFlag`
- Current Pokeweb name: `ToggleFreezeSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Control Pokemon animation playback flag.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `flag` | `p1` | Boolean/state flag. |

Notes:

- Legacy alias FreezeSprite is still accepted; new scripts decompile to ToggleFreezeSprite.

### ChangeSpriteColor

- Opcode: 27 (0x1b)
- Handler macro: `POKEMON_PAL_FADE`
- Reference name: `PokemonPaletteFade`
- Current Pokeweb name: `ChangeSpriteColor`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Fade/tint Pokemon palette color.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target/background/object selector affected by the palette fade. |
| 1 | `start_evy` | `p1` | Starting fade/tint coefficient. |
| 2 | `end_evy` | `p2` | Ending fade/tint coefficient. |
| 3 | `wait` | `p3` | Duration/wait in frames. |
| 4 | `r` | `p4` | Red component, 0-31. |
| 5 | `g` | `p5` | Green component, 0-31. |
| 6 | `b` | `p6` | Blue component, 0-31. |

Notes:

- Legacy alias ChangeColor is still accepted; new scripts decompile to ChangeSpriteColor.

### ToggleSpriteVisibility

- Opcode: 28 (0x1c)
- Handler macro: `POKEMON_VANISH`
- Reference name: `PokemonVanish`
- Current Pokeweb name: `ToggleSpriteVisibility`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Show or hide a Pokemon.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `flag` | `p1` | Boolean/state flag. |

Notes:

- Legacy alias ChangeVisibility is still accepted; new scripts decompile to ToggleSpriteVisibility.

### ToggleSpriteShadow

- Opcode: 29 (0x1d)
- Handler macro: `POKEMON_SHADOW_VANISH`
- Reference name: `PokemonShadowVanish`
- Current Pokeweb name: `ToggleSpriteShadow`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Show or hide a Pokemon shadow.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `flag` | `p1` | Boolean/state flag. |

Notes:

- Legacy alias CMD_1d is still accepted; new scripts decompile to ToggleSpriteShadow.

### ScaleSpriteShadow

- Opcode: 30 (0x1e)
- Handler macro: `POKEMON_SHADOW_SCALE`
- Reference name: `PokemonShadowScale`
- Current Pokeweb name: `ScaleSpriteShadow`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Scale a Pokemon shadow.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `scale_x` | `p2` | X scale target/multiplier. |
| 3 | `scale_y` | `p3` | Y scale target/multiplier. |
| 4 | `frame` | `p4` | Duration in frames. |
| 5 | `wait` | `p5` | Delay/wait in frames. |
| 6 | `count` | `p6` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_1e is still accepted; new scripts decompile to ScaleSpriteShadow.

### DeletePokemon

- Opcode: 31 (0x1f)
- Handler macro: `POKEMON_DEL`
- Reference name: `DeletePokemon`
- Current Pokeweb name: `DeletePokemon`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Remove/delete a Pokemon object from the scene.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |

Notes:

- Legacy alias CMD_1f is still accepted; new scripts decompile to DeletePokemon.

### SetTrainerSprite

- Opcode: 32 (0x20)
- Handler macro: `TRAINER_SET`
- Reference name: `SetTrainer`
- Current Pokeweb name: `SetTrainerSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Create/show a trainer object.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Object slot/index to create or modify. |
| 1 | `position` | `p1` | Trainer/object position selector. |
| 2 | `pos_x` | `p2` | X coordinate, fixed-point where used by scripts. |
| 3 | `pos_y` | `p3` | Y coordinate, fixed-point where used by scripts. |
| 4 | `pos_z` | `p4` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |

Notes:

- Legacy alias CMD_20 is still accepted; new scripts decompile to SetTrainerSprite.

### MoveTrainerSprite

- Opcode: 33 (0x21)
- Handler macro: `TRAINER_MOVE`
- Reference name: `MoveTrainer`
- Current Pokeweb name: `MoveTrainerSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move a trainer object.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `move_pos_x` | `p2` | Target X delta/coordinate for movement. |
| 3 | `move_pos_y` | `p3` | Target Y delta/coordinate for movement. |
| 4 | `move_pos_z` | `p4` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 5 | `frame` | `p5` | Frame count. |
| 6 | `wait` | `p6` | Frame count. |
| 7 | `count` | `p7` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_21 is still accepted; new scripts decompile to MoveTrainerSprite.

### SetTrainerSpriteAnimation

- Opcode: 34 (0x22)
- Handler macro: `TRAINER_ANIME_SET`
- Reference name: `SetTrainerAnimation`
- Current Pokeweb name: `SetTrainerSpriteAnimation`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Set trainer animation.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `anm_no` | `p1` | Animation number/index. |

Notes:

- Legacy alias CMD_22 is still accepted; new scripts decompile to SetTrainerSpriteAnimation.

### DeleteTrainerSprite

- Opcode: 35 (0x23)
- Handler macro: `TRAINER_DEL`
- Reference name: `DeleteTrainer`
- Current Pokeweb name: `DeleteTrainerSprite`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Remove/delete a trainer object.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |

Notes:

- Legacy alias CMD_23 is still accepted; new scripts decompile to DeleteTrainerSprite.

## Scene/Objects

### LoadBackground

- Opcode: 36 (0x24)
- Handler macro: `BG_LOAD`
- Reference name: `LoadBackground`
- Current Pokeweb name: `LoadBackground`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Load a battle background resource.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `datID` | `p0` | Archive/data ID. For particle commands this is the SPA datID; BW2 remaps only special ball/capture particle archives at runtime. |

### MoveBackground

- Opcode: 37 (0x25)
- Handler macro: `BG_SCROLL`
- Reference name: `MoveBackground`
- Current Pokeweb name: `MoveBackground`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Scroll/move a background layer.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `move_pos_x` | `p1` | Target X delta/coordinate for movement. |
| 2 | `move_pos_y` | `p2` | Target Y delta/coordinate for movement. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

### DistortBackground

- Opcode: 38 (0x26)
- Handler macro: `BG_RASTER_SCROLL`
- Reference name: `BackgroundRasterScroll`
- Current Pokeweb name: `DistortBackground`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Apply raster-line background scrolling/distortion.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Raster scroll direction/type. |
| 1 | `radius` | `p1` | Sine curve radius/amplitude. |
| 2 | `line` | `p2` | Line interval/line count for the sine curve. |
| 3 | `wait` | `p3` | Duration/wait in frames. |

### BackgroundPaletteAnimation

- Opcode: 39 (0x27)
- Handler macro: `BG_PAL_ANM`
- Reference name: `BackgroundPaletteAnimation`
- Current Pokeweb name: `BackgroundPaletteAnimation`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Play a background palette animation.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `datID` | `p0` | Palette animation archive/data ID. |
| 1 | `trans_pal` | `p1` | Destination palette slot. |

### BackgroundPriority

- Opcode: 40 (0x28)
- Handler macro: `BG_PRIORITY`
- Reference name: `BackgroundPriority`
- Current Pokeweb name: `BackgroundPriority`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Set background draw priority.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pri` | `p0` | Draw priority value. |

### BackgroundAlpha

- Opcode: 41 (0x29)
- Handler macro: `BG_ALPHA`
- Reference name: `BackgroundAlpha`
- Current Pokeweb name: `BackgroundAlpha`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Change background alpha/blending.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `bg_num` | `p0` | Background layer number. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `alpha` | `p2` | Alpha/opacity target. |
| 3 | `frame` | `p3` | Duration in frames. |
| 4 | `wait` | `p4` | Delay/wait in frames. |
| 5 | `count` | `p5` | Repeat count / number of cycles. |

### ChangeBackgroundColor

- Opcode: 42 (0x2a)
- Handler macro: `BG_PAL_FADE`
- Reference name: `BackgroundPaletteFade`
- Current Pokeweb name: `ChangeBackgroundColor`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Fade/tint a background palette.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `bg_num` | `p0` | Target/background/object selector affected by the palette fade. |
| 1 | `start_evy` | `p1` | Starting fade/tint coefficient. |
| 2 | `end_evy` | `p2` | Ending fade/tint coefficient. |
| 3 | `wait` | `p3` | Duration/wait in frames. |
| 4 | `r` | `p4` | Red component, 0-31. |
| 5 | `g` | `p5` | Green component, 0-31. |
| 6 | `b` | `p6` | Blue component, 0-31. |

### ApplyBackground

- Opcode: 43 (0x2b)
- Handler macro: `BG_VISIBLE`
- Reference name: `BackgroundVisible`
- Current Pokeweb name: `ApplyBackground`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Show or hide a background layer.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `bg_num` | `p0` | Background layer number. |
| 1 | `sw` | `p1` | Boolean/state flag. |

### MoveWindow

- Opcode: 44 (0x2c)
- Handler macro: `WINDOW_MOVE`
- Reference name: `WindowMove`
- Current Pokeweb name: `MoveWindow`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move/open/close a battle window mask.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `type` | `p0` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 1 | `horizon` | `p1` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 2 | `vertical` | `p2` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 3 | `in_out` | `p3` | The parameter list names this value, but the exact editor-facing meaning is command-specific. |
| 4 | `frame` | `p4` | Frame count. |
| 5 | `wait` | `p5` | Frame count. |
| 6 | `flag` | `p6` | Boolean/state flag. |

Notes:

- Legacy alias CMD_2c is still accepted; new scripts decompile to MoveWindow.

### CreateBattleObject

- Opcode: 45 (0x2d)
- Handler macro: `OBJ_SET`
- Reference name: `SetObject`
- Current Pokeweb name: `CreateBattleObject`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Create/show an OBJ sprite.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Object slot/index to create or modify. |
| 1 | `datID` | `p1` | Archive/data ID. For particle commands this is the SPA datID; BW2 remaps only special ball/capture particle archives at runtime. |
| 2 | `pos` | `p2` | Target battle position/object selector. |
| 3 | `ofs_x` | `p3` | X offset applied before emission/rendering. |
| 4 | `ofs_y` | `p4` | Y offset applied to the command logic and destination positions. |
| 5 | `scale_x` | `p5` | X scale target/multiplier. |
| 6 | `scale_y` | `p6` | Y scale target/multiplier. |

Notes:

- Legacy alias CMD_2d is still accepted; new scripts decompile to CreateBattleObject.

### MoveBattleObject

- Opcode: 46 (0x2e)
- Handler macro: `OBJ_MOVE`
- Reference name: `MoveObject`
- Current Pokeweb name: `MoveBattleObject`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Move an OBJ sprite.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Object slot/index to create or modify. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `move_pos_x` | `p2` | Target X delta/coordinate for movement. |
| 3 | `move_pos_y` | `p3` | Target Y delta/coordinate for movement. |
| 4 | `frame` | `p4` | Duration in frames. |
| 5 | `wait` | `p5` | Delay/wait in frames. |
| 6 | `count` | `p6` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_2e is still accepted; new scripts decompile to MoveBattleObject.

### ScaleBattleObject

- Opcode: 47 (0x2f)
- Handler macro: `OBJ_SCALE`
- Reference name: `ScaleObject`
- Current Pokeweb name: `ScaleBattleObject`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Scale an OBJ sprite.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Object slot/index to create or modify. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `scale_x` | `p2` | X scale target/multiplier. |
| 3 | `scale_y` | `p3` | Y scale target/multiplier. |
| 4 | `frame` | `p4` | Duration in frames. |
| 5 | `wait` | `p5` | Delay/wait in frames. |
| 6 | `count` | `p6` | Repeat count / number of cycles. |

Notes:

- Legacy alias CMD_2f is still accepted; new scripts decompile to ScaleBattleObject.

### SetBattleObjectAnimation

- Opcode: 48 (0x30)
- Handler macro: `OBJ_ANIME_SET`
- Reference name: `SetObjectAnimation`
- Current Pokeweb name: `SetBattleObjectAnimation`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Set OBJ animation.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `anm_no` | `p1` | Animation number/index. |

Notes:

- Legacy alias CMD_30 is still accepted; new scripts decompile to SetBattleObjectAnimation.

### ObjectPaletteFade

- Opcode: 49 (0x31)
- Handler macro: `OBJ_PAL_FADE`
- Reference name: `ObjectPaletteFade`
- Current Pokeweb name: `ObjectPaletteFade`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Fade/tint an OBJ palette.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Target/background/object selector affected by the palette fade. |
| 1 | `start_evy` | `p1` | Starting fade/tint coefficient. |
| 2 | `end_evy` | `p2` | Ending fade/tint coefficient. |
| 3 | `wait` | `p3` | Duration/wait in frames. |
| 4 | `r` | `p4` | Red component, 0-31. |
| 5 | `g` | `p5` | Green component, 0-31. |
| 6 | `b` | `p6` | Blue component, 0-31. |

### DeleteBattleObject

- Opcode: 50 (0x32)
- Handler macro: `OBJ_DEL`
- Reference name: `DeleteObject`
- Current Pokeweb name: `DeleteBattleObject`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Delete an OBJ sprite.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |

Notes:

- Legacy alias CMD_32 is still accepted; new scripts decompile to DeleteBattleObject.

### ToggleHUD

- Opcode: 51 (0x33)
- Handler macro: `GAUGE_VANISH`
- Reference name: `GaugeVanish`
- Current Pokeweb name: `ToggleHUD`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Show or hide HP/EXP gauge UI.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `flag` | `p0` | Boolean/state flag. |
| 1 | `side` | `p1` | Battle side selector, usually attacker/defender. |

Notes:

- Legacy alias CMD_33 is still accepted; new scripts decompile to ToggleHUD.

## Sound

### PlaySound

- Opcode: 52 (0x34)
- Handler macro: `SE_PLAY`
- Reference name: `PlaySound`
- Current Pokeweb name: `PlaySound`
- Boundary: Pure script sound command.

Play a sound effect.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `se_no` | `p0` | Sound effect ID. |
| 1 | `player` | `p1` | Sound player/channel index. Default player is resolved automatically when requested. |
| 2 | `pan` | `p2` | Stereo pan value. |
| 3 | `wait` | `p3` | Delay/wait in frames. |
| 4 | `pitch` | `p4` | Pitch value. |
| 5 | `vol` | `p5` | Volume value. |
| 6 | `mod_depth` | `p6` | Sound modulation depth. |
| 7 | `mod_speed` | `p7` | Sound modulation speed. |
| 8 | `dummy` | `p8` | Unused padding/dummy value read and ignored by the VM. |

### StopSound

- Opcode: 53 (0x35)
- Handler macro: `SE_STOP`
- Reference name: `StopSound`
- Current Pokeweb name: `StopSound`
- Boundary: Pure script sound command.

Stop a sound effect player.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `player` | `p0` | Sound player/channel index. Default player is resolved automatically when requested. |

Notes:

- Legacy alias CMD_35 is still accepted; new scripts decompile to StopSound.

### SwitchAudioSide

- Opcode: 54 (0x36)
- Handler macro: `SE_PAN`
- Reference name: `SoundPan`
- Current Pokeweb name: `SwitchAudioSide`
- Boundary: Pure script sound command.

Animate sound panning.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `player` | `p0` | Sound player/channel index. Default player is resolved automatically when requested. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `start` | `p2` | Starting value. |
| 3 | `end` | `p3` | Ending value. |
| 4 | `start_wait` | `p4` | Delay before starting the transition. |
| 5 | `frame` | `p5` | Duration in frames. |
| 6 | `wait` | `p6` | Delay/wait in frames. |
| 7 | `count` | `p7` | Repeat count / number of cycles. |

### AdjustSound

- Opcode: 55 (0x37)
- Handler macro: `SE_EFFECT`
- Reference name: `SoundEffect`
- Current Pokeweb name: `AdjustSound`
- Boundary: Pure script sound command.

Animate a sound parameter/effect.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `player` | `p0` | Sound player/channel index. Default player is resolved automatically when requested. |
| 1 | `type` | `p1` | Mode/interpolation selector. Meaning depends on command; command processing commonly uses it as movement/blend direction. |
| 2 | `param` | `p2` | Work/parameter selector or value, depending on command. |
| 3 | `start` | `p3` | Starting value. |
| 4 | `end` | `p4` | Ending value. |
| 5 | `start_wait` | `p5` | Delay before starting the transition. |
| 6 | `frame` | `p6` | Duration in frames. |
| 7 | `wait` | `p7` | Delay/wait in frames. |
| 8 | `count` | `p8` | Repeat count / number of cycles. |

### PlayPokemonCry

- Opcode: 67 (0x43)
- Handler macro: `NAKIGOE`
- Reference name: `PlayPokemonCry`
- Current Pokeweb name: `PlayPokemonCry`
- Boundary: Pure script sound command.

Play Pokemon cry.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `pitch` | `p1` | Pitch value. |
| 2 | `volume` | `p2` | Volume value. |
| 3 | `chorus_vol` | `p3` | Cry chorus volume. |
| 4 | `chorus_speed` | `p4` | Cry chorus speed. |
| 5 | `play_dir` | `p5` | Cry playback direction/side setting. |
| 6 | `wait` | `p6` | Delay/wait in frames. |

## VM/Flow

### LetCMDsFinish

- Opcode: 56 (0x38)
- Handler macro: `EFFECT_END_WAIT`
- Reference name: `EffectEndWait`
- Current Pokeweb name: `LetCMDsFinish`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Wait for pending effect commands to complete.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `kind` | `p0` | Effect wait kind/group. |

Notes:

- Used heavily before/after background/camera/audio changes to wait for a group/kind of pending commands.

### Wait

- Opcode: 57 (0x39)
- Handler macro: `WAIT`
- Reference name: `Wait`
- Current Pokeweb name: `Wait`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Wait a fixed number of frames.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `wait` | `p0` | Delay/wait in frames. |

Notes:

- This is a VM wait only; it does not automatically wait for emitters/sounds unless paired with EFFECT_END_WAIT/LetCMDsFinish.

### AudioContainer

- Opcode: 58 (0x3a)
- Handler macro: `CONTROL_MODE`
- Reference name: `ControlMode`
- Current Pokeweb name: `AudioContainer`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Change VM/control mode.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `mode` | `p0` | VM control mode. |

Notes:

- This is VM control flow, not an audio container. Documented values are 0 = continue and 1 = suspend.

### CheckMoveuser

- Opcode: 59 (0x3b)
- Handler macro: `IF`
- Reference name: `If`
- Current Pokeweb name: `CheckMoveuser`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Branch based on a work value.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `work` | `p0` | Work/parameter selector or value, depending on command. |
| 1 | `cond` | `p1` | Condition operator used by branch commands. |
| 2 | `value` | `p2` | Immediate value to compare or assign. |
| 3 | `adrs` | `p3` | Branch target label/address. |

Notes:

- Old/current naming pointed at the move user, but the handler command is a general IF against a work value.
- Legacy alias CheckMoveUser is still accepted; new scripts decompile to CheckMoveuser.

### IfWork

- Opcode: 60 (0x3c)
- Handler macro: `IF_WORK`
- Reference name: `IfWork`
- Current Pokeweb name: `IfWork`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Branch by comparing two work values.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `src` | `p0` | Work/parameter selector or value, depending on command. |
| 1 | `cond` | `p1` | Condition operator used by branch commands. |
| 2 | `dst` | `p2` | Work/parameter selector or value, depending on command. |
| 3 | `adrs` | `p3` | Branch target label/address. |

Notes:

- Legacy alias CMD_3c is still accepted; new scripts decompile to IfWork.

### McssPositionCheck

- Opcode: 61 (0x3d)
- Handler macro: `MCSS_POS_CHECK`
- Reference name: `McssPositionCheck`
- Current Pokeweb name: `McssPositionCheck`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Branch/check based on battle position state.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |
| 1 | `cond` | `p1` | Condition operator used by branch commands. |
| 2 | `adrs` | `p2` | Branch target label/address. |

Notes:

- Legacy alias CMD_3d is still accepted; new scripts decompile to McssPositionCheck.

### SetWork

- Opcode: 62 (0x3e)
- Handler macro: `SET_WORK`
- Reference name: `SetWork`
- Current Pokeweb name: `SetWork`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Set the generic sequence work value.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `value` | `p0` | Immediate value to compare or assign. |

Notes:

- Legacy alias CMD_3e is still accepted; new scripts decompile to SetWork.

### GetWork

- Opcode: 63 (0x3f)
- Handler macro: `GET_WORK`
- Reference name: `GetWork`
- Current Pokeweb name: `GetWork`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Read a work value into the generic sequence work value.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `work` | `p0` | Work/parameter selector or value, depending on command. |

Notes:

- Legacy alias CMD_3f is still accepted; new scripts decompile to GetWork.

### SetParam

- Opcode: 64 (0x40)
- Handler macro: `SET_PARAM`
- Reference name: `SetParam`
- Current Pokeweb name: `SetParam`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Set a named work/parameter value.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `work` | `p0` | Work/parameter selector or value, depending on command. |
| 1 | `param` | `p1` | Work/parameter selector or value, depending on command. |

Notes:

- Legacy alias CMD_40 is still accepted; new scripts decompile to SetParam.

### Substitute

- Opcode: 65 (0x41)
- Handler macro: `MIGAWARI`
- Reference name: `Substitute`
- Current Pokeweb name: `Substitute`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Handle Substitute doll display/state.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `sw` | `p0` | Boolean/state flag. |
| 1 | `pos` | `p1` | Target battle position/object selector. |
| 2 | `flag` | `p2` | Boolean/state flag. |

Notes:

- Legacy alias CMD_41 is still accepted; new scripts decompile to Substitute.

### Transform

- Opcode: 66 (0x42)
- Handler macro: `HENSHIN`
- Reference name: `Transform`
- Current Pokeweb name: `Transform`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Handle Transform animation/state.

Parameters: none.

Notes:

- Legacy alias CMD_42 is still accepted; new scripts decompile to Transform.

### BallMode

- Opcode: 68 (0x44)
- Handler macro: `BALL_MODE`
- Reference name: `BallMode`
- Current Pokeweb name: `BallMode`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Switch ball/capture particle mode.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `pos` | `p0` | Target battle position/object selector. |

Notes:

- Legacy alias CMD_44 is still accepted; new scripts decompile to BallMode.

### SetBallObject

- Opcode: 69 (0x45)
- Handler macro: `BALLOBJ_SET`
- Reference name: `SetBallObject`
- Current Pokeweb name: `SetBallObject`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Create/show a ball OBJ sprite.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `index` | `p0` | Object slot/index to create or modify. |
| 1 | `pos` | `p1` | Target battle position/object selector. |
| 2 | `ofs_x` | `p2` | X offset applied before emission/rendering. |
| 3 | `ofs_y` | `p3` | Y offset applied to the command logic and destination positions. |
| 4 | `scale_x` | `p4` | X scale target/multiplier. |
| 5 | `scale_y` | `p5` | Y scale target/multiplier. |

Notes:

- Legacy alias CMD_45 is still accepted; new scripts decompile to SetBallObject.

### CallSequence

- Opcode: 70 (0x46)
- Handler macro: `CALL`
- Reference name: `CallSequence`
- Current Pokeweb name: `CallSequence`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Call another move-animation subroutine/sequence.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `seq_no` | `p0` | Sequence/subroutine number. |
| 1 | `atk_pos` | `p1` | Attack position override for called sequence. |
| 2 | `def_pos` | `p2` | Defence position override for called sequence. |

Notes:

- This is the VM-level subroutine call with attacker/defender overrides. Our current community macro exposes only one argument as CallMoveAnimation; called scripts may still rely on VM context.
- This is the true VM-level CALL and includes attacker/defender position overrides. It is distinct from opcode 74.
- Legacy alias CMD_46 is still accepted; new scripts decompile to CallSequence.

### Return

- Opcode: 71 (0x47)
- Handler macro: `RETURN`
- Reference name: `Return`
- Current Pokeweb name: `Return`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Return from a called subroutine.

Parameters: none.

Notes:

- Legacy alias CMD_47 is still accepted; new scripts decompile to Return.

### CheckMoveUserElse

- Opcode: 72 (0x48)
- Handler macro: `JUMP`
- Reference name: `Jump`
- Current Pokeweb name: `CheckMoveUserElse`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Jump to a label/address.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `adrs` | `p0` | Branch target label/address. |

Notes:

- Old naming suggested a move-user conditional else branch, but the command table marks this is an unconditional jump.

### Pause

- Opcode: 73 (0x49)
- Handler macro: `PAUSE`
- Reference name: `Pause`
- Current Pokeweb name: `Pause`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Pause the sequence VM.

Parameters: none.

Notes:

- Legacy alias CMD_49 is still accepted; new scripts decompile to Pause.

### CallMoveAnimation

- Opcode: 74 (0x4a)
- Handler macro: `SEQ_JUMP`
- Reference name: `SequenceJump`
- Current Pokeweb name: `CallMoveAnimation`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Jump to another sequence.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `seq_no` | `p0` | Sequence/subroutine number. |

Notes:

- This jumps to another sequence number. It is not the same as CALL opcode 70, which has return semantics and position overrides.

### LandingWait

- Opcode: 75 (0x4b)
- Handler macro: `LANDING_WAIT`
- Reference name: `LandingWait`
- Current Pokeweb name: `LandingWait`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Wait for landing-related animation to finish.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `side` | `p0` | Battle side selector, usually attacker/defender. |

Notes:

- Legacy alias CMD_4b is still accepted; new scripts decompile to LandingWait.

### ReverseDrawSet

- Opcode: 76 (0x4c)
- Handler macro: `REVERSE_DRAW_SET`
- Reference name: `ReverseDrawSet`
- Current Pokeweb name: `ReverseDrawSet`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Control MCSS reverse draw order.

| Index | Name | Current arg | Description |
| --- | --- | --- | --- |
| 0 | `flag` | `p0` | Boolean/state flag. |

Notes:

- Legacy alias CMD_4c is still accepted; new scripts decompile to ReverseDrawSet.

### TerminateMoveScript

- Opcode: 77 (0x4d)
- Handler macro: `SEQ_END`
- Reference name: `TerminateMoveScript`
- Current Pokeweb name: `TerminateMoveScript`
- Boundary: Pure script command unless paired with SPA particles elsewhere in the sequence.

Terminate the move-animation script.

Parameters: none.

Notes:

- The handler macro immediately before SEQ_END is LABEL, but LABEL is an assembler helper, not executable opcode 77. Opcode 77 maps to SEQ_END.
