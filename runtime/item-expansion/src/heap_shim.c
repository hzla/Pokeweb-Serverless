// GFL_HeapTryAllocate (a pokebw2 addition): GFL_HeapAllocate without the fatal stop when the heap is full.
#include "types.h"
#include "gfl/heap.h"

extern void *GFL_HeapAllocateCore(HeapID heapId, u32 size);
extern void GFL_HeapSetBlockDebugInfo(void *ptr, const char *file, u16 line);
extern void GFL_HeapDebugTraceAlloc(HeapID heapId, void *ptr, u32 size);
#include "nitro/mi.h"

void *GFL_HeapTryAllocate(HeapID heapId, u32 size, BOOL clear, const char *file, u16 line) {
    void *ptr = GFL_HeapAllocateCore(heapId, size);

    if (ptr != NULL) {
        GFL_HeapSetBlockDebugInfo(ptr, file, line);
        GFL_HeapDebugTraceAlloc(heapId, ptr, size);
        if (clear) {
            MIi_CpuClear32(0, ptr, size);
        }
    }
    return ptr;
}
