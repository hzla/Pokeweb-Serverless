// Configurable dust cloud and flying shadow outcomes for Black, White,
// Black 2 and White 2. The native step handler (EFFECT_ENCOUNT_TriggerSpot in
// BW1, CreateRandomPhenomenonEvent in BW2) still decides when a phenomenon is
// used, starts the battle or item script and clears the spot. Three call sites
// inside it are redirected here: its 0-999 roll and its two item pickers.
#include "phenomena.h"

// Resolved per game by the build's symbol database.
extern u32 Phen_NativeRandom(u32 max);
extern u16 Phen_NativeDustItem(u32 zone);
extern u16 Phen_NativeShadowItem(void);

// Written by Pokeweb at install time. An unconfigured block keeps the native
// odds and item pickers, so a bare DLL behaves exactly like the retail game.
__attribute__((used, aligned(4))) PhenConfig Phen_Config = {
    PHEN_MAGIC, PHEN_VERSION, 0, {400, 200}, {{0, 0, {{0, 0}}}, {0, 0, {{0, 0}}}}, {{0, 0, 0, {0}, {0, 0, {{0, 0}}}}},
};

static int Phen_ConfigValid(void) {
    return Phen_Config.magic == PHEN_MAGIC && Phen_Config.version == PHEN_VERSION && Phen_Config.groupCount <= PHEN_MAX_GROUPS;
}

static int Phen_KindOf(const void *spot) {
    u32 kind = PHEN_SPOT_KIND(spot);
    if (kind == PHEN_NATIVE_DUST_CLOUD) return PHEN_KIND_DUST;
    if (kind == PHEN_NATIVE_FLYING_SHADOW) return PHEN_KIND_SHADOW;
    return -1;
}

static const PhenGroup *Phen_FindGroup(u32 kind, u32 zone) {
    for (u32 i = 0; i < Phen_Config.groupCount; ++i) {
        const PhenGroup *group = &Phen_Config.groups[i];
        if (group->kind != kind || group->zoneCount > PHEN_MAX_ZONES) continue;
        for (u32 j = 0; j < group->zoneCount; ++j)
            if (group->zones[j] == zone) return group;
    }
    return 0;
}

static int Phen_Pick(const PhenTable *table, u16 *item) {
    u32 total = 0;
    if (table->count == 0 || table->count > PHEN_MAX_ITEMS) return 0;
    for (u32 i = 0; i < table->count; ++i) total += table->entries[i].weight;
    if (total == 0) return 0;
    u32 roll = Phen_NativeRandom(total);
    for (u32 i = 0; i < table->count; ++i) {
        u32 weight = table->entries[i].weight;
        if (roll < weight) {
            *item = table->entries[i].item;
            return 1;
        }
        roll -= weight;
    }
    return 0;
}

// Replaces the native roll. The native code starts a battle for a roll below
// its own threshold (200 for shadows, 400 for dust clouds) and gives an item
// otherwise, so 0 always means battle and 999 always means item.
u32 Phen_Roll(u32 max, const void *spot) {
    int kind = Phen_KindOf(spot);
    if (kind < 0 || max != PHEN_PERMILLE || !Phen_ConfigValid()) return Phen_NativeRandom(max);
    u32 chance = Phen_Config.encounterPermille[kind];
    const PhenGroup *group = Phen_FindGroup((u32)kind, PHEN_SPOT_ZONE(spot));
    if (group && group->encounterPermille != PHEN_INHERIT) chance = group->encounterPermille;
    if (chance > PHEN_PERMILLE) chance = PHEN_PERMILLE;
    return Phen_NativeRandom(PHEN_PERMILLE) < chance ? 0 : PHEN_PERMILLE - 1;
}

static u16 Phen_Item(u32 kind, const void *spot) {
    u16 item;
    u32 zone = PHEN_SPOT_ZONE(spot);
    if (Phen_ConfigValid()) {
        const PhenGroup *group = Phen_FindGroup(kind, zone);
        if (group && Phen_Pick(&group->items, &item)) return item;
        if (Phen_Pick(&Phen_Config.items[kind], &item)) return item;
    }
    return kind == PHEN_KIND_DUST ? Phen_NativeDustItem(zone) : Phen_NativeShadowItem();
}

u16 Phen_DustItem(const void *spot) { return Phen_Item(PHEN_KIND_DUST, spot); }
u16 Phen_ShadowItem(const void *spot) { return Phen_Item(PHEN_KIND_SHADOW, spot); }
