# Enhanced Party Menu for BW1

US revision-0 Black and White companions add EVOLVE and RELEARN to the native
party menu. Their separate BW1 Battle Log dependency provides immediate-KO
counters and native learning transitions. BW2 uses its own runtime dependency.
PK5 counter storage and save-log formats remain unchanged. Field scripts use
native command `0x0110` with counter parameters `0x0400`–`0x0402`.

Native bindings cover party overlay 91, battle-return overlay 92, field overlay
10 and reminder overlay 173. Reminder allocation failures return to the party
menu and release owned memory. Native request and selection behavior is retained.

Implementation sources live in the party-menu runtime checkout selected by
`W2U_RUNTIME_ROOT`. Build/check from this repository with:

```sh
npm run party-menu:build-bw1
npm run party-menu:bundle-bw1-candidates
npm run party-menu:verify-bw1
```

Normal installation requires accepted exact native profiles and dependency
hashes; rebuilding invalidates that acceptance. Live DSi/hardware behavior needs
separate testing. Other revisions require independent bindings.
