#ifndef POKEBW2_APP_MUSICAL_MUS_ITEM_DATA_H
#define POKEBW2_APP_MUSICAL_MUS_ITEM_DATA_H

// Overlay 210's mus_item_data.c (named after its string): the table of the musical's props, file 101 of
// ARCID_MUSICAL_ITEM, with each prop's texture size, offset, the positions it can be worn at and its effect

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// A prop's entry in the table, 12 bytes
typedef struct MusicalItemData {
    // The BlAct size of its texture
    u32 texSize;
    // Its offset from where it is worn
    s8 offsetX;
    s8 offsetY;
    // The positions it can be worn at
    u16 flags;
    // The kind of position it is worn at
    u8 category;
    u8 unk9;
    // The kind of its effect when it is used
    u8 effect;
} MusicalItemData;

// The loaded table
typedef struct {
    void *data;
    MusicalItemData *items;
} MusItemData;

MusItemData *MusItemData_Init(HeapID heapId);
void MusItemData_Free(MusItemData *items);
MusicalItemData *MusItemData_GetItem(MusItemData *items, u16 itemId);
// The prop's offset from where it is worn, x then y
void MusItemData_GetOffset(MusicalItemData *item, s32 *offset);
// The BlAct size of its texture
u32 MusItemData_GetTexSize(MusicalItemData *item);
// Whether the prop can be worn at a position, by its flags
BOOL MusItemData_CanEquipAtPos(MusicalItemData *item, s32 pos);
BOOL MusItemData_CanEquipInGroup(MusicalItemData *item, s32 pos);
// Whether the prop's category is that of a position
BOOL MusItemData_IsCategoryOfGroup(MusicalItemData *item, s32 pos);
// Its flags 0x80 and 0x200
BOOL MusItemData_GetFlag7(MusicalItemData *item);
BOOL MusItemData_GetFlag9(MusicalItemData *item);
s32 MusItemData_GetPosGroup(s32 pos);
u32 MusItemData_GetKind(MusItemData *items, u16 itemId);
// The kind of a prop's effect when it is used
u8 MusItemData_GetEffect(MusItemData *items, u16 itemId);
u8 MusItemData_GetCategory(MusItemData *items, u16 itemId);

#endif // POKEBW2_APP_MUSICAL_MUS_ITEM_DATA_H
