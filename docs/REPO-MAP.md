# Repository map

Use this map to choose a search scope. It describes the current working tree, not historical releases. The root [README](../README.md) describes the product.

| Task | Start here | Then check |
|---|---|---|
| App routing and editor UI | `src/main.ts`, `src/ui/`, `src/styles/` | corresponding model in `src/pokeweb/` |
| ROM parsing, writing, and export | `src/nds/`, `src/pokeweb/loader.ts`, `src/pokeweb/exportRom.ts` | `src/pokeweb/projectMaterialize.ts`, `src/test/` |
| Project state and browser persistence | `src/pokeweb/projectStore.ts`, `src/pokeweb/persistence.ts` | editor model and project tests |
| Native code-injection patches | `runtime/<feature>/` | matching installer in `src/pokeweb/`, bundled DLL/RPM in `src/assets/` |
| Following Pokémon | `runtime/following-pokemon/README.md`, `runtime/following-pokemon/build.py` | `src/pokeweb/followingPokemonProject.ts`, `src/test/followingPokemon*.test.ts` |
| LEARNSET and battle HUD | their `runtime/<feature>/README.md` | `src/assets/codeinjection/` and matching installer tests |
| Asset conversion and visual references | relevant importer under `runtime/` or `scripts/` | `public/images/`, `move-animation-reference/`, `docs/` only as needed |
| Source provenance | `patch-sources/README.md`, `patch-sources/manifest.json` | canonical origin recorded in the manifest |

`src/assets/` and `public/` are shipped data, not disposable build output. `move-animation-reference/`, the move-animation editor docs, and `wiki/` are active references, some generated for separate audiences. `docs/` also contains research notes; read a relevant note by title rather than scanning all of them. Old release narratives are in Git history. `patch-sources/` is bookkeeping and does not feed the app build.

The ignored `runtime/*/build/`, `dist/`, `generated/`, `work/`, and `exports/` are different kinds of local output. In particular, `work/` can contain active move-animation work; never treat the whole directory as disposable. Historical test ROMs and states are archived outside this repository at `../.pokeweb-local-archive/`. Versioned Following Pokémon alpha ROMs and matching saves remain in `Repos/`. Use `python3 scripts/archive-local-builds.py` for a dry run, `--verify` to check the archive, or `--restore [--sample REPO_RELATIVE_PATH]` to recover recorded outputs. The archive manifest lists every original path, size, and SHA-256.

Search narrowly before broadening:

```sh
git ls-files 'src/pokeweb/*following*' 'src/test/*following*' 'runtime/following-pokemon/*'
rg -n 'installFollowerAlpha' src/pokeweb src/test scripts
rg -n 'FollowingDraw' runtime/following-pokemon
```

Use an explicit asset path for image or binary questions. Avoid dumping `public/images/`, compiled archives, cumulative checklists, or machine-readable indexes into a tool response. Verification scripts under `runtime/` execute host or isolated CPU checks; their output is not an in-game visual result.
