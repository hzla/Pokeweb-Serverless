#include <stdint.h>
#include "training_profile.h"

typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef void (*Done)(void *);
typedef void (*Choice)(void *, unsigned);

extern void RetailSelect(void *work);
extern u32 GetParam(void *mon, u32 field, void *out);
extern void SetParam(void *mon, u32 field, u32 value);
extern void SetNature(void *mon, u32 nature);
extern void Recalc(void *mon);
extern u32 Personal(u16 species, u16 form, u32 field);
extern u32 RemoveItem(void *bag, u16 item, u16 count, u16 heap);
extern void ShowMessage(void *work, u32 message, u32 wait, Done done);
extern void ReturnToList(void *work);
extern void ReturnAfterUse(void *work);
extern void CloseMessage(void *work, void *message);
extern void OpenYesNo(void *work, Choice choice);
extern void RefreshPlate(void *work, void *plate, void *mon, int shift);
extern void PlaySound(u32 id);
extern void SetInputMode(u32 mode);
extern void *ReadString(void *bank, u32 row);
extern void *OpenTaskMenu(void *setup, void *resources);

extern void RetailAbility(void *box, u32 species, u32 oldSpecies);
extern u32 DecodeBox(void *box);
extern void EncodeBox(void *box, u32 decoded);
extern u8 *BoxBlock(void *box, u32 pid, u32 block);
extern u32 BoxGet(void *box, u32 field, void *out);
extern void BoxSet(void *box, u32 field, u32 value);

#define MEMBER(type, object, offset) (*(type *)((u8 *)(object) + (offset)))

enum { SILVER = 25, GOLD, CAPSULE, PATCH, ITEM_COUNT };
enum { ASK_STAT, CONFIRM, SUCCESS, NO_EFFECT, STAT_LABELS };
enum { SPECIES = 5, ABILITY = 10, IV_HP = 70, EGG = 76, FORM = 111, NATURE = 112, HIDDEN = 113 };
enum { FIRST_ABILITY = 26, SECOND_ABILITY, HIDDEN_ABILITY };
enum { MAX_IV = 31, YES = 14, CHOICE_STAT = 32, STAT_COUNT = 6 };

typedef struct {
    u32 tag;
    u16 version;
    u16 firstMessage;
    u16 items[ITEM_COUNT];
} TrainingConfig;
__attribute__((used)) const volatile TrainingConfig TrainingItems = {0x52545750, 2, 0, {0}};

static void *request(void *work) {
    return MEMBER(void *, work, REQUEST_OFFSET);
}

static unsigned trainingItem(void *work) {
    u16 item = MEMBER(u16, request(work), ITEM_OFFSET);
    for (unsigned i = 0; i < ITEM_COUNT; i++) {
        if (item && TrainingItems.items[i] == item) return i;
    }
    return ITEM_COUNT;
}

// PK5 block B + 0x1b is the unused high byte of the native Hidden/N flags.
// The three values store a personal-data slot. Leave any unrelated value alone.
enum { SLOT_FIRST = 0xd5, SLOT_SECOND, SLOT_HIDDEN };

static u8 *slotByte(void *box) {
    return BoxBlock(box, MEMBER(u32, box, 0), 1) + 0x1b;
}

static u8 readSlot(void *box) {
    u32 decoded = DecodeBox(box);
    u8 slot = *slotByte(box);
    EncodeBox(box, decoded);
    return slot;
}

static u32 ownSlot(u8 value) {
    return value >= SLOT_FIRST && value <= SLOT_HIDDEN;
}

static void writeSlot(void *box, unsigned slot) {
    u32 decoded = DecodeBox(box);
    *slotByte(box) = slot;
    EncodeBox(box, decoded);
}

static void refreshAbility(void *box, u32 species, u32 oldSpecies) {
    u8 slot = readSlot(box);
    if (!ownSlot(slot)) {
        RetailAbility(box, species, oldSpecies);
        return;
    }

    u16 form = BoxGet(box, FORM, 0);
    u32 ability = Personal(species, form, FIRST_ABILITY + slot - SLOT_FIRST);
    u32 hidden = ability && slot == SLOT_HIDDEN;
    if (!ability) {
        // Keep the requested slot for a later form or evolution with that slot.
        ability = Personal(species, form, FIRST_ABILITY);
        if (!ability) ability = Personal(species, form, SECOND_ABILITY);
    }
    if (!ability) {
        RetailAbility(box, species, oldSpecies);
        return;
    }
    BoxSet(box, HIDDEN, hidden);
    BoxSet(box, ABILITY, ability);
}

void TrainingEvolve(void *box, u32 species, u32 oldSpecies) {
    refreshAbility(box, species, oldSpecies);
}

void TrainingChangeForm(void *box, u32 species, u32 oldSpecies) {
    refreshAbility(box, species, oldSpecies);
}

static u32 targetAbility(void *mon, unsigned kind, u32 *slot) {
    u8 stored = readSlot(mon);
    if (stored && !ownSlot(stored)) return 0;
    u16 species = GetParam(mon, SPECIES, 0);
    u16 form = GetParam(mon, FORM, 0);
    u32 current = GetParam(mon, ABILITY, 0);
    u32 first = Personal(species, form, FIRST_ABILITY);
    u32 second = Personal(species, form, SECOND_ABILITY);
    u32 hidden = Personal(species, form, HIDDEN_ABILITY);
    u32 isHidden = GetParam(mon, HIDDEN, 0);
    *slot = SLOT_FIRST;
    if (kind == CAPSULE) {
        if (isHidden || !first || !second || first == second) return 0;
        if (current == first) {
            *slot = SLOT_SECOND;
            return second;
        }
        if (current == second) return first;
        return 0;
    }
    if (!first || !hidden || hidden == first || hidden == second) return 0;
    if (isHidden && current == hidden) return first;
    if (!isHidden && (current == first || (second && current == second))) {
        *slot = SLOT_HIDDEN;
        return hidden;
    }
    return 0;
}

static u32 availableStats(void *mon) {
    u32 mask = 0;
    for (unsigned stat = 0; stat < STAT_COUNT; stat++) {
        if (GetParam(mon, IV_HP + stat, 0) < MAX_IV) mask |= 1u << stat;
    }
    return mask;
}

static void show(void *work, unsigned row, u32 wait, Done done) {
    ShowMessage(work, TrainingItems.firstMessage + row, wait, done);
}

static void apply(void *work, unsigned choice) {
    unsigned kind = trainingItem(work);
    void *mon = MEMBER(void *, work, MON_OFFSET);
    u32 statMask = 0;
    u32 ability = 0;
    u32 requestedSlot = 0;

    if (kind >= ITEM_COUNT || !mon || GetParam(mon, EGG, 0)) {
        ReturnToList(work);
        return;
    }
    if (kind == SILVER) {
        if (choice < CHOICE_STAT || choice >= CHOICE_STAT + STAT_COUNT) {
            ReturnToList(work);
            return;
        }
        statMask = availableStats(mon) & (1u << (choice - CHOICE_STAT));
    } else {
        if (choice != YES) {
            ReturnToList(work);
            return;
        }
        if (kind == GOLD) statMask = availableStats(mon);
        if (kind == CAPSULE || kind == PATCH) ability = targetAbility(mon, kind, &requestedSlot);
    }

    if (!(statMask || ability || (kind < SILVER && GetParam(mon, NATURE, 0) != kind))) {
        CloseMessage(work, MEMBER(void *, work, MESSAGE_OFFSET));
        show(work, NO_EFFECT, 1, ReturnToList);
        return;
    }
    void *args = request(work);
    u16 item = MEMBER(u16, args, ITEM_OFFSET);
    if (!RemoveItem(MEMBER(void *, args, 4), item, 1, MEMBER(u16, work, 0))) {
        CloseMessage(work, MEMBER(void *, work, MESSAGE_OFFSET));
        show(work, NO_EFFECT, 1, ReturnToList);
        return;
    }
    if (kind < SILVER) {
        SetNature(mon, kind);
    } else if (statMask) {
        for (unsigned stat = 0; stat < STAT_COUNT; stat++) {
            if (statMask & (1u << stat)) SetParam(mon, IV_HP + stat, MAX_IV);
        }
        Recalc(mon);
    } else {
        writeSlot(mon, requestedSlot);
        SetParam(mon, HIDDEN, requestedSlot == SLOT_HIDDEN);
        SetParam(mon, ABILITY, ability);
    }

    unsigned slot = MEMBER(u32, work, SLOT_OFFSET);
    if (statMask) RefreshPlate(work, MEMBER(void *, work, PLATES_OFFSET + 4 * slot), mon, 0);
    PlaySound(1391);
    MEMBER(u32, args, RESULT_OFFSET) = 10;
    CloseMessage(work, MEMBER(void *, work, MESSAGE_OFFSET));
    show(work, SUCCESS, 1, ReturnAfterUse);
}

typedef struct {
    void *label;
    u16 color;
    u16 pad;
    u32 type;
} MenuEntry;

typedef struct {
    u32 heap;
    u8 count;
    MenuEntry *entries;
    u32 anchor;
    u8 x, y, width, height;
} MenuSetup;

_Static_assert(sizeof(MenuEntry) == 12 && sizeof(MenuSetup) == 20, "native task menu ABI");

static void statMenu(void *work) {
    // User order: HP, Attack, Defense, Sp. Atk, Sp. Def, Speed, Cancel.
    static const u8 order[] = {0, 1, 2, 4, 5, 3, 6};
    void *menu = MEMBER(void *, work, MENU_OFFSET);
    MenuEntry *entries = (MenuEntry *)((u8 *)menu + 0x14);
    MEMBER(u8, menu, 0) = sizeof(order);
    for (unsigned i = 0; i < sizeof(order); i++) {
        MEMBER(u16, menu, 2 + i * 2) = CHOICE_STAT + order[i];
        entries[i].label = ReadString(MEMBER(void *, work, BANK_OFFSET), TrainingItems.firstMessage + STAT_LABELS + i);
        entries[i].color = 0x39e0;
        entries[i].pad = 0;
        entries[i].type = 0;
    }
    MenuSetup setup = {MEMBER(u16, work, 0), sizeof(order), entries, 1, 32, 24, 13, 3};
    SetInputMode(MEMBER(u32, work, 8));
    MEMBER(void *, menu, 0x74) = OpenTaskMenu(&setup, MEMBER(void *, work, MENU_RES_OFFSET));
    MEMBER(Choice, work, CALLBACK_OFFSET) = apply;
    MEMBER(u8, work, 0x0c) = 9;
}

static void confirm(void *work) {
    OpenYesNo(work, apply);
}

void TrainingSelect(void *work) {
    if (MEMBER(u32, request(work), MODE_OFFSET) != 5 || MEMBER(u8, request(work), CLOSE_OFFSET) == 1) {
        RetailSelect(work);
        return;
    }
    unsigned kind = trainingItem(work);
    if (kind == ITEM_COUNT) {
        RetailSelect(work);
        return;
    }
    void *mon = MEMBER(void *, work, MON_OFFSET);
    u32 requestedSlot;
    if (!mon || !GetParam(mon, SPECIES, 0) || GetParam(mon, EGG, 0)
        || (kind < SILVER && GetParam(mon, NATURE, 0) == kind)
        || ((kind == SILVER || kind == GOLD) && !availableStats(mon))
        || ((kind == CAPSULE || kind == PATCH) && !targetAbility(mon, kind, &requestedSlot))) {
        show(work, NO_EFFECT, 1, ReturnToList);
        return;
    }
    if (kind == SILVER) {
        show(work, ASK_STAT, 0, statMenu);
    } else {
        show(work, CONFIRM, 0, confirm);
    }
}
