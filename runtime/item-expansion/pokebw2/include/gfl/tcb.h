#ifndef POKEBW2_GFL_TCB_H
#define POKEBW2_GFL_TCB_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Tasks that run every frame or every VBlank (tcb.c). Names from swan (https://github.com/ds-pokemon-hacking/swan,
// GPL-3.0)

typedef void (*TCBFunc)(TCB *tcb, void *data);
typedef void (*VBlankCallback)(void *data);

TCB *GFL_HBlankTCBAdd(TCBFunc func, void *data, u32 priority);
TCB *GFL_VBlankTCBAdd(TCBFunc func, void *data, u32 priority);
BOOL GFL_TCBRemove(TCB *tcb);
// Adds a task that runs after the tasks of lower or the same priority
TCB *GFL_TCBMgrAddTask(TCBManager *manager, TCBFunc func, void *data, u32 priority);
void GFL_TCBSetCallbackFunc(TCB *tcb, TCBFunc func);
void *GFL_TCBGetData(TCB *tcb);
// Whether another task of this priority follows, for optional stream uploads to yield to native work.
BOOL W2U_TCBHasFollowingPriority(TCB *tcb, u32 priority);
TCBManager *GFL_VBlankGetTCBMgr(void);
// A single callback that runs every VBlank, for when the tasks cannot
BOOL GFL_VBlankSetCallback(VBlankCallback callback, void *data);
void GFL_VBlankResetCallback(void);

// A manager of count tasks, in a buffer of GFL_TCBMgrCalcAllocSize(count) bytes
u32 GFL_TCBMgrCalcAllocSize(u32 count);
TCBManager *GFL_TCBMgrCreate(u32 count, void *buffer);
void GFL_TCBMgrUpdate(TCBManager *manager);
void GFL_TCBMgrDelete(TCBManager *manager);

#endif // POKEBW2_GFL_TCB_H
