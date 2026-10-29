# Trainer Field Conditions

Install through **Code Injection → Feature Add-Ons** or the Trainer sidebar's
**Battle Field Conditions** panel, then configure conditions and export. PMC
is installed automatically. Checked US revision-0 Black 2/White 2 profiles are
supported; BW1, other revisions, Gen 6+ terrain and Aurora Veil are outside scope.

Supported conditions include native weather, rooms, Gravity, Water/Mud Sport,
screens, Tailwind, Lucky Chant, hazards and Pledge side effects. Opening setup
uses native animations/messages before entry abilities. Screens/hazards are
applied to the configured side; authored weather and conditions are permanent
until native battle effects remove or replace them. Replacement effects keep
their normal duration. Later battle-created conditions are unchanged.

In multi-trainer battles, the primary opposing trainer (client 1) provides the
whole-field and both-side configuration; other trainers do not merge it. Wild,
facility, demo, online and communication battles pass through. Changing settings
affects subsequent battles and does not modify the save.

Native opening/field/side/file APIs and conflicting DLL hooks are verified before
installation. Build/check with `npm run trainerfields:build`,
`npm run trainerfields:verify` and
`npm run trainerfields:verify-rom -- /path/white2.nds /path/new-output.nds`.
`--game B2` or `W2` selects one build profile. Native gameplay and hardware
coverage remain distinct from compiled and export tests.
