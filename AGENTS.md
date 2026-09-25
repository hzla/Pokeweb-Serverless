# Pokeweb Serverless agent entrypoint

Read [docs/REPO-MAP.md](docs/REPO-MAP.md) only for the part of the project you are changing. `src/` and `runtime/` are canonical source; `src/assets/` contains shipped files. `patch-sources/manifest.json` records provenance, not build input. Generated references, images, and ignored build directories are not general code-search targets.

Start with `git ls-files` for an inventory and a scoped `rg` search for behavior. Do not list or read the entire repository to answer a local question. Follow the parent directory's local instructions separately; they are deliberately not repeated here.
