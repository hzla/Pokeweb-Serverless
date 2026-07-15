# DSPRE Porting Plan

This is the living checklist for the Gen 4 DSPRE port. Update the relevant row and add or extend tests before changing an item to `[x]`.

## Status Legend

- `[ ]` Not started
- `[~]` In progress or partial parity
- `[x]` Implemented with writer/export coverage
- `[!]` Blocked or unsafe for general use

## Architecture Decisions

- One Pokeweb project lifecycle handles Gen 4 and Gen 5 ROM loading, editing, persistence, and export.
- Browser-loaded `.nds` files are the supported Gen 4 project format.
- Generation and game-family helpers gate format-specific behavior; Gen 5 behavior must remain unchanged.
- Binary meaning belongs in model code. Shared UI is reused only where the underlying formats agree.
- Diamond/Pearl, Platinum, and HeartGold/SoulSilver are separate format families. Patches may support a narrower family when their code or overlay layouts differ.

## Phase Checklist

- `[x]` Phase 0: generation-aware project identity, family helpers, and this living checklist
- `[x]` Phase 1: Gen 4 detection, core NARC loading, text decoding, labels, persistence, and ROM export
- `[~]` Phase 2: personal data, learnsets, evolutions, moves, items, trainers, and base encounters
- `[~]` Phase 3: headers, TMs, events, matrices, map permissions, and specialty data
- `[~]` Phase 4: top-down/3D maps, buildings, overworld sprites, and move-animation previews
- `[~]` Phase 5: scripts, toolbox patches, and advanced ROM-hack workflows

## Port Matrix

| DSPRE editor/tool | Source data | Pokeweb target | Parser | Writer | UI | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pokemon / personal | personal, learnsets, evolutions | Pokemon editor | `[x]` | `[x]` | `[~]` | `[x]` | Game-gated Gen 4 fields |
| Moves and items | move/item NARCs | Moves and Items editors | `[x]` | `[x]` | `[~]` | `[x]` | Shared labels and format branches |
| Trainers | trdata, trpoke, trainer text | Trainer editor/export | `[x]` | `[x]` | `[~]` | `[x]` | Includes Gen 4 PID/nature handling |
| Encounters | DPPt/HGSS encounter NARCs | Encounter editor | `[x]` | `[x]` | `[~]` | `[x]` | Specialty encounter parity remains partial |
| Headers | map headers and names | Header editor | `[x]` | `[x]` | `[x]` | `[x]` | Generation-specific fields |
| Events / overworlds | zone event NARC | Overworld editor | `[x]` | `[x]` | `[~]` | `[x]` | Placement and asset parity remain active work |
| Matrices and maps | matrix, land, area/building assets | Overworld and Maps 3D | `[x]` | `[~]` | `[~]` | `[x]` | Rendering parity remains active work |
| Move animations | battle animations and graphics | Move animation editor | `[~]` | `[~]` | `[~]` | `[x]` | Platinum/HGSS parity work continues |
| Item standardization | Platinum script 404, events, overlay 9 | Patches | `[x]` | `[x]` | `[x]` | `[x]` | Platinum only; canonical event script is `7000 + itemId` |
| Script editor | field scripts and command database | Script editor | `[~]` | `[~]` | `[~]` | `[~]` | Full DSPRE plaintext/database parity remains later work |

## Update Rules

1. Preserve unrelated worktree changes.
2. Add parse/materialize and field-mutation tests for binary formats.
3. Verify export changes only intended NARC records or overlays.
4. Record game-family limitations in the matrix instead of silently applying another family’s offsets.
