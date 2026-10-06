#include "render.h"
#include "render_math.h"
#include <limits.h>
/* Audited IRDO billboard/camera layouts, also used by the effect snapshots. */
typedef struct { uint16_t geom,pad; FwPoint position; uint16_t frame; int16_t sx,sy; uint16_t rotation,flags,pad2; } Billboard;
_Static_assert(sizeof(Billboard)==28,"billboard ABI");
void fwr_anchor(Actor *a,unsigned face){
 if(!a)return;
 /* Native control Z is added to both the model and its attached shadow. The
  * follower's logical world/grid position and collision remain unchanged. */
 int z=(int8_t)a->descriptor[15]+(face==0?-FWR_NORTH_ANCHOR_Z:face==1?6:0);
 if(z>=INT8_MIN&&z<=INT8_MAX)a->dimensions[4]=(uint8_t)(int8_t)z;
}
__attribute__((visibility("default"))) volatile struct {
 uint32_t magic,version,frames,actor,size,applied;int32_t policy,before,after;
 FwPoint axis,native,submitted;int32_t nativeSX,submittedSX;
} FollowingRenderDebug={.magic=0x44525746,.version=1};
static struct {
 Actor *actor; Vec world,native; uint16_t resource;
 FwrEffectPose submitted;
 Actor *player;Vec playerWorld;FwrEffectPose playerSubmitted;
} effectPose;
/* Work points 24 bytes into a fixed-pool task; leave the complete checked
 * task span inside real RAM, including the original 192-byte tail margin. */
int fwr_grass_work_valid(const void *work){
 uintptr_t address=(uintptr_t)work;
 if(address<0x02000018u||(address&3u))return 0;
 if(address<=0x023fff40u)return 1;
 return address<=0x02ffff40u&&CALL(0x0207acb9,int(*)(void))()!=0;
}
void fwr_grass_clear(void){effectPose.actor=effectPose.player=0;}
void fwr_effects_draw(void *system,void *camera,void *light,Actor *a){
 /* Native grass quads retain their task work in renderer slot +36. Walk the
  * live slots rather than remembering entry calls: retail player steps and
  * shared/recycled tiles need the same correction as follower-created grass. */
 Billboard *changed[8];Billboard original[8];unsigned count=0;
 if(system&&camera&&a&&effectPose.actor==a&&!(a->flags&4u)
    &&effectPose.world.x==a->world.x&&effectPose.world.y==a->world.y&&effectPose.world.z==a->world.z){
  void *scene=PTR(system,4);
  FwrCamera view={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
  unsigned capacity=*(uint16_t*)((uint8_t*)system+0x1c);
  uint8_t *slots=PTR(system,0x18);
  Actor *player=effectPose.player;
  int playerLive=player&&player->system==a->system&&!(player->flags&4u)&&
   player->world.x==effectPose.playerWorld.x&&player->world.y==effectPose.playerWorld.y&&player->world.z==effectPose.playerWorld.z;
  for(unsigned i=0;scene&&slots&&capacity<=256&&i<capacity&&count<8;++i){
   uint8_t *slot=slots+i*40;
   unsigned index=U32(slot,0);if(index>=*(uint16_t*)((uint8_t*)scene+14))continue;
   uint8_t *work=PTR(slot,36);
   /* Other effect kinds also use opaque work pointers. Check the native RAM
    * range before looking for the exact fixed-pool grass descriptor. */
   if(!fwr_grass_work_valid(work))continue;
   uint8_t *task=work-24;
   /* Active task, exact grass callbacks, and the live actor stamp. Pool
    * recycling cannot turn a stale token into an unrelated NPC effect. */
   if(U32(task,4)!=1||U32(task,188)!=0x021a419du||U32(task,196)!=0x021a428du)continue;
   Actor *owner=PTR(work,8);void *controller=PTR(work,4);
   if((owner!=a&&(!playerLive||owner!=player))||!controller||PTR(controller,4)!=system
      ||*(uint16_t*)(work+40)!=owner->id||*(uint16_t*)(work+42)!=owner->model
      ||*(uint16_t*)(work+44)!=owner->zone||*(uint16_t*)(work+48)!=i
      ||*(int32_t*)(work+12)!=owner->grid[0]||*(int32_t*)(work+16)!=owner->grid[2])continue;
   Billboard *b=(Billboard*)PTR(scene,8)+index;
   if((b->geom>>14)!=0||(b->geom&0x3fffu)==0x3fffu||!(b->flags&512))continue;
   FwrPose native={b->position,b->sx,b->sy},out;
   FwrPose followerBody={{effectPose.submitted.position.x,effectPose.submitted.position.y,effectPose.submitted.position.z},effectPose.submitted.sx,effectPose.submitted.sy};
   FwrPose playerBody={{effectPose.playerSubmitted.position.x,effectPose.playerSubmitted.position.y,effectPose.playerSubmitted.position.z},effectPose.playerSubmitted.sx,effectPose.playerSubmitted.sy};
   const FwrPose *body=owner==a?&followerBody:&playerBody;
   const FwrPose *other=playerLive?(owner==a?&playerBody:&followerBody):0;
   if(fwr_cover_feet(&native,body,other,&view,&out)){
    changed[count]=b;original[count++]=*b;
    b->position=out.position;b->sx=(int16_t)out.sx;b->sy=(int16_t)out.sy;
   }
  }
 }
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 for(unsigned i=0;i<count;++i)*changed[i]=original[i];
}
int fwr_effect_pose(Actor *actor,const Vec *native,FwrEffectPose *out){
 if(!actor||!native||!out||effectPose.actor!=actor||
    effectPose.resource!=*(uint16_t*)(actor->descriptor+16)||
    effectPose.world.x!=actor->world.x||effectPose.world.y!=actor->world.y||effectPose.world.z!=actor->world.z||
    effectPose.native.x!=native->x||effectPose.native.y!=native->y||effectPose.native.z!=native->z)return 0;
 *out=effectPose.submitted;return 1;
}
static Billboard *billboard(void *system,Actor *a){
 if(!a||!(a->flags&1)||(a->flags&4)||!a->system)return 0;
 void *fieldBl=PTR(a->system,0x28);if(!fieldBl||PTR(fieldBl,4)!=system)return 0;
 void *scene=PTR(system,4),*slots=PTR(system,0x18);
 unsigned id=*(uint16_t*)a->drawWork;
 if(!scene||!slots||id>=*(uint16_t*)((uint8_t*)system+0x1c))return 0;
 unsigned index=U32(slots,id*40);
 if(index>=*(uint16_t*)((uint8_t*)scene+14)||!PTR(scene,8))return 0;
 Billboard *b=(Billboard*)PTR(scene,8)+index;
 if((b->geom>>14)!=0||!(b->flags&512))return 0;
 return b;
}
/* Only a follower close enough to touch the player on screen needs a player
 * depth correction. In particular, a follower trailing off to the side must
 * not change the player's ordering against unrelated NPCs. */
static int near_player(const Actor *follower,const Actor *player){
 int32_t radius=follower->descriptor[7]==2?2*FW_TILE:3*FW_TILE/2;
 int64_t dx=(int64_t)follower->world.x-player->world.x;
 int64_t dz=(int64_t)follower->world.z-player->world.z;
 return dx>=-radius&&dx<=radius&&dz>=-radius&&dz<=radius;
}
/* The player's temporary foreground shift must stop before any nearby native
 * NPC that the unmodified player would be behind. An almost-tied center depth
 * is not enough for whole textured billboards: leave a visible depth budget
 * for the native NPC instead of letting the follower correction reorder it. */
static int32_t player_advance_limit(void *system,const Billboard *player,
                                   const Billboard *follower,FwPoint direction){
 void *scene=PTR(system,4);
 if(!scene||!PTR(scene,8))return 0;
 unsigned count=*(uint16_t*)((uint8_t*)scene+14);
 if(count>256)return 0;
 Billboard *entries=(Billboard*)PTR(scene,8);
 int32_t limit=2*FW_TILE;
 for(unsigned i=0;i<count;i++){
  const Billboard *other=entries+i;
  if(other==player||other==follower||(other->geom>>14)!=0||
     !(other->flags&512)||other->sx<=0||other->sy<=0)continue;
  int64_t dx=(int64_t)other->position.x-player->position.x;
  int64_t dy=(int64_t)other->position.y-player->position.y;
  int64_t dz=(int64_t)other->position.z-player->position.z;
  if(dx < -2*FW_TILE||dx > 2*FW_TILE||
     dz < -2*FW_TILE||dz > 2*FW_TILE||
     dy < -2*FW_TILE||dy > 2*FW_TILE)continue;
  int32_t depth=(int32_t)((dx*direction.x+dy*direction.y+dz*direction.z)/4096);
  if(depth>0){
   int32_t allowed=depth>FWR_NATIVE_FOREGROUND_GAP?depth-FWR_NATIVE_FOREGROUND_GAP:0;
   if(allowed<limit)limit=allowed;
  }
 }
 return limit;
}
void fwr_draw(void *system,void *camera,void *light,Actor *a,Actor *player,int sprite_y){
 Billboard *b=0,*p=0;FwrPose original={0},adjusted,playerOriginal={0};FwrResult result={0};int applied=0,changed=0,playerChanged=0,lightingChanged=0;uint16_t originalFlags=0;
 effectPose.actor=effectPose.player=0;
 FollowingRenderDebug.frames++;FollowingRenderDebug.applied=0;FollowingRenderDebug.actor=(uint32_t)a;
 FollowingRenderDebug.policy=FollowingRenderDebug.before=FollowingRenderDebug.after=0;
 if(system&&camera&&a&&player&&a!=player&&a->system==player->system){
  b=billboard(system,a);p=billboard(system,player);
  if(b){
   original=(FwrPose){b->position,b->sx,b->sy};
   adjusted=original;
   if(p)playerOriginal=(FwrPose){p->position,p->sx,p->sy};
   if(p&&b!=p){
    /* Both quads use this native scene and light object. Custom follower
     * descriptors can select a different light bank than the player. Mirror
     * only the player's light mask for this submission, never its alpha,
     * polygon ID, or actor-owned presentation flags. */
    originalFlags=b->flags;
    b->flags=(b->flags&~FWR_LIGHT_MASK)|(p->flags&FWR_LIGHT_MASK);
    lightingChanged=b->flags!=originalFlags;
   }
   /* The descriptor Y offset also moves the game's attached shadow. Apply the
    * appearance offset only to this actor quad during synchronous submission;
    * effects and the following pass see the untouched native position. */
   /* Facing up needs two pixels less correction for the artwork than for the
    * shadow; the latter is already moved through native control Z. */
   int delta=sprite_y-(int8_t)a->descriptor[14]-(a->face==0?FWR_NORTH_ART_Y:0);
   int64_t y=(int64_t)adjusted.position.y+(int64_t)delta*4096;
   if(delta&&y>=INT32_MIN&&y<=INT32_MAX){adjusted.position.y=(int32_t)y;changed=1;}
   FwrCamera cam={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
   if(p&&b!=p){
    FwrPose corrected;
    FwPoint world={a->world.x,a->world.y,a->world.z},pw={player->world.x,player->world.y,player->world.z};
    unsigned flags=(a->descriptor[7]==2?FWR_LARGE:0)|(a->face==0?FWR_NORTH:0);
    applied=fwr_correct(&world,&pw,&adjusted,&p->position,&cam,flags,&corrected,&result);
    if(applied){adjusted=corrected;changed=1;}
    FollowingRenderDebug.size=a->descriptor[7];FollowingRenderDebug.applied=applied;
    FollowingRenderDebug.policy=result.policy;FollowingRenderDebug.before=result.before;FollowingRenderDebug.after=result.after;
    FollowingRenderDebug.axis=result.axis;FollowingRenderDebug.native=original.position;
    FollowingRenderDebug.nativeSX=original.sx;
   }
   if((a->moveflags&0x4000u)&&!(a->moveflags&0x8000u)){
    /* The native shadow is submitted in the later effect pass. Some lowered
     * Pokémon quads sit behind its ground plane and are darkened by it. Move
     * only the submitted quad along the camera ray; keep the shadow, screen
     * pixels, logical position, and later effect pass where they are. */
    FwPoint ground={a->world.x,a->world.y,
                    a->world.z+(int8_t)a->dimensions[4]*4096};
    FwrPose corrected;
    if(fwr_above_shadow(&adjusted,&ground,&cam,&corrected)){
     adjusted=corrected;changed=1;
    }
   }
   if(p&&result.policy==-1&&near_player(a,player)){
    /* The shadow clearance runs after the ordinary player/follower ordering
     * decision. It can pull a trailing sprite past the player regardless of
     * the player's facing. Advance only the submitted player quad so the
     * follower remains above its shadow and both screen poses stay fixed. */
    FwrPose corrected;
    int32_t finalDepth=result.after;
    int32_t limit=player_advance_limit(system,p,b,result.axis);
    if(fwr_player_in_front(&adjusted,&playerOriginal,&cam,result.axis,FWR_BACK_MARGIN,limit,&corrected,&finalDepth)){
     p->position=corrected.position;p->sx=(int16_t)corrected.sx;p->sy=(int16_t)corrected.sy;
     playerChanged=1;
    }
    FollowingRenderDebug.after=finalDepth;
   }
   FollowingRenderDebug.submitted=adjusted.position;
   FollowingRenderDebug.submittedSX=adjusted.sx;
   effectPose.world=a->world;
   effectPose.native=(Vec){original.position.x,original.position.y,original.position.z};
   effectPose.resource=*(uint16_t*)(a->descriptor+16);
   effectPose.submitted=(FwrEffectPose){
    .position={adjusted.position.x,adjusted.position.y,adjusted.position.z},
    .sx=(int16_t)adjusted.sx,.sy=(int16_t)adjusted.sy};
   effectPose.actor=a;
   if(p){effectPose.player=player;effectPose.playerWorld=player->world;
    effectPose.playerSubmitted=(FwrEffectPose){{p->position.x,p->position.y,p->position.z},p->sx,p->sy};}
   if(changed){b->position=adjusted.position;b->sx=(int16_t)adjusted.sx;b->sy=(int16_t)adjusted.sy;}
  }
 }
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 /* Drawing consumes the quad synchronously. Never leave a correction for the
  * next frame, another camera, native effects, save data, or the movement trail. */
 if(changed){b->position=original.position;b->sx=(int16_t)original.sx;b->sy=(int16_t)original.sy;}
 if(lightingChanged)b->flags=originalFlags;
 if(playerChanged){p->position=playerOriginal.position;p->sx=(int16_t)playerOriginal.sx;p->sy=(int16_t)playerOriginal.sy;}
}
