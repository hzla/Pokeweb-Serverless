#include "render.h"
#include "render_math.h"
/* Audited IRDO billboard/camera layouts, also used by the effect snapshots. */
typedef struct { uint16_t geom,pad; FwPoint position; uint16_t frame; int16_t sx,sy; uint16_t rotation,flags,pad2; } Billboard;
_Static_assert(sizeof(Billboard)==28,"billboard ABI");
__attribute__((visibility("default"))) volatile struct {
 uint32_t magic,version,frames,actor,size,applied;int32_t policy,before,after;
 FwPoint axis,native,submitted;int32_t nativeSX,submittedSX;
} FollowingRenderDebug={.magic=0x44525746,.version=1};
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
void fwr_draw(void *system,void *camera,void *light,Actor *a,Actor *player){
 Billboard *b=0;FwrPose original={0},adjusted;FwrResult result={0};int applied=0;
 FollowingRenderDebug.frames++;FollowingRenderDebug.applied=0;FollowingRenderDebug.actor=(uint32_t)a;
 FollowingRenderDebug.policy=FollowingRenderDebug.before=FollowingRenderDebug.after=0;
 if(system&&camera&&a&&player&&a!=player&&a->system==player->system){
  b=billboard(system,a);Billboard *p=billboard(system,player);
  if(b&&p&&b!=p){
   original=(FwrPose){b->position,b->sx,b->sy};
   FwrCamera cam={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
   FwPoint world={a->world.x,a->world.y,a->world.z},pw={player->world.x,player->world.y,player->world.z};
   applied=fwr_correct(&world,&pw,&original,&p->position,&cam,a->descriptor[7]==2,&adjusted,&result);
   FollowingRenderDebug.size=a->descriptor[7];FollowingRenderDebug.applied=applied;
   FollowingRenderDebug.policy=result.policy;FollowingRenderDebug.before=result.before;FollowingRenderDebug.after=result.after;
   FollowingRenderDebug.axis=result.axis;FollowingRenderDebug.native=original.position;FollowingRenderDebug.submitted=adjusted.position;
   FollowingRenderDebug.nativeSX=original.sx;FollowingRenderDebug.submittedSX=adjusted.sx;
   if(applied){b->position=adjusted.position;b->sx=(int16_t)adjusted.sx;b->sy=(int16_t)adjusted.sy;}
  }
 }
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 /* Drawing consumes the quad synchronously. Never leave a correction for the
  * next frame, another camera, native effects, save data, or the movement trail. */
 if(applied){b->position=original.position;b->sx=(int16_t)original.sx;b->sy=(int16_t)original.sy;}
}
