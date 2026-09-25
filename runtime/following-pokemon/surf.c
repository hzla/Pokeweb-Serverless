#include "surf.h"
#include "render.h"
#include "render_math.h"
#include <limits.h>
#ifdef FW_MOUNT
#include "transition.h"
#endif

/* The audited White 2 field and billboard layouts are shared with White2Upgrade.
 * The mount effect and rider remain native; only draw submission is replaced. */
typedef struct { uint16_t geom,pad; Vec pos; uint16_t face; int16_t sx,sy; uint16_t rotation,flags,pad2; } SurfBillboard;
typedef struct { void *resource; uint16_t width,height; uint8_t fw,fh,cols,rows; uint32_t tex,pltt,format,dx,dy,texKey,plttKey; } SurfMaterial;
typedef struct { uint16_t heap,pad; SurfMaterial *materials; SurfBillboard *actors; uint16_t materialCount,actorCount; Vec scale; uint16_t diffuse,ambient,specular,emissive; uint8_t polygon,origin; uint16_t pad2; uint8_t rest[20]; } SurfScene;
_Static_assert(sizeof(SurfBillboard)==28,"Surf billboard ABI");
_Static_assert(sizeof(SurfMaterial)==40,"Surf material ABI");
_Static_assert(sizeof(SurfScene)==60,"Surf scene ABI");

static struct {
 ActorSystem *owner;
 Actor *player;
 void *resources[16];
 SurfMaterial materials[16];
 SurfBillboard billboard;
 SurfScene scene;
 Vec mount;
 uint32_t tick,captured;
 uint16_t lookupSpecies,memberBase,frameSize;
 unsigned hasMount;
 int ready,active;
 unsigned entryPending,entryTick;
 SurfBillboard template;
 unsigned hasTemplate;
 uint8_t lookupForm,lookupGender,lookupShiny;
 uint32_t uploadTick;
} surf;

__attribute__((visibility("default"))) volatile struct {
 uint32_t magic,version,loaded,active,captures,draws,frame,reason;
 uint32_t ordinarySuppressed,entrySuppressed,forwarded,lastSource,lastTick;
} FollowingSurfDebug={.magic=0x46535746,.version=2};

static uint16_t read16(const uint8_t *p){return p[0]|(uint16_t)p[1]<<8;}
static uint32_t read32(const uint8_t *p){return read16(p)|(uint32_t)read16(p+2)<<16;}
static int lookup_record(void *file,unsigned count,unsigned species,unsigned form,unsigned gender,unsigned shiny,unsigned members,uint16_t *base,uint16_t *frameSize){
 uint8_t record[8];
 unsigned first=0,last=count;
 while(first<last){
  unsigned middle=first+(last-first)/2;
  if(!CALL(0x02070e55,int(*)(void*,int,unsigned))(file,(int)(16+middle*8),0) ||
     CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,record,8)!=8)return 0;
  unsigned candidate=read16(record);
  if(candidate<species || (candidate==species && (record[2]<form || (record[2]==form && (record[3]<gender || (record[3]==gender && record[4]<shiny))))))first=middle+1;
  else last=middle;
 }
 if(first>=count || !CALL(0x02070e55,int(*)(void*,int,unsigned))(file,(int)(16+first*8),0) ||
    CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,record,8)!=8)return 0;
 unsigned member=read16(record+6);
 if(read16(record)!=species || record[2]!=form || record[3]!=gender || record[4]!=shiny ||
    (record[5]!=32 && record[5]!=64) || member+16>members)return 0;
 *base=(uint16_t)member;*frameSize=record[5];return 1;
}
static int lookup(unsigned species,unsigned form,unsigned gender,unsigned shiny,uint16_t *base,uint16_t *frameSize){
 uint32_t file[32];uint8_t header[16];
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/surf-registry.bin"))return 0;
 unsigned size=CALL(0x02070ded,unsigned(*)(void*))(file);
 int found=0;
 if(size>=24 && CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,header,16)==16 &&
    read32(header)==0x4d535746 && read16(header+4)==2 && read16(header+6)==8 &&
    read16(header+8)>=1298 && read16(header+8)<=(FW_MAX_SPECIES==1023u?4095u:2048u) && read16(header+10)==FW_MAX_SPECIES &&
    size==16u+8u*read16(header+8)){
  unsigned count=read16(header+8),members=read32(header+12);
  if(members==count*16u && members<=65535){
   for(unsigned f=0;f<2&&!found;++f){
    unsigned candidateForm=f?0:form;
    if(f&&form==0)break;
    for(unsigned s=0;s<(shiny?2u:1u)&&!found;++s){
     unsigned candidateShiny=s?0:shiny;
     found=lookup_record(file,count,species,candidateForm,gender,candidateShiny,members,base,frameSize);
     if(!found&&gender!=255)found=lookup_record(file,count,species,candidateForm,255,candidateShiny,members,base,frameSize);
    }
   }
  }
 }
 CALL(0x02070de1,int(*)(void*))(file);
 return found;
}
static void release_resources(void){
 for(unsigned i=0;i<16;++i)if(surf.resources[i]){
  CALL(0x02049561,int(*)(void*))(surf.resources[i]);
  CALL(0x02049431,void(*)(void*))(surf.resources[i]);
  surf.resources[i]=0;
  surf.materials[i]=(SurfMaterial){0};
 }
 FollowingSurfDebug.loaded=0;
}
void fwsurf_destroy(void){
 release_resources();
 surf.owner=0;surf.player=0;surf.ready=surf.active=0;
 surf.tick=surf.captured=surf.hasMount=surf.uploadTick=0;
 surf.entryPending=surf.entryTick=0;
 surf.hasTemplate=0;
 surf.lookupSpecies=surf.memberBase=surf.frameSize=0;
 surf.lookupForm=surf.lookupGender=surf.lookupShiny=0;
 FollowingSurfDebug.active=0;
}
static int load(void){
 if(surf.ready)return surf.ready>0;
 surf.ready=-1;
 for(unsigned i=0;i<16;++i){
  surf.resources[i]=CALL(0x020493f1,void*(*)(const char*,unsigned))("rom:/following/surf-mounts.narc",surf.memberBase+i);
  if(!surf.resources[i])goto fail;
  /* This native initializer takes texture-size exponents in argument 3.
   * 0x22 describes a 32x32 sheet and produces zero atlas cells for a 64x64
   * frame; use 0x33 for 64x64 and keep 0x22 for future 32x32 mounts. */
  unsigned dimensions=surf.frameSize==64?0x33u:0x22u;
  CALL(0x0204e599,void(*)(void*,unsigned,unsigned,unsigned,unsigned))(&surf.materials[i],0,dimensions,surf.frameSize,surf.frameSize);
  if(surf.materials[i].cols!=1||surf.materials[i].rows!=1)goto fail;
  CALL(0x0204e55d,void(*)(void*,void*))(&surf.materials[i],surf.resources[i]);
  if(!surf.materials[i].texKey||!surf.materials[i].plttKey)goto fail;
 }
 surf.uploadTick=surf.tick;
 surf.ready=1;FollowingSurfDebug.loaded=1;return 1;
fail:
 release_resources();surf.ready=-1;FollowingSurfDebug.reason=1;return 0;
}
int fwsurf_prepare(ActorSystem *system,unsigned appearance,unsigned tick){
 if(!system||!system->field||!(appearance&1023u))return 0;
 /* The first update resolves the ROM index; the entry-pending flag then keeps
  * its materials resident while the native effect starts on the next tick. */
 unsigned species=appearance&1023u,form=(appearance>>10)&255u;
 unsigned gender=(appearance>>18)&255u,shiny=(appearance>>26)&1u;
 if(surf.owner!=system||surf.lookupSpecies!=species||surf.lookupForm!=form||
    surf.lookupGender!=gender||surf.lookupShiny!=shiny){
  fwsurf_destroy();surf.owner=system;surf.lookupSpecies=(uint16_t)species;
  surf.lookupForm=(uint8_t)form;surf.lookupGender=(uint8_t)gender;surf.lookupShiny=(uint8_t)shiny;
  surf.memberBase=0xffff;
  uint16_t base,size;
  if(lookup(species,form,gender,shiny,&base,&size)){surf.memberBase=base;surf.frameSize=size;}
 }
 if(surf.memberBase==0xffff||CALL(0x0203a2d5,uint32_t(*)(uint32_t))(system->resourceHeap)<49152u)return 0;
 surf.entryPending=1;surf.entryTick=tick;surf.tick=tick;
 if(!load()){surf.entryPending=0;return 0;}
 surf.active=0;surf.hasMount=0;FollowingSurfDebug.active=0;
 return 1;
}
void fwsurf_update(ActorSystem *system,unsigned appearance,unsigned surfing,unsigned tick){
 unsigned species=appearance&1023u,form=(appearance>>10)&255u,gender=(appearance>>18)&255u,shiny=(appearance>>26)&1u;
 if(surf.owner&&surf.owner!=system)fwsurf_destroy();
 if(!system||!species||!system->field){
  if(surf.owner)fwsurf_destroy();
  return;
 }
 if(surf.lookupSpecies!=species||surf.lookupForm!=form||surf.lookupGender!=gender||surf.lookupShiny!=shiny){
  fwsurf_destroy();surf.owner=system;surf.lookupSpecies=(uint16_t)species;
  surf.lookupForm=(uint8_t)form;surf.lookupGender=(uint8_t)gender;surf.lookupShiny=(uint8_t)shiny;
  surf.memberBase=0xffff;
  uint16_t base,size;
  if(lookup(species,form,gender,shiny,&base,&size)){surf.memberBase=base;surf.frameSize=size;}
 }
 if(surf.memberBase==0xffff)return;
 surf.owner=system;surf.tick=tick;
 if(surfing)surf.entryPending=0;
 void *field=system->field,*fieldPlayer=PTR(field,0x94);
 Actor *player=fieldPlayer?CALL(0x0219a6e1,Actor*(*)(void*))(fieldPlayer):0;
 if(!player||!(player->flags&1u)||player->system!=system){
  if(surf.owner)fwsurf_destroy();
  return;
 }
 surf.player=player;
 if(!surfing && (!surf.entryPending || tick-surf.entryTick>90u)){
  if(surf.ready)release_resources();
  surf.ready=surf.active=0;surf.hasMount=0;surf.entryPending=0;
  FollowingSurfDebug.active=0;
  return;
 }
 surf.owner=system;surf.player=player;surf.tick=tick;
 surf.active=0;FollowingSurfDebug.active=0;
 if(!surf.ready&&CALL(0x0203a2d5,uint32_t(*)(uint32_t))(system->resourceHeap)<49152){FollowingSurfDebug.reason=2;return;}
 if(!load())return;
 if(!surf.hasMount
#ifdef FW_MOUNT
    && !fwtm_entering()
#endif
   ){
  /* The actor pass may precede the first native effect draw. Seed a one-frame
   * pose from the rider, then replace it with the exact effect transform.
   * The instant land handoff must wait for its first real effect capture:
   * the land rider's just-released VRAM can still be in the draw queue. */
  surf.mount=player->world;
  surf.captured=tick;
  surf.hasMount=2;
 }
 surf.active=1;FollowingSurfDebug.active=1;FollowingSurfDebug.reason=0;
}

static int capture_mount(void *control,unsigned index){
 if(!control)return 0;
 uint8_t *objects=PTR(control,12);
 if(!objects)return 0;
 uint8_t *object=objects+index*0x68u;
 if((U32(object,0)&3u)!=1u || (U32(object,0)&8u))return 0;
 surf.mount=*(Vec*)(object+8);
 surf.captured=surf.tick;
 surf.hasMount=2;
 ++FollowingSurfDebug.captures;
 return 1;
}

/* The native mount can draw before the player-mode change is visible to the
 * preceding field update. Arm either audited Surf draw callsite on its first
 * validated mount object; load textures in the following field update. */
static void draw_mount(void *control,unsigned index,unsigned source){
 if(surf.owner&&surf.lookupSpecies&&surf.memberBase!=0xffff&&surf.ready>=0&&capture_mount(control,index)){
  if(!surf.entryPending&&!surf.active)surf.entryTick=surf.tick;
  surf.entryPending=1;
  if(surf.ready==1){surf.active=1;FollowingSurfDebug.active=1;}
  if(source)++FollowingSurfDebug.entrySuppressed;
  else ++FollowingSurfDebug.ordinarySuppressed;
  FollowingSurfDebug.lastSource=source;
  FollowingSurfDebug.lastTick=surf.tick;
  return;
 }
 ++FollowingSurfDebug.forwarded;
 CALL(0x021c0309,void(*)(void*,unsigned))(control,index);
}
__attribute__((visibility("default"))) void FollowingSurfMountDraw(void *control,unsigned index){
 draw_mount(control,index,0);
}

/* Keep a distinct symbol for the entry hook's audited binary contract. */
__attribute__((visibility("default"))) void FollowingSurfEntryMountDraw(void *control,unsigned index){
 draw_mount(control,index,1);
}

static SurfBillboard *rider_billboard(void *system){
 Actor *player=surf.player;
 if(!player||!(player->flags&1u)||(player->flags&4u)||!player->system)return 0;
 void *fieldBillboards=PTR(player->system,0x28);
 if(!fieldBillboards||PTR(fieldBillboards,4)!=system)return 0;
 SurfScene *scene=PTR(system,4);
 void *slots=PTR(system,0x18);
 unsigned id=*(uint16_t*)player->drawWork;
 if(!scene||!slots||id>=*(uint16_t*)((uint8_t*)system+0x1c))return 0;
 unsigned index=U32(slots,id*40);
 if(index>=scene->actorCount||!scene->actors)return 0;
 SurfBillboard *billboard=scene->actors+index;
 if((billboard->geom>>14)!=0||!(billboard->flags&512))return 0;
 return billboard;
}
static int belongs_to_player_scene(void *system){
 Actor *player=surf.player;
 if(!player||!player->system||player->system!=surf.owner)return 0;
 void *fieldBillboards=PTR(player->system,0x28);
 return fieldBillboards&&PTR(fieldBillboards,4)==system;
}
void fwsurf_draw(void *system,void *camera,void *light,unsigned afterPlayer){
 /* The retail effect pass can run on either side of the actor pass. Accept
  * the previous update's transform, but never a position from an old field. */
 /* Uploading the Surf texture in the same field frame that releases the land
  * rider can recycle a VRAM key still referenced by queued land draw commands.
  * Keep the native effect hidden until the next completed field frame. */
 if(!surf.active||surf.ready!=1||surf.tick==surf.uploadTick||surf.hasMount!=2||surf.tick-surf.captured>1u||!system||!camera||!light||!surf.player||!belongs_to_player_scene(system))return;
 unsigned face=surf.player->face;
 if(face>3||afterPlayer!=(face==1))return;
 SurfScene *native=PTR(system,4);
 SurfBillboard *rider=rider_billboard(system);
 if(rider){surf.template=*rider;surf.hasTemplate=1;}
 else if(surf.hasTemplate)rider=&surf.template;
 if(!native||!rider)return;
 static const uint8_t phase[6]={0,1,2,3,2,1};
 unsigned frame=face*4u+phase[(surf.tick/4u)%6u];
 Vec mount=surf.mount;
#ifdef FW_MOUNT
 /* The native Surf effect starts ahead of its rider and converges only when
  * its jump finishes. Our no-hop land entry must keep the mount with the
  * rider throughout that transfer. The effect's own transform is retained
  * for the ordinary Surf path and after the handoff completes. */
 if(fwtm_entering())mount=surf.player->world;
#endif
 surf.billboard=*rider;
 surf.billboard.geom=(surf.billboard.geom&0xc000u)|frame;
 surf.billboard.face=0;
 /* Bit 9 marks a live billboard in the retail draw loop. The private
  * mount must retain it even though its high presentation bits are reset. */
 surf.billboard.flags&=~0xf000u;
 surf.billboard.sx=surf.billboard.sy=(int16_t)(surf.frameSize*256);
 surf.billboard.pos=mount;
 FwrCamera view={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
 FwrPose original={{mount.x,mount.y,mount.z},surf.billboard.sx,surf.billboard.sy},adjusted;
 FwrResult result;
 FwPoint world={mount.x,mount.y,mount.z};
 FwPoint playerWorld={surf.player->world.x,surf.player->world.y,surf.player->world.z};
 FwPoint riderDraw={rider->pos.x,rider->pos.y,rider->pos.z};
 if(fwr_correct(&world,&playerWorld,&original,&riderDraw,&view,
    face==1?FWR_FORCE_FRONT:FWR_FORCE_BACK,&adjusted,&result)){
  surf.billboard.pos=(Vec){adjusted.position.x,adjusted.position.y,adjusted.position.z};
  surf.billboard.sx=(int16_t)adjusted.sx;surf.billboard.sy=(int16_t)adjusted.sy;
 }
 surf.scene=*native;
 surf.scene.actors=&surf.billboard;surf.scene.materials=surf.materials;
 surf.scene.actorCount=1;surf.scene.materialCount=16;
 surf.scene.diffuse=surf.scene.ambient=0x7fff;
 surf.scene.specular=surf.scene.emissive=0;
 CALL(0x0204ebdd,void(*)(void*,void*,void*))(&surf.scene,camera,light);
 FollowingSurfDebug.frame=frame;++FollowingSurfDebug.draws;
}

void fwsurf_draw_scene(void *system,void *camera,void *light,Actor *follower,Actor *player,int sprite_y){
 SurfBillboard *rider=surf.owner&&belongs_to_player_scene(system)?rider_billboard(system):0;
 if(rider){surf.template=*rider;surf.hasTemplate=1;}
 /* Surf mode remains active through part of the shore hop after the native
  * mount vanishes. Only lift the seated rider while that mount can draw. */
 if(!(surf.active&&surf.ready==1&&surf.tick!=surf.uploadTick&&surf.hasMount==2&&surf.tick-surf.captured<=1u))rider=0;
 int32_t nativeY=0;
 int lifted=0;
 if(rider){
  int64_t y=(int64_t)rider->pos.y+10*4096;
  if(y<=INT32_MAX && y>=INT32_MIN){nativeY=rider->pos.y;rider->pos.y=(int32_t)y;lifted=1;}
 }
 fwsurf_draw(system,camera,light,0);
 fwr_draw(system,camera,light,follower,player,sprite_y);
 fwsurf_draw(system,camera,light,1);
 /* The effect pass, shadows, collision and next frame retain retail state. */
 if(lifted)rider->pos.y=nativeY;
}
