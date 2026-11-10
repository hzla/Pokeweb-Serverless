// Pokeweb item expansion, resident core (ARM9).
//
// * Save format: the main save keeps its retail size and footer position (0x25fa4). The bag block grows from
//   0x9ec to 0x1080 (pokebw2's shared 1,023-slot pool) and the Pal Pad trade-history block shrinks from 0xd54 to
//   0x6fc, so blocks 26-31 move by 0x700 and nothing else moves. The footer magic is Pokeweb's own.
// * Admission: a retail-format (or unknown) save stops the game with a message before anything can be written,
//   instead of looking corrupted and inviting a new game over it.
// * Erase: the title-screen erase also blanks the backup copy, so an erased card reads as empty.
// * Item IDs 639-1023: icon, holdable and dummy queries use the catalog.
//
// The pool bag API itself is pokebw2's (myitem_savedata.c, generated into its own unit).
#include "types.h"
#include "catalog.h"
#include "save/bag.h"
#include "core_addr.h"
#include "nitro/mi.h"

#define PW_SAVE_MAGIC 0x32495750u // "PWI2"
#define RETAIL_SAVE_MAGIC 0x31053527u
#define SAVE_REGION_SIZE 0x26000u
#define SAVE_USED_SIZE 0x25fa4u
#define SAVE_FOOTER_OFFSET (SAVE_USED_SIZE - 0x10u)
#define SAVE_BLOCK_BAG 0x19
#define SAVE_CONTROL_ERROR_BROKEN 0x2

typedef struct SaveData SaveData;
typedef struct {
    u8 newGame;
    u8 dataExists;
    u8 unk2;
    u8 wasIntroSave;
    u8 giftsLoaded;
    u8 giftsBroken;
    u8 keysLoaded;
    u8 keysBroken;
    u8 markDreamRadarRead;
    u32 errors;
    SaveData *sv;
} PwSaveControl;

enum { FORMAT_EMPTY, FORMAT_CURRENT, FORMAT_RETAIL, FORMAT_MIXED, FORMAT_UNKNOWN, FORMAT_READ_ERROR };

extern BOOL BackupSystem_Read(u32 src, void *dest, u32 size);
extern BOOL BackupSystem_WriteWait(u32 dest, const void *src, u32 size);
extern void GFL_DebugPrintCreateSurface(void);
extern void GFL_DebugPrintOutputMessage(const char *message);
extern void GFL_DebugPrintCommit(void);
extern void GX_DispOn(void);
extern void OS_Terminate(void);
extern PwSaveControl *SaveControl_Create(u32 heapId);
extern void *SaveControl_GetBlockPtr(PwSaveControl *save, u32 block);
extern BOOL SaveData_Erase(SaveData *sv, u32 heapId);
extern BOOL W2U_BagValidate(const BagSave *bag);
extern u32 ShooterItem_GetIndex(u16 item);
extern const u16 ITEM_GRAPHICS_CHARS_AND_PALETTES[PW_NATIVE_LAST + 1][2];
extern const u16 LIST_ITEM_GRAPHICS[][2];

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
        if (!BackupSystem_Read(copy * SAVE_REGION_SIZE + SAVE_FOOTER_OFFSET, bytes, 16)) {
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
        // The game's own loader still checks every CRC and picks the newest good copy.
        return FORMAT_CURRENT;
    }
    // Neither copy has a footer: only a blank card (all 0x00 or all 0xff) may start a new game.
    for (offset = 0; offset < 2 * SAVE_REGION_SIZE; offset += sizeof(bytes)) {
        if (!BackupSystem_Read(offset, bytes, sizeof(bytes))) {
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
    GFL_DebugPrintCreateSurface();
    if (format == FORMAT_RETAIL) {
        GFL_DebugPrintOutputMessage("This ROM uses Pokeweb's\n");
        GFL_DebugPrintOutputMessage("expanded item save format.\n");
        GFL_DebugPrintOutputMessage("Convert this save in Pokeweb:\n");
        GFL_DebugPrintOutputMessage("Code Injection > Item Expansion.\n");
    } else if (format == FORMAT_MIXED) {
        GFL_DebugPrintOutputMessage("Mixed save formats detected.\n");
        GFL_DebugPrintOutputMessage("Restore an original save copy.\n");
    } else {
        GFL_DebugPrintOutputMessage("The save format or its CRC\n");
        GFL_DebugPrintOutputMessage("is not valid. Saving blocked.\n");
    }
    GFL_DebugPrintOutputMessage("The save was not changed.\n");
    GX_DispOn();
    GFL_DebugPrintCommit();
    for (;;) {
        OS_Terminate();
    }
}

// GameInit's call to SaveControl_Create: check the card before the game can treat it as new.
PwSaveControl *HOOK_SAVE_CONTROL_CREATE_CALL(u32 heapId) {
    u32 format = CardFormat();
    PwSaveControl *save;

    if (format != FORMAT_EMPTY && format != FORMAT_CURRENT) {
        ShowFormatError(format);
    }
    save = SaveControl_Create(heapId);
    if (format == FORMAT_CURRENT) {
        if (save->dataExists) {
            if (!W2U_BagValidate(SaveControl_GetBlockPtr(save, SAVE_BLOCK_BAG))) {
                ShowFormatError(FORMAT_UNKNOWN);
            }
        } else if (save->errors & SAVE_CONTROL_ERROR_BROKEN) {
            ShowFormatError(FORMAT_UNKNOWN);
        }
    }
    return save;
}

// SaveControl_Erase (the title screen's erase): also blank the backup copy.
void HOOK_SAVE_CONTROL_ERASE(PwSaveControl *save) {
    u8 *buffer;
    u32 i;

    SaveData_Erase(save->sv, 1);
    buffer = GFL_HeapAllocate(1, 0x1000, FALSE, "pw_item_save", 1);
    MIi_CpuClear32(0xffffffff, buffer, 0x1000);
    for (i = 0; i < SAVE_REGION_SIZE; i += 0x1000) {
        BackupSystem_WriteWait(SAVE_REGION_SIZE + i, buffer, 0x1000);
    }
    GFL_HeapFree(buffer);
}

#define ITEM_FILE_DATA 0
#define ITEM_FILE_ICON_CHAR 1
#define ITEM_FILE_ICON_PLTT 2
#define ITEM_FILE_LIST_ICON_CHAR 3
#define ITEM_FILE_LIST_ICON_PLTT 4
#define ITEM_ICON_NONE 1021
#define ITEM_ICON_PALETTE_NONE 1022

// GetItemGraphicsDatID: retail behaviour for retail IDs (including the return arrow's 0xffff, which retail
// draws with the empty icon), catalog icons for 639-1023.
u16 HOOK_GET_ITEM_GRAPHICS_DAT_ID(u16 item, u32 type) {
    if (item > PW_NATIVE_LAST && item < PW_ITEM_CAPACITY && W2U_ItemIsAuthored(item)) {
        const PwItemEntry *entry = &gPwItemCatalog.entries[item - (PW_NATIVE_LAST + 1)];
        switch (type) {
        case ITEM_FILE_DATA:
            return item;
        case ITEM_FILE_ICON_CHAR:
            return entry->iconChar;
        case ITEM_FILE_ICON_PLTT:
            return entry->iconPalette;
        }
    }
    if (item > PW_NATIVE_LAST) {
        item = 0;
    }
    switch (type) {
    case ITEM_FILE_DATA:
        return item;
    case ITEM_FILE_ICON_CHAR:
        return item == 0 ? ITEM_ICON_NONE : ITEM_GRAPHICS_CHARS_AND_PALETTES[item][0];
    case ITEM_FILE_ICON_PLTT:
        return item == 0 ? ITEM_ICON_PALETTE_NONE : ITEM_GRAPHICS_CHARS_AND_PALETTES[item][1];
    case ITEM_FILE_LIST_ICON_CHAR:
        return LIST_ITEM_GRAPHICS[ShooterItem_GetIndex(item)][0];
    case ITEM_FILE_LIST_ICON_PLTT:
        return LIST_ITEM_GRAPHICS[ShooterItem_GetIndex(item)][1];
    }
    return 0;
}

u32 HOOK_ITEM_IS_UNHOLDABLE(u16 item) {
    if (item <= PW_NATIVE_LAST) {
        return !W2U_ItemCanHold(item);
    }
    return W2U_ItemIsAuthored(item) ? !W2U_ItemCanHold(item) : FALSE;
}

u32 HOOK_ITEM_IS_DUMMY(u16 item) {
    return W2U_ItemIsDummy(item);
}
