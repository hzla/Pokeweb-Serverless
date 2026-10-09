# Enhanced Party Menu BW1

The US revision-0 Black (`IRBO`) and White (`IRAO`) companions add EVOLVE and
RELEARN to the native party menu. Both are available through the normal installer
after the recorded DS gameplay and visual acceptance in both games.
Live DSi acceptance is pending. See the [BW1 release record](../BW1_UI_RELEASE.md).

The implementation sources and native profiles are maintained in the canonical
party-menu runtime checkout. `W2U_RUNTIME_ROOT` can select that checkout.
Pokeweb packages the candidates through its existing installer entry points
and project configuration. The bundled BW1 Battle Log is runtime 8 and includes the immediate-KO
counter and native learning transitions required by Enhanced Party Menu.
BW2 retains its runtime-11 dependency and existing DLLs.

BW1 uses party overlay 91, battle-return overlay 92, field overlay 10, and
reminder overlay 173. Its native message bank is 157. The retail process prefix
is 0x74 bytes; the extension adds two words without changing that prefix.
Native request, selection, battle-result, ARM/Thumb API and archive-path
bindings are verified independently for each game before building.

The BW1 archive adapter uses nonasserting allocation. Reminder failures return
to the party menu and release owned memory. Immediate KO learning uses bounded
stack records and the native learning sequence, including zero-EXP entries.
PK5 counter storage and save-log formats remain unchanged. Field scripts use
the native `0x0110` command with counter parameter IDs `0x0400`–`0x0402`.

```sh
npm run party-menu:build-bw1
npm run party-menu:bundle-bw1-candidates
npm run party-menu:verify-bw1
npx vitest run src/test/menuEvolutionBw1.test.ts src/test/menuEvolutionModel.test.ts
```

The counter DLLs must be built in the canonical runtime checkout before the
compiled suite runs. Bundling enables only profiles, companions and runtime-8
dependency hashes recorded in the DS acceptance ledger; changed builds remain disabled.
See [VALIDATION.md](VALIDATION.md) for the boundary between isolated verification
and live acceptance.
