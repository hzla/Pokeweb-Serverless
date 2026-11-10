#ifndef POKEBW2_SYSTEM_VM_H
#define POKEBW2_SYSTEM_VM_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// A script virtual machine, which runs the field event scripts, the trainer AI, the battle move animations and the
// musical scripts, each with its own commands. A script is a sequence of 16-bit command IDs, each followed by its
// arguments. The command reads its arguments from the script, and returns TRUE to make VM_Run return, or FALSE to
// run the next command.

typedef BOOL (*VMCommand)(VM *vm, void *env);
// Called before each command. Returning FALSE stops the script
typedef BOOL (*VMVerifier)(VM *vm, void *env, void *arg, u16 cmd);

typedef enum {
    VM_STATE_STOPPED,
    VM_STATE_RUNNING,
    // Waiting for the native function set by VM_SetNativeCallback to return TRUE
    VM_STATE_WAITING,
} VMState;

typedef struct {
    u16 stackSize;
    u16 workSize;
    const VMCommand *commands;
    u32 commandCount;
    // Commands with IDs from extraCommandStart
    const VMCommand *extraCommands;
    u32 extraCommandCount;
    u32 extraCommandStart;
} VMInitParam;

struct VM {
    VMInitParam param;
    u8 stackPos;
    u8 state;
    // The result of the last comparison: less, equal or greater than (0, 1, 2)
    u8 cmpResult;
    VMCommand native;
    const u8 *pc;
    u32 *stack;
    u32 *work;
    void *env;
    VMVerifier verifier;
    void *verifierArg;
    u32 unk38;
    // The work and then the stack follow
};

void VM_Reset(VM *vm);
VM *VM_Create(HeapID heapId, const VMInitParam *param);
void VM_Free(VM *vm);
void VM_ChangeEnv(VM *vm, void *env);
void VM_LoadScript(VM *vm, const void *script);
void VM_Halt(VM *vm);
BOOL VM_Run(VM *vm);
void *VM_GetEnv(VM *vm);
void VM_SetCallbackVerifier(VM *vm, VMVerifier verifier, void *arg);
static inline u8 VM_Read8(VM *vm) {
    u8 value = *vm->pc;

    vm->pc++;
    return value;
}

u16 VM_Read16(VM *vm);
u32 VM_Read32(VM *vm);
void VM_StackPush(VM *vm, u32 value);
u32 VM_StackPop(VM *vm);
void VM_Jump(VM *vm, const u8 *pc);
void VM_Call(VM *vm, const u8 *pc);
void VM_Return(VM *vm);
// Makes VM_Run call native until it returns TRUE, before running the next command
void VM_SetNativeCallback(VM *vm, VMCommand native);

#endif // POKEBW2_SYSTEM_VM_H
