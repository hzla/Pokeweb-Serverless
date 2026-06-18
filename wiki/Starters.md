# Starters

The Starters editor changes the three starter Pokemon and updates related scripts, starter sprites, type text, and overlay references.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `personal` | Species list and type display. |
| `pokemon_sprites` | Source sprite graphics/palettes copied into starter UI files. |
| `starter_sprites` | Starter selection graphics/palettes. |
| `scripts` | Starter gift script references. |
| `story_texts` | Starter type text. |
| Starter overlay | Required for applying overlay-level starter references. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| Left | Left starter slot. | `495 - Snivy` |
| Middle | Middle starter slot. | `498 - Tepig` |
| Right | Right starter slot. | `501 - Oshawott` |
| Type label | Read-only primary type of the selected species. | `Grass` |
| Apply | Writes starter changes to scripts, sprites, text, and overlay state. |

## What Apply Changes

| Area | Change |
| --- | --- |
| Scripts | Replaces starter species IDs in starter-gift commands and related word-setting commands. |
| Starter sprites | Copies front graphics and palettes from the selected Pokemon into starter selection files. |
| Story text | Updates detected starter type text when possible. |
| Overlays | Updates starter species references in the starter selection overlay. |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Replace all starters | Pick Left/Middle/Right species, verify types, click Apply, export ROM. |
| Use custom starter sprites | First import/edit the Pokemon's own sprite files, then apply the starter change so starter sprites are copied from the updated source. |
| Fix detection warning | Reload the ROM with Starter Sprites and required overlays selected, then reopen Starters. |

## Caveats

The editor expects exactly three starters. If current starters cannot be detected from scripts or overlays, it uses vanilla Snivy, Tepig, and Oshawott as the baseline. Applying changes requires the relevant starter overlay to be loaded.

## Related Pages

- [Pokemon Personal](Pokemon-Personal)
- [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations)
- [Texts](Texts)
