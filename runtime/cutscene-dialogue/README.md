# White 2 cutscene dialogue adapter

`dialogue.c` and `step.s` add authored dialogue to US White 2 cutscene overlay
293 using native windows, fonts and tasks. The adapter supports timed text,
A/B-advanced text and response choices. Waiting freezes scene time while rendering
continues; closing text or abort cleanup restores the animation step. Choices
use Up/Down and A; B does not cancel. Forward jumps skip intervening scene cues.
Music and sound continue independently.

The 24-byte `PWDL` header records magic, version, code length and state offset.
Known legacy payloads upgrade through checked hooks; altered or unknown payloads
are rejected. `dialogue-runtime.json` is the current build input;
`dialogue-runtime-v1.json` only recognizes the earlier format.

Run `python3 runtime/cutscene-dialogue/build.py` with ARM GNU embedded tools on
PATH or selected by `ARM_TOOLCHAIN_BIN`. The build emits the native payload and
signature metadata used by the installer. Other games/layouts and seamless
transfer to a live field player are outside this adapter's contract.
