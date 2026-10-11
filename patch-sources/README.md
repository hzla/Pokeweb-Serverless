# Bundled patch source provenance

`manifest.json` records the available canonical source paths and fingerprints for Pokeweb's bundled DLL/RPM patches. This bookkeeping does not feed the app build and does not prove that a historical binary was rebuilt from the current checkout. Current implementation work belongs in `runtime/`, `src/`, and the external source repositories named in the manifest.

The manifest covers stock Black 2 and White 2, Italian White 2, White2Upgrade, and separate Black/White profiles where those patches exist. Following Pokémon has four separate runtime packages. Italian PMC uses the audited Pokeweb retargeting script; its bundled RPM is inventoried separately. The monolithic Black2Upgrade DLL is outside this source snapshot.

The five BW1 Graphical/UI patches have a separate DS acceptance ledger and
build guard in `runtime/`. Their provenance includes the tested-profile and
artifact hashes, verifier and release evidence. Live DSi acceptance remains
pending; the source inventory itself does not establish gameplay acceptance.

The shared mode-aware RAM helper and its tests originate in the BW2 integration
checkout recorded as `w2u-integration`. `W2U_INTEGRATION_ROOT` can select that
checkout; `W2U_RUNTIME_ROOT` selects the separate runtime checkout. Their source
origins remain distinct even where a header has identical contents.

Original source for Main Menu Skip and the B2/W2 Single-NPC Double Battle Fix modules was not found. Their recorded supporting files are not substitutes for original implementation source. The new Black 1 double-battle fix has its own canonical source in `runtime/double-battle-fix`; it does not establish reproducibility of the historical B2/W2 binaries. The PMC license is retained at `pmc/LICENSE`. The trainer-sprite source note at `pwan-trainer/README.md` is a canonical provenance input. External SDKs, toolchains, full symbol databases, ROMs, saves, and emulator captures are excluded.

Tracked copies of canonical source were removed from this directory to avoid a second, stale source tree. Git history retains earlier snapshots. A source bundle can be materialized on demand **outside** this repository:

```sh
node patch-sources/refresh.mjs --check
node patch-sources/refresh.mjs --only=following-pokemon --check
node patch-sources/refresh.mjs --out ../.pokeweb-local-archive/generated/patch-sources/current
```

A bare `refresh.mjs` run updates the manifest's source and bundled-artifact hashes but writes no source copies. `--check` compares canonical inputs with the manifest without writing. `--out PATH` creates or updates a materialized snapshot at an external path, with a small managed index that guards local edits and removes obsolete generated files; combine it with `--check` to verify that copy. `--only=GROUP` limits a check, update, or materialization to one group. Missing source origins, unregistered bundled modules, and locally edited materialized copies cause an error rather than a silent omission or overwrite. Source text is normalized to LF with machine-local paths removed; binary build inputs are copied byte-for-byte.
