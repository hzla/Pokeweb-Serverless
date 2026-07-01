# Move Animation Workflow Guides

[Back to Move Animation Editor](Move-Animation-Editor)

Use these workflows from simplest to most complex. The common theme is to separate script sequencing from SPA particle data before editing.

## 1. Copy A Donor Animation

Script-only steps:

1. Resolve the donor move ID to its actual animation member.
2. Decompile the donor script.
3. Preview the unedited script.
4. Remove unwanted waits, backgrounds, sounds, and camera commands.
5. Recompile/import the edited script.

SPA steps:

1. List every `LoadSPA` and `Emit*` command.
2. Identify which SPA resources are actually visible.
3. Clone donor SPAs before changing custom textures, colors, scale curves, or behaviors.

## 2. Recolor Or Hue-Shift A Donor

Start with script commands:

- `ChangeSpriteColor`
- `ChangeBackgroundColor`
- `ObjectPaletteFade`
- `BackgroundPaletteAnimation`
- Other palette/background commands

Then inspect SPA fields:

- `resource.color`
- `resource.colorAnim`
- `resource.alphaAnim`
- `resource.childResource.color`
- `resource.texAnim`
- texture RGBA/palette data

If the particle changes color over time, do not flatten it unless the request asks for a uniform color. Replace the donor curve with a new curve in the requested color family.

## 3. Splice Multiple Donors

Script-only considerations:

- Load all needed SPAs before spawning them.
- Preserve waits only when they still match the new sequence.
- Remove donor `PlaySound` commands unless requested.
- Remove donor `LoadBackground` and background commands unless requested.
- Use `LetCMDsFinish` carefully. It waits for pending commands, but not every visual persistence problem is solved by it.

SPA considerations:

- Do not edit a vanilla donor SPA globally when only one custom move should change.
- Clone resources/textures into a new SPA or append a custom SPA.
- Repoint `LoadSPA` and all `Emit*` commands together.
- Scrub donor curves and behaviors one at a time.

## 4. Projectiles

Script controls:

- Spawn command variant.
- SPA ID and resource ID.
- Anchor selectors.
- Start/end offsets.
- Travel timing and waits.
- Camera position during travel.
- Impact sound/shake timing.

SPA controls:

- Texture shape.
- `baseScale`.
- `aspectRatio`.
- `scaleAnim`.
- `emitterBasePos`.
- `drawType`.
- `initAngle` and random angle.
- `particleLifeFrames`.
- Behaviors such as gravity, collision, spin, magnet, and convergence.

Debug order:

1. Confirm the right texture is visible.
2. Confirm the SPA resource is the correct size without script motion.
3. Confirm the projectile command moves in the expected direction.
4. Adjust timing after position and size are correct.

## 5. User And Target Sprite Movement

Common script commands:

- `ShakeSprite`
- `MoveSprite`
- `MoveSpriteSine`
- `ScaleSprite`
- `RotateSprite`
- `AdjustSpriteOpacity`
- `ApplySpriteMosaic`
- `ToggleFreezeSprite`
- `ChangeSpriteColor`
- `ToggleSpriteVisibility`
- `ToggleSpriteShadow`
- `ScaleSpriteShadow`
- `DeletePokemon`
- `Transform`

Selector reminders:

- User sprite selector: commonly `14`.
- Target sprite selector: commonly `16`.
- Target camera selector is different, commonly `11`.
- User camera selector is different, commonly `9`.

Do not substitute camera selectors for sprite commands or sprite selectors for camera commands.

## 6. Backgrounds

Useful commands:

- `LoadBackground`
- `ApplyBackground`
- `MoveBackground`
- `DistortBackground`
- `BackgroundAlpha`
- `BackgroundPriority`
- `ChangeBackgroundColor`
- `BackgroundPaletteAnimation`

When borrowing from a donor, copy only the background portion. Some moves pair a background fade with sprite freeze, silhouette, or sounds. Remove those unrelated commands unless the requested animation needs them.

## 7. Sounds

Useful commands:

- `PlaySound`
- `StopSound`
- `SwitchAudioSide`
- `AdjustSound`
- `AudioContainer`
- `PlayPokemonCry`

Guidance:

- Existing commands can play existing sounds. They do not add new sound banks.
- Repeated/staggered `PlaySound` commands can sell volleys or sequential impacts.
- Always remove donor sound effects when the user asks to copy only a visual component.

## 8. Troubleshooting

Particle is wrong color:

- Check script color commands.
- Check resource tint.
- Check color animation.
- Check child color.
- Check texture pixels and palette.

Particle is too small/large:

- Check script spawn scale/offsets.
- Check `baseScale`.
- Check `aspectRatio`.
- Check `scaleAnim`.
- Check source texture dimensions.

Particle appears too early/late:

- Check script waits.
- Check `startDelayFrames`.
- Check `emitterLifeFrames`.
- Check `particleLifeFrames`.
- Check `emissionIntervalFrames`.

Extra particles appear:

- Check `childResource`.
- Check `emissionCount`.
- Check `EmitAll` usage; older scripts may call the same command `DoSPAAllAnimations`.
- Check texture animation frames.

Projectile misses target:

- Confirm selector type.
- Confirm coordinate direction by changing one axis at a time.
- Check `emitterBasePos` and baked donor offsets.
- Check camera timing.
