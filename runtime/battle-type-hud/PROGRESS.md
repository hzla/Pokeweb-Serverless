# Current iteration

Bundle 0.4.3 contains Type Icons 0.3.3 and unchanged Move Preview 0.4.0.
Type Icons retains the HP slash fix and one-pixel exterior outlines (10x10
each, 21x10 with the gap). Names and levels return to their original positions;
icons paint over overlapping text and restore it for status labels.
The supplied captured state identified the missing enemy: its native battler ID
12 was truncated to 4 by a three-bit record field, so validation discarded the
binding before drawing. The full ID now occupies existing padding. A read-only
compiled regression reproduces the old failure and verifies the new Electric
icon against the captured gauge, using actual native getter routines.
The name hook preserves native placement and paints icons last.
Fixed icon state stays at 364 bytes; no sprites, palettes, VRAM or battle-heap
allocations are added. All 14 icon hooks and 20 resources are verified for both games.
Move Preview retains its red immunity highlighting and three color pickers.
Both components remain independent. See README.md and VALIDATION.md.

No in-game emulator testing for this or future battle UI work: the user tests
manually. Build, installer and focused logic checks remain appropriate.
No Cascade heap resizing or game-mechanics changes were made.
