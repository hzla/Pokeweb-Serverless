# C-Gear Quick Actions acceptance record

Development build 0.1.2, 2026-10-09. Supported profiles: English US Black 2 (`IREO`) and White 2 (`IRDO`), revision 0, plus derivatives preserving the checked interfaces.

## Changes

- Four text buttons: green REPEL, orange PC, magenta BIKE, purple MAP.
- Five-pixel foreground lettering, colored outline and outer black outline.
- Bike and PC field events retain the displayed buttons; PC dialogs dim them using the native delayed dimming behavior.
- Inner C-Gear teardown releases owned actors and uploads before native resources disappear. Native application return reattaches to the rebuilt C-Gear, including reused memory addresses.
- MAP opens native Fly destinations with an eligible Fly user, or ordinary Town Map otherwise.
- Bike requires Bicycle ownership; Map requires Town Map ownership. Missing items hide their buttons and release their touch regions.
- PC defaults to visible. Its configurable saved hide flag defaults to `0x05ED` (1517). Native flag accessors and the trainer range starting at 1520 are independently checked in both games. The default operand is absent from clean English script and entity data.
- Installer configuration survives updates, disabling, and export/reopening. Known earlier runtimes and archives update in place.

## Automated checks

| Check | Result and scope |
|---|---|
| Compiled native CPU harness, both profiles | Passed: register/stack preservation; input priority; held touch; item/flag gates; adjacent saved flags; Repel counters; map fallback and Fly request lifetimes; allocation failures; VBlank uploads; delayed dimming; 12 inner teardown/rebuild cycles with complete owned-resource cleanup. Native display and field applications are stubbed in this harness. |
| Installer tests | 14 tests passed: atomic staging/failure; conflicts; private resource integrity; disable/remove; export/reopen; PC flag configuration and invalid flag rejection. |
| Real ROM installation | Clean profiles and the existing Following Pokémon 0.6.88 test build install successfully. Known 0.1.1 test ROMs update to 0.1.2; repeated updates reuse owned paths. Native overlay files and input ROM hashes remain unchanged. |
| Production build | Passed. The existing large-bundle warning remains. |

## Emulator evidence

Tests use a copied bundled fixture. Original ROM and save files are preserved. Screenshots and traces are local ignored build outputs.

- Both games: Bike mount/dismount with visibility checked on every transition frame. The four buttons remain present.
- Both games: missing Bicycle/Town Map and a set PC hide flag leave only REPEL visible; image checks reject remaining colored label pixels for hidden buttons.
- White 2: full PC storage entry/exit with 0.1.2, including visible/dimmed controls during its dialog and all controls restored after returning.
- Both games on 0.1.1: two consecutive PC storage round trips; ordinary Town Map entry/cancel without Fly; all button colors restored on return. These checks preceded the item gates/font change; native transition code is retained in 0.1.2.
- Both games before 0.1.2: native Fly destination selection and completed travel; native saving of enabled Repel; White 2 reload restored the enabled preference. CPU checks also verify that initialization does not replay the spray sound.
- White 2 on 0.1.1: wireless-off actions, wrench dragging, and native design cycling after inner C-Gear reconstruction. The compositor harness checks all five designs for both genders on 0.1.2.

## Delivered test ROMs

Separately named builds in the workspace's parent `Repos/` directory:

- `White2-CGear-QuickActions-0.1.2-test.nds`
- `Black2-CGear-QuickActions-0.1.2-test.nds`
- `White2-Following-0.6.88-CGear-QuickActions-0.1.2-test.nds`

Cold boot these ROMs with copied ordinary saves. A state saved with an older runtime restores older code and is unsuitable for checking an update.

## Remaining human acceptance

The full gameplay release remains pending these checks; automated/fixture results do not establish every field mode or hack combination.

- Check the shorter lettering and double outline beside native labels in the chosen theme.
- Acquire/remove Bicycle and Town Map, set/clear the configured PC flag, and save/reload. Confirm each visibility change and normal native touches in hidden regions.
- Check each action with wireless on/off, both genders, all button designs, rearranged native controls, overlapping positions, and repeated power switches.
- Confirm spray audio, normal encounter level filtering, ordinary Repel expiration after disabling unlimited Repel, empty parties, and encounters that ignore native Repel.
- Check prohibited cycling/Fly locations, companions, party reordering, locked destinations, cancellation and repeated PC/Fly round trips.
- Check menus, battles, cutscenes, communication screens, special field modes and customization transitions. Requests must not launch after a blocked touch.
- Verify gameplay coexistence with Following Pokémon, Learnset, Summary enhancements, enhanced party menus and Porta PC together. Following module installation is checked; the other companion gameplay combinations have not yet been exercised here.
- Check disable/export/reopen in an existing hack and choose a PC flag unused by that hack.
