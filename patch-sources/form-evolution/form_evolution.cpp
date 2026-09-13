typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

namespace {

enum PersonalField : u32 {
    Personal_FormeDataOffs = 0x1e,
    Personal_FormeCount = 0x20,
};

struct FormTarget {
    u16 species;
    u16 form;
};

extern "C" u32 PML_PersonalGetParamSingle(u32 species, u32 form, u32 field);
extern "C" void setChangedPkmSpecies(void *pokemon, u32 species);
extern "C" u32 PokeParty_ChangeForme(void *pokemon, u32 form);

#if !defined(POKEWEB_GAME_B2) && !defined(POKEWEB_GAME_W2)
#error Define POKEWEB_GAME_B2 or POKEWEB_GAME_W2.
#endif

static const u16 LastRetailSpecies = 649;
static const u16 FirstFormPersonalId = 650;
static const u32 MaximumFormCount = 31;

static FormTarget ResolveFormTarget(u16 target)
{
    FormTarget resolved = { target, 0 };
    if (target < FirstFormPersonalId) {
        return resolved;
    }

    for (u16 species = 1; species <= LastRetailSpecies; ++species) {
        const u32 formCount = PML_PersonalGetParamSingle(species, 0, Personal_FormeCount);
        if (formCount <= 1 || formCount > MaximumFormCount) {
            continue;
        }

        const u32 firstForm = PML_PersonalGetParamSingle(species, 0, Personal_FormeDataOffs);
        if (firstForm == 0) {
            continue;
        }

        const u32 formOffset = static_cast<u32>(target) - firstForm;
        if (target >= firstForm && formOffset < formCount - 1) {
            resolved.species = species;
            resolved.form = static_cast<u16>(formOffset + 1);
            return resolved;
        }
    }

    return resolved;
}

static void ApplyEvolutionTarget(void *pokemon, u16 target)
{
    const FormTarget resolved = ResolveFormTarget(target);
    if (resolved.form == 0) {
        setChangedPkmSpecies(pokemon, target);
        return;
    }

    // The retail species-change routine preserves the previous form while it
    // refreshes ability, gender and stats. Reset it first so an evolution from
    // form 2 into a species which only has form 1 cannot perform an invalid
    // personal-data lookup between the two changes.
    PokeParty_ChangeForme(pokemon, 0);
    setChangedPkmSpecies(pokemon, resolved.species);
    PokeParty_ChangeForme(pokemon, resolved.form);
}

} // namespace

#if defined(POKEWEB_GAME_B2)
extern "C" void THUMB_BRANCH_LINK_284_0x21E355C(void *pokemon, u16 target)
{
    ApplyEvolutionTarget(pokemon, target);
}

extern "C" void THUMB_BRANCH_LINK_284_0x21E4E22(void *pokemon, u16 target)
{
    ApplyEvolutionTarget(pokemon, target);
}
#else
extern "C" void THUMB_BRANCH_LINK_284_0x21E359C(void *pokemon, u16 target)
{
    ApplyEvolutionTarget(pokemon, target);
}

extern "C" void THUMB_BRANCH_LINK_284_0x21E4E62(void *pokemon, u16 target)
{
    ApplyEvolutionTarget(pokemon, target);
}
#endif
