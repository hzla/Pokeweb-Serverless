#include "native_shadow.h"
#include "native_follow.h"
#include "shadow_metrics.h"
#include "render.h"
typedef struct {
 void *owner;Actor *actor;uint16_t model,resource;unsigned diameter;
} ShadowSize;
static ShadowSize selected;
__attribute__((visibility("default"),used)) volatile uint32_t FollowingNativeShadowDebug[10]={0x5a535746u,1};
static int resource_read(void *file,unsigned at,void *out,unsigned size){
 ++FollowingNativeShadowDebug[7];
 return CALL(0x02070e55,int(*)(void*,int,unsigned))(file,(int)at,0)&&
        CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,out,size)==size;
}
void fwn_shadow_reset(void){
 selected=(ShadowSize){0};
 for(unsigned i=2;i<6;++i)FollowingNativeShadowDebug[i]=0;
}
void fwn_shadow_prepare(Actor *a){
 if(!a||!a->system||(a->flags&5u)!=1u||a->model<FW_CODE_BASE)return;
 unsigned resource=a->descriptor[16]|(unsigned)a->descriptor[17]<<8;
 if(selected.actor==a&&selected.owner==a->system&&selected.model==a->model&&selected.resource==resource)return;
 selected=(ShadowSize){a->system,a,a->model,(uint16_t)resource,0};
 FollowingNativeShadowDebug[2]=(uint32_t)a;FollowingNativeShadowDebug[3]=a->model;
 FollowingNativeShadowDebug[4]=resource;FollowingNativeShadowDebug[5]=0;++FollowingNativeShadowDebug[6];
 uint32_t file[32];CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/a/0/4/8"))return;
 FwnShadowInput input={resource_read,file,CALL(0x02070ded,unsigned(*)(void*))(file)};
 fwn_shadow_measure(&input,resource,&selected.diameter);
 CALL(0x02070de1,int(*)(void*))(file);
 FollowingNativeShadowDebug[5]=selected.diameter;
}
/* Resolve the native task by exact owner, identity, callback family and scene.
 * Reused slots and other actors' nearby shadows are never eligible. */
static FwnBillboard *owned_shadow(void *system,Actor *a){
 if(!system||!a||!a->system||(a->flags&5u)!=1u)return 0;
 uint8_t *scene=PTR(system,4),*slots=PTR(system,24);
 unsigned count=*(uint16_t*)((uint8_t*)system+28);
 if(!scene||!PTR(scene,8)||!slots||count>256||*(uint16_t*)(scene+14)>256)return 0;
 for(unsigned i=0;i<count;++i){
  uint8_t *slot=slots+i*40,*work=PTR(slot,36);unsigned index=U32(slot,0);
  if(index>=*(uint16_t*)(scene+14)||!fwr_grass_work_valid(work))continue;
  uint8_t *task=work-24;
  if(U32(task,0)!=1||U32(task,188)!=0x021a3c61u||U32(task,196)!=0x021a3d15u||U32(task,200)!=0x021a3d69u)continue;
  if(PTR(work,8)!=a||*(uint16_t*)(work+12)!=a->id||*(uint16_t*)(work+14)!=a->model||*(uint16_t*)(work+16)!=a->zone||U32(work,20)!=i)continue;
  uint8_t *handle=PTR(work,4);
  if(!fwr_grass_work_valid(handle)||PTR(handle,16)!=system||PTR(handle,20)!=scene)continue;
  FwnBillboard *shadow=(FwnBillboard*)PTR(scene,8)+index;
  if(U32(work,0)||!(shadow->flags&512u)||(shadow->geom>>14)!=3||(shadow->geom&0x3fffu)>=*(uint16_t*)(scene+12))return 0;
  return shadow;
 }
 return 0;
}
void fwn_shadow_draw(void *system,void *camera,void *light,Actor *a){
 FwnBillboard *shadow=camera?owned_shadow(system,a):0;
 FwnBillboard original={0};
 if(shadow){
  original=*shadow;
  void *fieldBl=PTR(a->system,0x28),*bodySystem=fieldBl?PTR(fieldBl,4):0;
  FwnBillboard *body=fwn_billboard(bodySystem,a);FwPoint ground;
  /* Both sprites use the native body's authored ground anchor, expressed in
   * the current rail-camera basis. Retain the shadow's own terrain height;
   * artwork height and visual bobbing never lift its ground plane. */
  if(body&&(body->geom>>14)==0&&fwn_ground_position(a,camera,&body->position,&ground)){
   shadow->position.x=ground.x;shadow->position.z=ground.z;
  }
  if(selected.actor==a&&selected.owner==a->system&&selected.model==a->model&&selected.diameter){
   shadow->sx=(int16_t)(selected.diameter*256u);shadow->sy=shadow->sx;
  }
  ++FollowingNativeShadowDebug[8];
 }else if(a)++FollowingNativeShadowDebug[9];
 /* Preserve native texture alpha, lighting, polygon IDs, visibility and sort
  * behavior. No GPU register writes or substitute geometry are submitted. */
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 if(shadow)*shadow=original;
}
