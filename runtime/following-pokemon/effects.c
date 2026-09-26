__attribute__((visibility("hidden"))) void *memset(void *to,int value,unsigned length){unsigned char *p=to;while(length--)*p++=(unsigned char)value;return to;}
#include "effects.h"
#include "effects_assets.h"
#include "render.h"
/* Freestanding aggregate copies; no dependency on a gameplay module's libc. */
__attribute__((visibility("hidden"))) void *memcpy(void *to,const void *from,unsigned length){
 uint8_t *d=to;const uint8_t *s=from;while(length--)*d++=*s++;return to;
}
/* Private resource ownership: neither a retail palette nor material is edited. */
typedef struct { Vec pos,scale; int32_t rotation[9]; } Transform;
typedef struct { uint16_t geom,pad; Vec pos; uint16_t face; int16_t sx,sy; uint16_t rotation,flags,pad2; } Billboard;
typedef struct { void *resource; uint16_t width,height; uint8_t fw,fh,cols,rows; uint32_t tex,pltt,format,dx,dy,texKey,plttKey; } Material;
typedef struct { uint16_t heap,pad; Material *materials; Billboard *actors; uint16_t materialCount,actorCount; Vec scale; uint16_t diffuse,ambient,specular,emissive; uint8_t polygon,origin; uint16_t pad2; uint8_t rest[20]; } Scene;
_Static_assert(sizeof(Scene)==60,"billboard scene ABI");
_Static_assert(sizeof(Material)==40,"billboard material ABI");
_Static_assert(sizeof(Billboard)==28,"billboard actor ABI");
static struct {
 void *resources[3],*models[2],*actors[2],*animation,*white;
 uint16_t whiteID; int ready,mode,age,snapshot;
 Scene scene; Billboard billboard; Material material,whiteMaterial;
 Transform transform;
} fwfx;
/* Set only from the validated installed registry. The retail archive has 975
 * members, but imported follower appearances extend it. */
static uint16_t fwfx_resourceCount;
/* The two bright colors in the imported send-out flash palette (BGR555).
 * Keep a little of the source sprite's light/dark structure in the silhouette. */
#define FWFX_LIGHT_CYAN 0x7f93u
#define FWFX_WHITE 0x7fffu
#define FWFX_RECALL_TICKS 12
#define FWFX_RECALL_SPRITE_TICKS 8
/* Stock White 2 battle effects: switch-out return 620 and send-out 621 both
 * use SE 1383 for the ball. Effect 619 is Sunny Day, not a ball effect. */
#define FWFX_BALL_SE 1383u
__attribute__((visibility("default"))) volatile uint32_t FollowingEffectsDebug[8]={0x58465746,1,0,0,0,0,0,0};
static uint32_t checksum(const uint8_t *p,unsigned n){uint32_t c=~0u;while(n--){c^=*p++;for(unsigned j=0;j<8;++j)c=(c>>1)^((0u-(c&1))&0xedb88320u);}return ~c;}
static int verified(void){
 uint32_t f[32],data[(FW_EFFECT_BYTES+3)/4];
 CALL(0x02070ca9,void(*)(void*))(f);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(f,"rom:/following/effects.narc"))return 0;
 int ok=CALL(0x02070ded,uint32_t(*)(void*))(f)==FW_EFFECT_BYTES;
 if(ok)ok=CALL(0x02070e6d,uint32_t(*)(void*,void*,uint32_t))(f,data,FW_EFFECT_BYTES)==FW_EFFECT_BYTES && checksum((uint8_t*)data,FW_EFFECT_BYTES)==FW_EFFECT_CRC;
 CALL(0x02070de1,int(*)(void*))(f);return ok;
}
static void free_white(void){
 if(fwfx.white){CALL(0x02049561,int(*)(void*))(fwfx.white);CALL(0x02049431,void(*)(void*))(fwfx.white);fwfx.white=0;}
 fwfx.snapshot=0;fwfx.whiteMaterial.texKey=fwfx.whiteMaterial.plttKey=0;FollowingEffectsDebug[7]=0;
}
void fwfx_cancel(void){fwfx.mode=0;FollowingEffectsDebug[2]=0;}
void fwfx_set_resource_count(unsigned count){
 if(count>65535)count=0;
 if(fwfx_resourceCount!=count)free_white();
 fwfx_resourceCount=(uint16_t)count;
}
void fwfx_destroy(void){
 fwfx_emote_end();
 fwfx_cancel();free_white();
 for(unsigned i=0;i<2;++i)if(fwfx.actors[i]){CALL(0x02049961,void(*)(void*))(fwfx.actors[i]);fwfx.actors[i]=0;}
 if(fwfx.animation){CALL(0x020498b5,void(*)(void*))(fwfx.animation);fwfx.animation=0;}
 for(unsigned i=0;i<2;++i)if(fwfx.models[i]){CALL(0x02049801,void(*)(void*))(fwfx.models[i]);fwfx.models[i]=0;}
 for(unsigned i=0;i<3;++i)if(fwfx.resources[i]){if(i<2)CALL(0x02049561,int(*)(void*))(fwfx.resources[i]);CALL(0x02049431,void(*)(void*))(fwfx.resources[i]);fwfx.resources[i]=0;}
 fwfx.ready=0;FollowingEffectsDebug[6]=0;
}
static int init(void){
 if(fwfx.ready)return fwfx.ready>0;
 fwfx.ready=-1;if(!verified())return 0;
 for(unsigned i=0;i<3;++i){
  fwfx.resources[i]=CALL(0x020493f1,void*(*)(const char*,unsigned))("rom:/following/effects.narc",i);
  if(!fwfx.resources[i])return 0;
 }
 for(unsigned i=0;i<2;++i){
  if(!CALL(0x020494d9,int(*)(void*))(fwfx.resources[i]))return 0;
  fwfx.models[i]=CALL(0x02049759,void*(*)(void*,unsigned,void*))(fwfx.resources[i],0,fwfx.resources[i]);
  if(!fwfx.models[i])return 0;
 }
 fwfx.animation=CALL(0x02049839,void*(*)(void*,void*,unsigned))(fwfx.models[1],fwfx.resources[2],0);
 if(!fwfx.animation)return 0;
 fwfx.actors[0]=CALL(0x020498e5,void*(*)(void*,void**,int))(fwfx.models[0],0,0);
 fwfx.actors[1]=CALL(0x020498e5,void*(*)(void*,void**,int))(fwfx.models[1],&fwfx.animation,1);
 if(!fwfx.actors[0] || !fwfx.actors[1])return 0;
 CALL(0x020499a1,int(*)(void*,unsigned))(fwfx.actors[1],0);
 fwfx.transform.scale=(Vec){4096,4096,4096};
 fwfx.transform.rotation[0]=fwfx.transform.rotation[4]=fwfx.transform.rotation[8]=4096;
 fwfx.ready=1;FollowingEffectsDebug[6]=1;return 1;
}
void fwfx_prepare(Actor *actor){
 if(fwfx.mode || CALL(0x0203a2d5,uint32_t(*)(uint32_t))(((ActorSystem*)actor->system)->resourceHeap)<65536 || !init())return;
 uint16_t id=*(uint16_t*)(actor->descriptor+16);
 if(fwfx.white && fwfx.whiteID==id)return;
 free_white();fwfx.whiteID=id;
 if(!fwfx_resourceCount || id>=fwfx_resourceCount)return;
 fwfx.white=CALL(0x020493f1,void*(*)(const char*,unsigned))("rom:/a/0/4/8",id);
 if(!fwfx.white)return;
 void *tex=CALL(0x0204964d,void*(*)(void*))(fwfx.white);
 if(!tex){free_white();return;}
 unsigned length=CALL(0x020652e5,unsigned(*)(void*))(tex);
 uint16_t *palette=CALL(0x0204974d,uint16_t*(*)(void*))(fwfx.white);
 if(!palette || length>512 || !length){free_white();return;}
 unsigned count=length/2,minLight=~0u,maxLight=0;
 for(unsigned i=1;i<count;++i){
  unsigned color=palette[i];
  unsigned light=3u*(color&31u)+6u*((color>>5)&31u)+((color>>10)&31u);
  if(light<minLight)minLight=light;
  if(light>maxLight)maxLight=light;
 }
 unsigned middle=minLight+(maxLight-minLight)/2u;
 for(unsigned i=0;i<count;++i){
  unsigned color=palette[i];
  unsigned light=3u*(color&31u)+6u*((color>>5)&31u)+((color>>10)&31u);
  palette[i]=(uint16_t)(i&&((minLight==maxLight)?(i&1u):(light>middle))?FWFX_WHITE:FWFX_LIGHT_CYAN);
 }
 CALL(0x0204e55d,void(*)(void*,void*))(&fwfx.whiteMaterial,fwfx.white);
 if(!fwfx.whiteMaterial.texKey || !fwfx.whiteMaterial.plttKey)free_white();
}
void fwfx_snapshot(Actor *a){
 if(!fwfx.white || fwfx.mode==2 || (a->flags&4))return;
 void *fieldBl=PTR(a->system,0x28); if(!fieldBl)return;
 void *bl=PTR(fieldBl,4); if(!bl)return;
 Scene *scene=PTR(bl,4); unsigned id=*(uint16_t*)a->drawWork;
 if(!scene || id>=*(uint16_t*)((uint8_t*)bl+0x1c))return;
 unsigned index=U32(PTR(bl,0x18),id*40);
 if(index>=scene->actorCount)return;
 Billboard *actor=&scene->actors[index]; unsigned mat=actor->geom&0x3fff;
 if(mat>=scene->materialCount)return;
 fwfx.scene=*scene;fwfx.billboard=*actor;fwfx.material=scene->materials[mat];
 fwfx.scene.actors=&fwfx.billboard;fwfx.scene.materials=&fwfx.material;
 fwfx.scene.actorCount=fwfx.scene.materialCount=1;
 fwfx.scene.diffuse=fwfx.scene.ambient=0x7fff;
 fwfx.scene.specular=fwfx.scene.emissive=0;
 fwfx.billboard.geom&=0xc000;
 /* Keep the native draw-enable bit and its selected map lights. The old
  * 0xf200 mask cleared both, leaving a loaded silhouette invisible. */
 fwfx.billboard.flags|=0x0200u;
 FwrEffectPose submitted;
 if(fwr_effect_pose(a,&fwfx.billboard.pos,&submitted)){
  fwfx.billboard.pos=submitted.position;
  fwfx.billboard.sx=submitted.sx;fwfx.billboard.sy=submitted.sy;
 }
 /* Preserve animation layout; bind the already uploaded private VRAM keys. */
 fwfx.material.resource=fwfx.white;
 fwfx.material.tex=fwfx.whiteMaterial.tex;fwfx.material.pltt=fwfx.whiteMaterial.pltt;
 fwfx.material.texKey=fwfx.whiteMaterial.texKey;fwfx.material.plttKey=fwfx.whiteMaterial.plttKey;
 fwfx.snapshot=1;FollowingEffectsDebug[7]=1;
}
static void position(Actor *a){fwfx.transform.pos=a->world;fwfx.transform.pos.z+=6*4096;}
void fwfx_out(Actor *a){if(fwfx.ready!=1)return;position(a);fwfx.mode=1;fwfx.age=0;FollowingEffectsDebug[2]=1;FollowingEffectsDebug[5]=0;FollowingEffectsDebug[3]++;}
void fwfx_recall(Actor *a){
 if(fwfx.ready!=1 || fwfx.mode==2)return;
 position(a);fwfx.mode=2;fwfx.age=0;FollowingEffectsDebug[2]=2;FollowingEffectsDebug[5]=0;FollowingEffectsDebug[4]++;
 CALL(0x02006255,void(*)(unsigned))(FWFX_BALL_SE);
}
int fwfx_busy(void){return fwfx.mode!=0;}
int fwfx_recalling(void){return fwfx.mode==2;}
int fwfx_available(void){return fwfx.ready==1;}
int fwfx_hides_actor(void){return fwfx.mode==1 && fwfx.age<2;}
void fwfx_tick(void){
 if(!fwfx.mode)return;
 if(++fwfx.age>=(fwfx.mode==1?10:FWFX_RECALL_TICKS)){fwfx_cancel();return;}
 if(fwfx.mode==1 && fwfx.age==2)CALL(0x02006255,void(*)(unsigned))(FWFX_BALL_SE);
 FollowingEffectsDebug[2]=fwfx.mode;FollowingEffectsDebug[5]=fwfx.age;
}
static void draw_emote(void *camera,void *light);
void fwfx_draw(void *camera,void *light){
 draw_emote(camera,light);
 if(!fwfx.mode || fwfx.ready!=1)return;
 if(fwfx.mode==2 && fwfx.age<FWFX_RECALL_SPRITE_TICKS && fwfx.snapshot){
   /* Three recolored frames establish the silhouette, then five quick steps
    * pull it into the ball. The remaining four frames retain the ball art. */
   static const int scale[8]={4096,4096,4096,3440,2784,2112,1456,768};
   Billboard original=fwfx.billboard;
   fwfx.billboard.sx=(fwfx.billboard.sx*scale[fwfx.age])>>12;
   fwfx.billboard.sy=(fwfx.billboard.sy*scale[fwfx.age])>>12;
   CALL(0x0204ebdd,void(*)(void*,void*,void*))(&fwfx.scene,camera,light);fwfx.billboard=original;
 }else if((fwfx.mode==1 && fwfx.age<2) || fwfx.mode==2){
  CALL(0x02049b89,void(*)(void*,void*))(fwfx.actors[0],&fwfx.transform);
 }else{
  int32_t frame=(fwfx.age-2)*4096;
  CALL(0x02049a11,int(*)(void*,unsigned,void*))(fwfx.actors[1],0,&frame);
  CALL(0x02049b89,void(*)(void*,void*))(fwfx.actors[1],&fwfx.transform);
 }
}

static struct {void *resources[2];Scene scene;Billboard billboard;Material material[2];int active;unsigned frame;} fwemote;
void fwfx_emote_end(void){
 fwemote.active=0;
 for(unsigned i=0;i<2;++i)if(fwemote.resources[i]){CALL(0x02049561,int(*)(void*))(fwemote.resources[i]);CALL(0x02049431,void(*)(void*))(fwemote.resources[i]);fwemote.resources[i]=0;}
}
int fwfx_emote_begin(Actor *a,unsigned member){
 fwfx_emote_end();
 if(member>=28 || CALL(0x0203a2d5,uint32_t(*)(uint32_t))(((ActorSystem*)a->system)->resourceHeap)<32768)return 0;
 void *fieldBl=PTR(a->system,0x28);if(!fieldBl)return 0;
 void *bl=PTR(fieldBl,4);if(!bl)return 0;
 Scene *scene=PTR(bl,4);unsigned id=*(uint16_t*)a->drawWork;
 if(!scene||id>=*(uint16_t*)((uint8_t*)bl+0x1c))return 0;
 unsigned index=U32(PTR(bl,0x18),id*40);if(index>=scene->actorCount)return 0;
 fwemote.scene=*scene;fwemote.billboard=scene->actors[index];
 fwemote.scene.actors=&fwemote.billboard;fwemote.scene.materials=fwemote.material;
 fwemote.scene.actorCount=1;fwemote.scene.materialCount=2;
 fwemote.scene.diffuse=fwemote.scene.ambient=0x7fff;fwemote.scene.specular=fwemote.scene.emissive=0;
 fwemote.billboard.geom&=0xc000;fwemote.billboard.flags&=~0xf200;
 fwemote.billboard.sx=fwemote.billboard.sy=4096;fwemote.billboard.face=0;
 for(unsigned i=0;i<2;++i){
  fwemote.material[i]=(Material){0};
  fwemote.resources[i]=CALL(0x020493f1,void*(*)(const char*,unsigned))("rom:/following/emotes.narc",member+i);
  if(!fwemote.resources[i]){fwfx_emote_end();return 0;}
  CALL(0x0204e599,void(*)(void*,unsigned,unsigned,unsigned,unsigned))(&fwemote.material[i],0,0x22,32,32);
  CALL(0x0204e55d,void(*)(void*,void*))(&fwemote.material[i],fwemote.resources[i]);
  if(!fwemote.material[i].texKey||!fwemote.material[i].plttKey){fwfx_emote_end();return 0;}
 }
 fwemote.active=1;fwfx_emote_frame(a,0);return 1;
}
void fwfx_emote_frame(Actor *a,unsigned frame){
 if(!fwemote.active)return;
 fwemote.billboard.geom=(fwemote.billboard.geom&0xc000)|(frame&1);
 fwemote.billboard.pos=(Vec){a->world.x+a->drawOffset.x+a->externalOffset.x+a->attributeOffset.x,a->world.y+a->drawOffset.y+a->externalOffset.y+a->attributeOffset.y+32*4096,a->world.z+a->drawOffset.z+a->externalOffset.z+a->attributeOffset.z+4096};
}
static void draw_emote(void *camera,void *light){if(fwemote.active)CALL(0x0204ebdd,void(*)(void*,void*,void*))(&fwemote.scene,camera,light);}
