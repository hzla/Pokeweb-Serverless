# Marts

The Mart editor edits BW2 shop inventories.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `marts` | Shop inventory records. |
| `mart_counts` | Per-mart item count table, automatically synced when inventory changes. |
| `message_texts` | Item names. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| ID | Mart record ID. | `0` |
| Location/Description | Built-in label from Pokeweb's location reference. | `Aspertia City` |
| Inventory | Summary of non-None items in the mart. | `Potion, Poke Ball` |
| Item 0-19 | Shop item slots. `None`/item ID `0` means empty. | `Potion` |

## Common Workflows

| Goal | Steps |
| --- | --- |
| Add an item to a shop | Expand a mart, edit an empty item slot to the item name. |
| Remove an item | Set the item slot to `None`. |
| Replace a shop inventory | Edit slots 0-19. The editor syncs `mart_counts` based on non-empty slots. |

## Caveats

This editor is BW2-focused. The inventory count is synced from the number of non-None item slots, so leave unused slots as `None` instead of repeating filler items.

## Related Pages

- [Items](Items)
- [Texts](Texts)
- [File System](File-System)
