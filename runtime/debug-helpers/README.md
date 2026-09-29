# White 2 Debug Helpers

Two independent PMC DLLs for US White 2 (IRDO, revision 0), available in
**Code Injection → Debug Helpers**. The installer verifies native code and
rejects overlapping DLL hooks. PMC is installed automatically when needed.
These are developer alpha builds, version 0.1.0.

| DLL | Shortcut | Behavior |
| --- | --- | --- |
| `WalkThroughWallsW2.dll` | L + R + Start | Toggle player grid collision bypass, including catwalk collision flags. Off at boot. |
| `InstantBattleVictoryW2.dll` | A + B + Start | Finish a local wild/trainer battle with a victory after the native input-close handshake. |

Release a button before using the same shortcut again. Collision mode persists
through field overlay reloads and battles, but is not saved. Return to an ordinary
walkable tile before disabling it. The patch preserves native destination-tile
queries and clears the player's collision result; it does not remove NPC
collision globally, invent missing geometry, rewrite rail paths, or override
scripted movement. Water/height transitions and unusual maps need further play
testing. Start is consumed during the collision chord so it does not open Porta PC.

Victory skips the remaining fight and its knockout EXP. It retains the battle
process's result calculation, party synchronization, records, money calculation,
script return and teardown. It does not simulate defeating every opposing Pokémon.
The shortcut excludes communication battles, facilities, capture demos, replays,
communication errors and battles whose result is already decided. It uses the
native asynchronous input-close handshake, so transitions may take several frames.
Additional animations and submenus remain part of the gameplay verification matrix.

Both patches use 8 bytes of persistent state each, no per-frame allocation,
no ROM scans, no polling threads and no extra renderer. Collision handling adds a
small input check and return-mask check; battle input is checked in its main loop.
Hardware performance has not been benchmarked.

Build and verify from the Pokeweb directory:

```sh
python3 runtime/debug-helpers/build.py
python3 runtime/debug-helpers/verify.py ../cleanwhite2.nds
npx vitest run src/test/testingPatchesModel.test.ts src/test/codeInjectionEditor.test.ts
npx vite-node scripts/verify-testing-patches-install.ts ../cleanwhite2.nds
npx vite-node runtime/debug-helpers/emulator.ts ../cleanwhite2.nds 1250 850 --field
npx vite-node runtime/debug-helpers/emulator.ts ../cleanwhite2.nds 2450 850
npx vite-node runtime/debug-helpers/emulator.ts ../cleanwhite2.nds 2700 1050 --animation
npx vite-node runtime/debug-helpers/emulator.ts ../cleanwhite2.nds 2450 850 --fast-text
```

The builder also builds the separate Instant Fast Text module. `--only` accepts
`walk-through-walls`, `instant-victory`, or `instant-fast-text`. Tool locations can
be overridden with `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR`. CPU verification needs
`ndspy` and `unicorn`; it executes the release DLLs and native White 2 routines,
with instrumented graphics services for the battle handshake. It is not a
full-game simulation. The emulator smoke test uses the bundled fixture save in
memory and writes captures only under ignored `build/`; user saves are untouched.

The source ROM is never overwritten. The ROM verification script accepts an
optional separate output path and refuses to overwrite an existing output.
Staged DLLs can be removed individually; DLLs already embedded in an imported
ROM follow Pokeweb's existing removal limitation.

Build/CPU checks, Pokeweb compatibility guards, independent installation and
export/reimport have passed. Emulator smoke tests verified collision state
off/on/off and crossing a fence that blocked normal movement. Trainer-battle
shortcuts passed during the intro, command menu, move menu and Crunch animation,
returning to the field and the trainer's defeat dialogue. A separate run with
the fixture's Fast option set in emulator memory rendered the full defeat page.
Full map, wild/double/triple/rotation battle and hardware coverage is pending.

PMC framework: [upstream project](https://github.com/ds-pokemon-hacking/PMC).
