#include "transition.h"

/* The ordinary native Surf task owns effect creation, ripple, jointing and
 * mode change. These four audited calls replace only its hop with short,
 * grounded one-tile movements. Shore attributes require two such tiles. */
enum { TM_IDLE, TM_ENTRY, TM_WATER, TM_EXIT, TM_RETURN };
static struct {
 FwPokemon pokemon;
 void *task;
 unsigned appearance;
 uint8_t phase,slot,dir,shore,steps;
} transition;

__attribute__((visibility("default"))) volatile struct {
 uint32_t magic,version,phase,entries,exits,returns,failures,direction,shore;
} FollowingTransitionDebug={.magic=0x54535746,.version=1};

static void phase(unsigned value){transition.phase=(uint8_t)value;FollowingTransitionDebug.phase=value;}
/* The retail shore predicate recognizes only terrain 0x41/0x44. Some maps
 * put a water-flagged sand tile at the waterline instead. Let the native
 * two-tile collision and final dry-tile flags decide whether it is a shore. */
__attribute__((visibility("default"))) int FollowingShoreSpan(unsigned terrain,unsigned flags){
 if(CALL(0x021a2c25,int(*)(unsigned))(terrain))return 1;
 return transition.phase==TM_WATER && !(flags&1u) && (flags&2u)!=0;
}
static int same_party(void *game,int slot,const FwPokemon *selected,int healthy){
 if(!game||!selected||slot<0||slot>=6)return 0;
 void *party=CALL(0x0201735d,void*(*)(void*))(game);
 unsigned count=party?CALL(0x0201fe25,unsigned(*)(void*))(party):0;
 if(count>6||(unsigned)slot>=count)return 0;
 void *mon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)slot);
 if(!mon)return 0;
 uint32_t(*param)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 return param(mon,5,0)==selected->species && param(mon,0,0)==selected->personality &&
  param(mon,7,0)==selected->trainer && param(mon,0x6f,0)==selected->form &&
  param(mon,0x6e,0)==selected->gender &&
  !!CALL(0x0201cdd9,int(*)(void*))(mon)==selected->shiny &&
  !param(mon,0x4c,0) && (!healthy||param(mon,0xa0,0));
}
static int knows_surf(void *game,int slot){
 void *party=CALL(0x0201735d,void*(*)(void*))(game);
 void *mon=party?CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)slot):0;
 if(!mon)return 0;
 uint32_t(*param)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 for(unsigned i=0;i<4;++i)if(param(mon,0x36u+i,0)==57u)return 1;
 return 0;
}
int fwtm_eligible(void *game,void *field,const FwPokemon *selected,int slot,
                  unsigned *direction,unsigned *attribute){
 if(transition.phase||!game||!field||!direction||!attribute||
    !same_party(game,slot,selected,1)||!knows_surf(game,slot))return 0;
 void *bag=CALL(0x02017355,void*(*)(void*))(game);
 if(!bag||!CALL(0x02008539,unsigned(*)(void*,unsigned))(bag,422u))return 0;
 if(!CALL(0x02018c65,int(*)(unsigned))(fw_field_zone(field))||
    CALL(0x020175e5,int(*)(void*))(game)||CALL(0x0216a2b5,int(*)(void*))(game))return 0;
 void *fp=PTR(field,0x94);
 if(!fp||CALL(0x0219a705,unsigned(*)(void*))(fp)!=0)return 0;
 Actor *player=CALL(0x0219a6e1,Actor*(*)(void*))(fp);
 /* Mounted travel may have advanced the logical grid while the player is
  * still partway through the previous step. Starting a native Surf action
  * there preserves that fractional offset across every later transition. */
 if(!player||player->world.x!=(int32_t)player->grid[0]*65536+0x8000||
    player->world.z!=(int32_t)player->grid[2]*65536+0x8000)return 0;
 unsigned held=CALL(0x0203df4d,unsigned(*)(void))();
 unsigned dir=CALL(0x0219a611,unsigned(*)(void*,unsigned))(fp,held);
 if(dir>3||!CALL(0x0219ab71,int(*)(void*,unsigned))(fp,dir))return 0;
 Vec front;
 CALL(0x0219a9d1,void(*)(void*,unsigned,Vec*))(fp,dir,&front);
 void *mapper=CALL(0x02180515,void*(*)(void*))(field);
 if(!mapper)return 0;
 *attribute=CALL(0x021a2a11,unsigned(*)(void*,const Vec*))(mapper,&front);
 /* The low half is a visual/terrain class, not proof that the tile is
  * swimmable. Humilau has Splash-only shallows sharing water-like classes,
  * followed by Water+Splash tiles whose class can instead be sand (0x17).
  * Use the same packed high-half Water and Blocked flags exposed by Pokeweb. */
 unsigned flags=*attribute>>16;
 if((flags&3u)!=2u)return 0;
 *direction=dir;return 1;
}
static int entry_event(void *event,int *seq,void *work){
 (void)event;(void)seq;
 void *task=work?PTR(work,0):0;
 if(!task||task!=transition.task)return 1;
 if(!CALL(0x021bac45,int(*)(void*))(task))return 0;
 CALL(0x021bac51,void(*)(void*))(task);
 transition.task=0;
 if(transition.phase==TM_ENTRY)phase(TM_WATER);
 return 1;
}
void *fwtm_enter(void *game,void *field,const FwPokemon *selected,int slot,
                 unsigned appearance,unsigned direction,unsigned attribute){
 void *gameData=field?PTR(field,8):0;
 if(transition.phase||!same_party(gameData,slot,selected,1)||direction>3)return 0;
 void *fp=PTR(field,0x94);
 Actor *player=fp?CALL(0x0219a6e1,Actor*(*)(void*))(fp):0;
 if(!player||player->face>3||
    player->world.x!=(int32_t)player->grid[0]*65536+0x8000||
    player->world.z!=(int32_t)player->grid[2]*65536+0x8000)return 0;
 unsigned heap=CALL(0x02180501,unsigned(*)(void*))(field);
 if(CALL(0x0203a2d5,unsigned(*)(unsigned))(heap)<16384u)return 0;
 /* Native Surf phase zero and its jump action read the actor's facing, not
  * the direction passed to the task. Turn before creating either effect. */
 uint16_t oldFace=player->face,oldPreviousFace=player->oldFace;
 if(oldFace!=direction)CALL(0x02167099,void(*)(Actor*,unsigned))(player,direction);
 transition.pokemon=*selected;transition.slot=(uint8_t)slot;
 transition.appearance=appearance;transition.dir=(uint8_t)direction;
 transition.steps=0;transition.shore=0;phase(TM_ENTRY);
 transition.task=CALL(0x021babd5,void*(*)(void*,unsigned,unsigned,unsigned))
  (fp,direction,attribute,heap);
 if(!transition.task){goto fail;}
 /* Phase zero creates the effect immediately; only the old fifteen-frame
  * pre-hop pause is shortened. Its collision/mode work remains native. */
 void *taskWork=CALL(0x0203a6fd,void*(*)(void*))(transition.task);
 if(!taskWork){goto fail;}
 transition.shore=*(uint16_t*)((uint8_t*)taskWork+8)==1u;
 *(int16_t*)((uint8_t*)taskWork+2)=15;
 void *event=CALL(0x02016cb5,void*(*)(void*,void*,void*,unsigned))
  (game,0,entry_event,4);
 if(!event){goto fail;}
 PTR(PTR(event,12),0)=transition.task;
 FollowingTransitionDebug.direction=direction;FollowingTransitionDebug.shore=transition.shore;
 ++FollowingTransitionDebug.entries;
 /* The substituted walk command has no jump sound of its own. */
 CALL(0x02006255,void(*)(unsigned))(1374u);
 return event;
fail:
 if(transition.task){CALL(0x021bac51,void(*)(void*))(transition.task);transition.task=0;}
 player->face=oldFace;player->oldFace=oldPreviousFace;
 phase(TM_IDLE);++FollowingTransitionDebug.failures;return 0;
}
void fwtm_observe_exit(void *event,void *game,void *field){
 (void)game;
 if(transition.phase!=TM_WATER||!event||!field||PTR(event,4)!=(void*)(uintptr_t)0x02182c39u)return;
 if(!same_party(PTR(field,8),transition.slot,&transition.pokemon,1)){
  phase(TM_IDLE);return; /* Native shore exit continues on foot. */
 }
 void *work=PTR(event,12);
 if(!work||PTR(work,12)!=field)return;
 unsigned dir=*(uint16_t*)((uint8_t*)work+4);
 if(dir>3)return;
 transition.dir=(uint8_t)dir;
 transition.shore=*(uint16_t*)((uint8_t*)work+6)==1u;
 transition.steps=0;phase(TM_EXIT);
 FollowingTransitionDebug.direction=dir;FollowingTransitionDebug.shore=transition.shore;
 ++FollowingTransitionDebug.exits;
}
unsigned fwtm_appearance(void *game){
 if(transition.phase==TM_IDLE||!same_party(game,transition.slot,&transition.pokemon,0))return 0;
 return transition.appearance;
}
int fwtm_return_ready(void *game,const FwPokemon *selected){
 return transition.phase==TM_RETURN && selected &&
  fw_same_identity(selected,&transition.pokemon) &&
  same_party(game,transition.slot,&transition.pokemon,1);
}
int fwtm_return_pending(void){return transition.phase==TM_RETURN;}
void fwtm_return_done(void){if(transition.phase==TM_RETURN)++FollowingTransitionDebug.returns;phase(TM_IDLE);}
void fwtm_cancel(void){
 if(transition.task){CALL(0x021bac51,void(*)(void*))(transition.task);transition.task=0;}
 phase(TM_IDLE);
}
int fwtm_entering(void){return transition.phase==TM_ENTRY;}
int fwtm_exiting(void){return transition.phase==TM_EXIT||transition.phase==TM_RETURN;}
int fwtm_menu_snapshot(void *field,FweMount *mount){
 if(!field||!mount||transition.phase!=TM_WATER)return 0;
 void *game=PTR(field,8),*fp=PTR(field,0x94);
 Actor *player=fp?CALL(0x0219a6e1,Actor*(*)(void*))(fp):0;
 if(!player||CALL(0x0219a705,unsigned(*)(void*))(fp)!=2u||
    !same_party(game,transition.slot,&transition.pokemon,1))return 0;
 *mount=(FweMount){.game=game,.player=player->world,.zone=player->zone,
  .slot=transition.slot,.appearance=transition.appearance,.pokemon=transition.pokemon};
 return 1;
}
int fwtm_menu_restore(void *field,const FweMount *mount){
 if(!field||!mount||transition.phase!=TM_IDLE||mount->game!=PTR(field,8)||mount->slot>=6)return 0;
 void *fp=PTR(field,0x94);
 Actor *player=fp?CALL(0x0219a6e1,Actor*(*)(void*))(fp):0;
 if(!player||CALL(0x0219a705,unsigned(*)(void*))(fp)!=2u||
    player->zone!=mount->zone||player->world.x!=mount->player.x||
    player->world.y!=mount->player.y||player->world.z!=mount->player.z||
    !same_party(mount->game,mount->slot,&mount->pokemon,1)||
    !knows_surf(mount->game,mount->slot))return 0;
 transition.pokemon=mount->pokemon;transition.slot=mount->slot;
 transition.appearance=mount->appearance;transition.task=0;
 transition.steps=0;transition.shore=0;phase(TM_WATER);
 return 1;
}
static void short_step(void *model,unsigned direction){
 CALL(0x02166ec9,void(*)(void*,unsigned))(model,0x14u+direction);
}
static void align_shore_grid(void *model){
 /* A two-tile exit made of consecutive one-grid actions can leave the
  * player's current grid one tile behind its finished world position.
  * That grid drives collision and footprint effects on subsequent steps. */
 Actor *actor=(Actor*)model;
 if(!actor||!transition.shore||transition.steps!=2u||transition.dir>3||
    (actor->world.x&0xffff)!=0x8000||(actor->world.z&0xffff)!=0x8000)return;
 int x=actor->world.x>>16,z=actor->world.z>>16;
 int dx=x-actor->grid[0],dz=z-actor->grid[2];
 if((transition.dir==0&&dx==0&&dz==-1)||
    (transition.dir==1&&dx==0&&dz==1)||
    (transition.dir==2&&dx==-1&&dz==0)||
    (transition.dir==3&&dx==1&&dz==0)){
  actor->grid[0]=(int16_t)x;actor->grid[2]=(int16_t)z;
 }
}
static int short_done(void *model,unsigned state){
 int done=CALL(0x02166f0d,int(*)(void*))(model);
 if(done&&transition.shore&&transition.steps==1u){
  CALL(0x02166f39,void(*)(void*))(model);
  CALL(0x02166ec9,void(*)(void*,unsigned))(model,0x14u+transition.dir);
  transition.steps=2;return 0;
 }
 if(done&&state==TM_EXIT){align_shore_grid(model);phase(TM_RETURN);}
 return done;
}
__attribute__((visibility("default"))) void FollowingSurfEntryStep(void *model,unsigned code){
 if(transition.phase==TM_ENTRY){transition.steps=1;short_step(model,transition.dir);}
 else CALL(0x02166ec9,void(*)(void*,unsigned))(model,code);
}
__attribute__((visibility("default"))) int FollowingSurfEntryDone(void *model){
 return transition.phase==TM_ENTRY?short_done(model,TM_ENTRY):CALL(0x02166f0d,int(*)(void*))(model);
}
__attribute__((visibility("default"))) void FollowingSurfExitStep(void *model,unsigned code){
 if(transition.phase==TM_EXIT){transition.steps=1;short_step(model,code&3u);}
 else CALL(0x02166ec9,void(*)(void*,unsigned))(model,code);
}
__attribute__((visibility("default"))) int FollowingSurfExitDone(void *model){
 return transition.phase==TM_EXIT?short_done(model,TM_EXIT):CALL(0x02166f0d,int(*)(void*))(model);
}
