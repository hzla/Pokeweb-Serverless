#ifndef POKEBW2_SYSTEM_SCROLL_BAR_H
#define POKEBW2_SYSTEM_SCROLL_BAR_H

#include "types.h"

// A scroll bar between top and bottom, whose bar is barSize long: the value from 0 to max where the bar's center is,
// and where the bar's center is for a value. The file's name and the functions' are ours
u32 ScrollBar_GetValue(u32 max, u32 pos, u32 top, u32 bottom, u32 barSize);
u32 ScrollBar_GetPos(u32 max, u32 value, u32 top, u32 bottom, u32 barSize);

#endif // POKEBW2_SYSTEM_SCROLL_BAR_H
