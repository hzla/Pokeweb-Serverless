# Tag Battle Stabilization

Install **Tag Battle Stabilization** from **Code Injection** and export the ROM.
The bundled modules target US revision-0 Black, White, Black 2, and White 2.
The installer stages PMC when needed.

The runtime serializes trainer AI decisions to limit concurrent script memory.
The active client keeps ownership across frame yields and releases it after
native completion. Initialization and teardown reset ownership.

The patch changes AI scheduling for all affected clients, including an AI
partner. Shared RNG order and move choices can change, and total decision time
can increase. Each script needs to fit in the existing battle heap. Set team
sizes separately in the Trainer editor.

The battle client calls AI initialization, thinking, and teardown from overlay
93 in Black and White and overlay 167 in Black 2 and White 2. The native AI
routines are in overlays 96 and 170, respectively. The installer checks the
call instructions, native entries, module identities and overlapping
relocations. White 2 retains signature-based compatibility with edited headers
and recognizes the original Cascade module.

Build with Python, ndspy, Java, ARM GNU tools and CTRMap RPMTool.
`ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` override the tool paths.

```sh
python3 runtime/tag-battle-stabilization/build.py \
  --black BLACK.nds --white WHITE.nds --black2 BLACK2.nds --white2 WHITE2.nds
python3 runtime/tag-battle-stabilization/verify_runtime.py
```

The builder validates the retail calls and writes the bundled DLLs and
compatibility manifest. The second command requires Python Unicorn and checks
the compiled wrapper ABI, frame yields and cleanup.
