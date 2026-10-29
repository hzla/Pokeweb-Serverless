# Map-transition autosave

Experimental US revision-0 Black 2 and White 2 modules, separate from the bundled
installer catalog. Eligible door/warp and seamless area transitions queue one
native save after arrival events, fades and player movement finish. Scripts,
encounters, communication and menus retain priority. Initial Continue and normal
Bag/Party returns do not save; consecutive scripted transitions coalesce.

The native snapshot and asynchronous writer retain their backup/checksum and
flash handling. The module advances the writer at most eight times per field
tick. It shows a native saving message, closes it on completion, and displays
failure briefly. Low memory skips that transition's save. There is no new save
format or periodic timer.

Run `python3 runtime/autosave/build.py` and `python3 runtime/autosave/verify.py`
from the repository root. `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` select build
tools. `patch-rom.ts INPUT.nds NEW-OUTPUT.nds` creates a separate patched ROM.
Input saves must be preserved.

Hardware/DSi behavior, interruption/power loss, exhaustive story areas and broad
ROM-hack compatibility are unverified. Native backup handling does not establish
coverage of those cases.
