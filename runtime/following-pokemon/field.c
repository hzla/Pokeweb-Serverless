#include "native.h"
#include "effects.h"
#include "interaction.h"
#include "scene.h"
#include "core_api.h"
#include "render.h"
#ifdef FW_MOUNT
#include "land.h"
#include "transition.h"
#endif
#ifdef FW_ARCEUS_SURF
#include "surf.h"
#endif
#define API __attribute__((visibility("default")))
#define USE 1u
#define HIDDEN 4u
#define PAUSE_ANM 16u
#define NONBLOCKING (128u|256u|32768u)
#define NO_QUERY (512u|1024u)
#define KEEP_ZONE 32u
#define NOT_SAVE 1048576u
#define NO_EFFECT 2097152u
#define SHADOW_SET 16384u
#define SHADOW_VANISH 32768u
/* No retail structure owns this state. It is discarded with overlay 36. */
static FwFollower fwfield_follower;
static ActorSystem *fwfield_owner;
static Actor *fwfield_player;
static uint32_t fwfield_tick, fwfield_generation;
static uint16_t fwfield_code;
static uint8_t fwfield_flying;
#ifdef FW_MOUNT
static uint32_t fwfield_registryCrc;
static uint16_t fwfield_descriptorCount;
static uint8_t fwfield_landCarry,fwfield_landCheckAfterPause;
static uint32_t fwfield_landToggleTick;
#endif
#ifdef FW_STOCK
/* Grid followers bypass the retail movement process. Remember only the last
 * visible tile whose field effect was checked; this is not save state. */
static Actor *fwfield_terrainActor;
static void *fwfield_terrainController;
static int16_t fwfield_terrainX,fwfield_terrainZ;
static uint16_t fwfield_terrainZone;
#endif
static int fwfield_configState,fwfield_eventsReady;
/* A manual choice lives only in the field runtime; party data is untouched.
 * Keep the previous safe follower tile for the recall -> send-out sequence. */
static Vec fwfield_cyclePose;
static int16_t fwfield_cycleGrid[3];
static uint16_t fwfield_cycleFace;
static uint8_t fwfield_cyclePending;
#ifdef FW_ARCEUS_SURF
static uint32_t fwfield_surfAppearance;
#endif
static FweRestore fwfield_restore;
#define REGISTRY_MAX (32u+FW_MAX_ROWS*24u)
static uint8_t fwfield_page[FW_REGISTRY_PAGE];
static uint16_t fwfield_index[FW_MAX_SPECIES+2];
static unsigned fwfield_registrySize,fwfield_stride,fwfield_pageFirst,fwfield_pageCount;
/* FWCG v2: stage, total registry bytes, cache capacity, native read count. */
API volatile struct {uint32_t magic,version,stage,registryBytes,cacheBytes,reads;} FollowingConfigDebug={.magic=0x47435746,.version=2,.cacheBytes=FW_REGISTRY_PAGE};
/* Searchable emulator diagnostics; values never become save data. */
API volatile struct { uint32_t magic,version,ticks,spawns,deletes,reason,species,fwfield_code,actor,fwfield_player,visible,resets,system,systemFlags,field,cameraYaw,cameraPitch,depthClass,depthX,depthY,depthZ,modelSize; } FollowingDebug={.magic=0x47445746,.version=2};
API volatile struct { uint32_t magic,version,attempts,attached,actor,playerFlags,actorFlags; } FollowingShadowDebug={.magic=0x48535746,.version=1};
static void cleanup(void);
static void clear_restore(void){
 fwfield_restore.magic=0;fwfield_restore.player=(Vec){0,0,0};fwfield_restore.follower=(Vec){0,0,0};
 fwfield_restore.grid[0]=fwfield_restore.grid[1]=fwfield_restore.grid[2]=0;
 fwfield_restore.face=fwfield_restore.zone=0;
}
static void noop(Actor *a) { (void)a; }
static void removed(Actor *a) {
 if ((uintptr_t)a==fwfield_follower.actor) fwt_cancel();
#ifdef FW_MOUNT
 if ((uintptr_t)a==fwfield_follower.actor) fwland_end();
#endif
 if ((uintptr_t)a==fwfield_follower.actor) { fwfield_follower.actor=0; fwfield_follower.state=FW_ABSENT; if(!fwfield_cyclePending)fw_trail_clear(&fwfield_follower.trail); FollowingDebug.actor=0; FollowingDebug.visible=0; ++FollowingDebug.deletes; }
}
/* The actor renderer advances the imported directional animation itself.  Its
 * pause flag belongs to presentation only: never advance it while an owned
 * interaction, external safe scene or ball effect owns the follower. */
static void animation_gate(Actor *a) {
 if(fw_idle_animation_enabled(fwfield_follower.state,!(a->flags&HIDDEN),fwfx_busy()))a->flags&=~PAUSE_ANM;
 else a->flags|=PAUSE_ANM;
}
static void move(Actor *a) {
 if ((uintptr_t)a!=fwfield_follower.actor || !fwfield_player || a->system!=fwfield_owner) return;
#ifdef FW_MOUNT
 if(fwland_active()){fwland_follow_player(a,fwfield_player);a->flags&=~PAUSE_ANM;return;}
#endif
 if(fwfield_follower.state==FW_INTERACTING||fwfield_follower.state==FW_EVENT_PAUSED){a->flags|=PAUSE_ANM;return;}
 FwSample sample={.x=fwfield_player->world.x,.y=fwfield_player->world.y+fwfield_player->drawOffset.y+fwfield_player->externalOffset.y,
 .z=fwfield_player->world.z,.generation=fwfield_generation,.space=1,.rail=0,.connection=0,.direction=(uint8_t)fwfield_player->face,.kind=FW_WORLD,.duration=1}, target;
 int result=fw_trail_push(&fwfield_follower.trail,&sample,&target,fwfield_follower.side_gap);
 if(result<0) { a->flags|=HIDDEN; fwfield_follower.state=FW_WAITING; FollowingDebug.visible=0; ++FollowingDebug.resets;animation_gate(a); return; }
 if(fwfield_follower.state==FW_FOLLOWING && !fwfx_hides_actor()){a->flags&=~HIDDEN;FollowingDebug.visible=1;}
 if(result!=1){animation_gate(a);return;}
 Vec next={target.x,target.y,target.z};
 if(!fws_step_clear(a,&next)){
  if(!(a->flags&HIDDEN))fwfx_recall(a);
  a->flags|=HIDDEN;fwfield_follower.state=FW_WAITING;FollowingDebug.visible=0;
  fw_trail_clear(&fwfield_follower.trail);++FollowingDebug.resets;return;
 }
 a->world=(Vec){target.x,target.y,target.z};
 for(unsigned i=0;i<3;++i) a->previous[i]=a->grid[i];
 a->grid[0]=(int16_t)(target.x/FW_TILE); a->grid[1]=(int16_t)(target.y/FW_TILE); a->grid[2]=(int16_t)(target.z/FW_TILE);
 CALL(0x02167099,void(*)(Actor*,uint32_t))(a,target.direction);
 fwr_anchor(a,target.direction);
 a->moveflags&=~(2048u|4096u);
 if(fwfield_follower.state!=FW_FOLLOWING){
#ifdef FW_MOUNT
  /* Dismount returns through this ordinary trail-spawn path and keeps its
   * ball send-out effect. */
#endif
  fwfx_out(a);
 }
 if(!fwfx_hides_actor())a->flags&=~HIDDEN;
 fwfield_follower.state=FW_FOLLOWING; FollowingDebug.visible=!(a->flags&HIDDEN);
 /* This dispatcher belongs to a native movement context absent from our
  * synthetic stock actor. Calling it on a grid follower with flag 0x400
  * cleared dereferences a null Actor+0x94 context and freezes the game. Keep
  * stock out of this path until a grid-specific adapter is audited. */
#ifndef FW_STOCK
 if(!fwfield_flying && !(a->flags&HIDDEN) &&
    (a->previous[0]!=a->grid[0] || a->previous[2]!=a->grid[2]))
  CALL(0x02194b89,void(*)(Actor*))(a);
#endif
 animation_gate(a);
}
static const Moves fwfield_moves={0,noop,move,removed,noop};
static int owned(void) {
 Actor *a=(Actor*)fwfield_follower.actor;
 return a && fwfield_owner && a>=fwfield_owner->actors && a<fwfield_owner->actors+fwfield_owner->capacity && (a->flags&USE) && a->system==fwfield_owner && a->callbacks==&fwfield_moves;
}
static void cleanup_impl(int keepTrail) {
#ifdef FW_MOUNT
 fwland_end();fwfield_landCheckAfterPause=0;
#endif
 fwt_cancel();
 if(owned()) CALL(0x02166981,void(*)(Actor*))((Actor*)fwfield_follower.actor);
 fwfield_follower.actor=0; fwfield_player=0; fwfield_follower.state=FW_ABSENT;
 if(!keepTrail)fw_trail_clear(&fwfield_follower.trail);
#ifdef FW_STOCK
 fwfield_terrainActor=0;
#endif
 fwfield_cyclePending=0;
 FollowingDebug.actor=FollowingDebug.visible=0;
}
static void cleanup(void) {cleanup_impl(0);}
static void scene_recall(void){
#ifdef FW_MOUNT
 if(fwland_active()&&owned()){((Actor*)fwfield_follower.actor)->flags|=HIDDEN;fwland_end();}
#endif
 if(owned()&&!(((Actor*)fwfield_follower.actor)->flags&HIDDEN))fwfx_recall((Actor*)fwfield_follower.actor);
 cleanup();
}
static uint16_t read16(const uint8_t *p){return p[0]|(uint16_t)p[1]<<8;}
static int registry_read(void *file,unsigned at,void *out,unsigned n){
 if(at>fwfield_registrySize||n>fwfield_registrySize-at)return 0;
 ++FollowingConfigDebug.reads;
 return CALL(0x02070e55,int(*)(void*,int,unsigned))(file,(int)at,0)
  &&CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,out,n)==n;
}
__attribute__((noinline)) static int config(void) {
 if(fwfield_configState)return fwfield_configState>0;
 fwfield_configState=-1;fwfield_pageCount=0;FollowingConfigDebug.stage=1;
 if(FollowingCoreAPI.abi!=FWC_ABI||FollowingCoreAPI.size!=sizeof(FwcApi))return 0;
 FollowingCoreAPI.clear();FollowingConfigDebug.stage=2;
 uint32_t file[32],header[8];
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/native.bin"))return 0;
 unsigned size=CALL(0x02070ded,unsigned(*)(void*))(file);
 int ok=size==sizeof(header)&&CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,header,sizeof(header))==sizeof(header);
 CALL(0x02070de1,int(*)(void*))(file);
 if(ok)ok=header[0]==0x544e5746&&header[1]==1&&header[2]==2&&header[3]>=32&&header[3]<=REGISTRY_MAX&&header[4]<=65535&&header[5]<=65535&&header[7]==0;
 if(!ok)return 0;
#ifdef FW_MOUNT
 fwfield_registryCrc=header[6];fwfield_descriptorCount=(uint16_t)header[4];
#endif
 FollowingConfigDebug.stage=3;FollowingConfigDebug.registryBytes=header[3];
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/runtime-registry.bin"))return 0;
 fwfield_registrySize=CALL(0x02070ded,unsigned(*)(void*))(file);
 FwRegistryInput input={registry_read,file,fwfield_page,fwfield_index,FW_MAX_SPECIES+2,fwfield_registrySize,header[6],header[4],header[5],0,0};
 FollowingConfigDebug.stage=4;
 ok=fwfield_registrySize==header[3]&&FollowingCoreAPI.configureStream(&input);
 CALL(0x02070de1,int(*)(void*))(file);
 fwfield_pageCount=0;
 if(ok){fwfield_stride=input.stride;fwfield_configState=1;FollowingConfigDebug.stage=7;}
 else {FollowingCoreAPI.clear();fwfield_registrySize=fwfield_stride=0;}
 return ok;
}
/* Only called on selection/appearance changes, never during movement/drawing. */
__attribute__((noinline)) static uint16_t model(const FwPokemon *p) {
 if(fwfield_configState!=1||!p||!p->species||p->species>FW_MAX_SPECIES)return 0;
 unsigned first=fwfield_index[p->species],end=fwfield_index[p->species+1];
 fwfield_follower.side_gap=0;fwfield_follower.sprite_y=0;
 uint16_t fallback=0x3000;int best=-100,opened=0;uint32_t file[32];
 for(unsigned i=first;i<end;++i){
  if(i<fwfield_pageFirst||i-fwfield_pageFirst>=fwfield_pageCount){
   if(!opened){
    CALL(0x02070ca9,void(*)(void*))(file);
    if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/runtime-registry.bin"))goto fail;
    opened=1;if(CALL(0x02070ded,unsigned(*)(void*))(file)!=fwfield_registrySize)goto fail;
   }
   unsigned n=FW_REGISTRY_PAGE/fwfield_stride;if(n>end-i)n=end-i;
   fwfield_pageCount=0;
   if(!registry_read(file,32+i*fwfield_stride,fwfield_page,n*fwfield_stride))goto fail;
   fwfield_pageFirst=i;fwfield_pageCount=n;
  }
  const uint8_t *r=fwfield_page+(i-fwfield_pageFirst)*fwfield_stride;
  unsigned species,form,gender,shiny,row;
  if(fwfield_stride==12){
   uint32_t key=read16(r)|(uint32_t)read16(r+2)<<16;
   species=key>>11;form=(key>>3)&255;gender=(key>>1)&3;shiny=key&1;row=read16(r+4);
  }else{species=read16(r);form=r[2];gender=r[3];shiny=r[4];row=read16(r+6);}
  if(species!=p->species)goto fail;
  int score=(form==p->form?8:form==0?0:-20)+(gender==p->gender?4:gender==2?2:-20)+(shiny==p->shiny?1:-20);
  if(score>best){best=score;fallback=FW_CODE_BASE+row-FW_STOCK_ROWS;fwfield_follower.side_gap=fwfield_stride==12?(r[8]>>3)&7:r[15];fwfield_follower.sprite_y=(int8_t)(fwfield_stride==12?r[10]:r[13]);}
 }
 if(opened)CALL(0x02070de1,int(*)(void*))(file);
 return first<end?fallback:0;
fail:
 if(opened)CALL(0x02070de1,int(*)(void*))(file);
 fwfield_pageCount=0;FollowingConfigDebug.stage=8;return 0;
}
static int select(void *game,void *field,FwPokemon *out,FwrSnapshot *snapshot,int direction,int *chosenSlot) {
 void *party=CALL(0x0201735d,void*(*)(void*))(game);
 if(!party)return 0;
 unsigned count=CALL(0x0201fe25,unsigned(*)(void*))(party); if(count>6)return 0;
 FwPokemon mons[6];
 for(unsigned i=0;i<count;++i) {
  void *mon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,i);
  if(!mon)return 0;
  uint32_t(*param)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
  mons[i]=(FwPokemon){.species=param(mon,5,0),.form=param(mon,0x6f,0),.gender=param(mon,0x6e,0),.egg=param(mon,0x4c,0),.hp=param(mon,0xa0,0),.max_hp=param(mon,0xa1,0),.personality=param(mon,0,0),.trainer=param(mon,7,0),.shiny=CALL(0x0201cdd9,int(*)(void*))(mon)};
 }
 int slot=fw_select(mons,count); if(slot<0)return 0;
 if(direction){
  int current=-1;
  if(fwfield_follower.has_selection){
   int hint=fwfield_follower.slot;
   if(hint>=0 && (unsigned)hint<count && fw_same_identity(&mons[hint],&fwfield_follower.selected))current=hint;
   else for(unsigned i=0;i<count;++i)if(fw_same_identity(&mons[i],&fwfield_follower.selected)){current=(int)i;break;}
  }
  slot=fw_cycle_slot(mons,count,current,direction);
 }else if(fwfield_follower.slot>=0 && fwfield_follower.has_selection){
  int manual=-1,hint=fwfield_follower.slot;
  if((unsigned)hint<count && fw_same_identity(&mons[hint],&fwfield_follower.selected))manual=hint;
  else for(unsigned i=0;i<count;++i)if(fw_same_identity(&mons[i],&fwfield_follower.selected)){manual=(int)i;break;}
  if(manual>=0 && !mons[manual].egg && mons[manual].species && mons[manual].species<=FW_MAX_SPECIES
     && (mons[manual].hp || !mons[slot].hp)){slot=manual;fwfield_follower.slot=(int8_t)manual;}
  else fwfield_follower.slot=-1;
 }
 if(slot<0)return 0;
 *out=mons[slot];
 if(chosenSlot)*chosenSlot=slot;
 void *selectedMon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)slot);
 if(!selectedMon)return 0;
 uint32_t(*selectedParam)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 unsigned type1=selectedParam(selectedMon,0xae,0),type2=selectedParam(selectedMon,0xaf,0);
 fwfield_flying=(type1==2||type2==2);
 if(snapshot){
  *snapshot=(FwrSnapshot){.pokemon=*out};
  snapshot->friendship=(uint8_t)selectedParam(selectedMon,9,0);snapshot->status=selectedParam(selectedMon,157,0);snapshot->type1=(uint8_t)type1;snapshot->type2=(uint8_t)type2;snapshot->zone=fw_field_zone(field);
  selectedParam(selectedMon,116,snapshot->nickname);snapshot->nickname[11]=0xffff;
  const uint16_t *name=CALL(0x0201736d,const uint16_t*(*)(void*))(game);
  if(!name)return 0;
  for(unsigned i=0;i<8;++i)snapshot->playerName[i]=name[i];
  snapshot->playerName[8]=0xffff;
 }
 return 1;
}
static void cycle_follower(void *game,void *field){
#ifdef FW_MOUNT
 if(fwland_active())return;
#endif
 unsigned keys=CALL(0x0203df29,unsigned(*)(void))()&0x300u;
 if(keys!=0x100u && keys!=0x200u)return; /* Both shoulders together have no direction. */
 if(!owned() || fwfield_follower.state!=FW_FOLLOWING || !fwfield_player || fwt_active() || fwfx_busy())return;
 Actor *actor=(Actor*)fwfield_follower.actor;
 if(actor->flags&HIDDEN)return;
 fwfx_prepare(actor);
 if(!fwfx_available())return; /* A switch must have its recall and send-out effects. */
 uint8_t oldFlying=fwfield_flying;
 FwPokemon next;int slot=-1;
 if(!select(game,field,&next,0,keys==0x100u?1:-1,&slot))return;
 uint8_t oldGap=fwfield_follower.side_gap;
 int8_t oldY=fwfield_follower.sprite_y;
 uint16_t code=model(&next);
 if(!code){
  fwfield_follower.side_gap=oldGap;fwfield_follower.sprite_y=oldY;
  fwfield_flying=oldFlying;
  return;
 }
 fwfield_cyclePose=actor->world;
 for(unsigned i=0;i<3;++i)fwfield_cycleGrid[i]=actor->grid[i];
 fwfield_cycleFace=actor->face;
 fwfx_snapshot(actor);fwfx_recall(actor);
 Actor *keep=fwfield_player;
 fwfield_cyclePending=1; /* The native delete callback must retain the route. */
 cleanup_impl(1);fwfield_player=keep;
 fwfield_follower.selected=next;fwfield_follower.has_selection=1;
 fwfield_follower.slot=(int8_t)slot;fwfield_code=code;
 fwfield_cyclePending=1;
 clear_restore();
}
static void cycle_track(void){
 if(!fwfield_cyclePending||!fwfield_player)return;
 FwSample sample={.x=fwfield_player->world.x,
  .y=fwfield_player->world.y+fwfield_player->drawOffset.y+fwfield_player->externalOffset.y,
  .z=fwfield_player->world.z,.generation=fwfield_generation,.space=1,
  .direction=(uint8_t)fwfield_player->face,.kind=FW_WORLD,.duration=1},target;
 int step=fw_trail_push(&fwfield_follower.trail,&sample,&target,fwfield_follower.side_gap);
 if(step<0){fwfield_cyclePending=0;return;}
 if(step==1){
  fwfield_cyclePose=(Vec){target.x,target.y,target.z};
  fwfield_cycleGrid[0]=(int16_t)(target.x/FW_TILE);
  fwfield_cycleGrid[1]=(int16_t)(target.y/FW_TILE);
  fwfield_cycleGrid[2]=(int16_t)(target.z/FW_TILE);
  fwfield_cycleFace=target.direction;
 }
}
#ifdef FW_ARCEUS_SURF
/* Surf's native permission flow runs separately. This read only chooses art:
 * the selected follower wins when it knows Surf, otherwise party order wins.
 * Neither HP nor remaining move PP changes eligibility. */
API uint32_t FollowingSurfPartyAppearance(void *game){
 if(!game)return 0;
 void *party=CALL(0x0201735d,void*(*)(void*))(game);
 if(!party)return 0;
 unsigned count=CALL(0x0201fe25,unsigned(*)(void*))(party);
 if(count>6)return 0;
 uint32_t(*param)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 uint32_t first=0,preferred=0;
 for(unsigned i=0;i<count;++i){
  void *mon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,i);
  if(!mon)continue;
  unsigned species=param(mon,5,0);
  if(!species||species>FW_MAX_SPECIES||param(mon,0x4c,0))continue;
  unsigned knows=0;
  for(unsigned move=0;move<4;++move)if(param(mon,0x36+move,0)==57u){knows=1;break;}
  if(!knows)continue;
  unsigned form=param(mon,0x6f,0),gender=param(mon,0x6e,0);
  unsigned shiny=!!CALL(0x0201cdd9,int(*)(void*))(mon);
  if(form>255||gender>2)continue;
  uint32_t appearance=species|(form<<10)|(gender<<18)|(shiny<<26);
  if(!first)first=appearance;
  if(fwfield_follower.has_selection){
   const FwPokemon *selected=&fwfield_follower.selected;
   if(species==selected->species && form==selected->form && gender==selected->gender
      && shiny==selected->shiny && param(mon,0,0)==selected->personality
      && param(mon,7,0)==selected->trainer){
    if(fwfield_follower.slot==(int)i)return appearance;
    if(!preferred)preferred=appearance;
   }
  }
 }
 return preferred?preferred:first;
}
#endif
static void before(ActorSystem *sys) {
 fwt_poll_input();
 ++fwfield_tick; FollowingDebug.ticks=fwfield_tick;
#ifdef FW_MOUNT
 fwland_tick(fwfield_tick);
#endif
 if(fwfield_owner!=sys) {
#ifdef FW_MOUNT
  unsigned carry=fwland_active();
#endif
  FwPokemon manual=fwfield_follower.selected;
  int manualSlot=fwfield_follower.slot;
  int keepManual=fwfield_owner&&fwfield_follower.has_selection&&manualSlot>=0;
  fws_detach();cleanup();fwt_unload();fwfx_destroy();fwfield_owner=sys;
  fw_init(&fwfield_follower,++fwfield_generation);
  if(keepManual){fwfield_follower.selected=manual;fwfield_follower.slot=(int8_t)manualSlot;fwfield_follower.has_selection=1;}
  fwfield_eventsReady=fws_attach(sys,&fwfield_follower,fwfield_generation,scene_recall);
  clear_restore();if(fwfield_eventsReady)fws_take_restore(&fwfield_restore);
#ifdef FW_MOUNT
  if(fwfield_eventsReady){
   FweMount mount;
   if(FollowingEventsAPI.consumeMount(PTR(sys->field,8),&mount)&&
      fwtm_menu_restore(sys->field,&mount)){
    fwfield_follower.selected=mount.pokemon;
    fwfield_follower.slot=(int8_t)mount.slot;
    fwfield_follower.has_selection=1;
   }
  }
  fwfield_landCarry=(uint8_t)(carry&&fwfield_restore.magic==FWE_RESTORE_MAGIC);
#endif
 }
 void *field=sys->field;
 if(fwt_active()&&!fwt_owns(field))fwt_cancel();
 int ownTalk=fwt_field_owns(field);
 unsigned eventState=fws_poll();
 if(eventState==FWS_INVALID)fwfield_eventsReady=0;
 int paused=eventState==FWS_PAUSED;
 FollowingDebug.system=(uint32_t)sys; FollowingDebug.systemFlags=sys->flags; FollowingDebug.field=(uint32_t)field;
 uint32_t reason=0;
 if(!config())reason|=1;
 if(!fwfield_eventsReady)reason|=1024;
 if(eventState==FWS_RECALLED)reason|=2048;
 if(!field || (sys->flags&17)!=17 || (sys->flags&6))reason|=2;
 if(!reason) {
  void *fp=PTR(field,0x94),*game=PTR(field,8);
  fwfield_player=fp?CALL(0x0219a6e1,Actor*(*)(void*))(fp):0;
  fws_set_player(fwfield_player);
  if(!fwfield_player || !(fwfield_player->flags&USE) || (fwfield_player->flags&HIDDEN) || ((fwfield_player->moveflags&8)&&!ownTalk&&!paused))reason|=4;
  if(fp && CALL(0x0219a705,unsigned(*)(void*))(fp)!=0)reason|=8;
  if((CALL(0x0218130d,int(*)(void*))(field)&&!ownTalk&&!paused) || (U32(field,0x148)&&!fws_pc_fade()))reason|=16;
  if(CALL(0x0216a2b5,int(*)(void*))(game))reason|=32;
#ifdef FW_MOUNT
  if(paused&&fwland_active())fwfield_landCheckAfterPause=1;
  if(!reason&&!paused&&fwland_active()&&(fwfield_landCheckAfterPause||fwfield_tick%30==0)){
   fwfield_landCheckAfterPause=0;fwland_validate();
  }
#endif
  if(!reason &&
#ifdef FW_MOUNT
      !fwland_invalid() &&
#endif
      !ownTalk && (!paused||fwfield_restore.magic==FWE_RESTORE_MAGIC) && (!fwfield_follower.actor || fwfield_tick%30==0 || (eventState&FWS_REFRESH))) {
   FwPokemon selected;
   if(!select(game,field,&selected,0,0,0))reason|=64;
   else if(!fwfield_follower.has_selection || !fw_same_identity(&selected,&fwfield_follower.selected)) {
    uint16_t code=model(&selected);
    if(!code){reason|=1;fwfield_configState=-1;FollowingCoreAPI.clear();}
    else {Actor *keep=fwfield_player; cleanup(); fwfield_player=keep; fwfield_follower.selected=selected; fwfield_follower.has_selection=1; fwfield_code=code;}
   }
  }
  if(!reason&&!ownTalk&&!paused&&!fwt_active())cycle_follower(game,field);
 }
 FollowingDebug.reason=reason;
 if(reason){if(fwfield_eventsReady)FollowingEventsAPI.discard();clear_restore();fwt_cancel();
#ifdef FW_MOUNT
  if(fwland_active()){((Actor*)fwfield_follower.actor)->flags|=HIDDEN;fwland_end();}
  fwfield_landCarry=0;
#endif
  if(owned() && !( ((Actor*)fwfield_follower.actor)->flags&HIDDEN) && (reason&(8|16|32)))fwfx_recall((Actor*)fwfield_follower.actor);else if(fwfield_follower.actor)fwfx_cancel();cleanup();return;}
#ifdef FW_MOUNT
 if(fwland_invalid()&&owned()){
  Actor *a=(Actor*)fwfield_follower.actor;
  fwland_end();a->flags|=HIDDEN;a->moveflags&=~SHADOW_VANISH;
  fw_trail_clear(&fwfield_follower.trail);fwfield_follower.state=FW_WAITING;
  FollowingDebug.visible=0;
 }
#endif
 FollowingDebug.fwfield_player=(uint32_t)fwfield_player; FollowingDebug.species=fwfield_follower.selected.species; FollowingDebug.fwfield_code=fwfield_code;
 if(fwfield_follower.actor && !owned()){fwfield_follower.actor=0;fw_trail_clear(&fwfield_follower.trail);}
 if(paused&&fwfield_restore.magic!=FWE_RESTORE_MAGIC)return;
 /* Only a matching storage return may reconstruct during a paused event. */
 if(fwfield_restore.magic==FWE_RESTORE_MAGIC&&(!fw_same_identity(&fwfield_restore.selected,&fwfield_follower.selected)
    ||fwfield_restore.zone!=fwfield_player->zone||fwfield_restore.player.x!=fwfield_player->world.x
    ||fwfield_restore.player.y!=fwfield_player->world.y||fwfield_restore.player.z!=fwfield_player->world.z))clear_restore();
 if(paused&&fwfield_restore.magic!=FWE_RESTORE_MAGIC)return;
 #ifdef FW_MOUNT
 if(fwtm_return_pending()&&owned()){
  Actor *a=(Actor*)fwfield_follower.actor;
  int ready=fwtm_return_ready(PTR(field,8),&fwfield_follower.selected);
  fwsurf_destroy();
  if(ready){
   a->flags&=~HIDDEN;fwfield_follower.state=FW_FOLLOWING;
   if(fwland_begin(sys,a,fwfield_player,field,fwfield_code,
      fwfield_registryCrc,fwfield_descriptorCount,&fwfield_follower.selected,fwfield_follower.slot)){
    fw_trail_clear(&fwfield_follower.trail);fwland_follow_player(a,fwfield_player);
    FollowingDebug.visible=1;
   }else{a->flags|=HIDDEN;fwfield_follower.state=FW_WAITING;FollowingDebug.visible=0;}
  }
  fwtm_return_done();
  return;
 }
 #endif
 if(!fwfield_follower.actor) {
  if(fwfx_busy()){cycle_track();return;}
  /* Native allocation asserts on a full pool. Check capacity and leave room. */
  unsigned free=0; for(unsigned i=0;i<sys->capacity;++i)if(!(sys->actors[i].flags&USE))++free;
  if(free<2){FollowingDebug.reason=128;return;}
  unsigned id;
  for(id=0xf0;id<=0xf8;++id) { unsigned i; for(i=0;i<sys->capacity;++i)if((sys->actors[i].flags&USE) && sys->actors[i].id==id)break; if(i==sys->capacity)break; }
  if(id>0xf8){FollowingDebug.reason=256;return;}
  if(CALL(0x0203a2d5,uint32_t(*)(uint32_t))(sys->resourceHeap)<32768){FollowingDebug.reason=512;return;}
  Actor *a=CALL(0x021668c1,Actor*(*)(ActorSystem*,int,int,unsigned,unsigned,unsigned,unsigned,unsigned))(sys,fwfield_player->grid[0],fwfield_player->grid[2],fwfield_player->face,id,fwfield_code,0,fwfield_player->zone);
  if(!a)return;
  a->flags|=HIDDEN|NONBLOCKING|NO_QUERY|KEEP_ZONE; a->moveflags|=NOT_SAVE|NO_EFFECT; a->moveflags&=~(8u|2048u|4096u);
  a->callbacks=&fwfield_moves; a->world=fwfield_player->world;
  fwr_anchor(a,fwfield_player->face);
  fwfield_follower.actor=(uintptr_t)a; fwfield_follower.state=FW_WAITING;
#ifdef FW_MOUNT
  if(fwtm_return_pending()){
   int ready=fwtm_return_ready(PTR(field,8),&fwfield_follower.selected);
   fwsurf_destroy();
   if(ready){
    a->flags&=~HIDDEN;fwfield_follower.state=FW_FOLLOWING;
    if(fwland_begin(sys,a,fwfield_player,field,fwfield_code,
       fwfield_registryCrc,fwfield_descriptorCount,&fwfield_follower.selected,fwfield_follower.slot)){
     fw_trail_clear(&fwfield_follower.trail);fwland_follow_player(a,fwfield_player);
     FollowingDebug.visible=1;
    }else{a->flags|=HIDDEN;fwfield_follower.state=FW_WAITING;}
   }
   fwtm_return_done();
  }else
#endif
  if(fwfield_cyclePending){
   fwfield_cyclePending=0;
   if(fws_step_clear(a,&fwfield_cyclePose)){
    a->world=fwfield_cyclePose;
    for(unsigned i=0;i<3;++i)a->grid[i]=a->previous[i]=fwfield_cycleGrid[i];
    CALL(0x02167099,void(*)(Actor*,uint32_t))(a,fwfield_cycleFace);
    fwr_anchor(a,fwfield_cycleFace);
    fwfx_out(a);
    if(!fwfx_hides_actor())a->flags&=~HIDDEN;
    fwfield_follower.state=FW_FOLLOWING;FollowingDebug.visible=!(a->flags&HIDDEN);
   }
  }else if(fwfield_restore.magic==FWE_RESTORE_MAGIC&&fwfield_restore.zone==fwfield_player->zone
     &&fwfield_restore.player.x==fwfield_player->world.x&&fwfield_restore.player.y==fwfield_player->world.y&&fwfield_restore.player.z==fwfield_player->world.z){
   a->world=fwfield_restore.follower;
   for(unsigned i=0;i<3;++i)a->grid[i]=a->previous[i]=fwfield_restore.grid[i];
   CALL(0x02167099,void(*)(Actor*,uint32_t))(a,fwfield_restore.face);
   fwr_anchor(a,fwfield_restore.face);
   a->flags&=~HIDDEN;fwfield_follower.state=FW_FOLLOWING;FollowingDebug.visible=1;fws_restored();
#ifdef FW_MOUNT
   if(fwfield_landCarry){
    if(fwland_begin(sys,a,fwfield_player,field,fwfield_code,fwfield_registryCrc,fwfield_descriptorCount,&fwfield_follower.selected,fwfield_follower.slot)){
     fw_trail_clear(&fwfield_follower.trail);fwland_follow_player(a,fwfield_player);
    }
    fwfield_landCarry=0;
   }
#endif
  }
  clear_restore();
  FollowingDebug.actor=(uint32_t)a; ++FollowingDebug.spawns;
 }
}
#ifdef FW_STOCK
static void terrain_update(void) {
 if(fwland_active())return;
 if(!owned()) {fwfield_terrainActor=0;return;}
 Actor *a=(Actor*)fwfield_follower.actor;
 if((a->flags&HIDDEN)||fwfield_flying){fwfield_terrainActor=0;return;}
 /* This controller lookup is the same one used by the native grass entry
  * path. The grid-tile attribute query is separate from the rail movement
  * dispatcher, which dereferences our actor's absent +0x94 context. */
 void *controller=CALL(0x02194f19,void*(*)(Actor*))(a);
 if(!controller)return;
 if(a==fwfield_terrainActor && controller==fwfield_terrainController &&
    a->grid[0]==fwfield_terrainX && a->grid[2]==fwfield_terrainZ &&
    a->zone==fwfield_terrainZone)return;
 Vec center={(int32_t)a->grid[0]*FW_TILE+FW_TILE/2,a->world.y,
             (int32_t)a->grid[2]*FW_TILE+FW_TILE/2};
 uint32_t attr=0;
 if(!CALL(0x0215e8e5,int(*)(Actor*,const Vec*,uint32_t*))(a,&center,&attr))return;
 fwfield_terrainActor=a;fwfield_terrainController=controller;
 fwfield_terrainX=a->grid[0];fwfield_terrainZ=a->grid[2];
 fwfield_terrainZone=a->zone;
 /* The native grass entry helper owns the effect task, tile height, season
  * resources and actor-lifetime checks. It is safe for a grid actor and uses
  * no movement-context pointer. Only its grass path is enabled here. */
 if((attr>>16)&0x20u)
  CALL(0x02194d8d,void(*)(Actor*,uint32_t))(a,attr);
}
#endif
API void FollowingUpdate(ActorSystem *sys) {
 fwfx_tick();before(sys);
#ifdef FW_ARCEUS_SURF
 unsigned surfing=0;
 if(fwfield_configState==1&&sys&&sys->field){
  void *field=sys->field,*fp=PTR(field,0x94);
  surfing=fp&&CALL(0x0219a705,unsigned(*)(void*))(fp)==2;
  /* Arm both entry draw hooks while still on land; refresh party edits on
   * every field update, including the first update after Surf starts. */
  fwfield_surfAppearance=
#ifdef FW_MOUNT
   fwtm_appearance(PTR(field,8));
  if(!fwfield_surfAppearance)fwfield_surfAppearance=
#endif
   FollowingSurfPartyAppearance(PTR(field,8));
 }
 else fwfield_surfAppearance=0;
 fwsurf_update(sys,fwfield_surfAppearance,surfing
#ifdef FW_MOUNT
  ||fwtm_exiting()
#endif
  ,fwfield_tick);
#endif
 CALL(0x021667b9,void(*)(ActorSystem*))(sys);
#ifdef FW_MOUNT
 if(fwland_active()&&owned()&&fwfield_player)fwland_follow_player((Actor*)fwfield_follower.actor,fwfield_player);
#endif
#ifdef FW_STOCK
 terrain_update();
#endif
 if(owned()){
  Actor *a=(Actor*)fwfield_follower.actor;
  /* This actor's route callback writes coordinates directly, so the retail
   * move-start attribute pass never registers its shadow. The audited native
   * shadow helper owns the effect task, billboard, visibility and teardown. */
  if(
#ifdef FW_MOUNT
     !fwland_active() &&
#endif
     !(a->flags&HIDDEN) && fwfield_player && (fwfield_player->moveflags&SHADOW_SET) &&
     !(fwfield_player->moveflags&SHADOW_VANISH) && !(a->moveflags&SHADOW_SET)){
   FollowingShadowDebug.actor=(uint32_t)a;
   FollowingShadowDebug.playerFlags=fwfield_player->moveflags;
   FollowingShadowDebug.actorFlags=a->moveflags;
   ++FollowingShadowDebug.attempts;
   CALL(0x02194df5,void(*)(Actor*))(a);
   FollowingShadowDebug.attached=!!(a->moveflags&SHADOW_SET);
  }
  fwfx_prepare(a);fwfx_snapshot(a);
 }
}
API void FollowingDraw(void *system,void *camera,void *light){
#ifdef FW_MOUNT
 if(fwland_active()){
  fwland_draw(system,camera,light,owned()?(Actor*)fwfield_follower.actor:0,fwfield_player,fwfield_follower.sprite_y,fwfield_tick);
  return;
 }
#endif
#ifdef FW_ARCEUS_SURF
 fwsurf_draw_scene(system,camera,light,owned()?(Actor*)fwfield_follower.actor:0,fwfield_player,fwfield_follower.sprite_y);
#else
 fwr_draw(system,camera,light,owned()?(Actor*)fwfield_follower.actor:0,fwfield_player,fwfield_follower.sprite_y);
#endif
}
API void FollowingEffectsDraw(void *system,void *camera,void *light){
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);fwfx_draw(camera,light);
}
extern int FollowingOriginalUnload(void*,void*);
API int FollowingUnload(void *game,void *field) {
#ifdef FW_MOUNT
 FweMount mount;
 if(fwfield_eventsReady&&fws_menu_active()&&fwtm_menu_snapshot(field,&mount))
  FollowingEventsAPI.preserveMount(field,fwfield_generation,&mount);
 else FollowingEventsAPI.discardMount();
#endif
 fws_detach();fwfield_eventsReady=0;cleanup();fwt_unload();fwfx_destroy();FollowingCoreAPI.clear();
#ifdef FW_MOUNT
 fwfield_landCarry=0;
 fwtm_cancel();
#endif
#ifdef FW_ARCEUS_SURF
 fwsurf_destroy();fwfield_surfAppearance=0;
#endif
fwfield_pageCount=fwfield_stride=0;
 fwfield_owner=0;fwfield_configState=0;fwfield_registrySize=0;return FollowingOriginalUnload(game,field); }

/* Original event providers retain first refusal for every retail event. */
static void *try_talk(void *game,void *field){
#ifdef FW_MOUNT
 if(fwland_active())return 0;
#endif
 if(!owned()||fwfield_owner->field!=field||fwt_active()||!fwfield_player||fwfield_follower.state!=FW_FOLLOWING||FollowingDebug.reason)return 0;
 if(!(CALL(0x0203df29,unsigned(*)(void))()&1)||U32(field,0x148))return 0;
 void *fp=PTR(field,0x94);if(!fp)return 0;
 unsigned state=CALL(0x0219a6f9,unsigned(*)(void*))(fp);if(state!=0&&state!=3)return 0;
 if(CALL(0x0219a705,unsigned(*)(void*))(fp)!=0)return 0;
 FwPokemon selected;FwrSnapshot snapshot;
 if(!select(PTR(field,8),field,&selected,&snapshot,0,0)||!fw_same_identity(&selected,&fwfield_follower.selected))return 0;
 snapshot.direction=(uint8_t)(fwfield_player->face^1u);
 return fwt_begin(&fwfield_follower,fwfield_player,(Actor*)fwfield_follower.actor,field,game,&snapshot);
}
#ifdef FW_MOUNT
static int land_toggle(void *field){
 unsigned pressed=CALL(0x0203df29,unsigned(*)(void))();
 unsigned held=CALL(0x0203df4d,unsigned(*)(void))();
 int chord=(held&3u)==3u && (pressed&3u)!=0;
 if(chord && fwfield_landToggleTick && fwfield_landToggleTick==fwfield_tick)return 1;
 if(chord && owned() && fwfield_owner->field==field && fwfield_player &&
    fwfield_follower.state==FW_FOLLOWING && !FollowingDebug.reason && !fwt_active() && !fwfx_busy() &&
    !U32(field,0x148) && !(held&0xf0u)){
  void *fp=PTR(field,0x94);
  if(fp && CALL(0x0219a6f9,unsigned(*)(void*))(fp)==0 && CALL(0x0219a705,unsigned(*)(void*))(fp)==0){
   Actor *a=(Actor*)fwfield_follower.actor;
   fwfield_landCheckAfterPause=0;
   if(fwland_active()){
    fwland_end();a->flags|=HIDDEN;a->moveflags&=~SHADOW_VANISH;
    fw_trail_clear(&fwfield_follower.trail);fwfield_follower.state=FW_WAITING;
    FollowingDebug.visible=0;
   }else if(!(a->flags&HIDDEN) && fwland_begin(fwfield_owner,a,fwfield_player,field,fwfield_code,
      fwfield_registryCrc,fwfield_descriptorCount,&fwfield_follower.selected,fwfield_follower.slot)){
   fw_trail_clear(&fwfield_follower.trail);
   fwland_follow_player(a,fwfield_player);
    CALL(0x02006255,void(*)(unsigned))(1374u);
   }
   fwfield_landToggleTick=fwfield_tick;
   return 1; /* Consume this A press before the retail event provider. */
  }
 }
 return 0;
}
static void *try_water(void *game,void *field){
 if(!fwland_active()||!owned()||!fwfield_owner||fwfield_owner->field!=field||
    fwfield_follower.state!=FW_FOLLOWING||!fwfield_player||fwt_active()||fwfx_busy()||
    FollowingDebug.reason||U32(field,0x148))return 0;
 unsigned dir,attribute;
 if(!fwland_validate())return 0;
 int slot=fwland_slot();
 if(slot<0||!fwtm_eligible(PTR(field,8),field,&fwfield_follower.selected,
     slot,&dir,&attribute))return 0;
 Actor *a=(Actor*)fwfield_follower.actor;
 unsigned appearance=fwfield_follower.selected.species|
  ((unsigned)fwfield_follower.selected.form<<10)|
  ((unsigned)fwfield_follower.selected.gender<<18)|
  ((unsigned)fwfield_follower.selected.shiny<<26);
 /* Keep the land rider's texture allocations live while the Surf materials
  * load: GPU commands queued earlier in this frame can still use them. */
 if(!fwsurf_prepare(fwfield_owner,appearance,fwfield_tick))return 0;
 void *event=fwtm_enter(game,field,&fwfield_follower.selected,
  slot,appearance,dir,attribute);
 if(!event){fwsurf_destroy();return 0;}
 fwland_handoff(fwfield_tick);
 a->flags|=HIDDEN;fwfield_follower.state=FW_WAITING;
 fw_trail_clear(&fwfield_follower.trail);FollowingDebug.visible=0;
 return event;
}
#endif
API void *FollowingGridEvents(void *game,void *field,int *deleteEffect,int *menu){
#ifdef FW_MOUNT
 if(land_toggle(field)){if(deleteEffect)*deleteEffect=0;return 0;}
#endif
 void *event=CALL(0x0218151d,void*(*)(void*,void*,int*,int*))(game,field,deleteEffect,menu);
#ifdef FW_MOUNT
 if(event)fwtm_observe_exit(event,game,field);
 if(!event){event=try_water(game,field);if(event&&deleteEffect)*deleteEffect=1;}
#endif
 if(event&&menu&&*menu)fws_mark_menu(event);
 if(!event){event=try_talk(game,field);if(event)*deleteEffect=1;}return event;
}
API void *FollowingRailEvents(void *game,void *field){
#ifdef FW_MOUNT
 if(land_toggle(field))return 0;
#endif
 void *event=CALL(0x02181aa1,void*(*)(void*,void*))(game,field);
 return event?event:try_talk(game,field);
}
