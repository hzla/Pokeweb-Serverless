# Black 2 / White 2 save-menu 0.2.2 validation

The previous menu animation used player cells `0 → 6 → 0 → 18`. Cell 18 belongs to a faster movement sequence, while the native downward walk animation in both player animation archives is `7 → 0 → 6 → 0`, eight ticks per cell. The asset builder now verifies that sequence for both player sprites, extracts cells 0, 7, and 6, and the renderer plays them in the native order.

| Check | Result |
| --- | --- |
| Native animation data | English White 2 player animation members 1 and 3 both declare the same four-cell looping downward walk sequence. The build asserts its cell indices and durations. |
| Runtime modules | Both modules built from source. `SaveMenuW2.dll` is 57,008 bytes and expands to 63,600 bytes; `SaveMenuB2.dll` is 57,072 bytes and expands to 63,664 bytes. Both are below the 65,536-byte PMC expansion limit. |
| Pokeweb install and update | Clean English White 2 and Black 2, plus the current Following variants, passed fresh install, PMC auto-install, 0.2.1 to 0.2.2 update, ROM export, and active Main Menu Skip conflict refusal. |
| UI/build | The three Code Injection panel tests passed. TypeScript and the production Vite build passed. |
| Saves | Copies were placed beside the new test ROMs. Their SHA-256 values match their respective source saves; the source saves and ROMs were not modified. |

## Test ROMs in `Repos/`

| Game | ROM filename | ROM SHA-256 | Copied save SHA-256 |
| --- | --- | --- | --- |
| White 2 Following 0.6.82 | `White2-Following-0.6.82-SaveMenu-0.2.2-walk-test.nds` | `13fca2c557582053c776393e1decc457b52148003116a5fcf46a07825267f705` | `1912185027b4af523de02276adc6fda29def3258e1c2731473a384f9cb87f503` |
| Black 2 Following 0.6.48 | `Black2-Following-0.6.48-SaveMenu-0.2.2-walk-test.nds` | `c4aedde35e6a869774b09a3e12af11295cec1f348440f8b0f51ffeb9c84a84df` | `f41aa7452001bcdcab5c202d943823127cfe5ed71a47d3b4d46d875b4195c370` |

In-emulator verification is left to the user as requested. The remaining check is that each player sprite visibly alternates left and right steps on the saved-game card. The earlier no-save passthrough also remains to be checked in the emulator; its host validation is in [VALIDATION-0.2.1.md](VALIDATION-0.2.1.md).
