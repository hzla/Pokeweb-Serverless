# Standalone LEARNSET viewer

Current BW2 bundled version **1.5.0** installs two stripped PMC companions for each verified English White 2 (IRDO) and Black 2 (IREO) profile. Separately compiled **0.1.0-bw1-candidate** companions support English US revision-0 Black (IRBO) and White (IRAO) through the normal installer after DS gameplay and visual acceptance in both games. The existing build identifier is retained for the tested binaries. The [BW1 release record](../BW1_UI_RELEASE.md) binds availability to their native profiles and exact DLL hashes; live DSi acceptance is pending. The viewer is independent of Upgrade and the Enhanced Party Menu. The installer pins native hook/resource signatures and rejects unknown overlaps.

LEARNSET is a read-only party command. It appears just before Cancel after field commands have expanded, provided a command slot remains among the native eight. Eggs and battle, daycare, item, and mail contexts do not expose it. RELEARN and retail tutors are unchanged; viewing LEARNSET does not teach moves, spend items, or edit the Pokémon.

The upper panel shows ROM species/form information, types, abilities, base stats, and a browsable evolution family. Only the highlighted native icon alternates its two poses. L/R moves through the family in place without a fade; D-pad party changes use the native fade/relaunch. The lower learnset follows the selected stage, with ROM move details and requirement text. A successful L/R family move plays tutor-list sound 1356; a successful D-pad party change plays summary-page sound 1637. Endpoints and failed refreshes are silent. A bounded evolution graph and three icon buffers live only for the viewer session; temporary ROM and message handles close before input resumes. This is tutor-application memory, not persistent PMC or battle state.

Pokeweb appends or reuses private text in BW2 banks 178/401 and BW1 banks 157/204 without replacing shared tutor strings. Updating both companions preserves allocated IDs and edited private text. Staged uninstall removes the companions; text and private ID assignments are retained for reinstall. Installation commits PMC, text, and both companions together; failed installation leaves the project unchanged. A module already baked into an imported ROM cannot be physically deleted by staged uninstall, so keep an unpatched source ROM for rollback.

## Build and verify

An experimental [BW2 Ruby port](../ruby-patches/learnset/README.md) implements
the viewer behavior in typed Ruby and builds separate native candidates. Its
[authoring guide](../ruby-patches/AUTHORING.md) describes Ruby patch development.
The bundled release and the separate BW1 implementation continue to use this
directory's C++ sources.

From the Pokeweb repository root:

```sh
npm run learnset:build
python3 runtime/learnset-viewer/verify_runtime.py
python3 runtime/learnset-viewer/verify_info.py
python3 runtime/learnset-viewer/verify_graphics.py
npm run learnset:verify-rom -- /path/to/cleanwhite2.nds --enhanced-first
npm run build
```

Build and inspect BW1 companions separately:

```sh
npm run learnset:build-bw1
npm run learnset:verify-bw1
python3 runtime/learnset-viewer/verify_info.py --bw1 --header-only
python3 runtime/learnset-viewer/verify_info.py --bw1 --navigation-only
python3 runtime/learnset-viewer/verify_info.py --bw1 --cache-only
python3 runtime/learnset-viewer/verify_bw1_memory.py
npm run learnset:bundle-bw1-candidates
npm run learnset:prepare-bw1-validation -- INPUT.nds NEW-OUTPUT.nds
```

BW1 profiles independently bind ARM/Thumb native functions, overlays 10/91/173, 60-byte personal records, party/request offsets, type archive `a/0/8/3`, and tutor graphics `a/1/2/4`. The private validator temporarily overrides acceptance only in its process, uses the normal installer, checks export/reopen and retained private text, and writes a new filename without modifying the source. It never changes shipped support flags.

BW2 builds pin US overlays 12, 165, and 258. Set `LEARNSET_W2_ROM`, `LEARNSET_B2_ROM`, `LEARNSET_B_ROM`, `LEARNSET_W_ROM`, `ARM_TOOLCHAIN_BIN`, or `RPM_TOOL_JAR` to override local inputs and tools. Python needs `ndspy`; BW1 profile extraction also uses Capstone. Compiled checks use Unicorn and `pyelftools` (global or the ignored `build/python` directory). `build/` contains generated intermediates and local diagnostics; only stripped DLLs and their manifest ship with Pokeweb. BW2 rebuilds preserve the existing BW1 profile entries. The checks run host logic and isolated native-call fixtures, not a complete game session.

[VALIDATION.md](VALIDATION.md) holds current evidence and its limits. Cold-boot acceptance still needs LEARNSET opening and repeated exits across party slots, forms, long and empty lists, in-place L/R navigation, D-pad switches, sound behavior, private text, ordinary tutors afterward, and battles/menus around the viewer. Use an ordinary battery save with the new export; a state captured under an older DLL restores old code. Earlier release narratives and experimental measurements remain in Git history.
