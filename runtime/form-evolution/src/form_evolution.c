// Pokeweb form evolution runtime: evolution by form (Black, White, Black 2, White 2).
//
// Retail reads a Pokémon's evolutions by species only and keeps its form number when the species changes, so an
// added form evolved as its base form did, into whatever form had its number (Galarian Darumaka, Darumaka's form 1,
// into Zen Mode Darmanitan). Two parts:
//
// - Core (resident, ARM9): the evolution check (CheckEvolveSpecies / SHINKA_CHECK_CheckEvolution) reads the evolution
//   record of the Pokémon's species and form: the evolution archive has a member per personal record. The check's
//   first parameter read (whether it is an egg) records the Pokémon; its record read uses the form's record when the
//   form has one, the archive has that member and it holds an evolution, else the species' (retail). A form that
//   should not evolve though its species does holds an evolution that cannot happen (Pokeweb writes "use item 0").
// - Demo (the evolution scene's overlay): an evolution target can be a form's personal record; the evolved Pokémon
//   then becomes that species in that form. A target that is a species keeps the form when the new species has it,
//   else form 0 (retail kept it even when the new species had no such form).
#include "hooks.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#define PARAM_SPECIES 5
#define PARAM_FORM 0x6f
#define PERSONAL_FORM_DATA 30
#define PERSONAL_FORM_COUNT 32
#define LAST_SPECIES 649
#define EVOLUTION_ROWS 7 // {u16 method, param, species} each

#ifdef PW_BW1
#define ARC_EVOLUTIONS 0x13
u32 POKE_TOOL_GetPartyValue(void *pkm, u32 param, void *extra);
u32 POKE_TOOL_GetPersonalParam(u16 species, u16 form, u32 field);
u32 POKE_PERSONAL_GetFormDataId(u32 species, int form);
u32 POKE_TOOL_ChangeForm(void *pkm, u32 form);
void POKE_TOOL_ChangeSpecies(void *pkm, u32 species);
void SHINKA_CHECK_LoadData(u32 species, void *rows);
u32 ARC_TOOL_GetArchiveFileCount(u32 arc);
#define GetParam(pkm, param) POKE_TOOL_GetPartyValue((pkm), (param), 0)
#define PersonalParam POKE_TOOL_GetPersonalParam
#define PersonalRecord(species, form) POKE_PERSONAL_GetFormDataId((species), (form))
#define ChangeForm POKE_TOOL_ChangeForm
#define ChangeSpecies POKE_TOOL_ChangeSpecies
#define ReadEvolutions SHINKA_CHECK_LoadData
#define EvolutionCount() ARC_TOOL_GetArchiveFileCount(ARC_EVOLUTIONS)
#else
#define ARC_EVOLUTIONS 19
u32 PokeParty_GetParam(void *pkm, u32 param, void *extra);
u32 PML_PersonalGetParamSingle(u16 species, u16 form, u32 field);
u16 PML_PersonalGetDatID(u16 species, u16 form);
int PokeParty_ChangeForme(void *pkm, u16 form);
void setChangedPkmSpecies(void *pkm, u16 species);
void getEvolutionInfoFile(u16 species, void *rows);
u32 GFL_ArcSysGetDataMax(u32 arc);
#define GetParam(pkm, param) PokeParty_GetParam((pkm), (param), 0)
#define PersonalParam PML_PersonalGetParamSingle
#define PersonalRecord(species, form) PML_PersonalGetDatID((species), (form))
#define ChangeForm PokeParty_ChangeForme
#define ChangeSpecies setChangedPkmSpecies
#define ReadEvolutions getEvolutionInfoFile
#define EvolutionCount() GFL_ArcSysGetDataMax(ARC_EVOLUTIONS)
#endif

#ifdef PW_FORM_EVOLUTION_CORE
static void *sChecking; // the Pokémon the evolution check is looking at

// The check's first read (is it an egg): note the Pokémon.
u32 HOOK_CHECK_FIRST_PARAM(void *pkm, u32 param, void *extra)
{
    sChecking = pkm;
    return GetParam(pkm, param);
}

// The check's evolution record: its form's, when the form has a personal record of its own with an evolution in
// it; an empty form record (a form added without evolutions of its own) evolves as its species, as in retail.
void HOOK_CHECK_READ(u32 species, void *rows)
{
    if (sChecking) {
        u32 form = GetParam(sChecking, PARAM_FORM);
        sChecking = 0;
        if (form) {
            u32 own = PersonalRecord(species, form), i;
            if (own != species && own < EvolutionCount()) {
                ReadEvolutions(own, rows);
                for (i = 0; i < EVOLUTION_ROWS; i++)
                    if (((u16 *)rows)[i * 3]) return; // a method: the form's own evolutions
            }
        }
    }
    ReadEvolutions(species, rows);
}
#endif

#ifdef PW_FORM_EVOLUTION_DEMO
// A personal record above the species: the species and form it belongs to (form 0 when none).
static u32 OwnerOf(u32 record, u32 *form)
{
    u32 species;
    *form = 0;
    if (record <= LAST_SPECIES) return record;
    for (species = 1; species <= LAST_SPECIES; species++) {
        u32 count = PersonalParam(species, 0, PERSONAL_FORM_COUNT), first;
        if (count <= 1 || count > 31) continue;
        first = PersonalParam(species, 0, PERSONAL_FORM_DATA);
        if (first && record >= first && record - first < count - 1) {
            *form = record - first + 1;
            return species;
        }
    }
    return record;
}

static void Evolve(void *pkm, u32 target)
{
    u32 form, species = OwnerOf(target, &form);
    if (species == target) {
        // A species: keep the form if the new species has it.
        u32 now = GetParam(pkm, PARAM_FORM);
        if (now && now >= PersonalParam(species, 0, PERSONAL_FORM_COUNT)) ChangeForm(pkm, 0);
        ChangeSpecies(pkm, species);
        return;
    }
    ChangeForm(pkm, 0); // no lookup of the old form in the new species between the two changes
    ChangeSpecies(pkm, species);
    ChangeForm(pkm, form);
}

void HOOK_DEMO_MAIN(void *pkm, u32 target) { Evolve(pkm, target); }
void HOOK_DEMO_VIEW(void *pkm, u32 target) { Evolve(pkm, target); }
#endif
