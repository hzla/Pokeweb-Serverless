#ifndef POKEBW2_BATTLE_BTLV_B_GAUGE_H
#define POKEBW2_BATTLE_BTLV_B_GAUGE_H

// Overlay 168's btlv_b_gauge.c (named by its string), a side's gauge of party balls that slides in at a trainer
// battle's start. The names are ours; swan has none for this file

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

typedef struct {
    u32 side;     // 0x00  0: the player's, slides in from the right; 1: the opponent's, from the left
    u32 balls[6]; // 0x04  each ball's state, the column of its animations
    u32 mode;     // 0x1c  2: nothing is shown
} BtlvBGaugeParam;

BtlvBGauge *BtlvBGauge_Create(const BtlvBGaugeParam *param, HeapID heapId);
void BtlvBGauge_Delete(BtlvBGauge *work);
BOOL BtlvBGauge_IsBusy(BtlvBGauge *work);

#endif // POKEBW2_BATTLE_BTLV_B_GAUGE_H
