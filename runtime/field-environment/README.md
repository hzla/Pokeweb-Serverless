# White 2 live field environment adapter

`environment.c` extends the US White 2 Aspertia field gimmick while preserving
native map callbacks, player, camera and actors. Seasonal tours require this
module; ordinary field tours use retail scripts. Other areas/layouts are outside
the adapter's contract.

Format 2 has a 128-byte header, 16-byte frame samples and 40-byte palette
programs; configuration is capped at 512 KiB. Samples carry blend, RGB555 tint,
season endpoints and FX32 ambient speed. `fieldEnvironmentClock.ts` supplies the
30 Hz authoring clock. Actor animation is not accelerated.

The module starts with the detached event camera, plays its private stream and
temporarily mutes field BGM. Completion stops the stream and restores BGM and
animation speed. Camera/input return remain native script actions. Persistence
uses saved work `0x41AE` with marker `0xA7C2` and the field-season module; the
native force-season flag stays clear so Save remains available. Lighting does
not advance RTC encounter/event logic.

Run `python3 runtime/field-environment/build.py` with an ARM GNU toolchain on
PATH or `ARM_TOOLCHAIN_BIN` and a clean White 2 input. It emits
`src/assets/cutscenes/field-environment-runtime.json`. Installation verifies
native callbacks and the reserved overlay-112 memory window. Live emulator and
hardware acceptance are separate from headless/compiled checks.
