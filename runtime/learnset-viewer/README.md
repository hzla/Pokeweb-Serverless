# Standalone LEARNSET viewer

Current bundled version **1.4.5** installs two stripped PMC companions for each verified English White 2 (IRDO) and Black 2 (IREO) profile. It is independent of Upgrade and the Enhanced Party Menu. The installer pins native hook/resource signatures and rejects unknown overlaps instead of replacing them.

LEARNSET is a read-only party command. It appears just before Cancel after field commands have expanded, provided a command slot remains among the native eight. Eggs and battle, daycare, item, and mail contexts do not expose it. RELEARN and retail tutors are unchanged; viewing LEARNSET does not teach moves, spend items, or edit the Pokémon.

The upper panel shows ROM species/form information, types, abilities, base stats, and a browsable evolution family. Only the highlighted native icon alternates its two poses. L/R moves through the family in place without a fade; D-pad party changes use the native fade/relaunch. The lower learnset follows the selected stage, with ROM move details and requirement text. A successful L/R family move plays tutor-list sound 1356; a successful D-pad party change plays summary-page sound 1637. Endpoints and failed refreshes are silent. A bounded evolution graph and three icon buffers live only for the viewer session; temporary ROM and message handles close before input resumes. This is tutor-application memory, not persistent PMC or battle state.

Pokeweb appends or reuses private text in banks 178 and 401 without replacing shared tutor strings. Updating both companions preserves its versioned message configuration. Staged uninstall removes the companions; text is retained for reinstall. A module already baked into an imported ROM cannot be physically deleted by staged uninstall, so keep an unpatched source ROM for rollback.

## Build and verify

From the Pokeweb repository root:

```sh
npm run learnset:build
python3 runtime/learnset-viewer/verify_runtime.py
python3 runtime/learnset-viewer/verify_info.py
python3 runtime/learnset-viewer/verify_graphics.py
npm run learnset:verify-rom -- /path/to/cleanwhite2.nds --enhanced-first
npm run build
```

Builds pin the US overlays 12, 165, and 258. Set `LEARNSET_W2_ROM`, `LEARNSET_B2_ROM`, `ARM_TOOLCHAIN_BIN`, or `RPM_TOOL_JAR` to override local inputs and tools. Python needs `ndspy`; compiled wrapper checks use Unicorn and `pyelftools` (global or the ignored `build/python` directory). `build/` contains generated intermediates and local diagnostics; only the four DLLs and their manifest ship with Pokeweb. The checks run host logic and isolated Thumb/native-call fixtures, not a complete game session.

[VALIDATION.md](VALIDATION.md) holds current evidence and its limits. Cold-boot acceptance still needs LEARNSET opening and repeated exits across party slots, forms, long and empty lists, in-place L/R navigation, D-pad switches, sound behavior, private text, ordinary tutors afterward, and battles/menus around the viewer. Use an ordinary battery save with the new export; a state captured under an older DLL restores old code. Earlier release narratives and experimental measurements remain in Git history.
