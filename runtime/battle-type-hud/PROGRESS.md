# Current iteration

Bundle 0.4.17 contains two selectable current Type Icons builds and unchanged
Move Preview 0.4.0. The Code Injection card shows preview sheets for both and a
checkbox that selects the circular symbols; unchecked installs the lettered
point-up variant. Switching variants replaces the existing Type Icons DLL at
its current path, so duplicate hooks are never installed.

The circular build uses the approved 18 white symbol masks and colored circles,
centered inside the same 12×11 logical footprint as the letters. It shares the
current 5-right/6-down diagonal placement, status behavior, live typing,
Illusion, palette handling, lifecycle hooks, and native caught-marker behavior.
It does not use the archived 0.3.11 marker relocation.

Pokeweb recognizes either current variant after export/reimport, restores the
matching checkbox, and upgrades historical builds through 0.3.16. Compiled ARM
checks cover all circular masks, types, panel slots, statuses, type changes,
unchanged frames, marker preservation, and teardown for B2 and W2. Focused
installer tests cover both directions of in-place variant switching. No in-game
emulator testing was run.
