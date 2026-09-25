# Italian White 2 follower validation

Automated work executed for 0.6.39-alpha:

- Exact IRDI SHA-256 and 391 mapped hook/adapter signatures passed; 726 translated pointers and 167 translated Thumb calls accounted for.
- All 755 script-table entries, 170 safe commands and 10 finishers matched the target binary.
- 6 PMC hook sites and 24 imported entries matched. Exported PMC boot calls the Italian native initializer and overlay loader.
- W2I DLLs passed packaged ARMv5T call, relocation, stack, and movement-trail checks at three load addresses.
- The native terrain-entry adapter has pinned IRDI bytes; grounded followers dispatch it once per crossed tile, while Flying followers skip it. Terrain visuals remain a human acceptance item.
- Land-riding, custom Surf, and shore-transition hook bytes and translated native calls were audited against the exact IRDI binary; its seated rider source sheets match the US source sheets.
- Packaged Surf catalog/party selection, entry hooks, cached jump draw, Repel Yes/No, mounted input, rider draw, and water/shore transitions passed CPU-level checks. In-game visual timing and graphics remain a human acceptance item.
- Packaged-runtime tests passed 100 simulated follower conversations, 100 conversation returns and 100 retained-actor scene cycles, including event-command policy checks and an Italian full-Bag response/rollback path.
- The 0.6.38-alpha-to-0.6.39-alpha package update retained enabled state and authored dialogue through export/reopen. Earlier clean-install, disable/enable and removal checks remain separately recorded.
- A reported Pokeweb W2I/W2 installation error was traced to ROM bytes moving into browser storage. The DLL identity check now uses the loaded IRDI code when project bytes are absent; follower module staging receives the retrieved source ROM. A focused identity test and clean-ROM install/reinstall/export/reopen/disable/remove round trip with a browser-storage stand-in passed. Live browser recheck remains pending.
- Replacing one appearance asset passed export/reopen without rebuilding the DLLs.
- Grounding audit checked all 2,574 Italian appearances: 2,266 non-Flying and 308 Flying. Every appended descriptor Y is zero, and original stock descriptor rows and native shadow flags remain unchanged.
- Packaged draw-pass tests checked sprite-only vertical translation, immediate billboard restoration, and an unchanged native effects pass, including repeated flat and stair draws. GPU submission was simulated; no emulator visual test was run.
- Walking and mounted shadow-depth tests check that submitted Pokémon quads clear the native ground-shadow footprint while their projected pixels, shadow ground anchor and later effects pass remain in place. Rapidash and mounted Reuniclus require human visual acceptance; walking Reuniclus is a control case.
- The state-derived south-facing test reproduces the player/follower depth reversal, then checks a draw-only player foreground correction while leaving the follower above its ground shadow. Packaged stock draw tests verify immediate restoration; Italian in-game visual acceptance is pending.
- Packaged control-offset checks verified north/south adjustments affect only the follower's native control-Z byte, leaving world/grid/collision coordinates unchanged. The north two-pixel artwork correction is draw-only; visual pixel alignment requires emulator review.
- A north-facing draw regression compares the corrected submission with the pre-anchor foreground depth while preserving its new projected position and the native shadow/effect pose. Stair, lateral and unrelated actor depth policies are unchanged; emulator visual acceptance remains pending.
- Italian HeartGold reaction/motion/emote archives matched pinned layouts. All 27 selected messages imported without truncation; accented è and substitutions were validated. The Bag-full response matches Italian White 2 retail text.
- Italian retail text/script archives, personal data, appearance data and original object-code rows were byte-preserved by export.

The user confirmed the tested sprite/shadow positioning, then reported that the player covered Serperior while walking north. Visual acceptance of the 0.6.33 depth correction, 0.6.34 terrain effects, and new land/Surf presentation is **pending**. DS-family hardware results: **not tested**. Automated checks cannot establish in-game field timing, native heap behavior or visual correctness.
