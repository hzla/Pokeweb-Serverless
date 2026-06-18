# Type Chart

The Type Chart editor edits type effectiveness. Rows are attacking types and columns are defending types.

## Required Data

| Data | Why it is needed |
| --- | --- |
| BW2 overlay/type chart data | The editor reads the type chart from overlay `167` or `type_chart.bin` when present. |
| Fairy support data | Needed for an 18-type chart that includes Fairy. |

## Values

| UI value | Stored value | Meaning |
| --- | --- | --- |
| `0` | `0` | No effect, 0x damage. |
| `.5` | `2` | Not very effective, 0.5x damage. |
| `1` | `4` | Normal effectiveness, 1x damage. |
| `2` | `8` | Super effective, 2x damage. |

## Type Count

| Chart | Types |
| --- | --- |
| Vanilla Gen 5 | 17 types, no Fairy. |
| Fairy-aware project | 18 types, including Fairy. |

The editor detects Fairy support from the project/session, personal data, move data, or a loaded 18x18 type chart file.

## Common Workflows

| Goal | Steps |
| --- | --- |
| Make Ice resist Water | Find Ice row or Water column depending on the matchup. Rows attack, columns defend. For Water attacking Ice, edit Water row / Ice column. |
| Add Fairy matchups | Apply Fairy Type Support first, then edit the Fairy row/column values. |
| Export calc data with custom chart | Generate calc data after editing; custom charts are included when they differ from standard charts. |

## Caveats

Rows are attack types. Columns are defending types. This is the easiest mistake to make. Type chart edits affect battle effectiveness, but Pokemon and move typings are edited elsewhere.

## Related Pages

- [Pokemon Personal](Pokemon-Personal)
- [Moves](Moves)
- [Code Injection and Patches](Code-Injection-and-Patches)
- [Calc Generation](Calc-Generation)
