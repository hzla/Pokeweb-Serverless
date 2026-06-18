# Grottos

The Hidden Grotto editor edits BW2 Hidden Grotto Pokemon, item pools, levels, genders, forms, and odds.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `grottos` | Hidden Grotto content records. |
| `grotto_odds` | Odds table for rarity groups. |
| `message_texts` | Pokemon and item names. |

## Main Controls

| Control | Meaning |
| --- | --- |
| Search | Filters grottos by location or contents. |
| Edit Odds | Opens the Grotto Odds editor. |
| Grottos | Returns from odds to the main Grotto editor. |

## Pokemon Fields

Pokemon slots are split by version (`black`, `white`) and rarity (`common`, `uncommon`, `rare`). Each version/rarity group has four slots.

| Field | Meaning | Example |
| --- | --- | --- |
| Pokemon | Species in the slot. | `Eevee` |
| Min | Minimum level. Range `0-100`. | `10` |
| Max | Maximum level. Range `0-100`. | `15` |
| F/M | Gender value. The editor stores a numeric gender selector from the grotto format. | `0`, `1`, `2` |
| Form | Form ID. Range `0-100`. | `0` |

## Item Fields

Item pools are split into normal items and hidden items, each with rarity groups.

| Item type | Rarities | Meaning |
| --- | --- | --- |
| Normal Items | Common, Uncommon, Rare, Super Rare | Visible item pool. |
| Hidden Items | Common, Uncommon, Rare, Super Rare | Hidden item pool. Common hidden odds are calculated from the remaining percent. |

Each item group has four item slots.

## Odds Fields

| Column | Meaning |
| --- | --- |
| R Pok | Rare Pokemon odds. |
| UC Pok | Uncommon Pokemon odds. |
| CM Pok | Common Pokemon odds. |
| SR Item | Super Rare normal item odds. |
| R Item | Rare normal item odds. |
| UC Item | Uncommon normal item odds. |
| CM Item | Common normal item odds. |
| SR H-Item | Super Rare hidden item odds. |
| R H-Item | Rare hidden item odds. |
| UC H-Item | Uncommon hidden item odds. |
| CM H-Item | Not directly editable. It is `100 - all other odds` for that grotto. |

All editable odds accept `0-100`.

## Common Workflows

| Goal | Steps |
| --- | --- |
| Change a grotto's Pokemon | Search the location, expand it, edit Black/White Pokemon slots by rarity. |
| Make one species common | Put it in Common slots and set common Pokemon odds high enough. |
| Add rare hidden items | Edit Hidden Items Super Rare/Rare slots, then set corresponding odds. |
| Keep Black and White versions matching | Copy species/item values into both version columns. |

## Caveats

Odds are per rarity group, not per individual slot. If a rarity group has four slots, the game chooses within that group after the rarity is selected. Keep total odds sane; Common Hidden Item odds are calculated from the remaining percent.

## Related Pages

- [Encounters](Encounters)
- [Items](Items)
- [Pokemon Personal](Pokemon-Personal)
