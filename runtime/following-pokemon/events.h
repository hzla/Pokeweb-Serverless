#ifndef FOLLOWING_EVENTS_H
#define FOLLOWING_EVENTS_H
#include <stdint.h>
#ifdef FW_MOUNT
#define FWE_ABI 5u
#else
#define FWE_ABI 4u
#endif
/* Synchronous notifications only. Arguments are borrowed for this call. */
enum { FWE_CALLBACK=1, FWE_FREE, FWE_OPCODE, FWE_ACTION, FWE_ALLOCATE,
 FWE_POSITION, FWE_DELETE, FWE_WORLD_STEP, FWE_VM_FREE, FWE_AMBIENT_GRID, FWE_AMBIENT_RAIL };
/* Stack-owned query; observers may set blocked only during notify(). */
typedef struct {Vec position;int32_t radius;unsigned blocked;} FweCollision;
typedef void (*FweObserver)(unsigned kind,void *subject,uintptr_t value);
typedef struct {
 uint32_t magic;
 Vec player, follower;
 int16_t grid[3];
 uint16_t face, zone;
 FwPokemon selected;
} FweRestore;
#define FWE_RESTORE_MAGIC 0x52535746u
#ifdef FW_MOUNT
typedef struct {
 void *game;
 Vec player;
 uint16_t zone;
 uint8_t slot;
 uint8_t reserved;
 uint32_t appearance;
 FwPokemon pokemon;
} FweMount;
#endif
typedef struct {
 uint32_t abi, size;
 int (*bind)(void *field,void *game,uint32_t generation,FweObserver observer);
 void (*unbind)(void *field,uint32_t generation);
 void (*preserve)(void *field,uint32_t generation,const FweRestore *restore);
 int (*consume)(FweRestore *restore);
 void (*discard)(void);
#ifdef FW_MOUNT
 void (*preserveMount)(void *field,uint32_t generation,const FweMount *mount);
 int (*consumeMount)(void *game,FweMount *mount);
 void (*discardMount)(void);
#endif
} FweApi;
extern const FweApi FollowingEventsAPI;
#endif
