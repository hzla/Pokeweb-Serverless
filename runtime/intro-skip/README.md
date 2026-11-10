# Skip Intro (US Black 2, White 2)

A new game starts in the player's room in Aspertia City, in control, right
after Professor Juniper's introduction. It skips:

- the Aspertia City flyover (3D demo 5),
- the street outside the house, where mom takes Juniper's call (Aspertia City
  scripts 29 and 30),
- mom's "I'm home!" scene in the house (house script 17).

Mom is in the house at her usual spot, and walking to the room's exit starts
her "Do you want a Pokémon?" talk as usual. Install it from Code Injection >
Quality of Life. Existing saves are unaffected.

## How it works

`EventGameOpening_Callback` and `EventFieldFirst_Callback` / `_Create` in
overlay 35 (`src/ov035/event_mapchange.c` in the pokebw2 decomp) run the new
game. `IntroSkipB2/W2.dll` redirects five of their calls, one
`THUMB_BRANCH_LINK` each (B2 = W2 − 0x40 in this overlay):

| Hook | Call | B2 | W2 | Replacement |
|---|---|---|---|---|
| demo | `Event3DDemo_Create(gsys, event, 5, 0, 1)` | `0x0217c9e8` | `0x0217ca28` | an event that ends at once |
| init | `FieldScript_CallPlayerInitSetup` | `0x0217ca9c` | `0x0217cadc` | the same, then clear flag `0x2E4` |
| hide | `SetActorFlag(player, 4)` (hidden) | `0x0217cafc` | `0x0217cb3c` | nothing |
| script | `EventScriptCall_Start` (scripts 29 and 30) | `0x0217cb0c` | `0x0217cb4c` | nothing |
| spawn | `LoadAspertiaCitySpawnInfo` | `0x0217cb72` | `0x0217cbb2` | `CreateZoneChangeData`: zone 428 (`ZONE_ASPERTIA_CITY_2`), tile (14, 0, 3), facing down |

The spawn is where script 30's `MapChangeCore` puts the player, facing the
way script 17 leaves them. Script 17 is the only skipped script with a
lasting effect: it clears flag `0x2E4`, which the new-game setup script
(global 9600) sets to keep mom out of the house during the street scene. The
`init` hook clears it right after that script, before the field loads its
actors, so mom appears at her placement (4, 5) — where the game puts her on
any later visit — instead of (5, 8), where script 17 happens to leave her.
Script 3 (the room-exit trigger at (10, 8)) walks her to an absolute tile, so
the story plays the same.

`games.json` holds the call sites, their retail bytes and the native
bindings (from the pokebw2 decomp symbols, checked against the clean ROMs).
The installer checks the bytes on the loaded ROM and refuses another DLL that
relocates into any of the five calls. `IntroSkipDebug` ("ISKP") counts each
hook for the emulator check.

## Build and check

```sh
python3 runtime/intro-skip/build.py      # src/assets/codeinjection/IntroSkip*.dll + introSkipManifest.json
npx vite-node runtime/intro-skip/emulator.ts /path/clean.nds --walk "down:80,left:64,down:16"
npx vite-node runtime/intro-skip/emulator.ts /path/clean.nds --vanilla --frames 17000 --every 1000
```

The emulator check starts a new game from a blank save, waits until all five
hooks have run (demo 1, init 1, hide 1, script 2, spawn 1), walks the room,
then walks to the trigger and captures mom's talk. Checked on clean US Black 2
and White 2: the field opens once, in the room, and the player can move;
mom's talk starts at the trigger. The `--vanilla` run shows the retail
sequence ending in the same room, tile and facing.

The bundled DLLs were built with ARM GCC 13.2; a rebuild with another
compiler changes their bytes and hashes but not their behaviour.
