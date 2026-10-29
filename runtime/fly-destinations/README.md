# BW2 Fly destinations

Open **Fly Destinations** from navigation or Headers. Choose an existing area,
enable Fly, select its visit flag and landing position, apply and export. Supports
checked US revision-0 Black 2/White 2 layouts; other games or relocated functions
need separate bindings. Hook conflicts are rejected before changing the project.

The Town Map keeps its 85 records and native visuals/hit regions. Fly settings
and visit flags use `a/0/8/5`, member 0. Saved flags are 1–3059; native conditions
61440–61442 are also accepted. Flag 65535 cannot unlock an enabled destination.
Custom flags must be set by game scripts.

Landing overrides are keyed by area ID in the DLL configuration and affect Fly
only. Header default spawns remain available to other transitions. Route 4 and
Join Avenue keep independent overrides. Grid positions use signed 16-bit matrix
coordinates; rail destinations use component/front/side values. The preview uses
spring terrain and does not validate collision or height; rail points cannot yet
be plotted. Select walkable coordinates and test the actual arrival in-game.

Build/check with `python3 runtime/fly-destinations/build.py`,
`python3 runtime/fly-destinations/verify.py` and
`npx vitest run src/test/flyDestinationModel.test.ts`. Native CPU and export
checks do not establish landing safety or animation behavior.
