#include "native.h"
#include "events.h"
#define API __attribute__((visibility("default")))
static struct {void *field,*game;uint32_t generation;FweObserver observer;unsigned notifying,restoreValid;FweRestore restore;Actor *ambient;} bridge;
#ifdef FW_MOUNT
static FweMount mountToken;
static unsigned mountValid;
static void discard_mount(void){mountValid=0;mountToken.game=0;}
static void preserve_mount(void *field,uint32_t generation,const FweMount *mount){
 if(!mount||!mount->game||bridge.field!=field||bridge.generation!=generation||PTR(field,8)!=mount->game)return;
 mountToken=*mount;mountValid=1;
}
static int consume_mount(void *game,FweMount *mount){
 if(!game||!mount||!mountValid)return 0;
 int valid=mountToken.game==game;
 if(valid)*mount=mountToken;
 discard_mount();return valid;
}
#endif
static void copy_restore(FweRestore *to,const FweRestore *from){
 volatile uint8_t *d=(volatile uint8_t*)to;const uint8_t *s=(const uint8_t*)from;
 for(unsigned i=0;i<sizeof(*to);++i)d[i]=s[i];
}
static void clear_restore(void){
 bridge.restore.magic=0;bridge.restore.player=(Vec){0,0,0};bridge.restore.follower=(Vec){0,0,0};
 bridge.restore.grid[0]=bridge.restore.grid[1]=bridge.restore.grid[2]=0;
 bridge.restore.face=bridge.restore.zone=0;
}
static int bind(void *field,void *game,uint32_t generation,FweObserver observer){
 if(!field||!game||!generation||!observer)return 0;
 if(bridge.observer&&(bridge.field!=field||bridge.generation!=generation))return 0;
 bridge.field=field;bridge.game=game;bridge.generation=generation;bridge.observer=observer;return 1;
}
static void unbind(void *field,uint32_t generation){
 if(bridge.field==field&&bridge.generation==generation){bridge.observer=0;bridge.ambient=0;bridge.field=bridge.game=0;bridge.generation=0;}
}
static void preserve(void *field,uint32_t generation,const FweRestore *restore){
 if(bridge.field!=field||bridge.generation!=generation||!restore||restore->magic!=FWE_RESTORE_MAGIC)return;
 copy_restore(&bridge.restore,restore);bridge.restoreValid=1;
}
static int consume(FweRestore *restore){
 if(!restore||!bridge.restoreValid)return 0;
 copy_restore(restore,&bridge.restore);bridge.restoreValid=0;clear_restore();return 1;
}
static void discard(void){bridge.restoreValid=0;clear_restore();
#ifdef FW_MOUNT
 discard_mount();
#endif
}
API const FweApi FollowingEventsAPI={FWE_ABI,sizeof(FweApi),bind,unbind,preserve,consume,discard
#ifdef FW_MOUNT
 ,preserve_mount,consume_mount,discard_mount
#endif
};
static void notify(unsigned kind,void *subject,uintptr_t value){
 if(!bridge.observer||bridge.notifying)return;
 bridge.notifying=1;bridge.observer(kind,subject,value);bridge.notifying=0;
}
API unsigned FollowingEventOpcode(void *vm){
 unsigned opcode=CALL(0x020159e9,unsigned(*)(void*))(vm);
 /* Other VMs (battle, applications) are not field scripts. Do not inspect
    their environments. This comparison precedes every environment read. */
 if(bridge.observer&&U32(vm,4)==0x0216b578){
  void *env=PTR(vm,0x2c),*param=env?PTR(env,0x20):0;
  if(param&&PTR(param,4)==bridge.game&&PTR(param,12)&&PTR(PTR(param,12),64)==bridge.field)
   notify(FWE_OPCODE,vm,opcode);
 }
 return opcode;
}
API int FollowingEventCallback(void *event){
 if(bridge.observer&&PTR(event,16)==bridge.game)notify(FWE_CALLBACK,event,U32(event,4));
 /* The observer never edits the event. Fetch its arguments once, before the
    native callback can replace/free itself. No post-call event dereference. */
 int (*callback)(void*,void*,void*)=PTR(event,4);
 return callback(event,(uint8_t*)event+8,PTR(event,12));
}
extern void FollowingOriginalEventFree(void*);
API void FollowingEventFree(void *event){
 if(bridge.observer&&PTR(event,16)==bridge.game)notify(FWE_FREE,event,0);
 FollowingOriginalEventFree(event);
}
API void FollowingEventAction(Actor *actor,unsigned code){
 unsigned wasUsed=actor->flags&1;
 if(bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field)notify(FWE_ACTION,actor,code);
 if(wasUsed&&!(actor->flags&1))return;
 /* Original SetNextActorAcmd is two instructions, not an eight-byte hook. */
 CALL(0x02167259,void(*)(Actor*,unsigned))(actor,code);
}
API Actor *FollowingEventAllocate(ActorSystem *sys,const void *entity){
 if(bridge.observer&&sys->field==bridge.field)notify(FWE_ALLOCATE,sys,(uintptr_t)entity);
 return CALL(0x02167aad,Actor*(*)(ActorSystem*))(sys);
}
extern void FollowingOriginalPosition(Actor*,const Vec*,unsigned);
API void FollowingEventPosition(Actor *actor,const Vec *position,unsigned direction){
 unsigned wasUsed=actor->flags&1;
 if(bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field)notify(FWE_POSITION,actor,(uintptr_t)position);
 if(wasUsed&&!(actor->flags&1))return;
 FollowingOriginalPosition(actor,position,direction);
}
extern void FollowingOriginalDelete(Actor*);
API void FollowingEventDelete(Actor *actor){
 unsigned wasUsed=actor->flags&1;
 if(bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field)notify(FWE_DELETE,actor,0);
 if(wasUsed&&!(actor->flags&1))return; /* owned follower already removed by observer */
 FollowingOriginalDelete(actor);
}
API void FollowingEventWorldStep(Actor *actor,const Vec *position){
 unsigned wasUsed=actor->flags&1;
 /* Native initialization writes the first position before MOVEPROC_INIT
    (flags bit 1). That is placement, not a sweep from the cleared origin.
    Reuse the existing placement notification so a real destination conflict
    still recalls. Initialized actors keep the full movement guard. */
 if(bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field)
  notify((actor->flags&2)?FWE_WORLD_STEP:FWE_POSITION,actor,(uintptr_t)position);
 if(wasUsed&&!(actor->flags&1))return;
 actor->world=*position;
}
API void FollowingEventVmFree(void *vm){
 /* Its environment has already been freed by the field VM destructor. */
 if(bridge.observer&&U32(vm,4)==0x0216b578)notify(FWE_VM_FREE,vm,0);
 CALL(0x0203a279,void(*)(void*))(vm);
}

/* Only collision queries issued by this actor's autonomous callback qualify.
   Sight/event queries outside the callback retain retail results. */
API void FollowingAmbientUpdate(Actor *actor){
 Actor *previous=bridge.ambient;
 bridge.ambient=actor;
 if(actor->callbacks->update)actor->callbacks->update(actor);
 bridge.ambient=previous;
}
extern int FollowingOriginalGridCollision(Actor*,int,int,int);
API int FollowingAmbientGrid(Actor *actor,int x,int y,int z){
 int result=FollowingOriginalGridCollision(actor,x,y,z);
 if(!result&&bridge.ambient==actor&&bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field){
  FweCollision query;query.position.x=x;query.position.y=y;query.position.z=z;query.radius=0;query.blocked=0;notify(FWE_AMBIENT_GRID,actor,(uintptr_t)&query);
  result=query.blocked?1:0;
 }
 return result;
}
API int FollowingAmbientRail(Actor *actor,const void *location){
 int result=CALL(0x021957a9,int(*)(Actor*,const void*))(actor,location);
 if(!result&&bridge.ambient==actor&&bridge.observer&&actor->system&&PTR(actor->system,64)==bridge.field){
  void *mapper=PTR(actor->system,60),*manager=mapper?PTR(mapper,0):0;
  if(manager){
   FweCollision query;query.blocked=0;
   CALL(0x021b0725,void(*)(void*,const void*,Vec*))(manager,location,&query.position);
   query.radius=CALL(0x021b0625,int32_t(*)(void*))(manager)/4;
   notify(FWE_AMBIENT_RAIL,actor,(uintptr_t)&query);result=query.blocked?1:0;
  }
 }
 return result;
}
