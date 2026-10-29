# Single-NPC Double Battle Fix

Allows an unpaired Double trainer to start a native double battle with two usable
player Pokémon. Paired NPC battles retain their normal two-slot setup; other
battle formats keep native party-size checks.

The Black 1 module supports US revision-0 IRBO with BW1 PMC and replaces two
field-overlay-21 functions. White 1 is not bundled. Black 2/White 2 use separate
bundled DLLs. The BW2 fix is credited to **Sunk** and **Papaya**; the Black 1
implementation follows the native trainer flow and the same behavior.

Build with `python3 runtime/double-battle-fix/build.py`; run
`python3 runtime/double-battle-fix/test_runtime.py` for compiled checks. The
installer verifies the supported native sites and rejects conflicts. Full battle
and dialogue playtesting remains necessary; CPU checks do not establish it.
