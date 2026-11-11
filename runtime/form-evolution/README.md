# Form evolution runtime (Black, White, Black 2, White 2)

Evolution by form. Retail reads a Pokémon's evolutions by species only and keeps its form number when the species
changes, so an added form evolved as its base form did, into whatever form had its number. The runtime has two parts
per game (`src/form_evolution.c`, built by `build.py`):

- `FormEvolutionCore<game>.dll` (ARM9, resident): the evolution check reads the evolution record of the Pokémon's
  form, when the form has a personal record of its own and that record holds an evolution. A form record that holds
  none evolves as its species, as in retail.
- `FormEvolution<game>.dll` (the evolution scene: overlay 284, Black / White 195): an evolution target can be a form's
  personal record, and the evolved Pokémon then becomes that species in that form. A target that is a species keeps
  the form when the new species has it, else form 0.

The scene part keeps the name, path and hooks of the earlier Black 2 / White 2-only runtime (`form_evolution.cpp`,
`build.sh`, PMC version 1.0.0, target resolution only), which it replaces. Installing over that runtime updates it.

    python3 runtime/form-evolution/build.py [--game W2|B2|B|W] [--test]

Inputs are those of the Mega Evolution runtime (`runtime/mega-evolution/build.py`). Every hook is a BL found by its
caller and callee in the retail binary, and the check's first parameter read is verified to be the egg read. The build
writes the DLLs and `formEvolutionManifest.json` to `src/assets/codeinjection`.

Installed by the Added-Form Evolution Support card and by Regional Forms (`runtime/regional-forms`).
