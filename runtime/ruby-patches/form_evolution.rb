# This file is parsed by compiler.rb; it is never evaluated as a build script.
native :personal_param, symbol: "PML_PersonalGetParamSingle",
       args: [:u32, :u32, :u32], returns: :u32
native :set_species, symbol: "setChangedPkmSpecies",
       args: [:ptr, :u32], returns: :void
native :change_form, symbol: "PokeParty_ChangeForme",
       args: [:ptr, :u32], returns: :u32

signature :apply_evolution_target,
          args: { pokemon: :ptr, target: :u16 }, returns: :void

def apply_evolution_target(pokemon, target)
  # Ordinary species targets retain the native behavior.
  if target < 650
    set_species(pokemon, target)
    return
  end

  species = 1
  while species <= 649
    form_count = personal_param(species, 0, 0x20)
    if form_count > 1 && form_count <= 31
      first_form = personal_param(species, 0, 0x1e)
      if first_form != 0 && target >= first_form
        form_offset = target - first_form
        if form_offset < form_count - 1
          # Reset the old form before refreshing species-dependent data.
          change_form(pokemon, 0)
          set_species(pokemon, species)
          change_form(pokemon, form_offset + 1)
          return
        end
      end
    end
    species += 1
  end

  # Unknown or malformed form records use the original species fallback.
  set_species(pokemon, target)
end
