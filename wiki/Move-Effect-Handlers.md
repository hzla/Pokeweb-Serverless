# Move Effect Handlers

The Move Effect Handlers editor exposes the table that maps move effect rows to battle code handler addresses. This is an advanced editor for code-aware move behavior work.

## Required Data

| Data | Why it is needed |
| --- | --- |
| `moves` | Move names and count. |
| Overlay data | The handler table lives in overlay `93` for BW and overlay `167` for BW2. |

## Fields

| Field | Meaning | Example |
| --- | --- | --- |
| # | Handler table row index. There are `258` rows. | `0`, `257` |
| Move | Move assigned to this handler row. Accepts a move name or ID. | `Flamethrower` |
| Handler Address | ARM address for the battle effect handler. Accepts decimal or `0x` hex. | `0x021D1234` |
| History | Recent edits to handler rows in the changelog. | `Flamethrower handler changed...` |

## Addresses

Handler addresses are code pointers. A value of `0x00000000` usually means no handler or intentionally disabled behavior. Non-zero values should point to valid battle code for the loaded ROM version.

## Common Workflows

| Goal | Steps |
| --- | --- |
| Make a custom move reuse existing behavior | Find a move with the behavior you want and copy its handler address to the target row. |
| Disable a behavior hook | Set the handler address to `0x00000000` only if you know the game tolerates it. |
| Search for a handler | Search by move name, move ID, decimal address, or hex address. |

## Caveats

This editor does not create new code. It only changes which existing address a row points to. Invalid addresses can crash battles. If you add new behavior through code injection, document the address and ROM version before assigning it here.

## Related Pages

- [Moves](Moves)
- [Code Injection and Patches](Code-Injection-and-Patches)
- [Move Animation Editor](Move-Animation-Editor)
