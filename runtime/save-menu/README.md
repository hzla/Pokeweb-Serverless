# Black 2 / White 2 save menu

Version 0.2.3 is a separate PMC patch for English Black 2 and White 2. It installs on the retail games and on hacks whose menu code and embedded artwork pass the compatibility checks in `compatibility.json`. The patch has no dependency on Following Pokémon. Pokeweb installs PMC as part of the save-menu action when a clean ROM does not have it. Source ROMs and save files are never overwritten.

The saved screen shows the dark grid and trainer card, a walking player, animated party icons, native badge art and empty badge silhouettes, a native-style clock and time, and the full Unova map on the lower screen. The player uses the native downward walk sequence, alternating both steps with its neutral pose every eight ticks. The lower map has its location title and animated marker, without the native bottom control bar. The card uses the game's variable-width English font with white ink and gray shadow. The second page has a centered New Game button. With no save, the hook passes through to the game's original save load menu and its native actions. Continue and New Game retain the original game actions and warning flow. Returning to the title with B keeps the old menu framebuffers covered during cleanup. See [the original visual validation](VALIDATION.md) for the reference comparison and prior White 2 runtime checks.

## Install in Pokeweb

Open an English Black 2 or White 2 ROM, choose **Code Injection → Graphical/UI Enhancements → Black 2 / White 2 Save Menu → Install Save Menu**, then export to a separately named `.nds` file. If PMC is absent, the installer stages the matching PMC runtime first. A current save-menu module can be updated through the same control.

The installer checks the game code, the 16-byte hook, every native function used by the menu, the input-global addresses, the bundled map/player/font artwork, the embedded location names and marker coordinates, required archive paths, and conflicts with existing PMC modules. It selects the matching `SaveMenuB2.dll` or `SaveMenuW2.dll`. It does not change Main Menu Skip. An active Main Menu Skip is refused because it would bypass this menu; remove that debug patch before installing.

The bundled map and font come from the English retail assets. A hack that changes those assets needs its own asset build. Hacks that move native functions or change the save-menu hook need a port and are refused instead of being patched speculatively. Language releases beyond English are outside this version's compatibility audit.

## Local build

With `cleanblack2.nds` and `cleanwhite2.nds` in the workspace root:

```sh
python3 runtime/save-menu/compatibility.py
python3 runtime/save-menu/build.py
```

The build extracts shared English BW2 graphics and creates both versioned PMC modules. `compatibility.py` regenerates the pinned native-code and art signatures without pinning a full ROM hash. The separate `install.py` command accepts a ROM that already has PMC; use Pokeweb when PMC also needs installation. It refuses to overwrite an output ROM and does not edit saves.

See [the 0.2.3 validation report](VALIDATION-0.2.3.md) for the current host checks. In-emulator acceptance is left to the ROM tester.
