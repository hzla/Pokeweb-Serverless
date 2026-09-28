# Black 2 / White 2 save-menu 0.2.3 validation

The supplied B-return screenshot shows the native save menu during the handoff to the title. In the previous hook, B left the custom menu and immediately restored the saved native framebuffers without covering the displays. This also exposed the restoration writes for a frame. Static inspection of the English White 2 menu code shows that B from the saved menu enters state 2, waits for the native fade, enters state 1 for cleanup, and then finishes at state 13.

Version 0.2.3 covers both displays before forwarding B to the native menu, keeps them covered while restoring its framebuffers, and maintains that cover through the fade and cleanup states until state 13. The existing Continue cover remains. Other menu actions retain their native warning screens. This release also includes the corrected native downward walk sequence from 0.2.2.

| Check | Result |
| --- | --- |
| Runtime modules | Both modules built from source. `SaveMenuW2.dll` is 57,104 bytes and expands to 63,696 bytes; `SaveMenuB2.dll` is 57,200 bytes and expands to 63,792 bytes. Both are below the 65,536-byte PMC expansion limit. |
| Pokeweb install and update | Clean English White 2 and Black 2, plus the current Following variants, passed fresh install, PMC auto-install, 0.2.2 to 0.2.3 update, ROM export, and active Main Menu Skip conflict refusal. |
| UI/build | The three Code Injection panel tests passed. TypeScript and the production Vite build passed. |
| Saves | Copies were placed beside the new test ROMs. Their SHA-256 values match the prior test saves. Source ROMs and saves were not modified. |

## Test ROMs in `Repos/`

| Game | ROM filename | ROM SHA-256 | Copied save SHA-256 |
| --- | --- | --- | --- |
| White 2 Following 0.6.82 | `White2-Following-0.6.82-SaveMenu-0.2.3-transition-test.nds` | `5b50c9ab969f05c262ae062016c204e9a6043c22d4679ca8ec780b4ea91890ba` | `1912185027b4af523de02276adc6fda29def3258e1c2731473a384f9cb87f503` |
| Black 2 Following 0.6.48 | `Black2-Following-0.6.48-SaveMenu-0.2.3-transition-test.nds` | `d3536c7f68255c7e0d0b14e38755e32eb49ee8970260bf2401d34d65e51da51d` | `f41aa7452001bcdcab5c202d943823127cfe5ed71a47d3b4d46d875b4195c370` |

In-emulator verification is left to the user as requested. Check B from the saved card to the Kyurem title, A to Continue, B from the New Game page back to the card, and the saved-game overwrite warning. The walk animation and no-save passthrough also still need user acceptance.
