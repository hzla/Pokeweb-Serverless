// Pokeweb regional forms: Zen Mode for Galarian Darmanitan (Black, White, Black 2, White 2).
//
// Retail's Zen Mode handlers switch Darmanitan between forms 0 (Standard) and 1 (Zen Mode): at the end of a turn the
// form is Zen Mode when its HP is at most half, and it returns to form 0 when it leaves the battle or loses the
// ability. A Galarian Darmanitan (an added form) would become the standard one. The runtime keeps the handlers and
// maps the forms of the Galarian pair: the handler's form read gives a Galarian Darmanitan 0 or 1 as if it were the
// standard pair, and the form change it sends gets the Galarian form back (0 -> Galarian, 1 -> Galarian Zen Mode).
// The Galarian forms' numbers are the installer's (sZen, patched by regionalFormsModel.ts at its "PWZN" mark).
#include "hooks.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#define DARMANITAN 555
#define VALUE_FORM 0x13

#ifdef PW_BW1
void *BTL_SERVER_FLOW_GetPokeParam(void *flow, u32 pokeId);
u32 BTL_POKEPARAM_GetSpecies(void *mon);
u32 BTL_POKEPARAM_GetValue(void *mon, u32 which);
void BTL_SERVER_FLOW_CommitCmdRecord(void *flow, void *cmd);
#define GetMon BTL_SERVER_FLOW_GetPokeParam
#define GetSpecies BTL_POKEPARAM_GetSpecies
#define GetValue BTL_POKEPARAM_GetValue
#define Commit BTL_SERVER_FLOW_CommitCmdRecord
#else
void *GetBattleMon(void *flow, u32 monId);
u32 GetBattleMonSpecies(void *mon);
u32 GetBattleMonStat(void *mon, u32 which);
void BattleHandler_PopWork(void *flow, void *work);
#define GetMon GetBattleMon
#define GetSpecies GetBattleMonSpecies
#define GetValue GetBattleMonStat
#define Commit BattleHandler_PopWork
#endif

// {mark, Galarian form, Galarian Zen Mode form}; 0 leaves Zen Mode as retail's.
volatile struct { char mark[4]; u8 galar; u8 galarZen; u16 reserved; } sZen = { { 'P', 'W', 'Z', 'N' }, 0, 0, 0 };

static int IsGalarian(void *mon, u32 form)
{
    return sZen.galar && GetSpecies(mon) == DARMANITAN && (form == sZen.galar || form == sZen.galarZen);
}

// The form Zen Mode compares with: a Galarian Darmanitan's as the standard pair's.
u32 HOOK_ZEN_FORM_READ(void *mon, u32 which)
{
    u32 value = GetValue(mon, which);
    if (which == VALUE_FORM && IsGalarian(mon, value)) return value == sZen.galarZen ? 1 : 0;
    return value;
}

// The form change Zen Mode sends ({header, u8 Pokémon, u8 form, ...}): the Galarian form of the pair.
static void SendFormChange(void *flow, u8 *change)
{
    void *mon = GetMon(flow, change[4]);
    if (IsGalarian(mon, GetValue(mon, VALUE_FORM))) change[5] = change[5] ? sZen.galarZen : sZen.galar;
    Commit(flow, change);
}

void HOOK_ZEN_UPDATE_SEND(void *flow, u8 *change) { SendFormChange(flow, change); }
void HOOK_ZEN_REVERT_SEND(void *flow, u8 *change) { SendFormChange(flow, change); }
