# Italian White 2 follower validation

Automated work executed for 0.6.33-alpha:

- Exact IRDI SHA-256 and 351 mapped hook/adapter signatures passed; 723 translated pointers and 155 translated Thumb calls accounted for.
- All 755 script-table entries, 170 safe commands and 10 finishers matched the target binary.
- 6 PMC hook sites and 24 imported entries matched. Exported PMC boot calls the Italian native initializer and overlay loader.
- W2I DLLs passed packaged ARMv5T call, relocation, stack, and movement-trail checks at three load addresses.
- Packaged-runtime tests passed 100 simulated follower conversations, 100 conversation returns and 100 retained-actor scene cycles, including event-command policy checks and an Italian full-Bag response/rollback path.
- Pokeweb clean install, idempotent install, export/reopen, disable/enable and removal passed. The 0.6.27-to-0.6.28 update preserved authored dialogue and gift rules.
- A reported Pokeweb W2I/W2 installation error was traced to ROM bytes moving into browser storage. The DLL identity check now uses the loaded IRDI code when project bytes are absent; follower module staging receives the retrieved source ROM. A focused identity test and clean-ROM install/reinstall/export/reopen/disable/remove round trip with a browser-storage stand-in passed. Live browser recheck remains pending.
- Replacing one appearance asset passed export/reopen without rebuilding the DLLs.
- Grounding audit checked all 2,574 Italian appearances: 2,266 non-Flying and 308 Flying. Every appended descriptor Y is zero, and original stock descriptor rows and native shadow flags remain unchanged.
- Packaged draw-pass tests checked sprite-only vertical translation, immediate billboard restoration, and an unchanged native effects pass, including repeated flat and stair draws. GPU submission was simulated; no emulator visual test was run.
- Packaged control-offset checks verified north/south adjustments affect only the follower's native control-Z byte, leaving world/grid/collision coordinates unchanged. The north two-pixel artwork correction is draw-only; visual pixel alignment requires emulator review.
- A north-facing draw regression compares the corrected submission with the pre-anchor foreground depth while preserving its new projected position and the native shadow/effect pose. Stair, lateral and unrelated actor depth policies are unchanged; emulator visual acceptance remains pending.
- Italian HeartGold reaction/motion/emote archives matched pinned layouts. All 27 selected messages imported without truncation; accented è and substitutions were validated. The Bag-full response matches Italian White 2 retail text.
- Italian retail text/script archives, personal data, appearance data and original object-code rows were byte-preserved by export.

The user confirmed the tested sprite/shadow positioning, then reported that the player covered Serperior while walking north. Visual acceptance of the 0.6.33 depth correction is **pending**. DS-family hardware results: **not tested**. Automated checks cannot establish in-game field timing, native heap behavior or visual correctness.
