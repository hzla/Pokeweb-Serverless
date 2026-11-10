#ifndef POKEBW2_SYSTEM_SHOOTER_ITEM_H
#define POKEBW2_SYSTEM_SHOOTER_ITEM_H

#include "types.h"

// The items of the Wonder Launcher (the shooter) and their costs in its energy. The file's name and the functions'
// are ours

#define SHOOTER_ITEM_COUNT 46

// Whether the item at index isn't set in the bit field of disabled items
BOOL ShooterItem_IsEnabled(const u8 *disabled, u32 index);
u32 ShooterItem_GetItem(u32 index);
// An item's cost, 0 if it isn't a shooter item
u32 ShooterItem_GetCost(u16 item);
// An item's index in the list, 0 if it isn't in it
u32 ShooterItem_GetIndex(u16 item);

#endif // POKEBW2_SYSTEM_SHOOTER_ITEM_H
