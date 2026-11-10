# Marts

The Mart editor edits shop inventories in Black 2 / White 2 (mart NARC) and Black / White (tables in overlay 21).

## Required Data

| Data | Why it is needed |
| --- | --- |
| `marts` | Shop inventory records. |
| `mart_counts` | Per-mart item count table, automatically synced when inventory changes. |
| `message_texts` | Item names. |
| Loaded ROM (BW1) | Overlay 21 shop tables. |

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

## Black and White

Black and White keep their shop lists in overlay 21, so the page needs the ROM loaded in this session.

| Marts | What they are |
| --- | --- |
| Poké Mart: N badges (0-5) | The standard cashier in every Pokémon Center; the list depends on the badge count. |
| City names, Driftveil Market, Shopping Mall Nine (6-25) | The second cashier and the specialty shops. |
| Gear Station: BP items / BP TMs | The Battle Subway BP shops; each entry has its own BP price. |

Each list holds its retail number of items. **Expand inventories (PMC)** in the page header moves every list into a generated code injection module (`patches/PokewebMarts{B,W}.dll`, PMC is installed first if needed), after which every shop can hold up to 40 items. **Remove expansion** puts the lists back into the overlay once every shop fits its retail size again. Regular item prices come from the [Items](Items) editor.

## Caveats

In BW2 the inventory count is synced from the number of non-None item slots, so leave unused slots as `None` instead of repeating filler items. In BW1, clearing a slot removes it and the items below move up. The Black City / White Forest resident shops are built from the save and are not listed.

## Related Pages

- [Items](Items)
- [Texts](Texts)
- [File System](File-System)
