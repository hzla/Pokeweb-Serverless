These five DLLs were generated with the preceding ability installer against
`makeItemEffectsProject(0, 0, true, true)`. They contain synthetic layout addresses
and one ability in slot 165, covering the base, contact-priority, library,
expanded-recipe and client-trapping runtime formats.

The recipe fixture is Harden: Defense +1 and Speed −1 on entry/ability gain.
They intentionally retain their original bytes. The compatibility tests reopen
them through the current verifier, rebuild with popup grouping, and check that
the rules survive. Regenerating them with the current installer would remove
that coverage.
