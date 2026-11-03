# Forgettable HMs (Black 2 / White 2, PMC)

Black / White keeps its direct ARM9 edit (`applyForgettableHmsToArm9`, Patches
page). Black 2 / White 2 instead installs a PMC module from Code Injection >
Quality of Life, so the retail ARM9 stays unchanged and the patch can be removed
by deleting `patches/ForgettableHms{B2,W2}.dll`. Entry points:
`getForgettableHmsPmcStatus`, `stageForgettableHmsPmc` (inside the page's
`installCodeInjectionPatch` transaction) and `installForgettableHmsPmc`.

## What the module does

`PML_MoveIsHM(u16 move)` walks the six-entry HM table and returns 1 on a hit.
Every "can this move be forgotten?" check goes through it. The module replaces
it with

```asm
movs r0, #0
bx   lr
```

via one `THUMB_BRANCH` relocation into `ARM9` (`module: "ARM9"`, target address
with the Thumb bit set, the same convention as the BattleLogSaveGuard hooks).
Metadata: `PMCGameID` B2 / W2 / W2I, `PMCModulePriority` 4, `PMCVersion` 1.0.0.

## Why there is no build script or bundled DLL

The module is four bytes of code and one relocation, so
`src/pokeweb/forgettableHmsRuntime.ts` writes it with `writeRpm` at install
time. The hook address comes from the loaded ROM, not a constant:

- `findBw2MoveIsHm` scans word-aligned ARM9 offsets for the Black / White code
  shape (table displacement, padding and literal are wildcards), requires the
  literal's table to lie in ARM9 and hold six plausible move IDs, and requires
  exactly one match.
- Reference address: White 2 (`IRDO`) `PML_MoveIsHM` = `0x02026b44` in the swan
  ESDB (`ds-pokemon-hacking/swan`, `IRDO.yml`). Black 2 is not in the public
  ESDB; nearby ARM9 code is shifted by -0x2c, so `0x02026b18` is expected.

The installer refuses if another DLL already relocates into the function, and
restores an inline `00 20 70 47` entry edit to `08 4a 00 23` before staging.

## Verification status

Unit tests cover the scan, DLL round-trip, install, migration and conflict
paths (`src/test/forgettableHmsBw2.test.ts`). In-game acceptance on real
Black 2 / White 2 ROMs (move deleter, level-up and TM replacement with an HM
known) is still pending. Cold boot the export; old emulator states restore old
runtime code.
