# Black 2 / White 2 save-menu 0.2.0 validation

This report covers the English Black 2 and White 2 compatibility port. In-game visual and interaction testing of this version is left to the user. The earlier White 2 visual checks are recorded separately in [VALIDATION.md](VALIDATION.md); they do not establish Black 2 runtime behavior.

| Check | Result |
| --- | --- |
| Native code and artwork audit | Clean English Black 2 (`IREO`) and White 2 (`IRDO`) passed the overlay 162 hook, 18 ARM9 function signatures, input-global literals, required NitroFS paths, embedded map/player/font hashes, location-name bank, 615 header name IDs, and 85 marker records. The current `Black2-Following-0.6.48-alpha.nds` and `White2-Following-0.6.82-alpha.nds` also passed. This checks the actual binary layout without requiring one whole-ROM SHA-256. |
| Shared assets | The clean games' player, map-art, font, icon, and location-text archives are byte identical. Their 615 map-header name IDs and 85 map-marker coordinates match. The versioned DLLs therefore use one English asset bundle. |
| Binaries | `SaveMenuW2.dll` is 56,944 bytes and expands to 63,536 bytes, with one 16-byte full-copy hook at `0x0219D9E4`. `SaveMenuB2.dll` is 57,008 bytes and expands to 63,600 bytes, with one 16-byte full-copy hook at `0x0219D9A4`. The Black 2 binary contains its own ARM9 call addresses, input globals, and overlay continuation. Both remain below the 65,536-byte PMC module expansion limit. |
| Pokeweb | Fresh install, PMC auto-install where needed, staged module update, and ROM export passed for clean Black 2 and White 2. The same install, update, and export path passed for the two current Following variants above. The bundled active Main Menu Skip modules were then staged in the temporary projects; both versions refused a save-menu update and left the skip bytes unchanged. |
| Standalone installer | Both current Following variants were installed into separately named local outputs with all original file IDs' payloads preserved. The corresponding source ROM hashes remained unchanged. Clean ROMs use the Pokeweb path to install PMC first. |
| Existing debug skip | The current White2Upgrade Following alpha passed the code and art audit, then both Pokeweb and the standalone installer refused its active `MainMenuSkip(1).dll`. No output ROM was written or save-menu module staged, and the debug module was not changed. A release build without that debug patch can use the normal compatibility check. |
| UI/build | The Code Injection graphical/UI panel test passed (3 tests). TypeScript and the production Vite build passed, and both DLLs appear in the bundled output. |
| Saves | Test save files were copied to new names beside the test ROMs. Each copy's SHA-256 matches its source. Source saves were not edited. |

## Test ROMs for user emulator checks

| Game | Test ROM SHA-256 | Copied save SHA-256 |
| --- | --- | --- |
| White 2 Following 0.6.82 | `d78d7870472ed087c209457d6bd562657fe7aa08a0ceda04255d3c6072a89ddd` | `663aad6a5401a1e370834b1de76b030212f5b42189085f6d2fd5ed67a3bbdf44` |
| Black 2 Following 0.6.48 | `52247719e52e5edfa66d2efc89358db6d5d364fec326d8b2aa411f544cc9757e` | `f41aa7452001bcdcab5c202d943823127cfe5ed71a47d3b4d46d875b4195c370` |

The source ROM SHA-256 values are `067545b4b076a3a00b17e6409f8d5fb222ab2941722ae6d8eae6c4203b92e5e6` (White 2) and `5391059730a2cf6226530483b7d5f845c1ad47e8e54d5cea153e283605f1c45f` (Black 2). The test outputs and copied saves are in `Repos/` with `SaveMenu-0.2.0-test` in their names.

## Compatibility boundary

English ROMs with game codes `IRDO` and `IREO` are eligible. A hack is accepted only when the used native entry points, input globals, menu hook, embedded artwork, location names, and map coordinates still match the audited layouts. A changed map, font, player archive, moved function, or active debug startup skip is refused with an explanatory error. Other languages and runtime behavior in Black 2 have not yet been validated in-game.
