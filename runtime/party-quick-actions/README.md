# Party Toolbar

Install under **Code Injection → Graphical/UI Enhancements → Enhanced Party Menu**.
Supports checked US revision-0 Black/White and Black 2/White 2 with separate
native adapters. Infinite Candy item 622 is required for its Candy control;
the BW2 installer stages that dependency atomically. Enhanced Party Menu and
Battle Log are otherwise optional.

Touch an icon or press L to navigate the toolbar with Left/Right and A; B/L
returns to party selection. The selected Pokémon stays locked while navigating.
Only normal field Party selection exposes the toolbar. Native applications and
other Party request modes retain their own controls.

| Control | Action |
| --- | --- |
| Candy | Native level-up, move-learning and evolution flow; item is retained. |
| Heal | Confirm healing of living, non-Egg party members; EXP/PP unchanged. |
| HP | Adjust selected member's HP with Left/Right, bounded by zero/max. |
| EXP | Confirm setting EXP to one below the next level; level-100/Eggs ignored. |
| Status | Set or clear native SLP/PSN/BRN/FRZ/PAR; new status needs positive HP. |

Optional saved flags hide the whole toolbar or Candy/Heal/HP/EXP/Statuses.
Blank means always available. Flags are read-only; hidden controls have no touch
target and remaining icons pack left. Visibility changes cancel incompatible
pending actions without modifying Pokémon. Disable restores the native prompt
and leaves previous Pokémon changes intact.

The private archive is `party-tools/ui.narc`. Native resources are owned until
their queued uploads/applications finish; partial failures release resources and
retain the native menu. Build/check with `npm run partytools:build` and
`npm run partytools:verify`; BW1 uses the `:build-bw1` / `:verify-bw1` variants.
BW1 bundle acceptance is tied to exact hashes. Hardware/live DSi and other ROM
revisions require independent testing.
