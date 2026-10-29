# Tag Battle Stabilization

US White 2 module for the checked native battle-AI layout. It serializes trainer
AI decisions so different trainer clients do not hold separate script buffers
at the same time. Ownership survives frame yields and releases on completion;
initialization/teardown reset it. Busy calls yield rather than spin.

The patch changes AI scheduling for all affected clients, including an AI
partner. Shared RNG order and move choices can change, and total decision time
can increase. It does not enlarge battle heaps or party storage; one script
still needs to fit in memory.

Overlay-167 call hooks wrap native AI initialization, main and exit. Installation
checks those sites, targets, known module identities and overlapping relocations
to avoid duplicate installation. This cannot establish compatibility with every
custom or indirect AI hook.

Build with `python3 runtime/tag-battle-stabilization/build.py`. Requires Python,
Java, ARM GNU tools and CTRMap RPMTool; `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR` and
`PMC_ESDB` override build inputs. A changed build requires a new installer
fingerprint and runtime checks.
