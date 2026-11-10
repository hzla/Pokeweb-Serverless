#ifndef POKEBW2_NNSYS_FND_H
#define POKEBW2_NNSYS_FND_H

#include "types.h"

// NitroSystem's foundation (NNS_Fnd): linked lists, the expanded, frame and unit heaps and the allocators over them.
// The names are NitroSystem's, as ntrtwl's reconstruction of NitroSystem has them, where the code shows them, and ours
// elsewhere; the sources' header comments list swan's names where they differ

// Lists (list.c), which link any struct through an NNSFndLink at offset in it

typedef struct {
    void *prevObject;
    void *nextObject;
} NNSFndLink;

typedef struct {
    void *headObject;
    void *tailObject;
    u16 numObjects;
    u16 offset;
} NNSFndList;

void NNS_FndInitList(NNSFndList *list, u16 offset);
void NNS_FndAppendListObject(NNSFndList *list, void *object);
void NNS_FndPrependListObject(NNSFndList *list, void *object);
// Inserts object before target, or last when target is NULL
void NNS_FndInsertListObject(NNSFndList *list, void *target, void *object);
void NNS_FndRemoveListObject(NNSFndList *list, void *object);
// The first object when object is NULL
void *NNS_FndGetNextListObject(NNSFndList *list, void *object);
// The last object when object is NULL
void *NNS_FndGetPrevListObject(NNSFndList *list, void *object);

// What every heap starts with (heapcommon.c). A heap is linked into the child list of the heap its memory came from

// Clear allocated memory to 0
#define NNS_FND_HEAP_OPT_0_CLEAR (1 << 0)

typedef struct NNSiFndHeapHead {
    u32 signature;
    NNSFndLink link;
    NNSFndList childList;
    void *heapStart;
    void *heapEnd;
    u32 attribute; // The options (NNS_FND_HEAP_OPT_0_CLEAR) in the low byte
} NNSiFndHeapHead;

typedef NNSiFndHeapHead *NNSFndHeapHandle;

// Expanded heaps (expheap.c): blocks of any size, allocated from either end. A negative alignment allocates from the
// end of the heap

// Allocate from the first free block big enough, or from the smallest
#define NNS_FND_EXPHEAP_ALLOC_MODE_FIRST 0
#define NNS_FND_EXPHEAP_ALLOC_MODE_NEAR 1

#define NNS_FND_EXPHEAP_ALLOC_DIR_FRONT 0
#define NNS_FND_EXPHEAP_ALLOC_DIR_REAR 1

typedef struct NNSiFndExpHeapMBlockHead NNSiFndExpHeapMBlockHead;

// The header before every block, free ('FR') or used ('UD')
struct NNSiFndExpHeapMBlockHead {
    u16 signature;
    u16 attribute; // A used block's group in the low byte, its alignment padding in bits 8 to 14, its end in bit 15
    u32 blockSize;
    NNSiFndExpHeapMBlockHead *pMBHeadPrev;
    NNSiFndExpHeapMBlockHead *pMBHeadNext;
};

typedef struct {
    NNSiFndExpHeapMBlockHead *head;
    NNSiFndExpHeapMBlockHead *tail;
} NNSiFndExpMBlockList;

// Follows the NNSiFndHeapHead of an expanded heap
typedef struct {
    NNSiFndExpMBlockList mbFreeList;
    NNSiFndExpMBlockList mbUsedList;
    u16 groupID;
    u16 feature; // The fit mode (NNS_FND_EXPHEAP_ALLOC_MODE_FIRST or _NEAR) in bit 0
} NNSiFndExpHeapHead;

typedef void (*NNSFndHeapVisitor)(void *memBlock, NNSFndHeapHandle heap, u32 param);

NNSFndHeapHandle NNS_FndCreateExpHeapEx(void *startAddress, u32 size, u16 optFlag);
void NNS_FndDestroyExpHeap(NNSFndHeapHandle heap);
void *NNS_FndAllocFromExpHeapEx(NNSFndHeapHandle heap, u32 size, int alignment);
u32 NNS_FndResizeForMBlockExpHeap(NNSFndHeapHandle heap, void *memBlock, u32 size);
void NNS_FndFreeToExpHeap(NNSFndHeapHandle heap, void *memBlock);
u32 NNS_FndGetTotalFreeSizeForExpHeap(NNSFndHeapHandle heap);
u32 NNS_FndGetAllocatableSizeForExpHeapEx(NNSFndHeapHandle heap, int alignment);
u16 NNS_FndSetAllocModeForExpHeap(NNSFndHeapHandle heap, u16 mode);
u16 NNS_FndSetGroupIDForExpHeap(NNSFndHeapHandle heap, u16 groupID);
void NNS_FndVisitAllocatedForExpHeap(NNSFndHeapHandle heap, NNSFndHeapVisitor callback, u32 param);
u32 NNS_FndGetSizeForMBlockExpHeap(const void *memBlock);
u16 NNS_FndGetGroupIDForMBlockExpHeap(const void *memBlock);

// Frame heaps (frameheap.c): allocation moves a pointer from either end, and memory is freed only all at once

#define NNS_FND_FRMHEAP_FREE_HEAD (1 << 0)
#define NNS_FND_FRMHEAP_FREE_TAIL (1 << 1)
#define NNS_FND_FRMHEAP_FREE_ALL (NNS_FND_FRMHEAP_FREE_HEAD | NNS_FND_FRMHEAP_FREE_TAIL)

typedef struct NNSiFndFrmHeapState NNSiFndFrmHeapState;

// Where both ends were, recorded under a tag in memory allocated from the heap
struct NNSiFndFrmHeapState {
    u32 tagName;
    void *headAllocator;
    void *tailAllocator;
    NNSiFndFrmHeapState *pPrevState;
};

// Follows the NNSiFndHeapHead of a frame heap
typedef struct {
    void *headAllocator;
    void *tailAllocator;
    NNSiFndFrmHeapState *pState;
} NNSiFndFrmHeapHead;

NNSFndHeapHandle NNS_FndCreateFrmHeapEx(void *startAddress, u32 size, u16 optFlag);
void NNS_FndDestroyFrmHeap(NNSFndHeapHandle heap);
void *NNS_FndAllocFromFrmHeapEx(NNSFndHeapHandle heap, u32 size, int alignment);
void NNS_FndFreeToFrmHeap(NNSFndHeapHandle heap, int mode);
BOOL NNS_FndRecordStateForFrmHeap(NNSFndHeapHandle heap, u32 tag);
BOOL NNS_FndFreeByStateToFrmHeap(NNSFndHeapHandle heap, u32 tag);

// Unit heaps (unitheap.c): blocks of one size, kept in a free list

typedef struct NNSiFndUntHeapMBlockHead NNSiFndUntHeapMBlockHead;

struct NNSiFndUntHeapMBlockHead {
    NNSiFndUntHeapMBlockHead *pMBlkHdNext;
};

typedef struct {
    NNSiFndUntHeapMBlockHead *head;
} NNSiFndUntMBlockList;

// Follows the NNSiFndHeapHead of a unit heap
typedef struct {
    NNSiFndUntMBlockList mbFreeList;
    u32 mBlkSize;
} NNSiFndUntHeapHead;

void *NNS_FndAllocFromUnitHeap(NNSFndHeapHandle heap);
void NNS_FndFreeToUnitHeap(NNSFndHeapHandle heap, void *memBlock);

static inline u32 NNS_FndGetMemBlockSizeForUnitHeap(NNSFndHeapHandle heap) {
    return ((NNSiFndUntHeapHead *)((u32)heap + sizeof(NNSiFndHeapHead)))->mBlkSize;
}

// Allocators (allocator.c): a heap and its parameters behind one pair of functions

typedef struct NNSFndAllocator NNSFndAllocator;

typedef void *(*NNSFndFuncAllocatorAlloc)(NNSFndAllocator *allocator, u32 size);
typedef void (*NNSFndFuncAllocatorFree)(NNSFndAllocator *allocator, void *memBlock);

typedef struct {
    NNSFndFuncAllocatorAlloc pfAlloc;
    NNSFndFuncAllocatorFree pfFree;
} NNSFndAllocatorFunc;

struct NNSFndAllocator {
    const NNSFndAllocatorFunc *pFunc;
    void *pHeap;
    u32 heapParam1; // The alignment, or for a NitroSDK heap its arena
    u32 heapParam2;
};

void *NNS_FndAllocFromAllocator(NNSFndAllocator *allocator, u32 size);
void NNS_FndFreeToAllocator(NNSFndAllocator *allocator, void *memBlock);
void NNS_FndInitAllocatorForExpHeap(NNSFndAllocator *allocator, NNSFndHeapHandle heap, int alignment);

#endif // POKEBW2_NNSYS_FND_H
