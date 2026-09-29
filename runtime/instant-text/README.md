# Instant Fast Text for White 2

`InstantFastTextW2.dll` is a separate PMC QoL module, version 0.1.0, under
**Code Injection → Quality of Life → Instant Fast Text**. Supports US White 2
(IRDO, revision 0), subject to native code and conflicting-hook checks.

With **Options → Text Speed → Fast**, the native stream receives a bounded
128-character budget per update (signed wait value `-128`). A normal page fits
in one update; longer text can require another. This uses the native stream
renderer, including page advances, choices and text-control processing.
Deliberately slow text remains slow. Slow and Normal preserve their normal and
script FAST/SLOW speeds. The patch never changes the stored option value.

The two hooks cover ordinary messages and the shared speed conversion used by
battle and other UI text. Screens with hardcoded animation or text timing can
keep that timing. This does not remove dialogue confirmation or speed up battles.

```sh
python3 runtime/instant-text/build.py
python3 runtime/debug-helpers/verify.py ../cleanwhite2.nds
npx vite-node runtime/debug-helpers/emulator.ts ../cleanwhite2.nds 2450 850 --fast-text
```

The builder and CPU verifier share infrastructure with `runtime/debug-helpers`;
the DLL is independently installable and requires no Debug Helpers module.
The compiled module has no persistent state or per-frame worker. ARM946 checks
execute the native message getters for all three options, scripted FAST/SLOW
variants and invalid-index fallback. Installer/export/reimport tests pass.
An emulator smoke run set the bundled fixture's Fast option in RAM, rendered
trainer/battle dialogue, returned to a complete trainer defeat page, and verified
the option remained Fast. The fixture operation does not read or write user saves.
Visual coverage of every message system and hardware timing is still pending.
