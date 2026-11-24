#include <stddef.h>
#include <stdint.h>

typedef union {
    struct {
        uint16_t speciesAndForm;
        uint8_t beforePersonality[14];
        uint32_t personality;
        uint8_t beforeAbility[12];
        uint8_t ability;
        uint8_t beforeAbilitySlot[24];
        uint8_t abilitySlot;
        uint8_t tail[2];
    } fields;
    uint32_t words[15];
} FacilityPokemon;

_Static_assert(sizeof(FacilityPokemon) == 0x3c, "facility Pokémon size");
_Static_assert(offsetof(FacilityPokemon, fields.personality) == 0x10, "facility Pokémon PID");
_Static_assert(offsetof(FacilityPokemon, fields.ability) == 0x20, "facility Pokémon ability");
_Static_assert(offsetof(FacilityPokemon, fields.abilitySlot) == 0x39, "facility Pokémon padding");

#define ReadSet ((void (*)(unsigned, uint8_t *, unsigned)) (READ_SET | 1))
#define MakePartyPokemon ((void (*)(const FacilityPokemon *, void *, unsigned)) (MAKE_PARTY_POKEMON | 1))
#define GetPersonalParam ((unsigned (*)(unsigned, unsigned, unsigned)) (GET_PERSONAL_PARAM | 1))
#define SetHiddenAbility ((void (*)(void *, unsigned, unsigned)) (SET_HIDDEN_ABILITY | 1))

// BtlInst_MakeRomPokemon preserves its destination in r4 across the stock set read.
__asm__(
    ".thumb\n"
    ".global PwtReadSetHook\n"
    ".type PwtReadSetHook, %function\n"
    ".thumb_func\n"
    "PwtReadSetHook:\n"
    "mov r3, r4\n"
    "b PwtReadSet\n"
);

__attribute__((used, noinline))
void PwtReadSet(unsigned archive, uint8_t *data, unsigned file, FacilityPokemon *pokemon) {
    ReadSet(archive, data, file);
    if (archive == 250 || archive == 253 || archive == 256 || archive == 257) {
        pokemon->fields.abilitySlot = data[0x0a] >> 6;
    }
}

void PwtMakePartyPokemon(const FacilityPokemon *source, void *partyPokemon, unsigned level) {
    unsigned slot = source->fields.abilitySlot;
    if (slot < 1 || slot > 3) {
        MakePartyPokemon(source, partyPokemon, level);
        return;
    }

    unsigned species = source->fields.speciesAndForm & 0x7ff;
    unsigned form = source->fields.speciesAndForm >> 11;
    unsigned ability = GetPersonalParam(species, form, 25 + slot);
    if (ability == 0 || ability > UINT8_MAX) {
        MakePartyPokemon(source, partyPokemon, level);
    } else if (slot == 3) {
        MakePartyPokemon(source, partyPokemon, level);
        SetHiddenAbility(partyPokemon, species, form);
    } else {
        FacilityPokemon updated;
        for (unsigned i = 0; i < sizeof(updated.words) / sizeof(updated.words[0]); i++) {
            updated.words[i] = source->words[i];
        }
        updated.fields.ability = ability;
        updated.fields.personality = (source->fields.personality & ~0x10000u) | ((slot - 1) << 16);
        MakePartyPokemon(&updated, partyPokemon, level);
    }
}
