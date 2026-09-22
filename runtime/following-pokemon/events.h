#ifndef FOLLOWING_EVENTS_H
#define FOLLOWING_EVENTS_H
#include <stdint.h>
#define FWE_ABI 4u
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
typedef struct {
 uint32_t abi, size;
 int (*bind)(void *field,void *game,uint32_t generation,FweObserver observer);
 void (*unbind)(void *field,uint32_t generation);
 void (*preserve)(void *field,uint32_t generation,const FweRestore *restore);
 int (*consume)(FweRestore *restore);
 void (*discard)(void);
} FweApi;
extern const FweApi FollowingEventsAPI;
#endif
