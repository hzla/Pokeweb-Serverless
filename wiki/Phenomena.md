# Phenomena

The Phenomena editor (**Encounters → Phenomena**) sets what happens when the player steps on a cave dust cloud or a flying Pokemon's shadow on Driftveil Drawbridge. Saving installs a code injection patch (PMC) for Black, White, Black 2 or White 2 (English US, revision 0).

## Controls

| Control | Meaning | Example |
| --- | --- | --- |
| Encounter | Chance, in percent, that the spot starts a wild battle. The rest gives an item. | `40` for dust clouds |
| Item | Item the spot can give. Type a name or ID and pick from the list. | `Fire Gem (548)` |
| Weight | Relative weight of the item in its list. | Weights `3` and `1` give `75%` and `25%` |
| Chance | Share of each item, from the weights. | `5.0%` |
| Zone overrides | Different encounter chances or items for listed zones. The first matching override is used. | Shards in Reversal Mountain |
| Reset to retail | Loads the original game's values. | |

Wild battles use the zone's Special Grass slots in the [Encounter editor](Encounters). Shaking grass and rippling water are unchanged.

## Retail Values

| Phenomenon | Encounter | Items |
| --- | --- | --- |
| Dust cloud | `40%` | Evolution stones `1%` each, Gems `5%` each, Everstone `5%` |
| Dust cloud, BW2 Relic Passage and Reversal Mountain | `40%` | Red, Blue, Yellow and Green Shard `25%` each |
| Flying shadow | `20%` | Health, Muscle, Resist, Genius, Clever and Swift Wing `15%` each, Pretty Wing `10%` |

## Notes

* Changes apply after exporting the ROM.
* The Patches page dust-cloud patches are replaced by this editor once it is installed. Use a `100%` encounter chance to stop dust clouds giving items, or remove the Gem rows to stop Gems.
* Up to 48 items per list, 8 zone overrides and 32 zones per override.
