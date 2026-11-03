# Phenomena

Configurable dust clouds (caves) and flying shadows (Driftveil Drawbridge) for
English US revision-0 Black, White, Black 2 and White 2. Edited under
**Encounters → Phenomena**; saving installs PMC if needed and stages
`patches/Phenomena{B,W,B2,W2}.dll`.

## Behavior

When the player steps on a dust cloud or shadow, the retail handler
(`EFFECT_ENCOUNT_TriggerSpot` in overlay 21 for BW1,
`CreateRandomPhenomenonEvent` in overlay 36 for BW2) rolls 0–999 and either
starts a wild battle or gives an item through script `0x2795`. Retail odds:

| Phenomenon | Battle | Item |
|---|---|---|
| Dust cloud | 40% | 10% one of 10 evolution stones, 85% one of 17 Gems, 5% Everstone. BW2 Relic Passage and Reversal Mountain: one of four Shards. |
| Flying shadow | 20% | 90% one of six stat Wings, 10% Pretty Wing |

The runtime redirects three calls inside that handler, so spawning, the battle,
the item script and clearing the spot stay native:

| Call | Replacement |
|---|---|
| `random(1000)` | Returns 0 (battle) or 999 (item) from the configured encounter chance |
| Flying shadow item picker | Weighted pick from the configured table |
| Dust cloud item picker | Weighted pick from the configured table |

Each handler receives the active spot (`r4` at all three call sites), which
holds the zone ID at `+0x00` and the kind at `+0x0C` in both generations. Zone
overrides (up to 8, 32 zones each) can replace the encounter chance, the items,
or both for listed zones; the first matching override wins. Other phenomena
(shaking grass, rippling water) keep the retail roll.

The configuration is a 2516-byte block inside the DLL (`phenomena.h`), written
by `src/pokeweb/phenomenaModel.ts`. A missing or malformed block, or an empty
item table, falls back to the retail roll or picker.

Installing restores the dust-cloud branch changed by the Patches-page
**Remove Items from Cave Dust Clouds** patch; set a 100% encounter chance
instead. Both dust-cloud patches are disabled while the runtime is installed.

## Build and verification

```sh
python3 runtime/phenomena/build.py            # clean ROMs beside the repository
python3 runtime/phenomena/verify.py
```

`--dumps DIR` reads `<IDCODE>_arm9.bin`, `<IDCODE>_ov<N>.bin` and `info.json`
instead of ROMs. `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` select the toolchain and
CTRMap. The build checks the retail instruction shape at every hook, records the
byte signature the installer requires, and reads the default item and zone
tables from the ROM. White (BW1) hooks are derived from Black (overlay 21 loads
0x20 higher in White, with the same code) when its ROM is absent, and the
manifest marks them `retailChecked: false`; the installer still compares the
user's ROM against that signature.

`verify.py` links the runtime at a fixed address and executes the retail
handler from its roll to the battle or item call under Unicorn, with the retail
random generator: retail distributions for a bare DLL, configured odds and
weights, zone overrides, and fallbacks. These are CPU-level checks; in-game
behavior has not been verified on hardware or an emulator.
