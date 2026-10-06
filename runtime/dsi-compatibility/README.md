# Bundled patch DS/DSi memory audit

Scope: rejecting valid pointers because they exceed DS's 4 MiB main RAM. This audit does not certify every patch's behavior, display timing, or hardware compatibility in DSi mode.

## Findings and fixes

The inventory covers **97 bundled DLL/RPM modules** and **437 canonical C, C++, header, and assembly files**, including external upgrade sources, the PMC framework, all Following Pokémon profiles, and the Summary IV/EV runtime. `audit.json` records exact artifact hashes and source candidates. Literal scans supplement source review; literals can be data, and their absence alone does not prove compatibility.

| Runtime | Finding | Result |
|---|---|---|
| Type Icons and Move Effectiveness | Shared DS-only pointer guard | Already corrected in the preceding HUD release; retained and included in the audit. |
| PWAN battle and trainer sprites | Sprite and palette pointers rejected above `0x02400000` | Rebuilt all four B2/W2 DLLs with the shared mode-aware guard. |
| PWAN Summary sprites | Work, Pokémon and sprite pointers rejected above `0x02400000` | Rebuilt both DLLs; retained word-alignment checks. |
| PWAN miscellaneous sprites | Evolution, hatching and other MCSS/palette guards used the DS ceiling | Rebuilt both DLLs with the same shared guard. |
| Stock White 2 Following Pokémon | Grass task validation used the DS ceiling | Updated both base/full field modules in **0.6.88-alpha**. Alignment and the complete task span remain bounded. |
| Other Following Pokémon profiles | The stock grass correction hook is not installed | No active additional 4 MiB guard found; existing bundles retained. Shared source is corrected for future builds. |
| Canonical White2Upgrade dynamic battle loader | Imported function/handler checks used the DS ceiling | Corrected source. The bundled Black2Upgrade uses its separate static resolver, so its DLL/package was not rebuilt. |
| Remaining bundles | No additional DS-only pointer ceiling found | Includes Summary IV/EV, Learnset, enhanced party menu, battle logs/counters/save guards, gameplay helpers, weather, BGM, trainer nature, and PMC. Binary-only Main Menu Skip and Double Battle Fix were inspected separately. |

The shared native range helper accepts `[0x02000000, 0x02400000)` in either mode. It accepts the additional RAM up to `0x03000000` only when the native `hw_isDSi` accessor confirms DSi mode. Span checks avoid overflow. DS mirrors are not accepted as independent heaps. No firmware or NAND data is required by these changes.

The remaining source candidates are the mode-aware guards themselves, a YUV conversion-table constant, and an ability speed mask. The latter two operate on numbers, not pointers.

PWAN installation now verifies the native mode accessor in both ROM profiles, including the independent trainer installer. Unknown changes to it are rejected. The eight DLLs add no BSS/heap buffers and retain their overlay scopes and resolved imports. They were built with the existing GCC 16 PWAN toolchain; the artifact test rejects unresolved imports.

## Automated evidence

- `verify.py`: execute the exact shipped code, located through matching named diagnostic modules, with the real retail cold/cached mode getter. Check both games, all eight PWAN DLLs, extra RAM, upper/lower endpoints, Summary alignment, callee-saved registers, and stack preservation.
- External `tools/tests/test_main_ram.py`: compile the production shared header under ASan/UBSan; check complete spans, cross-boundary spans, overflow, zero length, and DS rejection of extra RAM.
- External `tools/tests/check_pwan_substitute_runtime.py`: compiled battle update/draw fixture in both games and both modes. All battle objects/palette buffers reside in extra RAM for the DSi cases. Check substitute suspension, queued-upload cancellation, temporary reveal, and palette restoration. Mode and asset services are fixtures.
- External `tools/pwan/test_runtime_memory.py`: independently decode 128 frames across all eight texture slots under ASan/UBSan.
- Following Pokémon's normal publish gates passed for both variants. Extended `verify_render.py` executes the packaged grass guard and actual native mode getter; a task placed in extra RAM is corrected only in DSi mode and its quad is restored after submission. Native GPU submission is a spy.
- Focused Pokeweb artifact, installer, compatibility, and Following Pokémon regressions; production build and privacy checks.

Run from Pokeweb:

```sh
python3 runtime/dsi-compatibility/audit.py
python3 runtime/dsi-compatibility/verify.py /path/to/cleanwhite2.nds /path/to/cleanblack2.nds
node scripts/sync-pwan-runtime-artifacts.mjs --check
```

External source location can be supplied through `W2U_RUNTIME_ROOT`. ROMs and diagnostic build files remain local; reports contain hashes and checks, not ROM/firmware bytes.

## Human acceptance

Reinstall the affected Pokémon/trainer sprite runtimes or update the stock White 2 follower package, export, and boot from reset. Save states restore old loaded DLLs.

- In DS and DSi mode, test custom battle/trainer sprites, Summary, evolution, and egg hatching in both games. Check palette fades, substitute swaps, and repeated entry/exit.
- For stock White 2 followers, test grass with both player and follower, then enter/exit menus and change maps.
- Repeat on hardware through the user's usual loader. Emulator/hardware acceptance remains with the user; no game frames were run for this audit.
