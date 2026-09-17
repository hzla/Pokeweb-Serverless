# Standalone LEARNSET party-menu viewer

Status: **source-copied**. Bundled version: **1.4.1**.

Bundled artifacts: `LearnsetMenuB2.dll`, `LearnsetMenuW2.dll`,
`LearnsetViewerB2.dll`, and `LearnsetViewerW2.dll`.

The menu/field companion owns the private viewer request; the overlay-258
companion renders the read-only level-up list and species-info upper panel.
This snapshot includes form-aware base stats, cycle-safe three-icon evolution
chains, paged outgoing requirements, and private message configuration.
L/R browses virtual species and their learnsets without fading or restarting
in 1.4.1; only the selected icon animates. A pages evolution requirements.
D-pad Right/Left changes actual party slots with wrapping and Egg-skipping;
those switches still use the native fade lifecycle. B restores the last party
slot. Version 1.4.1 also fixes upper-panel colors to read sub BG, not main OBJ.
The viewer retains buffered ROM scans, compact gold stats, right arrows, and
left-aligned Title Case ROM ability names with purple hidden-ability highlighting. The
buffered lower background and two-pixel type-icon/level gap remain unchanged.

Canonical runtime: `Pokeweb-Serverless: runtime/learnset-viewer/`.
Refresh this group without changing other patch snapshots using
`node patch-sources/refresh.mjs --only=learnset-viewer`.
See [runtime notes](runtime-notes.md) for design, rebuilding, and verification.
The installer manifest is in `metadata/`, the Pokeweb installer model in
`integration/`, and installer/export tests in `tests/`.

These are bookkeeping copies, not build inputs. Relative imports and build
paths describe the canonical repository layout. No ROM, save state, screenshots,
or build binaries are included. See the root manifest for every file's
repo-relative origin, normalization flag, and SHA-256.
