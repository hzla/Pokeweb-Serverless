# Single-NPC Double Battle Fix

`DoubleBattleFixB.dll` supports US Black 1 (`IRBO`, revision 0) with Pokeweb's
BW1 PMC runtime. Install **PMC Runtime** first, then **Single-NPC Double Battle
Fix** in Code Injection → Add-ons. White 1 is not bundled. The existing Black 2
and White 2 DLLs remain available separately.

The Black 1 implementation replaces two functions in field overlay 21:

- Trainer sight checks at `0x021ae0cc`: a Double trainer with no paired map
  actor uses one trainer setup slot. The trainer's battle type still determines
  the battle rule. Two usable party Pokémon are required; paired NPC battles
  keep their existing two-slot format. Single, Triple, and Rotation checks
  retain their native party-size gates.
- Common-script dialogue selection at `0x021aebb0`: a single Double trainer
  uses message types 0/2/24. Paired NPCs retain 3/5/6 and 7/9/10. The first NPC's
  dialogue lookup checks for the paired script ID, 2000 above its own.

This fixes trainers that use the standard common battle scripts after changing
their battle type from Singles to Doubles. It does not create trainer teams or
rewrite custom map scripts. Configure the trainer's team and Double battle type
in the Trainer editor.

`black1.cpp` is a new BW1 implementation, based on Black 1's native control
flow and the behavior of the bundled BW2 fix credited to **Sunk** and **Papaya**.
The original B2/W2 C++ implementation has not been recovered. This source is
not a claim that either historical BW2 DLL can be reproduced.

The installer checks both trainer hook windows and every native API entry
used by the DLL in overlays 10/21. It checks editor overlays, raw file
replacements, region, revision, and competing DLL hooks before staging. PMC
applies the function replacements when field overlay 21 loads; the native
trainer overlay files are preserved in the exported ROM.

Build with Python 3, ARM GNU tools, Java, and CTRMap's RPM tooling:

```sh
python3 runtime/double-battle-fix/build.py
```

The builder accepts `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` overrides. It uses
the local `symbols.yml`, requires no external symbol database, and writes the
stripped DLL to `src/assets/codeinjection/DoubleBattleFixB.dll`.

Validation commands from the repository root:

```sh
python3 runtime/double-battle-fix/test_runtime.py
npm exec vitest run src/test/doubleBattleFix.test.ts src/test/pmcModel.test.ts src/test/codeInjectionEditor.test.ts
npm exec vite-node scripts/verify-black1-double-battle-fix.ts Black.nds [output.nds]
```

The Python test requires Unicorn and executes the shipped Thumb payload through
PMC's actual hook trampolines. It models native API calls at their Black 1
addresses, including caller register clobbering. It checks the single-NPC path,
paired trainers, dialogue lookup, stack/register preservation, and party gates.
The ROM check installs the bundled BW1 PMC, exports/reimports the DLL, verifies
its game identity and hooks, and repeats installation without adding another
file. It never writes the input ROM or saves.

On clean US Black revision 0, these checks and a 600-frame cold boot through
the bundled Desmond emulator passed. That boot check does not exercise a
trainer battle. Full in-game battle and dialogue playtesting remains pending;
no White 1 or other-region verification is claimed.
