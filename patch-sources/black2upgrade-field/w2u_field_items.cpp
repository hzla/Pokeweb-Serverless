#include "w2u_battle.h"
#include "personal_data.h"
#include "w2u_platform.h"

extern "C" u32 PML_PersonalGetParamSingle(u32 species, u32 form, u32 field);

namespace {

constexpr u16 W2U_FIELD_ITEM_ABILITY_CAPSULE = ITEM_ABILITY_CAPSULE;
constexpr u16 W2U_FIELD_ITEM_ABILITY_PATCH = ITEM_ABILITY_PATCH;

typedef u32 (*CanUseItemOnMonFn)(PartyPkm* partyPkm, u32 itemID, u32 itemArg, u32 heapID);
typedef void (*PlistMsgCreateWordSetFn)(void* work, void* msgWork);
typedef void (*PlistMsgAddPokeNameFn)(void* work, void* msgWork, u32 wordSetIdx, PartyPkm* partyPkm);
typedef void (*PlistMsgDeleteWordSetFn)(void* work, void* msgWork);
typedef void (*WordSetRegisterTokuseiNameFn)(void* wordSet, u32 wordSetIdx, u32 abilityID);
typedef void (*PlistMessageWaitInitFn)(void* work, u32 msgID, u32 isWaitKey, void* callback);
typedef void (*PlistYesNoWaitInitFn)(void* work, void* callback);
typedef void (*PlistMsgCloseWindowFn)(void* work, void* msgWork);
typedef void (*PlistReturnAfterItemUseFn)(void* work);
typedef void (*PlistPlateRedrawParamFn)(void* work, void* plateWork);
typedef void (*PlistSubBagItemFn)(void* work, u32 itemID);

const CanUseItemOnMonFn VanillaCanUseItemOnMon =
    reinterpret_cast<CanUseItemOnMonFn>(W2U_ADDR_FIELD_CAN_USE_ITEM_ON_MON);
const PlistMsgCreateWordSetFn PlistMsgCreateWordSet =
    reinterpret_cast<PlistMsgCreateWordSetFn>(W2U_ADDR_FIELD_MSG_CREATE_WORD_SET);
const PlistMsgAddPokeNameFn PlistMsgAddPokeName =
    reinterpret_cast<PlistMsgAddPokeNameFn>(W2U_ADDR_FIELD_MSG_ADD_POKE_NAME);
const PlistMsgDeleteWordSetFn PlistMsgDeleteWordSet =
    reinterpret_cast<PlistMsgDeleteWordSetFn>(W2U_ADDR_FIELD_MSG_DELETE_WORD_SET);
const WordSetRegisterTokuseiNameFn WordSetRegisterTokuseiName =
    reinterpret_cast<WordSetRegisterTokuseiNameFn>(W2U_ADDR_WORD_SET_REGISTER_ABILITY_NAME);
const PlistMessageWaitInitFn PlistMessageWaitInit =
    reinterpret_cast<PlistMessageWaitInitFn>(W2U_ADDR_FIELD_MESSAGE_WAIT_INIT);
const PlistYesNoWaitInitFn PlistYesNoWaitInit =
    reinterpret_cast<PlistYesNoWaitInitFn>(W2U_ADDR_FIELD_YES_NO_WAIT_INIT);
const PlistMsgCloseWindowFn PlistMsgCloseWindow =
    reinterpret_cast<PlistMsgCloseWindowFn>(W2U_ADDR_FIELD_MSG_CLOSE_WINDOW);
const PlistReturnAfterItemUseFn PlistReturnAfterItemUse =
    reinterpret_cast<PlistReturnAfterItemUseFn>(W2U_ADDR_FIELD_RETURN_AFTER_ITEM_USE);
const PlistPlateRedrawParamFn PlistPlateRedrawParam =
    reinterpret_cast<PlistPlateRedrawParamFn>(W2U_ADDR_FIELD_PLATE_REDRAW_PARAM);
const PlistSubBagItemFn PlistSubBagItem =
    reinterpret_cast<PlistSubBagItemFn>(W2U_ADDR_FIELD_SUB_BAG_ITEM);

constexpr u32 W2U_ABILITY_ITEM_SUCCESS_MSG = 0x39;
constexpr u32 W2U_ABILITY_ITEM_CONFIRM_MSG = 0x3C;
constexpr u32 PL_RET_BAG = 10;
constexpr u32 PMIT_YES = 14;

constexpr u32 PLIST_WORK_SELECT_POKE_OFFSET = 0x3C;
constexpr u32 PLIST_WORK_MSG_WORK_OFFSET = 0x154;
constexpr u32 PLIST_WORK_PLATE_WORK_BASE_OFFSET = 0x164;
constexpr u32 PLIST_WORK_PL_DATA_OFFSET = 0x28C;
constexpr u32 PLIST_WORK_POKE_CURSOR_OFFSET = 0x30;
constexpr u32 PLIST_DATA_RET_MODE_OFFSET = 0x50;
constexpr u32 PLIST_DATA_ITEM_OFFSET = 0x54;
constexpr u32 PLIST_MSG_WORK_WORD_SET_OFFSET = 0x2C;

inline u8* AsBytes(void* ptr)
{
    return static_cast<u8*>(ptr);
}

inline void* WorkMsgWork(void* work)
{
    return *reinterpret_cast<void**>(AsBytes(work) + PLIST_WORK_MSG_WORK_OFFSET);
}

inline PartyPkm* WorkSelectPoke(void* work)
{
    return *reinterpret_cast<PartyPkm**>(AsBytes(work) + PLIST_WORK_SELECT_POKE_OFFSET);
}

inline void* WorkPlData(void* work)
{
    return *reinterpret_cast<void**>(AsBytes(work) + PLIST_WORK_PL_DATA_OFFSET);
}

inline u16 WorkItem(void* work)
{
    return *reinterpret_cast<u16*>(AsBytes(WorkPlData(work)) + PLIST_DATA_ITEM_OFFSET);
}

inline void SetRetModeBag(void* work)
{
    *reinterpret_cast<u32*>(AsBytes(WorkPlData(work)) + PLIST_DATA_RET_MODE_OFFSET) = PL_RET_BAG;
}

inline void* MsgWorkWordSet(void* msgWork)
{
    return *reinterpret_cast<void**>(AsBytes(msgWork) + PLIST_MSG_WORK_WORD_SET_OFFSET);
}

inline void* WorkSelectedPlate(void* work)
{
    const u32 pokeCursor = *reinterpret_cast<u32*>(AsBytes(work) + PLIST_WORK_POKE_CURSOR_OFFSET);
    return *reinterpret_cast<void**>(
        AsBytes(work) + PLIST_WORK_PLATE_WORK_BASE_OFFSET + (pokeCursor * sizeof(void*)));
}

bool CanUseAbilityCapsule(PartyPkm* partyPkm)
{
    if (!partyPkm) {
        return false;
    }

    const u32 species = PokeParty_GetParam(partyPkm, PF_Species, nullptr);
    const u32 form = PokeParty_GetParam(partyPkm, PF_Forme, nullptr);
    const u32 ability1 = PML_PersonalGetParamSingle(species, form, Personal_Abil1);
    const u32 ability2 = PML_PersonalGetParamSingle(species, form, Personal_Abil2);
    const u32 hiddenAbility = PML_PersonalGetParamSingle(species, form, Personal_AbilH);
    const u32 currentAbility = PokeParty_GetParam(partyPkm, PF_Ability, nullptr);

    if (ability2 == 0 || ability1 == ability2) {
        return false;
    }

    if (hiddenAbility != 0 && currentAbility == hiddenAbility) {
        return false;
    }

    return currentAbility == ability1 || currentAbility == ability2;
}

bool CanUseAbilityPatch(PartyPkm* partyPkm)
{
    if (!partyPkm) {
        return false;
    }

    const u32 species = PokeParty_GetParam(partyPkm, PF_Species, nullptr);
    const u32 form = PokeParty_GetParam(partyPkm, PF_Forme, nullptr);
    const u32 ability1 = PML_PersonalGetParamSingle(species, form, Personal_Abil1);
    const u32 ability2 = PML_PersonalGetParamSingle(species, form, Personal_Abil2);
    const u32 hiddenAbility = PML_PersonalGetParamSingle(species, form, Personal_AbilH);
    const u32 currentAbility = PokeParty_GetParam(partyPkm, PF_Ability, nullptr);

    if (hiddenAbility == 0 || hiddenAbility == ability1 || hiddenAbility == ability2) {
        return false;
    }

    return currentAbility == ability1 ||
           currentAbility == ability2 ||
           currentAbility == hiddenAbility;
}

u32 GetAbilityCapsuleTarget(PartyPkm* partyPkm)
{
    if (!CanUseAbilityCapsule(partyPkm)) {
        return 0;
    }

    const u32 species = PokeParty_GetParam(partyPkm, PF_Species, nullptr);
    const u32 form = PokeParty_GetParam(partyPkm, PF_Forme, nullptr);
    const u32 ability1 = PML_PersonalGetParamSingle(species, form, Personal_Abil1);
    const u32 ability2 = PML_PersonalGetParamSingle(species, form, Personal_Abil2);
    const u32 currentAbility = PokeParty_GetParam(partyPkm, PF_Ability, nullptr);
    return currentAbility == ability1 ? ability2 : ability1;
}

u32 GetAbilityPatchTarget(PartyPkm* partyPkm)
{
    if (!CanUseAbilityPatch(partyPkm)) {
        return 0;
    }

    const u32 species = PokeParty_GetParam(partyPkm, PF_Species, nullptr);
    const u32 form = PokeParty_GetParam(partyPkm, PF_Forme, nullptr);
    const u32 ability1 = PML_PersonalGetParamSingle(species, form, Personal_Abil1);
    const u32 hiddenAbility = PML_PersonalGetParamSingle(species, form, Personal_AbilH);
    const u32 currentAbility = PokeParty_GetParam(partyPkm, PF_Ability, nullptr);
    const u32 isHiddenAbility = PokeParty_GetParam(partyPkm, PF_IsHiddenAbility, nullptr);

    return (isHiddenAbility != 0 || currentAbility == hiddenAbility) ? ability1 : hiddenAbility;
}

u32 GetAbilityFieldItemTarget(PartyPkm* partyPkm, u32 itemID)
{
    if (itemID == W2U_FIELD_ITEM_ABILITY_CAPSULE) {
        return GetAbilityCapsuleTarget(partyPkm);
    }

    if (itemID == W2U_FIELD_ITEM_ABILITY_PATCH) {
        return GetAbilityPatchTarget(partyPkm);
    }

    return 0;
}

void UseAbilityCapsule(PartyPkm* partyPkm, u32 nextAbility)
{
    if (nextAbility == 0 || !CanUseAbilityCapsule(partyPkm)) {
        return;
    }

    PokeParty_SetParam(partyPkm, PF_IsHiddenAbility, 0);
    PokeParty_SetParam(partyPkm, PF_Ability, nextAbility);
    PokeParty_RecalcStats(partyPkm);
}

void UseAbilityPatch(PartyPkm* partyPkm, u32 nextAbility)
{
    if (nextAbility == 0 || !CanUseAbilityPatch(partyPkm)) {
        return;
    }

    const u32 species = PokeParty_GetParam(partyPkm, PF_Species, nullptr);
    const u32 form = PokeParty_GetParam(partyPkm, PF_Forme, nullptr);
    const u32 ability1 = PML_PersonalGetParamSingle(species, form, Personal_Abil1);
    const u32 hiddenAbility = PML_PersonalGetParamSingle(species, form, Personal_AbilH);

    if (nextAbility == hiddenAbility) {
        PokeParty_SetParam(partyPkm, PF_IsHiddenAbility, 1);
        PokeParty_SetParam(partyPkm, PF_Ability, hiddenAbility);
    } else {
        PokeParty_SetParam(partyPkm, PF_IsHiddenAbility, 0);
        PokeParty_SetParam(partyPkm, PF_Ability, ability1);
    }

    PokeParty_RecalcStats(partyPkm);
}

void ShowAbilityItemMessage(void* work, u32 msgID, u32 abilityID, void* callback, u32 isWaitKey)
{
    void* msgWork = WorkMsgWork(work);
    SetRetModeBag(work);
    PlistMsgCreateWordSet(work, msgWork);
    PlistMsgAddPokeName(work, msgWork, 0, WorkSelectPoke(work));
    WordSetRegisterTokuseiName(MsgWorkWordSet(msgWork), 1, abilityID);
    PlistMessageWaitInit(work, msgID, isWaitKey, callback);
    PlistMsgDeleteWordSet(work, msgWork);
}

void RedrawSelectedPlate(void* work)
{
    PlistPlateRedrawParam(work, WorkSelectedPlate(work));
}

} // namespace

extern "C" void W2U_FieldItem_AbilityConfirmMessageCB(void* work);
extern "C" void W2U_FieldItem_AbilityConfirmYesNoCB(void* work, int retVal);

extern "C" u32 W2U_FieldItem_CanUseItemOrAbilityFieldItem(
    PartyPkm* partyPkm,
    u32 itemID,
    u32 itemArg,
    u32 heapID)
{
    if (itemID == W2U_FIELD_ITEM_ABILITY_CAPSULE) {
        return CanUseAbilityCapsule(partyPkm) ? 1 : 0;
    }

    if (itemID == W2U_FIELD_ITEM_ABILITY_PATCH) {
        return CanUseAbilityPatch(partyPkm) ? 1 : 0;
    }

    return VanillaCanUseItemOnMon(partyPkm, itemID, itemArg, heapID);
}

extern "C" u32 W2U_FieldItem_GetTargetAbility(PartyPkm* partyPkm, u32 itemID)
{
    return GetAbilityFieldItemTarget(partyPkm, itemID);
}

extern "C" u32 W2U_FieldItem_ApplyAbilityFieldItemDirect(PartyPkm* partyPkm, u32 itemID)
{
    const u32 targetAbility = GetAbilityFieldItemTarget(partyPkm, itemID);
    if (targetAbility == 0) {
        return 0;
    }

    if (itemID == W2U_FIELD_ITEM_ABILITY_CAPSULE) {
        UseAbilityCapsule(partyPkm, targetAbility);
        return targetAbility;
    }

    if (itemID == W2U_FIELD_ITEM_ABILITY_PATCH) {
        UseAbilityPatch(partyPkm, targetAbility);
        return targetAbility;
    }

    return targetAbility;
}

extern "C" u32 W2U_FieldItem_StartAbilityFieldItemConfirm(
    PartyPkm* partyPkm,
    u32 itemID,
    void* work)
{
    const u32 targetAbility = GetAbilityFieldItemTarget(partyPkm, itemID);
    if (targetAbility == 0) {
        return 0;
    }

    ShowAbilityItemMessage(
        work,
        W2U_ABILITY_ITEM_CONFIRM_MSG,
        targetAbility,
        reinterpret_cast<void*>(W2U_FieldItem_AbilityConfirmMessageCB),
        0);
    return 1;
}

extern "C" void W2U_FieldItem_AbilityConfirmMessageCB(void* work)
{
    PlistYesNoWaitInit(work, reinterpret_cast<void*>(W2U_FieldItem_AbilityConfirmYesNoCB));
}

extern "C" void W2U_FieldItem_AbilityConfirmYesNoCB(void* work, int retVal)
{
    if (retVal != static_cast<int>(PMIT_YES)) {
        PlistReturnAfterItemUse(work);
        return;
    }

    PlistMsgCloseWindow(work, WorkMsgWork(work));

    PartyPkm* partyPkm = WorkSelectPoke(work);
    const u32 itemID = WorkItem(work);
    const u32 targetAbility = W2U_FieldItem_ApplyAbilityFieldItemDirect(partyPkm, itemID);
    if (targetAbility == 0) {
        PlistReturnAfterItemUse(work);
        return;
    }

    RedrawSelectedPlate(work);
    PlistSubBagItem(work, itemID);
    ShowAbilityItemMessage(
        work,
        W2U_ABILITY_ITEM_SUCCESS_MSG,
        targetAbility,
        reinterpret_cast<void*>(PlistReturnAfterItemUse),
        1);
}
