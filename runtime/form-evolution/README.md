# Form evolution runtime

Resolves evolution targets that name Gen 5 personal-form records back to their
owning base species and form, then applies both to the evolution-animation and
party Pokémon. Black 2 and White 2 share the C++ implementation with independent
native symbol bindings, including `symbols_b2.yml` for Black 2.

Run `./build.sh` from this directory to regenerate
`src/assets/codeinjection/FormEvolutionB2.dll` and `FormEvolutionW2.dll`.
The [Ruby frontend](../ruby-patches/README.md) builds separate experimental
candidates; C++ remains the bundled build input.
