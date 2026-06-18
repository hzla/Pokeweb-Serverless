# Move Animation Editor

The Move Animation Editor edits the binary animation script used by a move and the referenced SPA particle archives.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `moves` | Move list and animation IDs. |
| `move_animations` | Move animation script archive. |
| `battle_animations` | Referenced battle animation resources. |
| `move_spas` | SPA particle archives. The editor can lazy-load this from the ROM when original bytes are available. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Move selector | Choose which move animation to edit. |
| Test in Game | Builds a move test battle when supported. |
| Apply Script | Compiles and saves the current text script. |
| Revert | Restores the last applied script text. |
| Refresh Preview | Rebuilds the preview from current script text and SPA edits. |
| Import Binary | Imports a raw animation binary. |
| Export Binary | Exports the compiled animation binary. |
| Command reference | Click a command in the script to see parameter help. |
| SPA Particle Editor | Loads SPA archives referenced by the script and edits particle emitters/textures. |

## Script Format

Simple scripts can be written as command lines:

```asm
LoadSPA 218
DoSPAAnimation 0, 0, 0, 0
LetCMDsFinish
TerminateMoveScript
```

Scripts with multiple entrypoints use a full header:

```asm
.include "B2W2_MOVSCRCMD.s"
.align 4

.word 1 @ Count
.word START
.word START
.word START
.word START

START:
     LoadSPA 218
     DoSPAAnimation 0, 0, 0, 0
     LetCMDsFinish
     TerminateMoveScript
```

Notes:

| Rule | Meaning |
| --- | --- |
| Commands use spaces and comma-separated numeric parameters. | `LoadSPA 218` or `DoSPAAnimation 0, 0, 0, 0` |
| Labels end with `:`. | `START:` |
| Full scripts need `.word` header entries that point to labels. | Header entries choose entrypoints. |
| Each entrypoint must terminate. | Use a terminating command such as `TerminateMoveScript`. |
| Comments are allowed after commands. | Use normal assembler-style comments when decompiled text includes them. |

## SPA Concepts

SPA files are particle archives. A move script usually loads a SPA archive and then plays one or more emitters from it.

| Term | Meaning |
| --- | --- |
| SPA archive | A particle file, selected by ID. |
| Emitter/resource | One particle effect inside the SPA, such as smoke, sparks, a projectile trail, or a flash. |
| Texture | Image used by particle sprites. |
| Resource index | Which emitter inside the archive a command plays. |

## Common SPA Commands

| Command | Plain-language meaning |
| --- | --- |
| `LoadSPA` | Loads a particle archive by SPA/data ID. |
| `DoSPAAnimation` | Creates one emitter from a loaded SPA archive. |
| `DoSPAScreenAnimation` | Plays a screen-space particle effect. |
| `DoSPAAnimation2` | Variant particle spawn command. |
| `DoSPAProjectileAnimation` | Plays a projectile-style particle effect. |
| `DoSPAProjectileAnimation2` | Projectile variant. |
| `DoSPAProjectileAnimation3` | Projectile variant. |
| `DoSPACircleAnimation` | Plays particles around a circular path/shape. |

For particle commands, the first parameter is normally the SPA archive/data ID or the resource selector depending on command. Use the command reference panel for the selected command before editing parameters.

## SPA Particle Fields

| Field | Meaning | Example |
| --- | --- | --- |
| SPA | Selected referenced particle archive. | `218` |
| Emitter | Selected resource inside the SPA. | `0` |
| Emission Type | Shape new particles spawn from: point, sphere, circle, cylinder, hemisphere, and variants. | `Point`, `Circle Border` |
| Emission Axis | Main axis for circle/cylinder/directional movement. | `Y` |
| Emitter Base Position | Offset for the whole emitter. | X `0`, Y `16`, Z `0` |
| Emitter Lifetime Frames | How long the emitter creates particles. `30` frames is roughly one second. | `30` |
| Emission Amount | Particles created per emission. | `4` |
| Emission Interval | Frames between emissions. Lower is denser. | `1`, `5` |
| Start Delay | Frames before particles start. | `0`, `10` |
| Radius / Length | Size of spawn shapes. | `20` |
| Draw Type | How particles face the camera or direction. | `Billboard` |
| Texture Index | Texture used by the emitter. | `0` |
| Rotate / Random Init Angle | Spin controls. | checked |
| Follow Emitter | Particles stay attached to a moving emitter. | unchecked |
| Color | Texture tint. White keeps original colors. | `#ffffff` |
| Base Scale | Starting particle size. | `1` |
| Base Alpha | Particle opacity. | `1` |
| Particle Lifetime | How long each particle lives. | `20` |
| Aspect Ratio | Stretches particle width/height. | `1` |
| Init Velocity Pos/Axis | Starting velocity from position or along axis. | `0.5` |
| Air Resistance | Velocity damping over time. | `0.95` |
| Scale/Alpha/Texture Anim | Time-based scale, opacity, or texture changes. | start `1`, end `0` |
| Behaviors | Forces such as random push, magnet, or convergence. | small values first |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Borrow another move's animation | Set the move's Animation ID in [Moves](Moves), or copy/decompile the donor script. |
| Change particles only | Open the move animation, select referenced SPA, edit emitter fields, Save SPA Edits, Refresh Preview. |
| Add a SPA effect | Add `LoadSPA` and a matching `DoSPA...` command, then preview and test. |
| Export a script binary | Click Export Binary after the script compiles. |

## Caveats

Animation scripts are code-like data. A script that does not terminate, references a missing label, or uses the wrong number of command parameters will not compile. SPA edits can make effects expensive or visually noisy, so change particle counts and lifetimes gradually.

## Related Pages

- [Moves](Moves)
- [Move Effect Handlers](Move-Effect-Handlers)
- `move-animation-reference/move-animation-reference.md` in the repo
