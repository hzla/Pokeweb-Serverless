# Autorun (US Black, White, Black 2, White 2)

With the Running Shoes, moving runs without holding B; holding B walks (and,
as in retail when walking, lets a tapped direction turn in place). An Autorun
On/Off row on the in-game Options screen turns it off; existing saves start
with it on. Install it from Code Injection > Quality of Life.

## How it works

The field controllers pass the held keys to the player through two small
`FieldPlayer` wrappers in the field overlay (ov021 in BW1, ov036 in BW2):

| Wrapper | BW2 decomp name | B | W | B2 | W2 |
|---|---|---|---|---|---|
| Grid movement | `FieldPlayer_UpdateGridMovement` | `0x021a35f0` | `0x021a3610` | `0x0219ac58` | `0x0219ac98` |
| Rail movement | `FieldPlayer_UpdateRailMovement` | `0x021a3674` | `0x021a3694` | `0x0219acdc` | `0x0219ad1c` |

`AutorunB/W/B2/W2.dll` replaces each wrapper with one `THUMB_BRANCH` (12 bytes;
both wrappers are exactly that long) and XORs B (`0x2`) into the held keys
before calling the original target. The grid controller already passes
`MOVE_FLAG_CAN_RUN` (Running Shoes flag `0x963`); the rail wrapper checks the
shoes itself. Nothing else reads the adjusted keys.

"Autorun off" is reserved CONFIG bit 12 (bits 11–15 are unused in both games;
Following Pokémon uses bit 11). The row is drawn by the shared Options rows
module, see `runtime/option-rows/README.md`.

`games.json` holds the hook sites, their retail bytes and the native
bindings (taken from the pokebw2 and aletheia decomps and checked against the
clean ROMs). The installer checks the bytes again on the loaded ROM and
refuses another DLL that relocates into either wrapper.

## Build and check

```sh
python3 runtime/autorun/build.py            # src/assets/codeinjection/Autorun*.dll + autorunManifest.json
python3 runtime/autorun/build.py --test     # build/<game>-test: also records the grid position
npx vite-node runtime/autorun/emulator.ts /path/clean.nds --dll runtime/autorun/build/W2-test/AutorunW2.dll [--hold-b]
```

The emulator check holds each direction for 32 frames from a standstill:
running covers 4–5 tiles, walking (with `--hold-b`) 2. Checked on all four
clean US ROMs. The rail hook is signature-checked but has not been walked in
the emulator; rails appear only on a few maps.
