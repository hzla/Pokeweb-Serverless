#include "land.h"
#include "render.h"
#include "render_math.h"
#include "land_speed.h"
#include <limits.h>

/* Only the selected appearance's eight ROM bytes and twelve rider materials are
 * resident. The mount itself reuses the existing follower billboard. */
typedef struct { uint16_t geom,pad; Vec pos; uint16_t frame; int16_t sx,sy; uint16_t rotation,flags,pad2; } LandBillboard;
typedef struct { void *resource; uint16_t width,height; uint8_t fw,fh,cols,rows; uint32_t tex,pltt,format,dx,dy,texKey,plttKey; } LandMaterial;
typedef struct { uint16_t heap,pad; LandMaterial *materials; LandBillboard *actors; uint16_t materialCount,actorCount; Vec scale; uint16_t diffuse,ambient,specular,emissive; uint8_t polygon,origin; uint16_t pad2; uint8_t rest[20]; } LandScene;
_Static_assert(sizeof(LandBillboard)==28,"land billboard ABI");
_Static_assert(sizeof(LandMaterial)==40,"land material ABI");
_Static_assert(sizeof(LandScene)==60,"land scene ABI");
static struct {
 ActorSystem *owner;
 Actor *follower,*player;
 FwPokemon selected;
 int slot;
 void *resources[12];
 LandMaterial materials[12];
 LandBillboard rider;
 LandScene scene;
 int8_t anchors[8];
 int32_t error;
 uint8_t sex,active,invalid,baseSpeed;
 uint32_t runStartTick;
 uint16_t runBaseFrame;
 uint8_t runStartPose,runAnimating,hasDrawWorld;
 Vec drawWorld;
 uint32_t releaseTick;
 uint8_t releasePending;
} land;
__attribute__((visibility("default"))) volatile struct {
 uint32_t magic,version,active,starts,stops,draws,steps,speed,frames,reason;
} FollowingLandDebug={.magic=0x444c5746,.version=1};
static unsigned rd16(const uint8_t *p){return p[0]|(unsigned)p[1]<<8;}
static uint32_t rd32(const uint8_t *p){return rd16(p)|(uint32_t)rd16(p+2)<<16;}
static int same_party_mon(void *mon,const FwPokemon *selected){
 if(!mon||!selected)return 0;
 uint32_t(*param)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 return param(mon,5,0)==selected->species && param(mon,0,0)==selected->personality &&
  param(mon,7,0)==selected->trainer && param(mon,0x6f,0)==selected->form &&
  param(mon,0x6e,0)==selected->gender &&
  !!CALL(0x0201cdd9,int(*)(void*))(mon)==selected->shiny &&
  !param(mon,0x4c,0) && param(mon,0xa0,0);
}
int fwland_active(void){return land.active!=0;}
int fwland_invalid(void){return land.invalid!=0;}
int fwland_slot(void){return land.active&&!land.invalid?land.slot:-1;}
int fwland_validate(void){
 if(!land.active||!land.owner||!land.owner->field||land.slot<0)return 0;
 void *game=PTR(land.owner->field,8),*party=game?CALL(0x0201735d,void*(*)(void*))(game):0;
 unsigned count=party?CALL(0x0201fe25,unsigned(*)(void*))(party):0;
 void *mon=count<=6 && (unsigned)land.slot<count?CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)land.slot):0;
 if(same_party_mon(mon,&land.selected))return 1;
 land.invalid=1;FollowingLandDebug.reason=4;return 0;
}
static void release_resources(void){
 for(unsigned i=0;i<12;++i)if(land.resources[i]){
  CALL(0x02049561,int(*)(void*))(land.resources[i]);
  CALL(0x02049431,void(*)(void*))(land.resources[i]);
  land.resources[i]=0;land.materials[i]=(LandMaterial){0};
 }
 land.releasePending=0;
}
static void deactivate(void){
 if(land.active)++FollowingLandDebug.stops;
 land.active=0;land.invalid=0;land.owner=0;land.follower=land.player=0;land.error=0;
 land.runAnimating=land.hasDrawWorld=0;
 FollowingLandDebug.active=0;
}
void fwland_end(void){release_resources();deactivate();}
void fwland_handoff(unsigned tick){
 if(!land.active)return;
 deactivate();
 /* The native event can allocate effects during this same field frame. Do
  * not let them recycle texture keys still referenced by queued land draws. */
 land.releaseTick=tick;land.releasePending=1;
}
void fwland_tick(unsigned tick){
 if(land.releasePending && tick-land.releaseTick>=2u)release_resources();
}
static int anchors(uint16_t code,uint32_t registryCrc,uint16_t descriptorCount,int8_t *out){
 if(descriptorCount<FW_STOCK_ROWS || code<FW_CODE_BASE ||
    (unsigned)(code-FW_CODE_BASE)>=descriptorCount-FW_STOCK_ROWS)return 0;
 uint32_t file[32];uint8_t header[16],record[8];
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/land-anchors.bin"))return 0;
 unsigned count=descriptorCount-FW_STOCK_ROWS;
 int ok=CALL(0x02070ded,unsigned(*)(void*))(file)==16+count*8 &&
  CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,header,16)==16 &&
  rd32(header)==0x4d4c5746 && rd16(header+4)==1 && rd16(header+6)==count &&
  rd32(header+8)==registryCrc;
 if(ok)ok=CALL(0x02070e55,int(*)(void*,int,unsigned))(file,16+(code-FW_CODE_BASE)*8,0) &&
  CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,record,8)==8;
 CALL(0x02070de1,int(*)(void*))(file);
 if(ok)for(unsigned i=0;i<8;++i)out[i]=(int8_t)record[i];
 return ok;
}
int fwland_begin(ActorSystem *owner,Actor *follower,Actor *player,void *field,
 uint16_t code,uint32_t registryCrc,uint16_t descriptorCount,const FwPokemon *selected,int slot){
 if(land.releasePending)release_resources();
 if(land.active||!owner||!follower||!player||!field||!selected||selected->egg||!selected->hp||
    (follower->flags&4u)||owner->field!=field)return 0;
 void *game=PTR(field,8),*party=game?CALL(0x0201735d,void*(*)(void*))(game):0;
 unsigned count=party?CALL(0x0201fe25,unsigned(*)(void*))(party):0;
 if(!count||count>6)return 0;
 if(slot<0||(unsigned)slot>=count){slot=-1;}
 if(slot>=0){
  void *mon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)slot);
  if(!same_party_mon(mon,selected))slot=-1;
 }
 if(slot<0)for(unsigned i=0;i<count;++i){
  void *mon=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,i);
  if(same_party_mon(mon,selected)){slot=(int)i;break;}
 }
 if(slot<0)return 0;
 void *fp=PTR(field,0x94);
 unsigned sex=fp?CALL(0x0219a71d,unsigned(*)(void*))(fp):2u;
 if(sex>1u || CALL(0x0203a2d5,uint32_t(*)(uint32_t))(owner->resourceHeap)<32768u){FollowingLandDebug.reason=1;return 0;}
 int8_t positions[8];
 if(!anchors(code,registryCrc,descriptorCount,positions)){FollowingLandDebug.reason=2;return 0;}
 land.owner=owner;land.follower=follower;land.player=player;land.selected=*selected;land.slot=slot;
 land.sex=(uint8_t)sex;
 /* The form-aware Personal record supplies the species' base Speed. A
  * calculated party Speed changes with level, nature and stat modifiers and
  * must not affect the mount's pace. Identity/form changes end the mount. */
 unsigned baseSpeed=CALL(0x0201ef49,unsigned(*)(unsigned,unsigned,unsigned))
  (selected->species,selected->form,3u);
 land.baseSpeed=(uint8_t)(baseSpeed>255u?255u:baseSpeed);
 for(unsigned i=0;i<8;++i)land.anchors[i]=positions[i];
 for(unsigned i=0;i<12;++i){
  land.resources[i]=CALL(0x020493f1,void*(*)(const char*,unsigned))("rom:/following/land-riders.narc",land.sex*12u+i);
  if(!land.resources[i])goto fail;
  CALL(0x0204e599,void(*)(void*,unsigned,unsigned,unsigned,unsigned))(&land.materials[i],0,0x22u,32,32);
  if(land.materials[i].cols!=1||land.materials[i].rows!=1)goto fail;
  CALL(0x0204e55d,void(*)(void*,void*))(&land.materials[i],land.resources[i]);
  if(!land.materials[i].texKey||!land.materials[i].plttKey)goto fail;
 }
 land.active=1;land.invalid=0;land.error=0;land.runAnimating=land.hasDrawWorld=0;
 ++FollowingLandDebug.starts;FollowingLandDebug.active=1;FollowingLandDebug.reason=0;
 return 1;
fail:
 FollowingLandDebug.reason=3;fwland_end();return 0;
}
void fwland_follow_player(Actor *follower,Actor *player){
 if(!land.active||follower!=land.follower||player!=land.player)return;
 follower->world=player->world;
 for(unsigned i=0;i<3;++i)follower->grid[i]=follower->previous[i]=player->grid[i];
 follower->zone=player->zone;
 if(follower->face!=player->face)CALL(0x02167099,void(*)(Actor*,uint32_t))(follower,player->face);
 follower->moveflags|=32768u; /* Suppress only the follower's attached shadow. */
}
/* Hook only the audited ordinary flat-grid walk command. Height, slope,
 * rail and script commands never pass through this callsite. */
__attribute__((visibility("default"))) void FollowingLandStep(void *model,unsigned code){
 unsigned base=code&~3u;
 if(land.active && model && (base==0x0cu||base==0x58u||base==0x10u) && land.owner && land.owner->field){
  void *game=PTR(land.owner->field,8),*party=game?CALL(0x0201735d,void*(*)(void*))(game):0;
  unsigned count=party?CALL(0x0201fe25,unsigned(*)(void*))(party):0;
  void *mon=(land.slot>=0 && (unsigned)land.slot<count)?CALL(0x0201ff35,void*(*)(void*,unsigned))(party,(unsigned)land.slot):0;
  if(mon){
   if(same_party_mon(mon,&land.selected)){
    code=fwl_step_code(land.baseSpeed,code,&land.error);
    ++FollowingLandDebug.steps;FollowingLandDebug.speed=land.baseSpeed;FollowingLandDebug.frames=fwl_step_frames(code);
   }else {land.invalid=1;FollowingLandDebug.reason=4;}
  }else {land.invalid=1;FollowingLandDebug.reason=4;}
 }
 CALL(0x02166ec9,void(*)(void*,unsigned))(model,code);
}
static LandBillboard *billboard(void *system,Actor *actor){
 if(!actor||!actor->system||!(actor->flags&1u)||(actor->flags&4u))return 0;
 void *context=PTR(actor->system,0x28);if(!context||PTR(context,4)!=system)return 0;
 LandScene *scene=PTR(system,4);void *slots=PTR(system,0x18);
 unsigned id=*(uint16_t*)actor->drawWork;
 if(!scene||!slots||id>=*(uint16_t*)((uint8_t*)system+0x1c))return 0;
 unsigned index=U32(slots,id*40);
 if(index>=scene->actorCount||!scene->actors)return 0;
 LandBillboard *b=scene->actors+index;
 return (b->geom>>14)==0&&(b->flags&512u)?b:0;
}
static void draw_rider(void *system,void *camera,void *light,LandBillboard *mount,LandBillboard *player,unsigned face,unsigned pose){
 LandScene *native=PTR(system,4);if(!native)return;
 land.rider=*player;
 land.rider.geom=(land.rider.geom&0xc000u)|(face*3u+pose);
 land.rider.frame=0;land.rider.flags&=~0xf000u;land.rider.flags|=512u;
 land.rider.sx=land.rider.sy=32*256;
 land.rider.pos=mount->pos;
 int x=land.anchors[face*2],y=land.anchors[face*2+1];
 FwPoint eye=*(FwPoint*)((uint8_t*)camera+32),target=*(FwPoint*)((uint8_t*)camera+56);
 int32_t dx=eye.x-target.x,dz=eye.z-target.z;
 int32_t adx=dx<0?-dx:dx,adz=dz<0?-dz:dz;
 if(adz>=adx){land.rider.pos.x+=(dz<0?-x:x)*4096;}
 else land.rider.pos.z+=(dx<0?x:-x)*4096;
 land.rider.pos.y-=y*4096;
 FwrCamera view={eye,target,U32(camera,0)};
 FwrPose original={{land.rider.pos.x,land.rider.pos.y,land.rider.pos.z},land.rider.sx,land.rider.sy},adjusted;
 FwrResult result;
 FwPoint world={land.player->world.x,land.player->world.y,land.player->world.z};
 FwPoint mountPos={mount->pos.x,mount->pos.y,mount->pos.z};
 if(fwr_correct(&world,&world,&original,&mountPos,&view,face==1?FWR_FORCE_BACK:FWR_FORCE_FRONT,&adjusted,&result)){
  land.rider.pos=(Vec){adjusted.position.x,adjusted.position.y,adjusted.position.z};
  land.rider.sx=(int16_t)adjusted.sx;land.rider.sy=(int16_t)adjusted.sy;
 }
 land.scene=*native;land.scene.actors=&land.rider;land.scene.materials=land.materials;
 land.scene.actorCount=1;land.scene.materialCount=12;
 land.scene.diffuse=land.scene.ambient=0x7fff;land.scene.specular=land.scene.emissive=0;
 CALL(0x0204ebdd,void(*)(void*,void*,void*))(&land.scene,camera,light);
 ++FollowingLandDebug.draws;
}
void fwland_draw(void *system,void *camera,void *light,Actor *follower,Actor *player,int spriteY,uint32_t tick){
 if(!land.active||follower!=land.follower||player!=land.player||!system||!camera||!light){
  fwr_draw(system,camera,light,follower,player,spriteY);return;
 }
 LandBillboard *mount=billboard(system,follower),*body=billboard(system,player);
 if(!mount||!body||player->face>3){fwr_draw(system,camera,light,follower,player,spriteY);return;}
 LandBillboard originalMount=*mount;
 uint16_t bodyFlags=body->flags;
 int moving=land.hasDrawWorld && (land.drawWorld.x!=player->world.x ||
  land.drawWorld.y!=player->world.y || land.drawWorld.z!=player->world.z);
 land.drawWorld=player->world;land.hasDrawWorld=1;
 unsigned held=CALL(0x0203df4d,unsigned(*)(void))();
 unsigned riderPose=moving?(tick/(held&2u?5u:10u))%3u:1u;
 if(moving){
  /* geom selects a material. Frame selects a pose inside that material.
   * Alternating geom can select an uninitialized material and submit a
   * black quad, especially for a 64-pixel appearance. The follower is
   * stationary while mounted, so drive its normal two-pose stride here. */
  unsigned base=mount->frame&~1u;
  if(!land.runAnimating || land.runBaseFrame!=base){
   land.runAnimating=1;land.runStartTick=tick;land.runStartPose=mount->frame&1u;
   land.runBaseFrame=(uint16_t)base;
  }
  /* Match the small two-pose walking bounce; B halves its frame duration.
   * Carry fractional time through a run/walk change so the pose does not
   * jump when B is released. */
  unsigned cadence=(held&2u)?5u:10u;
  unsigned elapsed=tick-land.runStartTick;
  if(elapsed>=cadence){
   unsigned advances=elapsed/cadence;
   land.runStartPose^=(uint8_t)(advances&1u);
   land.runStartTick+=advances*cadence;
  }
  mount->frame=(uint16_t)(base|land.runStartPose);
 }else land.runAnimating=0;
 mount->pos=body->pos;
 int delta=spriteY-(int8_t)follower->descriptor[14]-(player->face==0?2:0);
 mount->pos.y+=delta*4096;
 /* Lift the mounted pair by one rendered pixel on the raised stride pose.
  * The player's native ground shadow remains at its original position. */
 if(moving && (mount->frame&1u))mount->pos.y+=4096;
 if((player->moveflags&0x4000u)&&!(player->moveflags&0x8000u)){
  /* The follower's attached shadow is hidden while riding, but the player's
   * native ground shadow can otherwise darken a low mounted sprite. Keep that
   * shadow at ground and advance only the submitted mount along the eye ray. */
  FwrCamera view={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
  FwPoint ground={player->world.x,player->world.y,
                  player->world.z+(int8_t)player->dimensions[4]*4096};
  FwrPose pose={{mount->pos.x,mount->pos.y,mount->pos.z},mount->sx,mount->sy},corrected;
  if(fwr_above_shadow(&pose,&ground,&view,&corrected)){
   mount->pos=(Vec){corrected.position.x,corrected.position.y,corrected.position.z};
   mount->sx=(int16_t)corrected.sx;mount->sy=(int16_t)corrected.sy;
  }
 }
 /* Suppress only the player's native body quad. Its ground shadow is an
  * independent effect and remains at the original player position. */
 body->flags&=~512u;
 if(player->face==1)draw_rider(system,camera,light,mount,body,player->face,riderPose);
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 if(player->face!=1)draw_rider(system,camera,light,mount,body,player->face,riderPose);
 body->flags=bodyFlags;*mount=originalMount;
}
