# Standalone LEARNSET party-menu viewer

Status: **source-copied**. Bundled version: **1.0.3**.

Bundled artifacts: `LearnsetMenuB2.dll`, `LearnsetMenuW2.dll`,
`LearnsetViewerB2.dll`, and `LearnsetViewerW2.dll`.

The menu/field companion owns the private viewer request; the overlay-258
companion renders the read-only level-up list. This snapshot includes the
CPU-side background-buffer fix for the solid-green lower screen and its
compiled-wrapper/native-redraw regression tests, plus the two-pixel gap between
the type icon and first level digit. PP remains in its original column.

Canonical runtime: `Pokeweb-Serverless: runtime/learnset-viewer/`.
See [runtime notes](runtime-notes.md) for design, rebuilding, and verification.
The installer manifest is in `metadata/`, the Pokeweb installer model in
`integration/`, and installer/export tests in `tests/`.

These are bookkeeping copies, not build inputs. Relative imports and build
paths describe the canonical repository layout. No ROM, save state, screenshots,
or build binaries are included. See the root manifest for every file's
repo-relative origin, normalization flag, and SHA-256.
