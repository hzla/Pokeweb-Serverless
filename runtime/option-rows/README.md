# Options rows (US Black, White, Black 2, White 2)

`PokewebOptionRowsB/W/B2/W2.dll` adds up to two On/Off rows below the five
retail rows of the Options screen. Each row stores "Off" in one reserved
CONFIG bit, so existing saves start with every row on. Rows in use:

| Row | CONFIG bit | Text IDs (label, on, off, help) | Shown when |
|---|---|---|---|
| Following Pokémon (BW2) | 11 | 6, 21, 22, 30 | `following/native.bin` is enabled |
| Autorun | 12 | 19, 13, 14, 29 | always |

Text IDs are entries of the Options bank (`a/0/0/2`, member 32 in BW2, 29 in
BW1). 13/14 are the retail ON/OFF; the others are retail blanks.

The module is generalized from Following Pokémon's single-row Options module
and hooks the same seven call sites (`THUMB_BRANCH_LINK` tail veneers):
`ConfigPanelScroll_Init`/`_Exit`/`_Main` calls, the bar's cursor query, both
change checks and the save commit (BW1: the matching `OPTION_MENU_*` calls).
With two extra rows the list scrolls by one row when the seventh row is
focused (or the sixth is touched) and back near the top.

The row table ("PWOR": count, then `{bit, gate, label, on, off, help}` per
row) is empty in the bundled modules; `src/pokeweb/optionRowsModel.ts` writes
it at install time from what is installed:

- Autorun installs the module and its row.
- With Following Pokémon (stock W2, White2Upgrade, B2), Following's own
  Options module is replaced by the Following package's removed-module stub
  and its row moves into this module (row 6 Followers, row 7 Autorun).
  Following's installer and receipt checks accept that delegated state, and
  its install/removal update the table.

`games.json` holds hook sites and bindings for all four games. They were
derived by pairing the White 2 Options functions (pokebw2 symbols) with Black 2
and with BW1's `OPTION_MENU_*` functions (aletheia) by size and masked bytes,
then pairing the call targets inside them; every hook call target was checked
against the clean ROMs.

## Build and check

```sh
python3 runtime/option-rows/build.py
npx vite-node runtime/option-rows/emulator.ts /path/clean.nds --setup runtime/option-rows/test/setup-autorun.ts --script runtime/option-rows/test/nav-one.json
npx vite-node runtime/option-rows/emulator.ts /path/cleanwhite2.nds --setup runtime/option-rows/test/setup-following-then-autorun.ts --script runtime/option-rows/test/nav-two.json
```

Checked in the emulator on all four clean US ROMs: drawing, key navigation
(including wrap-around and held keys), touch, the change prompt, Confirm, and
the saved bit taking effect in the field; two rows with real Following Pokémon
on White 2, in both install orders.
