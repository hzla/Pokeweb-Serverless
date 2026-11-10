#ifndef POKEBW2_PML_ITEM_H
#define POKEBW2_PML_ITEM_H

#include "types.h"
#include "constants/items.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Names from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except ItemData, ItemParams, the ITEM_PARAM_*,
// ITEM_FILE_* and ITEM_WORK_* constants, PML_ItemGetIconArcID, PML_ItemGetIconCellDatID, PML_ItemGetIconAnimDatID,
// PML_ItemIsUnholdable, PML_ItemIsDummy and PML_ItemIsB2W2Only

// Item data (pml_item.c, a guessed name): each item's file in ARCID_ITEMINFO, its icon's files in ARCID_ITEMGRA, and
// the tables of TMs, mail, berries and balls

// What an item's work holds
#define ITEM_WORK_VALUE 0
#define ITEM_WORK_PARAMS 1

// The effects of an item used on a Pokémon
typedef struct {
    u8 sleepHeal : 1;
    u8 poisonHeal : 1;
    u8 burnHeal : 1;
    u8 freezeHeal : 1;
    u8 paralysisHeal : 1;
    u8 confusionHeal : 1;
    u8 infatuationHeal : 1;
    u8 guardSpec : 1;
    u8 revive : 1;
    u8 reviveAll : 1;
    u8 levelUp : 1;
    u8 evolve : 1;
    u8 attackStages : 4;
    u8 defenseStages : 4;
    u8 spAttackStages : 4;
    u8 spDefenseStages : 4;
    u8 speedStages : 4;
    u8 accuracyStages : 4;
    u8 critStages : 2;
    u8 ppUp : 1;
    u8 ppMax : 1;
    u8 ppRestore : 1;
    u8 ppRestoreAll : 1;
    u8 hpRestore : 1;
    u8 hpEVUp : 1;
    u8 attackEVUp : 1;
    u8 defenseEVUp : 1;
    u8 speedEVUp : 1;
    u8 spAttackEVUp : 1;
    u8 spDefenseEVUp : 1;
    u8 friendshipUp1 : 1;
    u8 friendshipUp2 : 1;
    u8 friendshipUp3 : 1;
    u8 unk6_4 : 1;
    s8 hpEV;
    s8 attackEV;
    s8 defenseEV;
    s8 speedEV;
    s8 spAttackEV;
    s8 spDefenseEV;
    u8 hpRestoreAmount;
    u8 ppRestoreAmount;
    s8 friendship1;
    s8 friendship2;
    s8 friendship3;
} ItemParams;

// An item's file in ARCID_ITEMINFO
struct ItemData {
    u16 price;
    u8 holdEffect;
    u8 holdParam;
    u8 pluckEffect;
    u8 flingEffect;
    u8 flingPower;
    u8 naturalGiftPower;
    u16 naturalGiftType : 5;
    u16 important : 1;
    u16 registrable : 1;
    u16 fieldPocket : 4;
    u16 battlePocket : 5;
    u8 fieldFunc;
    u8 battleFunc;
    u8 workType;
    // The item's kind, which the bag sorts by first
    u8 kind;
    u8 unkE;
    // The item's place in the bag's sort within its kind
    u8 sortIndex;
    union {
        u8 value;
        ItemParams params;
    } work;
};

// PML_ItemGetParam's parameters: the item's fields, then its work's
enum {
    ITEM_PARAM_PRICE,
    ITEM_PARAM_HOLD_EFFECT,
    ITEM_PARAM_HOLD_PARAM,
    ITEM_PARAM_IMPORTANT,
    ITEM_PARAM_REGISTRABLE,
    ITEM_PARAM_FIELD_POCKET,
    ITEM_PARAM_FIELD_FUNC,
    ITEM_PARAM_BATTLE_FUNC,
    ITEM_PARAM_PLUCK_EFFECT,
    ITEM_PARAM_FLING_EFFECT,
    ITEM_PARAM_FLING_POWER,
    ITEM_PARAM_NATURAL_GIFT_POWER,
    ITEM_PARAM_NATURAL_GIFT_TYPE,
    ITEM_PARAM_BATTLE_POCKET,
    ITEM_PARAM_WORK_TYPE,
    ITEM_PARAM_KIND,
    ITEM_PARAM_UNK_E,
    ITEM_PARAM_SORT_INDEX,
    ITEM_PARAM_SLEEP_HEAL,
    ITEM_PARAM_POISON_HEAL,
    ITEM_PARAM_BURN_HEAL,
    ITEM_PARAM_FREEZE_HEAL,
    ITEM_PARAM_PARALYSIS_HEAL,
    ITEM_PARAM_CONFUSION_HEAL,
    ITEM_PARAM_INFATUATION_HEAL,
    ITEM_PARAM_GUARD_SPEC,
    ITEM_PARAM_REVIVE,
    ITEM_PARAM_REVIVE_ALL,
    ITEM_PARAM_LEVEL_UP,
    ITEM_PARAM_EVOLVE,
    ITEM_PARAM_ATTACK_STAGES,
    ITEM_PARAM_DEFENSE_STAGES,
    ITEM_PARAM_SP_ATTACK_STAGES,
    ITEM_PARAM_SP_DEFENSE_STAGES,
    ITEM_PARAM_SPEED_STAGES,
    ITEM_PARAM_ACCURACY_STAGES,
    ITEM_PARAM_CRIT_STAGES,
    ITEM_PARAM_PP_UP,
    ITEM_PARAM_PP_MAX,
    ITEM_PARAM_PP_RESTORE,
    ITEM_PARAM_PP_RESTORE_ALL,
    ITEM_PARAM_HP_RESTORE,
    ITEM_PARAM_HP_EV_UP,
    ITEM_PARAM_ATTACK_EV_UP,
    ITEM_PARAM_DEFENSE_EV_UP,
    ITEM_PARAM_SPEED_EV_UP,
    ITEM_PARAM_SP_ATTACK_EV_UP,
    ITEM_PARAM_SP_DEFENSE_EV_UP,
    ITEM_PARAM_FRIENDSHIP_UP_1,
    ITEM_PARAM_FRIENDSHIP_UP_2,
    ITEM_PARAM_FRIENDSHIP_UP_3,
    ITEM_PARAM_UNK_51,
    ITEM_PARAM_HP_EV,
    ITEM_PARAM_ATTACK_EV,
    ITEM_PARAM_DEFENSE_EV,
    ITEM_PARAM_SPEED_EV,
    ITEM_PARAM_SP_ATTACK_EV,
    ITEM_PARAM_SP_DEFENSE_EV,
    ITEM_PARAM_HP_RESTORE_AMOUNT,
    ITEM_PARAM_PP_RESTORE_AMOUNT,
    ITEM_PARAM_FRIENDSHIP_1,
    ITEM_PARAM_FRIENDSHIP_2,
    ITEM_PARAM_FRIENDSHIP_3,
};

// The files of an item that GetItemGraphicsDatID and PML_ItemReadDataFile give: its data in ARCID_ITEMINFO, its icon's
// characters and palette in ARCID_ITEMGRA, and the characters and palette of the icon of the Wonder Launcher's
// items, in ShooterItem_GetIndex's order
#define ITEM_FILE_DATA 0
#define ITEM_FILE_ICON_CHAR 1
#define ITEM_FILE_ICON_PLTT 2
#define ITEM_FILE_LIST_ICON_CHAR 3
#define ITEM_FILE_LIST_ICON_PLTT 4

u16 GetItemGraphicsDatID(u16 item, u32 type);
// ARCID_ITEMGRA, and the files of the item icons' cells and animations in it
u32 PML_ItemGetIconArcID(void);
u32 PML_ItemGetIconCellDatID(void);
u32 PML_ItemGetIconAnimDatID(void);
ArcTool *PML_ItemArcHandleCreate(HeapID heapId);
ItemData *PML_ItemArcHandleReadFile(ArcTool *handle, u16 item, HeapID heapId);
// Reads one of an item's ITEM_FILE_* files into a new allocation
void *PML_ItemReadDataFile(u16 item, u32 type, HeapID heapId);
void setItemNameToStrbuf(StrBuf *strbuf, u16 item, HeapID heapId);
void setItemDescriptionTextToStrbuf(StrBuf *strbuf, u16 item, HeapID heapId);
// An ITEM_PARAM_* of an item, read from its file
s32 GetItemParam(u16 item, u32 param, HeapID heapId);
s32 PML_ItemGetParam(ItemData *data, u32 param);
BOOL PML_ItemIsTMHM(u16 item);
// How many of an item the bag can hold: one of a TM or HM, 999 of others
u32 PML_ItemGetMaxStorageCount(u16 item);
BOOL PML_ItemIsTM(u16 item);
// The move a TM or HM teaches, or 0
u16 PML_ItemGetTMWazaID(u16 item);
BOOL PML_MoveIsHM(u16 move);
// A TM's or HM's bit in a species' TM flags: TM01 to TM92, TM93 to TM95, then HM01 to HM06. 0xff for other items
u8 PML_ItemGetTMBitMask(u16 item);
// An HM's number from 0, or 0xff
u8 PML_ItemGetHMID(u16 item);
BOOL PML_ItemIsMail(u16 item);
// The mail of a mail item, and the item of a mail
u8 PML_ItemGetMailID(u16 item);
u16 PML_ItemGetMailItemID(u8 mail);
BOOL PML_ItemIsBerry(u16 item);
// Whether the item isn't one of HGSS's special balls, from the Fast Ball to the Park Ball
BOOL PML_ItemIsNotSpecialMonsball(u16 item);
// The ball ID of a ball item, or 0
u16 PML_ItemGetMonsBallID(u16 item);
// Whether a Pokémon can't hold the item: TMs, HMs and key items
u32 PML_ItemIsUnholdable(u16 item);
// Whether the item is one of the unused IDs or the Data Cards
u32 PML_ItemIsDummy(u16 item);
// Whether the item is one of the key items added in B2W2, from the Medal Box on
BOOL PML_ItemIsB2W2Only(u16 item);

#if defined(WHITE2) && defined(W2U_CHECKED_ITEM_READ) && !defined(BLACK2)
// Native Fling/Natural Gift fields from a complete typed record; zero is valid.
// Failure leaves the output untouched; ordinary GetItemParam is unchanged.
BOOL W2U_PMLItemReadPower(u16 item, u32 param, s32 *power);
#endif

#if defined(WHITE2) && !defined(BLACK2) && (defined(W2U_SHARED_BATTLE) || defined(W2U_CHECKED_ITEM_READ))
// Copied native values only; not the ItemData disk format or a borrowed record.
typedef struct W2UItemQueryValues {
    s32 holdEffect;
    s32 holdParam;
    s32 flingPower;
    s32 naturalGiftPower;
    s32 naturalGiftType;
} W2UItemQueryValues;
#endif

#if defined(WHITE2) && defined(W2U_CHECKED_ITEM_READ) && !defined(BLACK2)
// Preserves native invalid-item/NONE mapping without initializing Mega mapping.
// FALSE preserves every output byte; caller-owned output receives no pointers.
BOOL W2U_PMLItemReadQueryValues(u16 item, W2UItemQueryValues *values);
#endif

#endif // POKEBW2_PML_ITEM_H
