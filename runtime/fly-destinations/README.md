# BW2 Fly destinations

Open **Headers & Overworlds → Fly Destinations**, or use the links in Headers and Town Map. This separate page edits area eligibility, visit conditions and landing coordinates, with destination-map previews. Apply and export the ROM to use the changes.

Fly now uses the combined [Town Map runtime](../town-map/README.md), which supports 85–128 area records on checked US revision-0 Black 2/White 2 layouts. Existing Fly 1.0.0/1.0.1 configurations migrate atomically while preserving overrides. Unknown code changes and conflicting hooks are rejected. The legacy builder remains available for reproducing those older modules.

Route 4 and Join Avenue have independent landing overrides. Grid positions use signed 16-bit matrix X/Y/Z; rail destinations use component/position/side values. The preview shows spring terrain and does not validate collision, height or rail coordinates. Test the actual arrival in-game. Header default spawns remain available to other transitions.
