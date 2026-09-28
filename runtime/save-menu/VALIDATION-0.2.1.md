# Black 2 / White 2 save-menu 0.2.1 validation

Version 0.2.1 passes the no-save menu states directly to the game's original save-menu routine. The custom renderer does not capture graphics or draw a card or map when the menu work data reports no save. The entry transition cover is also skipped for that case. Saved-game rendering and actions retain the 0.2.0 path.

| Check | Result |
| --- | --- |
| Runtime modules | Both modules built from source. `SaveMenuW2.dll` is 57,008 bytes and expands to 63,600 bytes; `SaveMenuB2.dll` is 57,072 bytes and expands to 63,664 bytes. Both are below the 65,536-byte PMC expansion limit. |
| Pokeweb install and update | Clean English White 2 and Black 2 passed fresh install, PMC auto-install, 0.2.0 to 0.2.1 update, ROM export, and active Main Menu Skip conflict refusal. The current Following variants passed the same checks and were exported to separate test ROMs. |
| UI/build | The three Code Injection panel tests passed. TypeScript and the production Vite build passed. |
| Source preservation | The Following source ROM SHA-256 values still match the 0.2.0 report: `067545b4b076a3a00b17e6409f8d5fb222ab2941722ae6d8eae6c4203b92e5e6` (White 2) and `5391059730a2cf6226530483b7d5f845c1ad47e8e54d5cea153e283605f1c45f` (Black 2). No matching `.sav` or `.dsv` files were placed beside the new test ROMs. |

## Test ROMs in `Repos/`

| Game | Filename | SHA-256 |
| --- | --- | --- |
| White 2 Following 0.6.82 | `White2-Following-0.6.82-SaveMenu-0.2.1-no-save-test.nds` | `ec360385ca53194246d67100e48a490788017b5bfdc4140b3151071163fefd20` |
| Black 2 Following 0.6.48 | `Black2-Following-0.6.48-SaveMenu-0.2.1-no-save-test.nds` | `d56d42e254ac1be9fbfb516c0ef1ad0a1eb4d45449a48dacdcc9f2451f63a745` |

In-emulator verification is left to the user as requested. The remaining checks are that an empty boot shows the game's original save menu and native actions, and that a ROM with a save still shows the custom card and continues correctly. Previous emulator captures and acceptance checks are in [VALIDATION.md](VALIDATION.md); they cover earlier versions and do not verify this behavior change.
