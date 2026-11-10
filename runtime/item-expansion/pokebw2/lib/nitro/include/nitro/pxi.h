#ifndef POKEBW2_NITRO_PXI_H
#define POKEBW2_NITRO_PXI_H

#include "types.h"

// NitroSDK's PXI, the FIFO between the ARM9 and the ARM7. Each word carries a tag, which picks the function that the
// receiving side calls with it, and an error bit. PXI_IsCallbackReady (NitroSDK's PXI_IsCallbackReady) tells whether
// the ARM7 is ready for a tag

// The FIFO's registers: the four bits each processor sets for the other, and the FIFO's control and ports. The
// register's address is its own macro for the boot code's assembly, which loads the register instead of reading it
#define REG_SUBPINTF_ADDR 0x04000180
#define reg_PXI_INTF (*(vu16 *)REG_SUBPINTF_ADDR)
#define REG_PXI_INTF_RECV_MASK 0x000f
#define REG_PXI_INTF_SEND_SHIFT 8
#define reg_PXI_FIFO_CNT (*(vu16 *)0x04000184)
#define REG_PXI_FIFO_CNT_SEND_FULL_MASK 0x0002
#define REG_PXI_FIFO_CNT_RECV_EMP_MASK 0x0100
#define REG_PXI_FIFO_CNT_ERR_MASK 0x4000
#define REG_PXI_FIFO_CNT_E_MASK 0x8000
// Writing the error bit clears it
#define REG_PXI_FIFO_CNT_ERR_ACK (REG_PXI_FIFO_CNT_E_MASK | REG_PXI_FIFO_CNT_ERR_MASK)
// Clears the send FIFO, enables the FIFO and its interrupt when the receive FIFO is not empty
#define REG_PXI_FIFO_CNT_INIT 0xc408
#define reg_PXI_SEND_FIFO (*(vu32 *)0x04000188)
#define reg_PXI_RECV_FIFO (*(vu32 *)0x04100000)

// What sending a word and receiving one return
#define PXI_FIFO_SUCCESS 0
#define PXI_FIFO_FAIL_SEND_ERR (-1)
#define PXI_FIFO_FAIL_SEND_FULL (-2)
#define PXI_FIFO_FAIL_RECV_ERR (-3)
#define PXI_FIFO_FAIL_RECV_EMPTY (-4)

// The tags of the FIFO's words: each library has its own, 5 bits wide. The card's commands travel with the tag of the
// ARM7's file system, which reads the card; the DSi's libraries in the LTD autoload have theirs from 20
#define PXI_MAX_FIFO_TAG 32
typedef enum {
    PXI_FIFO_TAG_EX = 0,
    PXI_FIFO_TAG_USER_0 = 1,
    PXI_FIFO_TAG_USER_1 = 2,
    PXI_FIFO_TAG_SYSTEM = 3,
    PXI_FIFO_TAG_NVRAM = 4,
    PXI_FIFO_TAG_RTC = 5,
    PXI_FIFO_TAG_TOUCHPANEL = 6,
    PXI_FIFO_TAG_SOUND = 7,
    PXI_FIFO_TAG_PM = 8,
    PXI_FIFO_TAG_MIC = 9,
    PXI_FIFO_TAG_WM = 10,
    PXI_FIFO_TAG_FS = 11,
    PXI_FIFO_TAG_OS = 12,
    PXI_FIFO_TAG_CTRDG = 13,
    PXI_FIFO_TAG_CARD = 14,
    PXI_FIFO_TAG_WVR = 15,
    PXI_FIFO_TAG_CTRDG_Ex = 16,
    PXI_FIFO_TAG_CTRDG_PHI = 17,
    PXI_FIFO_TAG_FATFS = 20,
    PXI_FIFO_TAG_CAMERA = 21,
    PXI_FIFO_TAG_NWM = 22,
    PXI_FIFO_TAG_SCFG = 23,
    PXI_FIFO_TAG_SNDEX = 24,
} PXIFifoTag;

// The processors, for PXI_IsCallbackReady
typedef enum {
    PXI_PROC_ARM9 = 0,
    PXI_PROC_ARM7 = 1,
} PXIProc;

// A word of the FIFO
typedef union {
    u32 raw;
    struct {
        u32 tag : 5;
        u32 err : 1;
        u32 data : 26;
    } e;
} PXIFifoMessage;

typedef void (*PXIFifoCallback)(PXIFifoTag fifoTag, u32 data, BOOL err);

// Sets up the FIFO (NitroSDK's PXI_Init, which calls PXI_InitFifo, NitroSDK's PXI_InitFifo)
void PXI_Init(void);
void PXI_InitFifo(void);
// Sets the function called with the words the ARM7 sends with the tag, and marks the tag ready for the ARM7 in the
// shared memory; NULL clears both (PXI_SetFifoRecvCallback's code)
void PXI_SetFifoRecvCallback(int fifoTag, PXIFifoCallback callback);
// Sends a word with the tag. Negative when the FIFO is full or in error
int PXI_SendWordByFifo(int fifoTag, u32 data, BOOL err);
// NitroSDK's PXIi_HandlerRecvFifoNotEmpty: the interrupt handler that calls the callbacks with the words received,
// which the loops that wait with the interrupts off also call
void PXIi_HandlerRecvFifoNotEmpty(void);
// NitroSDK's PXI_IsCallbackReady: whether the processor has a callback for the tag, by its bit in the shared memory
// (OSSystemWork's pxiHandleChecker, nitro/os.h)
BOOL PXI_IsCallbackReady(int fifoTag, PXIProc processor);

#endif // POKEBW2_NITRO_PXI_H
