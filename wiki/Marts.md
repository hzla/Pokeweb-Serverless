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

## Battle Point Shops

Open **Items → Battle Point Shops** and choose **Items** or **TMs**. Edit the item and its price in BP, or add and remove offers within the current inventory capacity. In Black 2 and White 2, Battle Subway and the Pokémon World Tournament share the same stock and prices. The supported US BW2 layout holds up to 42 items and 18 TMs.

## Join Avenue

Open **Items → Join Avenue** in Black 2 or White 2. Choose a shop type, the shop owner’s game, and the shop rank. Each rank has up to 16 offers. Item offers have an item, quantity, and base price. Service offers use the game's service presets for that shop type and have an editable base price. Enter prices in multiples of 10 Poké Dollars. Edits apply to the selected stock list, and the game applies its normal discounts at checkout. Raffle prizes are drawn from a separate table.

## Black City Market

Open **Items → Black City Market** in Pokémon Black. Edit the item and price tied to each of the 30 resident records. Which offers are available in-game depends on the residents in the save.

## Special Vendors

Open **Items → Special Vendors**. **Scripted vendors** covers vending machines, the Castelia and Driftveil stands, the Marvelous Bridge Pokémon seller, Royal Unova tickets, and the Move Reminder. BW2 also includes the Route 5 and Skyarrow Bridge sellers, Shopping Mall Nine’s evening deals, and the weekday and weekend offers in Black City and White Forest. The editor updates associated stock text where it can match the original item or price. Use **Story Text** to revise custom dialogue or promotional wording.

In BW and BW2, **Item collectors** edits which items each collector buys and the payout. **Day Care** edits the base withdrawal fee and the charge per level gained, each from 0 to 255 Poké Dollars. BW2 also has **Funfest sales**, **Funfest exchanges**, and the **Join Avenue raffle** and **Antique appraisals** prize tables. Prize weights are relative to the sum of the weights in the selected table.

Special Vendors edits existing script operands, archives, or code and data in the supported US overlays. Day Care patches its existing fee routine in place. Funfest edits the existing overlay tables. These changes are included in a normal ROM export without installing a code injection module.

## Caveats

In BW2 the inventory count is synced from the number of non-None item slots, so leave unused slots as `None` instead of repeating filler items. In BW1, clearing a slot removes it and the items below move up.

## Related Pages

- [Items](Items)
- [Texts](Texts)
- [File System](File-System)
