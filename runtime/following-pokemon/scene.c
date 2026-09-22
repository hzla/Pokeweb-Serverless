#include "scene.h"
#include "interaction.h"
#include "scene-policy.h"
#define API __attribute__((visibility("default")))
#define EVENT_LIMIT 16u
#define VM_LIMIT 48u
typedef struct {void *event;uintptr_t callback;} EventToken;
typedef struct {void *vm,*event;} VmToken;
static struct {
 ActorSystem *sys;Actor *player;FwFollower *f;void *field,*game;
 uint32_t generation,active,recalled,previousState,pcActive,pcFade,boxPreserve;void *menuRoot,*pcVm;void (*recall)(void);
 EventToken events[EVENT_LIMIT];VmToken vms[VM_LIMIT];
} scene;
/* Pointer values are diagnostic identities only; never follow saved tokens. */
API volatile struct {
 uint32_t magic,abi,generation,disposition,reason,opcode,action,event,vm,origin,write,script;
 struct {uint32_t generation,event,subject,kind,value,reason;} entries[32];
} FollowingSceneDebug={.magic=0x45535746,.abi=1};
static void log_event(unsigned kind,void *subject,uintptr_t value,unsigned reason){
 unsigned i=FollowingSceneDebug.write++&31u;
 FollowingSceneDebug.entries[i].generation=scene.generation;
 FollowingSceneDebug.entries[i].event=(uintptr_t)(scene.game?PTR(scene.game,0x18):0);
 FollowingSceneDebug.entries[i].subject=(uintptr_t)subject;
 FollowingSceneDebug.entries[i].kind=kind;FollowingSceneDebug.entries[i].value=value;
 FollowingSceneDebug.entries[i].reason=reason;
 if(reason)FollowingSceneDebug.reason=reason;
 FollowingSceneDebug.generation=scene.generation;
 FollowingSceneDebug.disposition=scene.recalled?FWS_RECALLED:scene.active?FWS_PAUSED:0;
}
static void pause_scene(void){
 if(!scene.active){scene.active=1;scene.previousState=scene.f->state;FollowingSceneDebug.origin=(uintptr_t)PTR(scene.game,0x18);FollowingSceneDebug.reason=0;}
 if(!scene.recalled&&scene.f->actor&&scene.f->state!=FW_INTERACTING){
  scene.f->state=FW_EVENT_PAUSED;((Actor*)scene.f->actor)->flags|=16;
 }
}
static void recall(unsigned reason,unsigned kind,void *subject,uintptr_t value){
 pause_scene();
 if(!scene.recalled){FollowingEventsAPI.discard();scene.pcActive=scene.pcFade=0;scene.recalled=1;log_event(kind,subject,value,reason);scene.recall();}
}
int fws_safe_opcode(unsigned code){
 unsigned lo=0,hi=sizeof(fws_safe_commands)/sizeof(fws_safe_commands[0]);
 while(lo<hi){unsigned mid=(lo+hi)/2;if(fws_safe_commands[mid]<code)lo=mid+1;else hi=mid;}
 return lo<sizeof(fws_safe_commands)/sizeof(fws_safe_commands[0])&&fws_safe_commands[lo]==code;
}
static int safe_callback(void *event,uintptr_t callback){
 void *work=PTR(event,12);
 /* Native menu and its replacement screen event are separately identified.
    Never trust a recycled event address or an arbitrary child application. */
 if(callback==0x0215a8b5u)return work&&PTR(work,8)==scene.game&&PTR(work,12)==scene.field;
 if(callback==0x0218b1a9u)return work&&PTR(work,4)==scene.game&&PTR(work,8)==scene.field;
 if(callback==0x0217993du||callback==0x02179a29u||callback==0x02179ac5u)
  return scene.pcActive&&work&&PTR(work,0)==scene.game&&PTR(work,4)==scene.field;
 /* The storage subprocess owns field teardown/reconstruction. These resident
    callbacks are allowed only in an observed PC transaction. */
 if(scene.pcActive&&(callback==0x02019655u||callback==0x0201958du
    ||callback==0x0201937du||callback==0x02019401u||callback==0x02019479u))return 1;
 if(callback==0x02154135u){ /* Native end-of-script cleanup child. */
  void *work=PTR(event,12);
  uint32_t active=*(volatile uint32_t*)0x0216e680;
  if(!work||PTR(work,0)!=scene.game||U32(work,16)>=15||U32(work,20)!=15
     ||(active&~FWS_SAFE_FINISHERS)){
   recall(FWS_UNKNOWN_FINISHER,FWE_CALLBACK,event,active);return 0;
  }
  return 1;
 }
 return callback==0x02153821u /* native field script supervisor */
  ||callback==0x021a83d5u /* list choices */
  ||callback==0x021aea39u||callback==0x021aea61u; /* camera waits */
}
static void track_event(void *event,uintptr_t callback){
 unsigned free=EVENT_LIMIT;
 for(unsigned i=0;i<EVENT_LIMIT;++i){
  if(scene.events[i].event==event){scene.events[i].callback=callback;return;}
  if(!scene.events[i].event)free=i;
 }
 if(free==EVENT_LIMIT){recall(FWS_EVENT_LIMIT,FWE_CALLBACK,event,callback);return;}
 scene.events[free]=(EventToken){event,callback};
 log_event(FWE_CALLBACK,event,callback,0);
}
/* Only traverse the currently live native chain. Free notifications remove
   diagnostic tokens before native deallocation; no token is dereferenced. */
static void inspect_chain(void){
 void *event=PTR(scene.game,0x18);
 for(unsigned depth=0;event&&depth<EVENT_LIMIT;++depth){
  uintptr_t callback=U32(event,4);
  if(PTR(event,16)!=scene.game||!safe_callback(event,callback)){
   recall(FWS_UNKNOWN_EVENT,FWE_CALLBACK,event,callback);return;
  }
  pause_scene();track_event(event,callback);event=PTR(event,0);
 }
 if(event)recall(FWS_EVENT_LIMIT,FWE_CALLBACK,event,0);
}
static int min(int a,int b){return a<b?a:b;}
static int max(int a,int b){return a>b?a:b;}
/* Native volume convention: width grows +X and depth grows -Z. Swept
   occupied tiles include both endpoints; separate elevations stay separate.
   This intentionally overestimates a diagonal sweep, never uses screen space. */
static int intersects(const Vec *from,const Vec *to,unsigned width,unsigned depth){
 Actor *f=(Actor*)scene.f->actor;if(!f)return 0;
 int fx=f->grid[0],fz=f->grid[2],fw=max(f->dimensions[0],1),fd=max(f->dimensions[1],1);
 int x0=from->x/FW_TILE,x1=to->x/FW_TILE,z0=from->z/FW_TILE,z1=to->z/FW_TILE;
 int fy=f->grid[1];
 if(fy<min(from->y/FW_TILE,to->y/FW_TILE)||fy>max(from->y/FW_TILE,to->y/FW_TILE))return 0;
 return min(x0,x1)<=fx+fw-1&&max(x0,x1)+(int)width-1>=fx
  &&min(z0,z1)-(int)depth+1<=fz&&max(z0,z1)>=fz-fd+1;
}
/* Replay one rail step using a private copy of the verified 124-byte native
   rail cursor. This uses native switches, connections and curve evaluation,
   without changing any actor, shared scratch cursor, camera, or rail state. */
static int rail_clear(Actor *actor,unsigned direction){
 uint32_t copy[31];const uint32_t *unit=PTR(actor,148);if(!unit||!unit[30])return -1;
 if((unit[0]&0xffffu)!=1u)return -1; /* point/invalid cursor profiles are unaudited */
 for(unsigned i=0;i<31;++i)copy[i]=unit[i];
 if(((uint8_t*)copy)[44])return -1; /* another rail step is still active */
 unsigned key=CALL(0x02019311,unsigned(*)(unsigned))(direction);
 if(!CALL(0x021b0acd,int(*)(void*,unsigned,unsigned))(copy,0,key))return -1;
 Vec previous=actor->world,current;
 for(unsigned frame=0;frame<16;++frame){
  CALL(0x021b0af9,void(*)(void*))(copy);
  CALL(0x021b0a15,void(*)(void*,Vec*))(copy,&current);
  if(intersects(&previous,&current,max(actor->dimensions[0],1),max(actor->dimensions[1],1)))return 0;
  previous=current;
 }
 return ((uint8_t*)copy)[44]?-1:1;
}
static void action(Actor *actor,unsigned code){
 if(!scene.active||scene.recalled||!scene.f->actor)return;
 if((uintptr_t)actor==scene.f->actor){recall(FWS_ACTOR_ID,FWE_ACTION,actor,code);return;}
 if(code<=3||(code>=0x3c&&code<=0x42)||code==0xfe||code==0xff)return;
 if(actor==scene.player){recall(FWS_PLAYER_MOVEMENT,FWE_ACTION,actor,code);return;}
 /* Common field-event setup sets MMDL_MOVEBIT_PAUSE_MOVE on ordinary actors.
    A paused wanderer can still have a queued/local action inspected here, but
    its movement process cannot start it. Predicting that dormant route caused
    false recalls while reading signs, checking furniture, and talking to
    random-movement NPCs. Defer paused actors to the position/world-step hooks:
    those run before any real coordinate commit, including script actions that
    are allowed to execute while autonomous movement remains paused. */
 if(actor->moveflags&8)return;
 if((code>=0x18&&code<=0x33)||(code>=0x45&&code<=0x4b)||code==0x67||code==0x99||code==0xa0||code==0xa1||code==0xbd||code==0xbe){
  if(intersects(&actor->world,&actor->world,max(actor->dimensions[0],1),max(actor->dimensions[1],1)))recall(FWS_COLLISION,FWE_ACTION,actor,code);
  return;
 }
 unsigned distance=1,direction=code&3u;
 int walking=(code>=4&&code<=0x17)||(code>=0x4c&&code<=0x53)||(code>=0x60&&code<=0x63)||(code>=0x9b&&code<=0x9e)||(code>=0xa7&&code<=0xaa);
 if(code>=0x34&&code<=0x3b)distance=code>=0x38?2:1;
 else if(!walking){recall(FWS_UNKNOWN_MOVEMENT,FWE_ACTION,actor,code);return;}
 if(code>=0x9b&&code<=0x9e)direction=code-0x9b;
 if(code>=0xa7&&code<=0xaa)direction=code-0xa7;
 if(actor->flags&8192){
  /* The four rail walk rates 16/8/4/2 are implemented natively. Other
     rail action profiles need a separate audit, including rail jumps. */
  if(code<8||code>0x17){recall(FWS_UNKNOWN_MOVEMENT,FWE_ACTION,actor,code);return;}
  int clear=rail_clear(actor,direction);
  if(clear!=1)recall(clear<0?FWS_UNKNOWN_MOVEMENT:FWS_COLLISION,FWE_ACTION,actor,code);
  return;
 }
 unsigned controller=CALL(0x02180579,unsigned(*)(void*))(scene.field);
 if(controller!=0){recall(FWS_UNKNOWN_MOVEMENT,FWE_ACTION,actor,code);return;}
 Vec previous=actor->world,target=previous;
 for(unsigned step=0;step<distance;++step){
  if(direction<2)target.z+=(direction?1:-1)*FW_TILE;
  else target.x+=(direction==3?1:-1)*FW_TILE;
  int32_t height;
  if(!CALL(0x0215e909,int(*)(Actor*,const Vec*,int32_t*))(actor,&target,&height)){
   recall(FWS_UNKNOWN_MOVEMENT,FWE_ACTION,actor,code);return;
  }
  target.y=height;
  if(intersects(&previous,&target,max(actor->dimensions[0],1),max(actor->dimensions[1],1))){recall(FWS_COLLISION,FWE_ACTION,actor,code);return;}
  previous=target;
 }
}

/* Native grid volumes extend +X/-Z and reserve both ends of a step. */
static int grid_overlap(const Actor *a,const Vec *p,const Actor *b,const int16_t *q){
 int aw=max(a->dimensions[0],1),ad=max(a->dimensions[1],1);
 int bw=max(b->dimensions[0],1),bd=max(b->dimensions[1],1);
 return p->y==q[1]&&p->x<=q[0]+bw-1&&p->x+aw-1>=q[0]
  &&p->z-ad+1<=q[2]&&p->z>=q[2]-bd+1;
}
static int sphere_overlap(const Vec *a,const Vec *b,int radius){
 if(radius<=0||radius>FW_TILE*4)return 0;
 return CALL(0x021b0d9d,int(*)(const Vec*,const Vec*,int))(a,b,radius);
}
static int valid_follower(void){
 Actor *f=scene.f?(Actor*)scene.f->actor:0;
 return f&&scene.sys&&scene.sys->field==scene.field&&scene.f->generation==scene.generation
  &&f->system==scene.sys&&(f->flags&5)==1;
}
static void ambient_collision(unsigned kind,Actor *actor,FweCollision *q){
 if(!valid_follower()||scene.recalled||scene.active||!actor||actor==scene.player||actor->id==0xff
    ||actor->system!=scene.sys||(uintptr_t)actor==scene.f->actor||(actor->moveflags&8)
    ||PTR(scene.game,0x18)||*((uint8_t*)scene.game+0x35))return;
 Actor *f=(Actor*)scene.f->actor;
 if(kind==FWE_AMBIENT_GRID)
  q->blocked=grid_overlap(actor,&q->position,f,f->grid)||grid_overlap(actor,&q->position,f,f->previous);
 else q->blocked=sphere_overlap(&q->position,&f->world,q->radius);
 if(q->blocked)log_event(kind,actor,0,0);
}
/* Called before the follower commits its next trail sample. NPC destinations
   are already reserved in native grid/rail work, independent of update order.
   Ignore the player and actors excluded from native object collision. */
int fws_step_clear(Actor *f,const Vec *target){
 if(!scene.sys||!scene.f||scene.f->actor!=(uintptr_t)f)return 1;
 Vec grid={target->x/FW_TILE,target->y/FW_TILE,target->z/FW_TILE};
 for(unsigned i=0;i<scene.sys->capacity;++i){
  Actor *a=&scene.sys->actors[i];
  if(a==f||a==scene.player||a->id==0xff||(a->flags&(1|4|128))!=1)continue;
  if(a->flags&8192){
   uint32_t *unit=PTR(a,148);if(!unit||!unit[30])return 0;
   void *mapper=PTR(scene.sys,60),*manager=mapper?PTR(mapper,0):0;
   if(!manager)return 0;
   int radius=CALL(0x021b0625,int32_t(*)(void*))(manager)/4;
   Vec point;
   CALL(0x021b08c1,void(*)(void*,Vec*))(unit,&point);
   if(sphere_overlap(target,&point,radius))return 0;
   if(((uint8_t*)unit)[44]){
    unsigned key=CALL(0x021b0a25,unsigned(*)(void*))(unit);
    if(!CALL(0x021b084d,int(*)(void*,unsigned,void*,Vec*))(unit,key,0,&point))return 0;
    if(sphere_overlap(target,&point,radius))return 0;
   }
  }else if(grid_overlap(f,&grid,a,a->grid)||grid_overlap(f,&grid,a,a->previous))return 0;
 }
 return 1;
}
void fws_observe(unsigned kind,void *subject,uintptr_t value){
 if(!scene.sys||scene.sys->field!=scene.field||scene.f->generation!=scene.generation)return;
 if(kind==FWE_AMBIENT_GRID||kind==FWE_AMBIENT_RAIL){ambient_collision(kind,subject,(FweCollision*)value);return;}
 if(kind==FWE_VM_FREE){
  if(subject==scene.pcVm){scene.pcVm=0;scene.pcFade=0;}
  for(unsigned i=0;i<VM_LIMIT;++i)if(scene.vms[i].vm==subject)scene.vms[i]=(VmToken){0};
  return;
 }
 if(kind==FWE_FREE){
  if(subject==scene.menuRoot)scene.menuRoot=0;
  for(unsigned i=0;i<EVENT_LIMIT;++i)if(scene.events[i].event==subject)scene.events[i]=(EventToken){0};
  for(unsigned i=0;i<VM_LIMIT;++i)if(scene.vms[i].event==subject)scene.vms[i]=(VmToken){0};
  return;
 }
 if(kind==FWE_CALLBACK){
  if(fwt_owns(scene.field)&&subject==PTR(scene.game,0x18))return;
  FollowingSceneDebug.event=(uintptr_t)subject;
  pause_scene();track_event(subject,value);
  inspect_chain();
  if(!safe_callback(subject,value))recall(FWS_UNKNOWN_EVENT,kind,subject,value);
  return;
 }
 if(kind==FWE_OPCODE){
  pause_scene();FollowingSceneDebug.opcode=value;FollowingSceneDebug.vm=(uintptr_t)subject;
  void *env=PTR(subject,0x2c),*param=PTR(env,0x20),*work=PTR(param,0);
  FollowingSceneDebug.script=work?*(uint16_t*)((uint8_t*)work+4):0xffff;
  void *event=work?CALL(0x02153ee1,void*(*)(void*))(work):0;
  unsigned free=VM_LIMIT;
  for(unsigned i=0;i<VM_LIMIT;++i){if(scene.vms[i].vm==subject){free=i;break;}if(!scene.vms[i].vm)free=i;}
  if(free==VM_LIMIT)recall(FWS_VM_LIMIT,kind,subject,value);else scene.vms[free]=(VmToken){subject,event};
  if(value==0x130u||value==0x131u){scene.pcActive=1;scene.pcVm=subject;}
  int pcFade=scene.pcActive&&scene.pcVm==subject&&(value==0x1a3u||value==0x1a4u||value==0x1a7u);
  if(pcFade)scene.pcFade=1;
  if(value==0x14fu&&scene.pcActive&&!scene.recalled&&scene.f->actor&&scene.player&&!(((Actor*)scene.f->actor)->flags&4)){
   Actor *f=(Actor*)scene.f->actor;
   FweRestore restore={.magic=FWE_RESTORE_MAGIC,.player=scene.player->world,.follower=f->world,
    .grid={f->grid[0],f->grid[1],f->grid[2]},.face=f->face,.zone=scene.player->zone,.selected=scene.f->selected};
   FollowingEventsAPI.preserve(scene.field,scene.generation,&restore);
   scene.boxPreserve=1;
  }
  if(!fws_safe_opcode(value)&&!pcFade)recall(FWS_UNKNOWN_COMMAND,kind,subject,value);
  return;
 }
 if(kind==FWE_ALLOCATE){
  if(!scene.f->actor||subject!=scene.sys)return;
  const uint16_t *entity=(const uint16_t*)value;
  unsigned free=0;for(unsigned i=0;i<scene.sys->capacity;++i)if(!(scene.sys->actors[i].flags&1))++free;
  if(entity[0]==((Actor*)scene.f->actor)->id){recall(FWS_ACTOR_ID,kind,subject,entity[0]);return;}
  if(!free){recall(FWS_POOL,kind,subject,entity[0]);return;}
  if(!scene.active)return;
  if(U32(entity,24)||entity[1]==0xb9){recall(FWS_UNKNOWN_MOVEMENT,kind,subject,entity[0]);return;}
  Vec target={(int16_t)entity[14]*FW_TILE+FW_TILE/2,(int32_t)U32(entity,32),(int16_t)entity[15]*FW_TILE+FW_TILE/2};
  /* All pinned stock descriptors fit 3 x 2 tiles; use that conservative
     bound until the new actor's descriptor has been initialized. */
  if(intersects(&target,&target,3,2))recall(FWS_COLLISION,kind,subject,entity[0]);
  return;
 }
 /* Special autonomous controllers can deliberately ignore collision results.
    Let those controllers proceed, recalling before an actual conflicting write. */
 if(!scene.active&&(kind==FWE_WORLD_STEP||kind==FWE_POSITION)&&valid_follower()&&subject!=scene.player&&(uintptr_t)subject!=scene.f->actor){
  Actor *actor=subject;const Vec *target=(const Vec*)value;
  if(actor->system==scene.sys&&(target->x!=actor->world.x||target->y!=actor->world.y||target->z!=actor->world.z)){
   int hit;
   if(actor->flags&8192){
    void *mapper=PTR(scene.sys,60),*manager=mapper?PTR(mapper,0):0;
    int radius=manager?CALL(0x021b0625,int32_t(*)(void*))(manager)/4:FW_TILE/4;
    hit=sphere_overlap(target,&((Actor*)scene.f->actor)->world,radius);
   }else hit=intersects(kind==FWE_WORLD_STEP?&actor->world:target,target,max(actor->dimensions[0],1),max(actor->dimensions[1],1));
   if(hit)recall(FWS_COLLISION,kind,subject,0);
  }
 }
 if(!scene.active||scene.recalled||!scene.f->actor)return;
 if(kind==FWE_ACTION){FollowingSceneDebug.action=value;action(subject,value);}
 if(kind==FWE_POSITION||kind==FWE_WORLD_STEP){
  Actor *actor=subject;const Vec *target=(const Vec*)value;
  if(target->x==actor->world.x&&target->y==actor->world.y&&target->z==actor->world.z)return;
  if(actor==scene.player)recall(FWS_PLAYER_MOVEMENT,kind,subject,0);
  else if((uintptr_t)actor==scene.f->actor)recall(FWS_ACTOR_ID,kind,subject,0);
  else if(intersects(kind==FWE_WORLD_STEP?&actor->world:target,target,max(actor->dimensions[0],1),max(actor->dimensions[1],1)))recall(FWS_COLLISION,kind,subject,0);
 }
 if(kind==FWE_DELETE&&(uintptr_t)subject==scene.f->actor)recall(FWS_ACTOR_LOST,kind,subject,0);
}
int fws_attach(ActorSystem *sys,FwFollower *f,uint32_t generation,void (*recallFn)(void)){
 fws_detach();scene.sys=sys;scene.field=sys->field;scene.game=scene.field?PTR(scene.field,4):0;
 scene.f=f;scene.generation=generation;scene.recall=recallFn;
 if(FollowingEventsAPI.abi!=FWE_ABI||FollowingEventsAPI.size!=sizeof(FweApi)||!FollowingEventsAPI.bind(scene.field,scene.game,generation,fws_observe)){
  scene.sys=0;FollowingSceneDebug.reason=FWS_BRIDGE;return 0;
 }
 return 1;
}
void fws_set_player(Actor *player){scene.player=player;}
void fws_mark_menu(void *event){
 if(!event||!scene.sys||scene.recalled)return;
 scene.menuRoot=event;pause_scene();track_event(event,U32(event,4));
}
int fws_take_restore(FweRestore *restore){
 if(!scene.sys||FollowingEventsAPI.abi!=FWE_ABI||!FollowingEventsAPI.consume(restore))return 0;
 scene.pcActive=scene.pcFade=1;scene.previousState=FW_FOLLOWING;
 return 1;
}
void fws_detach(void){
 if(scene.sys&&FollowingEventsAPI.abi==FWE_ABI)FollowingEventsAPI.unbind(scene.field,scene.generation);
 scene=(__typeof__(scene)){0};
}
unsigned fws_poll(void){
 if(!scene.sys)return 0;
 if(scene.sys->field!=scene.field||scene.f->generation!=scene.generation){fws_detach();return FWS_INVALID;}
 if(PTR(scene.game,0x18)){
  if(!fwt_owns(scene.field))inspect_chain();
 }else if(scene.active&&!*((uint8_t*)scene.game+0x35)){
  unsigned recalled=scene.recalled;
  if(scene.boxPreserve)FollowingEventsAPI.discard();
  scene.active=scene.recalled=scene.pcActive=scene.pcFade=scene.boxPreserve=0;
  scene.menuRoot=scene.pcVm=0;
  for(unsigned i=0;i<EVENT_LIMIT;++i)scene.events[i]=(EventToken){0};
  for(unsigned i=0;i<VM_LIMIT;++i)scene.vms[i]=(VmToken){0};
  if(!recalled&&scene.f->state==FW_EVENT_PAUSED)scene.f->state=(FwState)scene.previousState;
  FollowingSceneDebug.disposition=0;return FWS_REFRESH;
 }
 return scene.active?(scene.recalled?FWS_RECALLED:FWS_PAUSED):FWS_NONE;
}

int fws_pc_fade(void){return scene.active&&!scene.recalled&&scene.pcActive&&scene.pcFade;}
void fws_restored(void){if(scene.active&&!scene.recalled){scene.previousState=FW_FOLLOWING;scene.f->state=FW_EVENT_PAUSED;}}
