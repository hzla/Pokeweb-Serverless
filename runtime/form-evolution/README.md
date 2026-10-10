# Pokeweb form-evolution runtime

This PMC patch makes evolution NARC target IDs which point at Gen 5 personal-form records safe. It resolves the target personal ID back to its owning base species and form, then applies both values to the temporary evolution-animation Pokemon and the real party Pokemon.

The two builds share one C++ implementation. White 2 resolves its ARM9 calls from White2Upgrade's `pmc/ESDB.yml` symbol database. The available `IREO` export omits the three required Black 2 routines, so `symbols_b2.yml` supplies their revision-shifted addresses; the overlay 284 call sites were verified against the Black 2 binary.

Run `./build.sh` to regenerate `src/assets/codeinjection/FormEvolutionB2.dll` and `FormEvolutionW2.dll`.

An experimental [Ruby port and compiler](../ruby-patches/README.md) builds
separate B2/W2 candidates and compares their packaged native behavior against
this implementation. The C++ source remains the bundled runtime's build input.
