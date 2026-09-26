#ifndef FOLLOWING_NATIVE_H
#define FOLLOWING_NATIVE_H
#include "following.h"
#include "field_layout.h"
/* IRDO revision 0 adapters. Offsets are checked against contract.json. */
typedef struct { int32_t x,y,z; } Vec;
typedef struct Actor Actor;
typedef struct { uint32_t code; void (*init)(Actor*); void (*update)(Actor*); void (*destroy)(Actor*); void (*recover)(Actor*); } Moves;
struct Actor {
 uint32_t flags, moveflags;
 uint16_t id, zone, model, move, event, spawn, script, head, face, dirMove, oldFace, oldMove, param[3], acmd, seq, draw;
 int16_t limitX,limitZ,initial[3],previous[3],grid[3],pad;
 Vec world,drawOffset,externalOffset,attributeOffset;
 uint32_t tile,oldTile; uint8_t dimensions[8];
 void *tcb,*system; const Moves *callbacks; void *drawing;
 uint8_t moveWork[16],subWork[16],cmdWork[16],drawWork[32],descriptor[28];
};
typedef struct { uint32_t flags; uint16_t capacity,count,heap,resourceHeap,priority,pad;
 uint32_t light; void *resources,*descriptors; Actor *actors; void *rest[8]; void *field; const uint16_t *cameraYaw; } ActorSystem;
_Static_assert(offsetof(FwFollower,trail)==52,"spacing uses sidecar padding");
_Static_assert(offsetof(FwFollower,sprite_y)==51,"sprite offset uses sidecar padding");
_Static_assert(sizeof(FwSample)==28,"trail sample layout");
_Static_assert(sizeof(FwFollower)==1856,"64-sample follower sidecar and directional positioning");
_Static_assert(sizeof(Actor)==256,"actor size");
_Static_assert(offsetof(Actor,world)==68,"world");
_Static_assert(offsetof(Actor,dimensions)+4==128,"native control Z offset");
_Static_assert(offsetof(Actor,callbacks)==140,"callback");
_Static_assert(offsetof(ActorSystem,field)==64,"field");
_Static_assert(offsetof(ActorSystem,cameraYaw)==68,"camera yaw");
_Static_assert(sizeof(Moves)==20,"callbacks");
#define CALL(address, type) ((type)(uintptr_t)(address))
#define U32(base, offset) (*(uint32_t*)((uint8_t*)(base)+(offset)))
#define PTR(base, offset) (*(void**)((uint8_t*)(base)+(offset)))
#endif
