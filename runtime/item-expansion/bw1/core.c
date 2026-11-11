// Pokeweb item expansion for Black / White, resident core (ARM9).
//
// * Save format: the main save keeps its retail size and footer position (0x23f9c). The bag block grows from
//   0x9c0 to 0x1000 (one pool of 1,023 slots) and the trade-history block 31 shrinks from 0xd54 to 0x6fc, so
//   blocks 26-31 move by 0x700 and nothing else moves. The footer magic is Pokeweb's own ("PWI2").
// * Admission: a retail-format (or unknown) save stops the game with a message before anything can be written.
// * Erase: the title-screen erase also blanks the backup copy, so an erased card reads as empty.
// * Item IDs 627-1023: icons and data files come from the catalog.
#include "bw1_items.h"
#include "bw1_addr.h"

#define PW_SAVE_MAGIC 0x32495750u // "PWI2"
#define RETAIL_SAVE_MAGIC 0x31053527u
#define SAVE_REGION_SIZE 0x24000u
#define SAVE_USED_SIZE 0x23f9cu
#define SAVE_FOOTER_OFFSET (SAVE_USED_SIZE - 0x10u)
#define SAVE_BLOCK_BAG 25
#define SAVE_FLAG_BROKEN 0x2

typedef struct SaveControl {
    u8 isNewGame;
    u8 hasFlashSave;
    u8 loadNotClean;
    u8 wasActiveBeforeSave;
    u8 outsideSaveLoaded;
    u8 outsideSaveBroken;
    u8 pad06[6];
    u32 loadFlags;
    void *mainSave;
} SaveControl;

enum { FORMAT_EMPTY, FORMAT_CURRENT, FORMAT_RETAIL, FORMAT_MIXED, FORMAT_UNKNOWN, FORMAT_READ_ERROR };

extern int BACKUP_SYSTEM_ReadFlash(u32 flashAddr, void *dst, u32 size);
extern void BACKUP_SYSTEM_WriteFlash(u32 flashAddr, const void *src, u32 size);
extern int BACKUP_SYSTEM_Erase(void *sv, u32 heapId);
extern SaveControl *SAVE_CONTROL_Create(int heapId);
extern void *SAVE_CONTROL_GetBlock(SaveControl *save, u32 block);
extern void GF_PANIC_Init(void);
extern void GF_PANIC_Print(const char *text);
extern void GF_PANIC_Die(void);
extern void *ARC_TOOL_LoadMember(u32 arc, u32 member, u32 heap);
extern u32 ITEM_GFX_GetRowIndex(u32 itemId);

typedef struct {
    u16 lo;
    u16 hi;
} ItemGfxMember;
extern const ItemGfxMember PW_ITEM_GFX_MEMBER[];   // item_gfx_member (Black 0x0209eb6c)
extern const ItemGfxMember PW_ITEM_GFX_MEMBER_X[]; // item_gfx_member_x (Black 0x0209e9e8)

static u32 ReadWord(const u8 *bytes) {
    return bytes[0] | ((u32)bytes[1] << 8) | ((u32)bytes[2] << 16) | ((u32)bytes[3] << 24);
}

static u32 CardFormat(void) {
    u8 bytes[256];
    u32 copy;
    u32 offset;
    u32 i;
    u32 fill = 0x100;
    BOOL retail = FALSE;
    BOOL current = FALSE;

    for (copy = 0; copy < 2; copy++) {
        if (!BACKUP_SYSTEM_ReadFlash(copy * SAVE_REGION_SIZE + SAVE_FOOTER_OFFSET, bytes, 16)) {
            return FORMAT_READ_ERROR;
        }
        if (ReadWord(&bytes[4]) == SAVE_USED_SIZE) {
            if (ReadWord(&bytes[8]) == RETAIL_SAVE_MAGIC) {
                retail = TRUE;
            } else if (ReadWord(&bytes[8]) == PW_SAVE_MAGIC) {
                current = TRUE;
            }
        }
    }
    if (retail && current) {
        return FORMAT_MIXED;
    }
    if (retail) {
        return FORMAT_RETAIL;
    }
    if (current) {
        return FORMAT_CURRENT;
    }
    // Neither copy has a footer: only a blank card (all 0x00 or all 0xff) may start a new game.
    for (offset = 0; offset < 2 * SAVE_REGION_SIZE; offset += sizeof(bytes)) {
        if (!BACKUP_SYSTEM_ReadFlash(offset, bytes, sizeof(bytes))) {
            return FORMAT_READ_ERROR;
        }
        for (i = 0; i < sizeof(bytes); i++) {
            if (fill == 0x100) {
                fill = bytes[i];
                if (fill != 0 && fill != 0xff) {
                    return FORMAT_UNKNOWN;
                }
            }
            if (bytes[i] != fill) {
                return FORMAT_UNKNOWN;
            }
        }
    }
    return FORMAT_EMPTY;
}

static void __attribute__((noreturn)) ShowFormatError(u32 format) {
    GF_PANIC_Init();
    if (format == FORMAT_RETAIL) {
        GF_PANIC_Print("This ROM uses Pokeweb's\n");
        GF_PANIC_Print("expanded item save format.\n");
        GF_PANIC_Print("Convert this save in Pokeweb:\n");
        GF_PANIC_Print("Code Injection > Item Expansion.\n");
    } else if (format == FORMAT_MIXED) {
        GF_PANIC_Print("Mixed save formats detected.\n");
        GF_PANIC_Print("Restore an original save copy.\n");
    } else {
        GF_PANIC_Print("The save format or its CRC\n");
        GF_PANIC_Print("is not valid. Saving blocked.\n");
    }
    GF_PANIC_Print("The save was not changed.\n");
    for (;;) {
        GF_PANIC_Die();
    }
}

// GFL_USE_InitGameSystems' call to SAVE_CONTROL_Create: check the card before the game can treat it as new.
SaveControl *HOOK_SAVE_CONTROL_CREATE_CALL(int heapId) {
    u32 format = CardFormat();
    SaveControl *save;

    if (format != FORMAT_EMPTY && format != FORMAT_CURRENT) {
        ShowFormatError(format);
    }
    save = SAVE_CONTROL_Create(heapId);
    if (format == FORMAT_CURRENT) {
        if (save->hasFlashSave) {
            if (!PwBag_Validate(SAVE_CONTROL_GetBlock(save, SAVE_BLOCK_BAG))) {
                ShowFormatError(FORMAT_UNKNOWN);
            }
        } else if (save->loadFlags & SAVE_FLAG_BROKEN) {
            ShowFormatError(FORMAT_UNKNOWN);
        }
    }
    return save;
}

// SAVE_CONTROL_EraseMainSave (the title screen's erase): also blank the backup copy.
int HOOK_SAVE_CONTROL_ERASE(SaveControl *save) {
    u8 *buffer;
    u32 i;
    int result = BACKUP_SYSTEM_Erase(save->mainSave, 1);

    buffer = GFL_HEAP_Alloc(1, 0x1000, 0, "pw_item_save", 1);
    MIi_CpuClear32(0xffffffff, buffer, 0x1000);
    for (i = 0; i < SAVE_REGION_SIZE; i += 0x1000) {
        BACKUP_SYSTEM_WriteFlash(SAVE_REGION_SIZE + i, buffer, 0x1000);
    }
    GFL_HEAP_Free(buffer);
    return result;
}

#define ITEM_ICON_NONE 1001
#define ITEM_ICON_PALETTE_NONE 1002
#define ARC_ITEM_DATA 0x18
#define ARC_ITEM_GRAPHICS 0x19

// FILE_UTIL_Get (item data / icon member of an item): retail for retail IDs, the catalog's icon for 627-1023.
u32 HOOK_FILE_UTIL_GET(u32 item, u32 which) {
    if (item > PW_NATIVE_LAST && item < PW_ITEM_CAPACITY && PwItem_IsAuthored(item)) {
        const PwItemEntry *entry = PwItem_Entry(item);
        switch (which) {
        case 0:
            return item;
        case 1:
            return entry->iconChar;
        case 2:
            return entry->iconPalette;
        }
    }
    // Retail clamps every other ID above 626 to 0 first, the return arrow's 0xffff included.
    if (item > PW_NATIVE_LAST) {
        item = 0;
    }
    switch (which) {
    case 0:
        return item;
    case 1:
        return item == 0 ? ITEM_ICON_NONE : PW_ITEM_GFX_MEMBER[item].lo;
    case 2:
        return item == 0 ? ITEM_ICON_PALETTE_NONE : PW_ITEM_GFX_MEMBER[item].hi;
    case 3:
        return PW_ITEM_GFX_MEMBER_X[ITEM_GFX_GetRowIndex(item)].lo;
    case 4:
        return PW_ITEM_GFX_MEMBER_X[ITEM_GFX_GetRowIndex(item)].hi;
    }
    return 0;
}

// FILE_UTIL_LoadItemRecord (an item's data file or one of its icon files).
void *HOOK_FILE_UTIL_LOAD_ITEM_RECORD(u32 item, u32 which, u32 heap) {
    const PwItemEntry *entry = NULL;

    if (item > PW_NATIVE_LAST) {
        entry = item < PW_ITEM_CAPACITY && PwItem_IsAuthored(item) ? PwItem_Entry(item) : NULL;
        if (entry == NULL) {
            item = 0;
        }
    }
    switch (which) {
    case 0:
        return ARC_TOOL_LoadMember(ARC_ITEM_DATA, item, heap);
    case 1:
        return ARC_TOOL_LoadMember(ARC_ITEM_GRAPHICS, entry ? entry->iconChar : PW_ITEM_GFX_MEMBER[item].lo, heap);
    case 2:
        return ARC_TOOL_LoadMember(ARC_ITEM_GRAPHICS, entry ? entry->iconPalette : PW_ITEM_GFX_MEMBER[item].hi, heap);
    }
    return NULL;
}
