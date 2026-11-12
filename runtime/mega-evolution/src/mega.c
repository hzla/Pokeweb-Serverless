// Pokeweb Mega Evolution runtime: server, form lifetime and battle UI. See mega.h and ../README.md.
//
// Mega Evolution mechanic: Dararo (original implementation, White2Upgrade). Battle UI (the move-screen Mega button
// and its graphics) and the transformation animation: Hibiki. This file is a standalone port of that work onto the
// native battle code, with Generation 7 turn order.
#include "mega.h"
#include "hooks.h"
#include "button_assets.h"

#define MON_IDS 24
#define NO_FORM 0

// Patched at install time (Pokeweb's Mega Evolution editor writes the routes and message/animation IDs).
__attribute__((used, section(".data.pw_mega_config"))) PwMegaConfig gPwMegaConfig = {
    .magic = PW_MEGA_MAGIC,
    .version = PW_MEGA_VERSION,
    .seArm = 1357,
    .seDisarm = 1362,
    .revealFrame = 244,
    .options = PW_MEGA_OPTION_AUTO_FOES,
#ifdef PW_MEGA_TEST_ROUTES
    // Emulator check without content: Rotom holding Leftovers changes into Heat Rotom, and
    // Giratina holding Leftovers changes into Origin Forme (Pressure -> Levitate).
    .count = 2,
    .routes = { { .species = 479, .trigger = 234, .sourceForm = 0, .targetForm = 1 },
                { .species = 487, .trigger = 234, .sourceForm = 0, .targetForm = 1 } },
#endif
};

// Battle-local state. The DLL is loaded with overlay 167, so it starts zeroed in every battle.
typedef struct {
    u8 active;
    u8 baseForm;
    u16 ability;
} MegaRecord;

static MegaRecord sRecords[MON_IDS];
static u8 sSelection[MON_IDS]; // the form the player armed for a Pokémon on the move screen
static u8 sUsedTrainers; // one Mega Evolution per trainer (client) per battle
static u8 sTurnPending;

// ---- Routes ----

static BOOL KnowsMove(BattleMon *mon, u16 move) {
    u32 i;

    for (i = 0; i < MON_MOVE_COUNT(mon) && i < 4; i++) {
        if (MON_MOVE_ID(mon, i) == move) {
            return TRUE;
        }
    }
    return FALSE;
}

// A universal stone (Megite, Megite X ...) triggers every route of its class, whatever the route's own trigger.
static BOOL UniversalStoneFits(const PwMegaRoute *route, u16 item) {
    u16 first = gPwMegaConfig.universalItem;

    return first != 0 && route->megaClass != 0 && item == first + route->megaClass - 1;
}

static const PwMegaRoute *RouteFor(BattleMon *mon) {
    u32 i;
    u32 count = gPwMegaConfig.count < PW_MEGA_MAX_ROUTES ? gPwMegaConfig.count : PW_MEGA_MAX_ROUTES;

    for (i = 0; i < count; i++) {
        const PwMegaRoute *route = &gPwMegaConfig.routes[i];

        if (route->species != MON_SPECIES(mon) || route->sourceForm != MON_FORM(mon)) {
            continue;
        }
        if (((route->flags & PW_MEGA_ROUTE_MOVE) ? KnowsMove(mon, route->trigger)
                                                  : route->trigger == MON_HELD_ITEM(mon)) ||
            UniversalStoneFits(route, MON_HELD_ITEM(mon))) {
            return route;
        }
    }
    return NULL;
}

static const PwMegaRoute *RouteByTarget(u16 species, u8 form) {
    u32 i;
    u32 count = gPwMegaConfig.count < PW_MEGA_MAX_ROUTES ? gPwMegaConfig.count : PW_MEGA_MAX_ROUTES;

    if (form == NO_FORM) {
        return NULL;
    }
    for (i = 0; i < count; i++) {
        if (gPwMegaConfig.routes[i].species == species && gPwMegaConfig.routes[i].targetForm == form) {
            return &gPwMegaConfig.routes[i];
        }
    }
    return NULL;
}

static BOOL ProtectsItem(u16 species, u16 item) {
    u32 i;
    u32 count = gPwMegaConfig.count < PW_MEGA_MAX_ROUTES ? gPwMegaConfig.count : PW_MEGA_MAX_ROUTES;

    for (i = 0; i < count && item != 0; i++) {
        const PwMegaRoute *route = &gPwMegaConfig.routes[i];

        if (route->species == species &&
            ((!(route->flags & PW_MEGA_ROUTE_MOVE) && route->trigger == item) || UniversalStoneFits(route, item))) {
            return TRUE;
        }
    }
    return FALSE;
}

static u8 TrainerOf(BattleMon *mon) {
    return MonIDToClientID(MON_ID(mon)) & 3;
}

// The Mega form this Pokémon can change into now, or 0. One Mega Evolution per trainer per battle.
static u8 CanMega(BattleMon *mon) {
    const PwMegaRoute *route;

    if (mon == NULL || MON_SRC(mon) == NULL || MON_ID(mon) >= MON_IDS || MON_HP(mon) == 0 || MON_TRANSFORMED(mon) ||
        (sUsedTrainers & (1 << TrainerOf(mon)))) {
        return NO_FORM;
    }
    route = RouteFor(mon);
    // The form must exist in the personal data, or the change would read another species' record.
    if (route == NULL || route->targetForm == NO_FORM ||
        PML_PersonalGetParamSingle(MON_SPECIES(mon), 0, PERSONAL_FORM_COUNT) <= route->targetForm) {
        return NO_FORM;
    }
    return route->targetForm;
}

// The Mega form's ability in the slot the Pokémon's own ability has in its base form (first, second or hidden); a Mega
// with one ability has it in every slot.
static u16 MegaAbility(BattleMon *mon, u8 form) {
    static const u8 kSlots[3] = { PERSONAL_ABILITY_1, PERSONAL_ABILITY_2, PERSONAL_ABILITY_HIDDEN };
    u16 species = MON_SPECIES(mon);
    u8 base = MON_BASE_FORM(mon);
    u16 own = MON_BASE_ABILITY(mon);
    u16 ability = 0;
    u32 slot;

    if (MON_ID(mon) < MON_IDS && sRecords[MON_ID(mon)].active) {
        base = sRecords[MON_ID(mon)].baseForm;
        own = sRecords[MON_ID(mon)].ability;
    }
    for (slot = 0; slot < 3; slot++) {
        if (PML_PersonalGetParamSingle(species, base, kSlots[slot]) == own) {
            ability = PML_PersonalGetParamSingle(species, form, kSlots[slot]);
            break;
        }
    }
    if (ability == 0) {
        ability = PML_PersonalGetParamSingle(species, form, PERSONAL_ABILITY_1);
    }
    return ability != 0 ? ability : MON_ABILITY(mon);
}

// The ability a Pokémon had before Mega Evolving, from its record or, failing that, from its base form's personal
// data and its ability slot (as the games choose it).
static u16 OriginalAbility(BattleMon *mon, u8 baseForm) {
    PartyPkm *src = MON_SRC(mon);
    u16 species = MON_SPECIES(mon);
    u16 second;
    u32 mask;

    if (MON_ID(mon) < MON_IDS && sRecords[MON_ID(mon)].active) {
        return sRecords[MON_ID(mon)].ability;
    }
    if (PokeParty_GetParam(src, PKM_PARAM_HIDDEN_ABILITY, NULL)) {
        u16 hidden = PML_PersonalGetParamSingle(species, baseForm, PERSONAL_ABILITY_HIDDEN);

        if (hidden != 0) {
            return hidden;
        }
    }
    second = PML_PersonalGetParamSingle(species, baseForm, PERSONAL_ABILITY_2);
    mask = PokeParty_GetParam(src, PKM_PARAM_ORIGIN_GAME, NULL) < VERSION_WHITE ? 1 : 0x10000;
    if (second != 0 && (PokeParty_GetParam(src, PKM_PARAM_PID, NULL) & mask)) {
        return second;
    }
    return PML_PersonalGetParamSingle(species, baseForm, PERSONAL_ABILITY_1);
}

// A Pokémon that changed into a Mega form keeps it until the battle ends: its base form and ability become the
// Mega's, so the native resets on switching and fainting keep it, and its source Pokémon carries them too (the
// native switch-in reads the ability from there). Runs for the server's and the client's copy of the Pokémon.
static void ApplyMegaForm(BattleMon *mon, u8 form) {
    const PwMegaRoute *route = RouteByTarget(MON_SPECIES(mon), form);
    PartyPkm *src = MON_SRC(mon);
    MegaRecord *record;
    u16 ability;

    if (route == NULL || src == NULL || MON_TRANSFORMED(mon) || MON_ID(mon) >= MON_IDS) {
        return;
    }
    record = &sRecords[MON_ID(mon)];
    if (!record->active) {
        if (MON_BASE_FORM(mon) != route->sourceForm) {
            return;
        }
        // The battle's own copy of the ability: PokeParty_ChangeForme has already rewritten the party's ability
        // for the new form by now.
        record->active = TRUE;
        record->baseForm = MON_BASE_FORM(mon);
        record->ability = MON_BASE_ABILITY(mon);
    }
    ability = MegaAbility(mon, form);
    PokeParty_SetParam(src, PKM_PARAM_ABILITY, ability);
    MON_ABILITY(mon) = ability;
    MON_BASE_ABILITY(mon) = ability;
    MON_FLAGS1B(mon) = (MON_FLAGS1B(mon) & ~0x1f) | (form & 0x1f);
    MON_WEIGHT(mon) = PML_PersonalGetParamSingle(MON_SPECIES(mon), form, PERSONAL_WEIGHT);
}

// ---- Server ----

// ChangeForm (btl_pokeparam.c), retail, then the Mega bookkeeping.
void HOOK_CHANGE_FORM(BattleMon *mon, u8 form) {
    PartyPkm *src = MON_SRC(mon);
    BOOL wasEncrypted;

    MON_FORM(mon) = form;
    wasEncrypted = PokeParty_DecryptPkm(src);
    PokeParty_ChangeForme(src, form);
    setupBySrcDataBase(mon, src, TRUE);
    if (MON_SPECIES(mon) == SPECIES_SHAYMIN && form == 0) {
        MON_FLAGS1B(mon) &= ~0x1f;
        MON_ABILITY(mon) = PokeParty_GetParam(src, PKM_PARAM_ABILITY, NULL);
    }
    PokeParty_EncryptPkm(src, wasEncrypted);
    ApplyMegaForm(mon, form);
}

// BattleMon_WriteToSrc (btl_pokeparam.c), retail. When the battle hands the party back (keepBaseForm), a Mega
// Evolved Pokémon gets its own form and ability back first.
void HOOK_WRITE_TO_SRC(BattleMon *mon, BOOL keepBaseForm) {
    PartyPkm *src = MON_SRC(mon);
    u32 form;

    if (keepBaseForm) {
        const PwMegaRoute *route = RouteByTarget(MON_SPECIES(mon), MON_BASE_FORM(mon));

        if (route != NULL) {
            u8 base = MON_ID(mon) < MON_IDS && sRecords[MON_ID(mon)].active ? sRecords[MON_ID(mon)].baseForm
                                                                              : route->sourceForm;
            u16 ability = OriginalAbility(mon, base);

            MON_FLAGS1B(mon) = (MON_FLAGS1B(mon) & ~0x1f) | (base & 0x1f);
            MON_BASE_ABILITY(mon) = ability;
            PokeParty_SetParam(src, PKM_PARAM_ABILITY, ability);
            if (MON_ID(mon) < MON_IDS) {
                sRecords[MON_ID(mon)].active = FALSE;
            }
        }
    }
    PokeParty_SetParam(src, PKM_PARAM_EXP, MON_EXP(mon));
    PokeParty_SetParam(src, PKM_PARAM_HP, MON_HP(mon));
    if (MON_HP(mon) != 0) {
        PokeParty_SetStatusCond(src, GetBattleMonStatus(mon));
    } else {
        PokeParty_SetStatusCond(src, 0);
    }
    SetMovesAndPP(mon);
    if (MON_TRANSFORMED(mon) || keepBaseForm) {
        form = MON_BASE_FORM(mon);
    } else {
        form = MON_FORM(mon);
    }
    PokeParty_SetParam(src, PKM_PARAM_FORM, (u8)form);
    PokeParty_RecalcStats(src);
    PokeParty_SetParam(src, PKM_PARAM_ITEM, MON_HELD_ITEM(mon));
}

// GiratinaArceusGenesectItemCheck (handler_common.c): items that can't be removed, swapped or knocked off. A Mega
// Stone stays on the species it is for.
BOOL HOOK_ITEM_CHECK(u16 species, u16 item) {
    if (ProtectsItem(species, item)) {
        return TRUE;
    }
    switch (species) {
    case SPECIES_GIRATINA:
        return item == ITEM_GRISEOUS_ORB;
    case SPECIES_ARCEUS:
        return IsArceusPlate(item);
    case SPECIES_GENESECT:
        return IsGenesectDrive(item);
    }
    return FALSE;
}

static void MegaEvolve(BtlServerFlow *flow, BattleMon *mon, u8 form, const PwMegaRoute *route) {
    u8 monId = MON_ID(mon);
    u16 oldAbility = MON_ABILITY(mon);
    u16 newAbility = MegaAbility(mon, form);
    void *queue = FLOW_QUEUE(flow);
    u32 args[3];
    u32 state;

    // A move-triggered route the Pokémon takes with a universal stone gets the stone's message.
    if ((route->flags & PW_MEGA_ROUTE_MOVE) && !UniversalStoneFits(route, MON_HELD_ITEM(mon))) {
        if (gPwMegaConfig.msgWish) {
            args[0] = monId;
            args[1] = MonIDToClientID(monId);
            ServerDisplay_SetMessage(flow, gPwMegaConfig.msgWish, 2, args);
        }
    } else if (gPwMegaConfig.msgReacting) {
        args[0] = monId;
        args[1] = MON_HELD_ITEM(mon);
        args[2] = MonIDToClientID(monId);
        ServerDisplay_SetMessage(flow, gPwMegaConfig.msgReacting, 3, args);
    }
    state = PushState(FLOW_ACTION_STATE(flow), 0);
    ServerEvent_ChangeAbilityBefore(flow, monId, oldAbility, newAbility);
    PopState(FLOW_ACTION_STATE(flow), state, 0);
    AbilityEvent_RemoveItem(mon);
    HOOK_CHANGE_FORM(mon, form);
    BtlServerCmdQueue_Put(queue, 0x4f, monId, form); // the client's form change: the transformation
    if (gPwMegaConfig.msgEvolved) {
        args[0] = monId;
        ServerDisplay_SetMessage(flow, gPwMegaConfig.msgEvolved, 1, args);
    }
    BtlServerCmdQueue_Put(queue, 0x1d, monId, newAbility); // the client's copy takes the Mega's ability
    AbilityEvent_AddItem(mon);
    if (oldAbility != newAbility) {
        state = PushState(FLOW_ACTION_STATE(flow), 0);
        ServerEvent_ChangeAbilityAfter(flow, monId); // entry abilities (Drought, Intimidate...) activate
        PopState(FLOW_ACTION_STATE(flow), state, 0);
    }
    if (!CheckCondition(mon, CONDITION_GASTRO_ACID) && oldAbility == ABILITY_KLUTZ) {
        ServerControl_CheckItemReaction(flow, mon, 0);
    }
}

// Before the first move of the turn (after switches, items and running): every chosen Mega Evolution happens, in
// the current order, then the remaining actions are ordered again with the Megas' speed and abilities
// (Generation 7). Opposing trainers Mega Evolve whenever they can.
static void MegaBeforeMoves(BtlServerFlow *flow, ActionOrderEntry *first) {
    ActionOrderEntry *order = FLOW_ACTION_ORDER(flow);
    u32 count = FLOW_ACTION_ORDER_COUNT(flow);
    u32 start = ((u8 *)first - (u8 *)order) / AOE_SIZE;
    BOOL evolved = FALSE;
    u32 i;

    for (i = start; i < count && i < 6; i++) {
        ActionOrderEntry *entry = (ActionOrderEntry *)((u8 *)order + i * AOE_SIZE);
        BattleAction *action = AOE_ACTION(entry);
        BattleMon *mon = AOE_MON(entry);
        u8 form;

        if (AOE_DONE(entry) || ACTION_KIND(action) != 1 || mon == NULL) {
            continue;
        }
        form = ACTION_MEGA(action);
        ACTION_SET_MEGA(action, 0);
        // Trainers the game controls (opponents and partners, never wild Pokémon) Mega Evolve whenever they can.
        if (form == NO_FORM && (gPwMegaConfig.options & PW_MEGA_OPTION_AUTO_FOES) &&
            IsClientNPCTrainer(FLOW_MAIN_MODULE(flow), TrainerOf(mon)) && !IsWildOpponent(flow, MON_ID(mon))) {
            form = CanMega(mon);
        }
        if (form == NO_FORM || IsFainted(mon) || CanMega(mon) != form) {
            continue;
        }
        sUsedTrainers |= 1 << TrainerOf(mon);
        sSelection[MON_ID(mon)] = NO_FORM;
        MegaEvolve(flow, mon, form, RouteFor(mon));
        evolved = TRUE;
    }
    if (evolved) {
        ActionOrder_RecalcAndSort(flow, first, count - start);
    }
}

// BtlServerFlow_RunTurn's ActionOrder_Build call: a new turn's actions.
u8 HOOK_RUN_TURN_BUILD(BtlServerFlow *flow, void *clientActions, ActionOrderEntry *order, u8 max) {
    sTurnPending = TRUE;
    return ActionOrder_Build(flow, clientActions, order, max);
}

// ActionOrder_Run's ActionOrder_Proc call.
u32 HOOK_RUN_PROC(BtlServerFlow *flow, ActionOrderEntry *entry) {
    if (sTurnPending && !AOE_DONE(entry) && ACTION_KIND(AOE_ACTION(entry)) == 1) {
        sTurnPending = FALSE;
        MegaBeforeMoves(flow, entry);
    }
    return ActionOrder_Proc(flow, entry);
}

// ---- Move-screen button (Hibiki's graphics, drawn on the touch screen's BG layer 2) ----

#define BUTTON_W W2U_MEGA_NATIVE_BUTTON_TILE_W
#define BUTTON_H W2U_MEGA_NATIVE_BUTTON_TILE_H
#define SUB_BG2CNT ((volatile u16 *)0x0400100c)
#define SUB_BG2HOFS ((volatile u16 *)0x04001018)
#define SUB_BG2VOFS ((volatile u16 *)0x0400101a)
#define SUB_BG_VRAM 0x06200000u
#define SUB_BG_PALETTE ((volatile u16 *)0x05000400)

static const TouchRect sButtonRect[] = {
    { W2U_MEGA_NATIVE_BUTTON_TOUCH_UP, W2U_MEGA_NATIVE_BUTTON_TOUCH_DOWN, W2U_MEGA_NATIVE_BUTTON_TOUCH_LEFT,
      W2U_MEGA_NATIVE_BUTTON_TOUCH_RIGHT },
    { 0xff, 0, 0, 0 },
};

static struct {
    u16 saved[BUTTON_W * BUTTON_H];
    u16 screenBase;
    u8 valid;
    u8 mapWidth;
    u8 mapHeight;
    u8 tileX;
    u8 tileY;
    u8 mode;
} sButton;

static BOOL sStartHeld = TRUE;
static BOOL sTouchHeld = TRUE;

static u32 MapIndex(u32 x, u32 y, u32 width) {
    return ((y >> 5) * (width >> 5) + (x >> 5)) * 1024 + (y & 31) * 32 + (x & 31);
}

static volatile u16 *ScreenMap(u32 base) {
    return (volatile u16 *)(SUB_BG_VRAM + base * 0x800);
}

static void RestoreButtonArea(void) {
    volatile u16 *map;
    u32 row, col;

    if (!sButton.valid) {
        return;
    }
    map = ScreenMap(sButton.screenBase);
    for (row = 0; row < BUTTON_H; row++) {
        for (col = 0; col < BUTTON_W; col++) {
            map[MapIndex((sButton.tileX + col) & (sButton.mapWidth - 1), (sButton.tileY + row) & (sButton.mapHeight - 1),
                         sButton.mapWidth)] = sButton.saved[row * BUTTON_W + col];
        }
    }
    sButton.valid = FALSE;
}

// mode 0 hides the button (the screen's own tiles come back), 1 shows it, 2 shows it armed.
static void DrawButton(u8 mode) {
    u16 cnt = *SUB_BG2CNT;
    u32 base = (cnt >> 8) & 0x1f;
    u32 width = (cnt & 0x4000) ? 64 : 32;
    u32 height = (cnt & 0x8000) ? 64 : 32;
    u32 x = ((W2U_MEGA_NATIVE_BUTTON_TOUCH_LEFT + (*SUB_BG2HOFS & 0x1ff)) >> 3) & (width - 1);
    u32 y = ((W2U_MEGA_NATIVE_BUTTON_TOUCH_UP + (*SUB_BG2VOFS & 0x1ff)) >> 3) & (height - 1);
    volatile u16 *map = ScreenMap(base);
    volatile u16 *chars;
    u32 tileBase, row, col, i;

    if (sButton.valid && (sButton.screenBase != base || sButton.mapWidth != width || sButton.mapHeight != height ||
                          sButton.tileX != x || sButton.tileY != y)) {
        RestoreButtonArea(); // the screen scrolled or changed layout under the button
    }
    if (mode == 0) {
        RestoreButtonArea();
        sButton.mode = 0;
        return;
    }
    if (!sButton.valid) {
        for (row = 0; row < BUTTON_H; row++) {
            for (col = 0; col < BUTTON_W; col++) {
                sButton.saved[row * BUTTON_W + col] = map[MapIndex((x + col) & (width - 1), (y + row) & (height - 1), width)];
            }
        }
        sButton.screenBase = base;
        sButton.mapWidth = width;
        sButton.mapHeight = height;
        sButton.tileX = x;
        sButton.tileY = y;
        sButton.valid = TRUE;
        sButton.mode = 0;
    }
    // The tiles and palette are written every frame, as the screen's own loads may replace them.
    chars = (volatile u16 *)(SUB_BG_VRAM + ((cnt >> 2) & 0xf) * 0x4000 + W2U_MEGA_NATIVE_BUTTON_TILE_BASE_NORMAL * 32);
    for (i = 0; i < W2U_MEGA_NATIVE_BUTTON_TILE_BYTES_SIZE; i += 2) {
        chars[i >> 1] = W2U_MEGA_NATIVE_BUTTON_TILE_BYTES[i] | (W2U_MEGA_NATIVE_BUTTON_TILE_BYTES[i + 1] << 8);
    }
    for (i = 0; i < W2U_MEGA_NATIVE_BUTTON_PALETTE_COLORS_SIZE; i++) {
        SUB_BG_PALETTE[W2U_MEGA_NATIVE_BUTTON_PALETTE * 16 + i] = W2U_MEGA_NATIVE_BUTTON_PALETTE_COLORS[i];
    }
    tileBase = mode == 1 ? W2U_MEGA_NATIVE_BUTTON_TILE_BASE_NORMAL : W2U_MEGA_NATIVE_BUTTON_TILE_BASE_ARMED;
    if (sButton.mode == mode && map[MapIndex(x, y, width)] == (tileBase | (W2U_MEGA_NATIVE_BUTTON_PALETTE << 12))) {
        return;
    }
    for (row = 0; row < BUTTON_H; row++) {
        for (col = 0; col < BUTTON_W; col++) {
            map[MapIndex((x + col) & (width - 1), (y + row) & (height - 1), width)] =
                (tileBase + row * BUTTON_W + col) | (W2U_MEGA_NATIVE_BUTTON_PALETTE << 12);
        }
    }
    sButton.mode = mode;
}

// The player's Pokémon whose move is being chosen: the form it can take, with no other Pokémon of theirs armed.
static u8 SelectableForm(BattleMon *mon) {
    u32 i;
    u8 form;

    if (mon == NULL || MON_ID(mon) >= MON_IDS) {
        return NO_FORM;
    }
    form = CanMega(mon);
    if (form == NO_FORM) {
        return NO_FORM;
    }
    for (i = 0; i < MON_IDS; i++) {
        if (i != MON_ID(mon) && sSelection[i] != NO_FORM && (MonIDToClientID(i) & 3) == TrainerOf(mon)) {
            return NO_FORM;
        }
    }
    return form;
}

// The player Mega Evolves only with the Mega Ring (gPwMegaConfig.ringItem) in the bag. Checked once per battle: the
// DLL loads with the battle overlay, so sRing starts at 0 (not checked yet); 1 has it, 2 does not.
static u8 sRing;

static BOOL PlayerHasRing(BtlvCore *core) {
    void *bag;

    if (gPwMegaConfig.ringItem == 0) {
        return TRUE;
    }
    if (sRing == 0) {
        bag = GetBagSave(CORE_MAIN_MODULE(core));
        sRing = bag != NULL && BagSave_CheckAmount(bag, gPwMegaConfig.ringItem, 1, HEAPID_BATTLE) ? 1 : 2;
    }
    return sRing == 1;
}

static void Toggle(BattleMon *mon, u8 form) {
    if (sSelection[MON_ID(mon)] != NO_FORM) {
        sSelection[MON_ID(mon)] = NO_FORM;
        GFL_SndSEPlay(gPwMegaConfig.seDisarm);
    } else {
        sSelection[MON_ID(mon)] = form;
        GFL_SndSEPlay(gPwMegaConfig.seArm);
    }
}

// BattleClient_ActionSelectFight's BtlvCore_WaitMoveSelect call, every frame of the move screen. START or the
// button arms the Mega Evolution; the chosen fight action carries the form to the server.
BOOL HOOK_WAIT_MOVE_SELECT(BtlvCore *core) {
    BattleMon *mon = CORE_MON(core);
    u8 form = PlayerHasRing(core) ? SelectableForm(mon) : NO_FORM;
    BOOL startHeld = (GCTX_HIDGetHeldKeys() & PAD_BUTTON_START) != 0;
    BOOL touchHeld = form != NO_FORM && GFL_HIDGetTouchHeldRect(sButtonRect) == 0;
    BattleAction *action;
    BOOL done;

    if (form != NO_FORM && ((startHeld && !sStartHeld) || (touchHeld && !sTouchHeld))) {
        Toggle(mon, form);
    }
    sStartHeld = startHeld;
    sTouchHeld = touchHeld;
    if (form == NO_FORM && mon != NULL && MON_ID(mon) < MON_IDS) {
        sSelection[MON_ID(mon)] = NO_FORM;
    }
    DrawButton(form == NO_FORM ? 0 : (sSelection[MON_ID(mon)] != NO_FORM ? 2 : 1));
    done = BtlvCore_WaitMoveSelect(core);
    if (!done) {
        return FALSE;
    }
    // A START held when the next move screen opens does not toggle it again.
    sStartHeld = TRUE;
    sTouchHeld = TRUE;
    DrawButton(0);
    action = CORE_ACTION(core);
    if (mon != NULL && MON_ID(mon) < MON_IDS && action != NULL && !BattleAction_GetMoveInfoFlag(action)) {
        if (ACTION_KIND(action) == 1 && sSelection[MON_ID(mon)] != NO_FORM && sSelection[MON_ID(mon)] == form) {
            ACTION_SET_MEGA(action, form);
        } else {
            ACTION_SET_MEGA(action, 0);
            if (ACTION_KIND(action) != 1) {
                sSelection[MON_ID(mon)] = NO_FORM; // backed out of the move screen
            }
        }
    }
    return TRUE;
}

// ---- Transformation (Hibiki's animation) ----

static struct {
    BtlvCore *core;
    BattleMon *mon;
    u16 frames;
    u8 viewPos;
    u8 refreshed;
    u8 scriptStarted;
} sVisual;

// BtlvCore_StartFormChange (btlv_core.c), the client's form change command.
void HOOK_START_FORM_CHANGE(BtlvCore *core, u32 viewPos) {
    BattleMon *mon = PokeCon_GetPosMonInner(CORE_POKECON(core), ViewPosToBattlePos(CORE_MAIN_MODULE(core), viewPos));

    if (mon != NULL && RouteByTarget(MON_SPECIES(mon), MON_FORM(mon)) != NULL) {
        sVisual.core = core;
        sVisual.mon = mon;
        sVisual.frames = 0;
        sVisual.viewPos = viewPos;
        sVisual.refreshed = FALSE;
        sVisual.scriptStarted = FALSE;
        // IsBattleSceneOff is TRUE while battle animations are on, despite its name.
        if (gPwMegaConfig.animationMove != 0 && IsBattleSceneOff(CORE_MAIN_MODULE(core)) &&
            !BattleClient_IsChapterSkipping(CORE_CLIENT(core))) {
            BtlvScu_StartMoveEffect(CORE_SCU(core), viewPos, viewPos, gPwMegaConfig.animationMove, MOVE_TARGET_USER, 0, 0);
            sVisual.scriptStarted = TRUE;
        } else {
            BtlvEffect_ChangeSprite(GetSrcData(mon), viewPos);
            sVisual.refreshed = TRUE;
        }
        return;
    }
    sVisual.core = NULL;
    BtlvScu_StartChangeForm(CORE_SCU(core), viewPos, BattleClient_IsChapterSkipping(CORE_CLIENT(core)));
}

// BtlvCore_WaitFormChange: the Mega sprite appears at the animation's reveal frame.
BOOL HOOK_WAIT_FORM_CHANGE(BtlvCore *core) {
    BOOL done;

    if (sVisual.core != core) {
        return BtlvScu_WaitChangeSprite(CORE_SCU(core));
    }
    done = !sVisual.scriptStarted || BtlvScu_WaitMoveEffect(CORE_SCU(core));
    if (!sVisual.refreshed && (done || sVisual.frames >= gPwMegaConfig.revealFrame)) {
        BtlvEffect_ChangeSprite(GetSrcData(sVisual.mon), sVisual.viewPos);
        sVisual.refreshed = TRUE;
    }
    if (sVisual.frames != 0xffff) {
        sVisual.frames++;
    }
    if (done && !BtlvEffect_IsBusy()) {
        sVisual.core = NULL;
        sVisual.mon = NULL;
        return TRUE;
    }
    return FALSE;
}
