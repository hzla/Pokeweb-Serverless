#ifndef POKEBW2_W2U_RESIDENT_MEGA_ROSTER_H
#define POKEBW2_W2U_RESIDENT_MEGA_ROSTER_H

#include "types.h"

typedef struct {
    u16 species;
    u16 personal;
    u16 graphic;
    u16 icon;
    u16 displayKey;
    u8 form;
    u8 count;
    u8 palette;
} W2USpeciesFormEntry;

typedef struct {
    u16 species;
    u16 trigger;
    u16 abilities[3];
    u8 sourceForm;
    u8 targetForm;
    u8 moveTrigger;
} W2UMegaRoute;

enum {
    W2U_SPECIES_CAPACITY = 2048,
    W2U_SPECIES_EGG = W2U_SPECIES_CAPACITY,
    W2U_SPECIES_BAD_EGG,
    W2U_SPECIES_ACTOR_FIRST,
    W2U_SPECIES_ACTOR_LAST = W2U_SPECIES_ACTOR_FIRST + (684 - 652),
    W2U_SPECIES_LOGICAL_COUNT,
    W2U_SPECIES_LEGACY_EGG = 650,
    W2U_SPECIES_LEGACY_ACTOR_FIRST = 652,
    W2U_SPECIES_LEGACY_LAST = 684,
    W2U_SPECIES_LEGACY_OFFSET = W2U_SPECIES_EGG - W2U_SPECIES_LEGACY_EGG,
    W2U_MEGA_ITEM_LAST = 641,
    // The newer held items follow the stones, staged with them: res/w2u/items.json, tools/data/items.py STAGED_LATER
    W2U_STAGED_ITEM_LAST = 659,
    W2U_MEGA_ROSTER_CAP_STRONG_WEATHER = 1,
    W2U_MEGA_ROSTER_CAP_PARENTAL_BOND = 2,
};

// Resident read-only compile capabilities, available without loading the battle overlay.
extern const u32 gW2UMegaRosterCapabilities;

BOOL W2U_RosterDataReady(void);
const W2USpeciesFormEntry *W2U_RosterForm(u16 species, u8 form);
BOOL W2U_RosterPersonal(u16 species, u8 form, u16 *record);
// Single-cell previews own palettes independently of streamed MCSS carriers.
BOOL W2U_RosterPreview(u32 sheet, u32 *character, u32 *normalPalette, u32 *shinyPalette);
u16 W2U_RosterImportActor(u16 species);
u16 W2U_RosterLegacySpecies(u16 species);
u16 W2U_RosterDisplayKey(u16 species);
u16 W2U_RosterSpeciesFromDisplayKey(u16 key);
u16 W2U_RosterItemLast(void);
BOOL W2U_RosterIsStone(u16 item);
// A stone, or a newer held item staged past the retail items
BOOL W2U_RosterIsStagedItem(u16 item);
BOOL W2U_RosterAbilitySupported(u16 ability);
const W2UMegaRoute *W2U_RosterRoutes(u32 *count);
u16 W2U_RosterResolveAbility(const W2UMegaRoute *route, u16 original, const u16 source[3], u8 slot);

#if defined(WHITE2) && defined(W2U_CHECKED_ITEM_READ) && !defined(BLACK2)
// Cache-only mapping availability; never initializes archives or changes state.
BOOL W2U_RosterItemMappingReady(void);
#endif

#endif // POKEBW2_W2U_RESIDENT_MEGA_ROSTER_H
