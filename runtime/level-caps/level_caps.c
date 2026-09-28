// Adapted from PW2Code's Hard Level Caps by dararo for retail US BW2.
// The save work variable 16415 stores the cap; zero means the retail cap 100.
#include <stdint.h>

typedef struct {
    void *party_src;
    void *disguise_src;
    uint32_t experience;
    uint16_t species;
    uint16_t max_hp;
    uint16_t current_hp;
    uint16_t held_item;
    uint16_t used_item;
    uint16_t ability;
    uint8_t level;
    uint8_t battle_slot;
    uint8_t base_attack;
    uint8_t flags;
} BattleMonHead;

extern void *GameData_GetEventWork(void *game_data);
extern uint16_t *EventWork_GetWkPtr(void *event_work, uint32_t variable);
extern uint32_t PokeParty_GetParam(void *pkm, uint32_t field, uint32_t arg);
extern void PokeParty_SetParam(void *pkm, uint32_t field, uint32_t value);
extern uint32_t PML_UtilGetPkmLvExp(uint16_t species, uint16_t form, uint32_t level);
extern uint32_t CalcLevelByExp(uint16_t species, uint16_t form, uint32_t exp);
extern uint32_t PassPower_ApplyEXP(uint32_t exp);
extern void DayCare_CommitPkmGrowth(void *pkm, uint32_t steps);
extern uint32_t DayCareSave_GetPkmStatus(void *save, uint32_t slot);
extern void *DayCareSave_GetPkm(void *save, uint32_t slot);
extern uint32_t DayCareSave_GetPkmStepCounter(void *save, uint32_t slot);
extern uint32_t DayCare_CalcNewExp(uint32_t exp, uint32_t steps);

enum {
    PKM_FIELD_SPECIES = 0x05,
    PKM_FIELD_EXPERIENCE = 0x08,
    PKM_FIELD_FORM = 0x6F,
    PKM_FIELD_LEVEL = 0x9E,
};

#if defined(LEVEL_CAP_B2)
#define GAME_BEACON 0x02141800u
#else
#define GAME_BEACON 0x02141840u
#endif

static uint32_t get_cap(void) {
    void *beacon = *(void * volatile *)GAME_BEACON;
    if (!beacon) return 100;
    void *game_data = *(void **)((uint8_t *)beacon + 4);
    if (!game_data) return 100;
    uint16_t *work = EventWork_GetWkPtr(GameData_GetEventWork(game_data), 16415);
    uint32_t cap = work ? *work : 0;
    return cap >= 1 && cap <= 100 ? cap : 100;
}

// Hook the game's PassPower_ApplyEXP call after all normal EXP bonuses. r7 in
// AddExpAndEVs holds the current BattleMon, and r4 its 12-byte CalcExpWork.
uint32_t LevelCaps_ApplyBattleExp(uint32_t exp, const BattleMonHead *mon, uint32_t *calc_work) {
    uint32_t result = PassPower_ApplyEXP(exp);
    uint32_t cap = get_cap();
    if (mon->level >= cap) {
        calc_work[0] = calc_work[1] = calc_work[2] = 0;
        return 0;
    }
    uint8_t form = *((const uint8_t *)mon + 0x141);
    uint32_t threshold = PML_UtilGetPkmLvExp(mon->species, form, cap);
    uint32_t room = threshold > mon->experience ? threshold - mon->experience : 0;
    return result < room ? result : room;
}

// PW2Code makes Infinite Candy (622) respect the cap, while regular Rare Candy
// (50) remains usable up to level 100. The retail item eligibility logic runs
// unchanged for every other item and for item 622 below the cap.
uint32_t LevelCaps_DenyInfiniteCandy(void *pkm, uint32_t item_id) {
    return item_id == 622 && PokeParty_GetParam(pkm, PKM_FIELD_LEVEL, 0) >= get_cap();
}

void THUMB_BRANCH_LINK_DayCare_RemovePkm_0x28(void *pkm, uint32_t steps) {
    if (PokeParty_GetParam(pkm, PKM_FIELD_LEVEL, 0) < get_cap()) DayCare_CommitPkmGrowth(pkm, steps);
}

void THUMB_BRANCH_LINK_DayCare_CommitPkmGrowth_0x58(void *pkm, uint32_t field, uint32_t exp) {
    uint32_t cap = get_cap();
    uint16_t species = (uint16_t)PokeParty_GetParam(pkm, PKM_FIELD_SPECIES, 0);
    uint16_t form = (uint16_t)PokeParty_GetParam(pkm, PKM_FIELD_FORM, 0);
    uint32_t threshold = PML_UtilGetPkmLvExp(species, form, cap);
    uint32_t old_exp = PokeParty_GetParam(pkm, PKM_FIELD_EXPERIENCE, 0);
    if (old_exp < threshold && exp > threshold) exp = threshold;
    PokeParty_SetParam(pkm, field, exp);
}

uint32_t THUMB_BRANCH_DayCare_CalcNewLevel(void *day_care, uint32_t slot) {
    void *save = *(void **)((uint8_t *)day_care + 8);
    if (!DayCareSave_GetPkmStatus(save, slot)) return 1;
    void *pkm = DayCareSave_GetPkm(save, slot);
    uint32_t level = PokeParty_GetParam(pkm, PKM_FIELD_LEVEL, 0);
    uint32_t cap = get_cap();
    if (level >= cap) return level;
    uint16_t species = (uint16_t)PokeParty_GetParam(pkm, PKM_FIELD_SPECIES, 0);
    uint16_t form = (uint16_t)PokeParty_GetParam(pkm, PKM_FIELD_FORM, 0);
    uint32_t exp = PokeParty_GetParam(pkm, PKM_FIELD_EXPERIENCE, 0);
    uint32_t steps = DayCareSave_GetPkmStepCounter(save, slot);
    uint32_t new_level = CalcLevelByExp(species, form, DayCare_CalcNewExp(exp, steps));
    return new_level > cap ? cap : new_level;
}
