# Porta PC

Press Start during normal exploration to open native PC script 10090 (`0x276A`).
Usual PC menus and progression-dependent options remain active. Supports checked
US Black 2/White 2 field layouts. No replacement script or save format is used.

The field hook uses native event ownership and yields to existing events/menu
locks. Rail-map support follows the checked native context; this opens the PC
menu rather than changing field geometry or unrestricted storage access.
Unknown native code and conflicting relocations are rejected before installation.

Run `python3 runtime/porta-pc/build.py` with Python, Java, ARM GNU tools and
RPMTool; select tools through `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR` and `PMC_ESDB`
where needed. `python3 runtime/porta-pc/verify.py` requires Unicorn for compiled
checks. Other versions and complete field/application behavior need gameplay
verification.
