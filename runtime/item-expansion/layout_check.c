// Compiled by build.py: the override headers must keep every retail offset.
#include <stddef.h>
#include "app/itemmenu.h"
#include "app/bag_item.h"
#include "battle/b_bag_main.h"
#include "save/bag.h"
#define CHECK(expr) _Static_assert(expr, #expr)
CHECK(sizeof(BagItemList) == 0x1684);
CHECK(offsetof(BagItemList, entries) == 0xc);
CHECK(sizeof(ItemMenuWork) == 0x1f54);
CHECK(offsetof(ItemMenuWork, items) == 0x24);
CHECK(offsetof(ItemMenuWork, state) == 0x4fc);
CHECK(offsetof(ItemMenuWork, heapId) == 0x54c);
CHECK(offsetof(ItemMenuWork, itemList) == 0x8c8);
CHECK(sizeof(BBagWork) == 0x5a4);
CHECK(offsetof(BBagWork, items) == 0x150);
CHECK(offsetof(BBagWork, itemCount) == 0x168);
CHECK(offsetof(BBagWork, actorUnit) == 0x420);
CHECK(offsetof(BBagWork, retailItemCount) == 0x535);
CHECK(offsetof(BBagWork, lastPage) == 0x539);
CHECK(offsetof(BBagWork, initialized) == 0x5a0);
CHECK(sizeof(BagSave) == 0x1080);
