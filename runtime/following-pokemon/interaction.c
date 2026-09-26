#include "interaction.h"
#include "render.h"
#include "effects.h"
#include "gifts.h"
#define API __attribute__((visibility("default")))
static uint32_t dataBytes[FWR_CAPACITY/4];
static uint32_t contextBytes[FWR_CONTEXT_CAPACITY/4];
static FwrData data;static FwrContext context;static FwrItems items;
static int loaded,emotesValid,needRelease;
static uint32_t rng=0x48534753;
static struct {
 FwFollower *f;const Moves *callbacks;void *system;Actor *actor,*player;void *field,*game,*event,*window,*string;
 FwrSnapshot snapshot;FwrMotion motion;FwrStep step;
 Vec offset,position;uint16_t text[FWR_TEXT_CAPACITY];
 uint32_t generation;unsigned rule,contextRule,itemRule,stepIndex,stage,age,bubbleIndex,bubbleAge;
 int contextual,gift,giftGranted;FwrItemChoice item;
 uint16_t face;int active,released,cryPending,closing,finished;
} talk;
API volatile uint32_t FollowingTalkDebug[12]={0x4b545746,1,0,0,0,0,0,0,0,0,0,0};
/* FWGF: gift selection/transaction evidence retained for emulator states.
   [2] attempts, [3] archive bytes, [4] archive valid, [5] claim read,
   [6] claim mask, [7] rule chosen, [8] rule, [9] grant result,
   [10] item, [11] slot:quantity. */
API volatile uint32_t FollowingGiftDebug[12]={0x46475746,1,0,0,0,0,0,0,0xffffffffu,0,0,0};
static int file_read(const char *path,void *out,unsigned capacity){
 uint32_t file[32];CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,path))return 0;
 unsigned size=CALL(0x02070ded,unsigned(*)(void*))(file);int ok=size<=capacity&&size>=48;
 if(ok)ok=CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,out,size)==size;
 CALL(0x02070de1,int(*)(void*))(file);return ok?(int)size:0;
}
static int verify_emotes(void){
 uint32_t file[32],buffer[64];CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/emotes.narc"))return 0;
 unsigned left=CALL(0x02070ded,unsigned(*)(void*))(file);int ok=left==data.emoteBytes;uint32_t crc=~0u;
 while(ok&&left){unsigned n=left>sizeof(buffer)?sizeof(buffer):left;
  if(CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,buffer,n)!=n){ok=0;break;}
  const uint8_t *p=(const uint8_t*)buffer;for(unsigned i=0;i<n;++i){crc^=p[i];for(unsigned j=0;j<8;++j)crc=(crc>>1)^((0u-(crc&1))&0xedb88320u);}left-=n;
 }
 CALL(0x02070de1,int(*)(void*))(file);return ok&&~crc==data.emoteCrc;
}
static int load(void){
 if(loaded)return loaded>0;
 loaded=-1;
 int n=file_read("rom:/following/interactions.bin",dataBytes,sizeof(dataBytes));
 if(!n||!fwr_validate(&data,dataBytes,(unsigned)n)){FollowingTalkDebug[10]=1;return 0;}
 loaded=1;emotesValid=verify_emotes();FollowingTalkDebug[9]=emotesValid;return 1;
}
static int valid_actor(void){return talk.f&&talk.f->generation==talk.generation&&talk.f->actor==(uintptr_t)talk.actor&&talk.actor&&(talk.actor->flags&1)&&talk.actor->system==talk.system&&talk.actor->callbacks==talk.callbacks;}
void fwt_poll_input(void){if(needRelease&&!(CALL(0x0203df4d,unsigned(*)(void))()&3))needRelease=0;}
int fwt_active(void){return talk.active;}
int fwt_owns(void *field){return talk.active&&talk.field==field&&talk.game&&PTR(talk.game,0x18)==talk.event;}
int fwt_field_owns(void *field){
 /* Retail snapshots event presence before running callbacks, then updates the
    field after freeing a completed event. Its cached flag stays set that frame.
    Consume our completion once; never exempt a new event or a replaced actor. */
 int finished=talk.finished;talk.finished=0;
 return fwt_owns(field)||(finished&&talk.field==field&&valid_actor()&&talk.game&&!PTR(talk.game,0x18));
}
static void close_resources(void){
 fwfx_emote_end();
 if(talk.window){CALL(0x02188859,void(*)(void*))(talk.window);talk.window=0;}
 if(talk.string){CALL(0x02048591,void(*)(void*))(talk.string);talk.string=0;}
 if(valid_actor()){talk.actor->drawOffset=talk.offset;CALL(0x02167099,void(*)(Actor*,unsigned))(talk.actor,talk.face);fwr_anchor(talk.actor,talk.face);talk.actor->flags|=16;}
 if(talk.f&&talk.f->generation==talk.generation&&talk.f->actor==(uintptr_t)talk.actor)fw_end_interaction(talk.f);
 talk.active=0;needRelease=1;FollowingTalkDebug[2]=0;FollowingTalkDebug[7]++;
}
static int finish_event(void){
 int owned=fwt_owns(talk.field)&&valid_actor();
 close_resources();talk.event=0;talk.finished=owned;return 1;
}
void fwt_cancel(void){
 talk.finished=0;
 if(!talk.active)return;
 /* Only unlink a live owned node. Never dereference a saved event pointer after
    native code has replaced/freed it, and never release somebody else's lock. */
 void *event=talk.event;void **link=talk.game?(void**)((uint8_t*)talk.game+0x18):0;
 close_resources();
 for(unsigned i=0;link&&*link&&i<16;++i){void *node=*link;if(node==event){*link=PTR(node,0);CALL(0x02016d09,void(*)(void*))(node);break;}link=(void**)node;}
 talk.event=0;FollowingTalkDebug[8]++;
}
void fwt_unload(void){fwt_cancel();loaded=0;data=(FwrData){0};context=(FwrContext){0};items=(FwrItems){0};emotesValid=0;}
static int abs32(int x){return x<0?-x:x;}
int fwt_reach(FwFollower *f,Actor *p,Actor *a,void *field){
 if(!f||f->state!=FW_FOLLOWING||!p||!a||(a->flags&4)||fwfx_busy()||p->face>3||f->trail.count<2)return 0;
 int gap=f->directional_gap[p->face];if(gap>(int)FW_MAX_DIRECTIONAL_GAP)return 0;
 int x=a->world.x-p->world.x,z=a->world.z-p->world.z,y=a->world.y-(p->world.y+p->drawOffset.y+p->externalOffset.y);
 if(abs32(x)>(int)(p->face>=2?FW_DIALOGUE_REACH(gap):FW_DIALOGUE_REACH(0))||
    abs32(z)>(int)(p->face<2?FW_DIALOGUE_REACH(gap):FW_DIALOGUE_REACH(0))||
    abs32(y)>8*4096)return 0;
 unsigned controller=CALL(0x02180579,unsigned(*)(void*))(field);
 int vx=p->face==2?-256:p->face==3?256:0,vz=p->face==0?-256:p->face==1?256:0;
 if(controller){
  /* Rail-facing keys are relative to the curve, not world compass directions.
     Only the player owns native rail movement work; never query the follower. */
  if(!(p->flags&8192)||!PTR(p->moveWork,0))return 0;
  if(CALL(0x02195729,unsigned(*)(Actor*,unsigned))(p,p->face)&3)return 0;
  Vec front;CALL(0x0219a9d1,void(*)(void*,unsigned,Vec*))(PTR(field,0x94),p->face,&front);
  vx=(front.x-p->world.x)/256;vz=(front.z-p->world.z)/256;
  if(abs32(vx)>512||abs32(vz)>512)return 0;
 }
 /* Match the wider lateral trail, including a rotated rail tangent. The
    native adjacent-tile/obstruction and connected-corridor checks still apply. */
 int length=vx*vx+vz*vz,px=x/256,pz=z/256,along=px*vx+pz*vz,lateral=px*vz-pz*vx;
 if(!length||along<length/2||along>length+length/8+gap*length/16||abs32(lateral)>(int)((unsigned)length/3))return 0;
 /* A bounded connected trail proves both actors occupy the same corridor.
    Use the rail tangent too, so rotated/curved paths retain normal reach. */
 for(unsigned i=0;i<f->trail.count;++i){const FwSample *s=&f->trail.samples[(f->trail.head+i)%FW_TRAIL_CAPACITY];
  if(s->generation!=f->generation||abs32(s->y-a->world.y)>8*4096)return 0;
  int dx=(s->x-p->world.x)/256,dz=(s->z-p->world.z)/256;
  if(abs32(dx)>512||abs32(dz)>512||abs32(dx*vz-dz*vx)>(int)((unsigned)length/3))return 0;
 }
 if(!controller){
  int16_t gx,gy,gz;CALL(0x0219aacd,void(*)(void*,void*,void*,void*))(PTR(field,0x94),&gx,&gy,&gz);
  int dx=a->grid[0]-gx,dz=a->grid[2]-gz;
  /* A twelve-unit side gap can place the follower in the next grid cell.
     The distance and connected straight trail above still bound this case. */
  int next=gap>8&&((p->face==0&&dx==0&&dz==-1)||(p->face==1&&dx==0&&dz==1)||
      (p->face==2&&dx==-1&&dz==0)||(p->face==3&&dx==1&&dz==0));
  if((dx||dz)&&!next)return 0;
  if(CALL(0x0215e4f1,unsigned(*)(Actor*,unsigned))(p,p->face))return 0;
 }
 return 1;
}
static void cry(void){
 if(!talk.cryPending)return;
 /* PMVOICE_Play spins during sound loading. Defer it instead of blocking field. */
 if(CALL(0x02005cbd,int(*)(void))())return;
 unsigned handle=CALL(0x020069f5,unsigned(*)(unsigned,unsigned,unsigned,int,int,int,int,unsigned))(talk.snapshot.pokemon.species,talk.snapshot.pokemon.form,64,0,0,0,0,0);
 /* HGSS distressed pitch is -96/768 octaves. DS waveform speed is 25825;
    round(25825 * (2^(-96/768)-1)) = -2143. */
 if(talk.cryPending==2&&handle<16)CALL(0x02006b5d,void(*)(unsigned,int))(handle,-2143);
 talk.cryPending=0;
}
#ifdef FW_ITALY
/* Language data is loaded only on the Bag-full path into the shared contextual
   scratch buffer. It has no permanent allocation and never truncates text. */
static unsigned fwt_full_bag_text(uint16_t *out){
 int size=file_read("rom:/following/language.bin",contextBytes,sizeof(contextBytes));
 const uint8_t *bytes=(const uint8_t*)contextBytes;
 if(size<18||fwr_u32(bytes)!=0x474c5746||fwr_u16(bytes+4)!=1||fwr_u16(bytes+6)!=1||fwr_u32(bytes+8)!=(unsigned)size||fwr_crc(bytes+16,(unsigned)size-16)!=fwr_u32(bytes+12))return 0;
 unsigned words=((unsigned)size-16)/2;
 if(((unsigned)size-16)&1||words<2||words>FWR_TEXT_CAPACITY||fwr_u16(bytes+16+(words-1)*2)!=0xffff)return 0;
 for(unsigned i=0;i<words;++i)out[i]=fwr_u16(bytes+16+i*2);
 return words-1;
}
#else
static unsigned fwt_full_bag_text(uint16_t *out){static const uint16_t text[]={ 'T','h','e',' ','B','a','g',' ','i','s',' ','f','u','l','l','.',0xffff};for(unsigned i=0;i<17;++i)out[i]=text[i];return 16;}
#endif
static int message(void){
 if(!(talk.gift ? (talk.giftGranted ? fwr_item_text(&items,talk.itemRule,&talk.snapshot,talk.text,FWR_TEXT_CAPACITY) : fwt_full_bag_text(talk.text)) : (talk.contextual?fwr_context_text(&context,talk.contextRule,&talk.snapshot,talk.text,FWR_TEXT_CAPACITY):fwr_text(&data,talk.step.message,&talk.snapshot,talk.text,FWR_TEXT_CAPACITY))))return 0;
 void *bg=CALL(0x021804d1,void*(*)(void*))(talk.field);if(!bg||!PTR(bg,0x15c))return 0;
 /* The native lower dialogue slot is an embedded 52-byte object. */
 if(PTR(bg,0xc0+0x34+8))return 0;
 unsigned heap=CALL(0x02180501,unsigned(*)(void*))(talk.field);
 if(CALL(0x0203a2d5,unsigned(*)(unsigned))(heap)<32768)return 0;
 talk.string=CALL(0x0204855d,void*(*)(unsigned,unsigned))(FWR_TEXT_CAPACITY,heap);if(!talk.string)return 0;
 CALL(0x02048641,void(*)(void*,void*))(talk.string,talk.text);
 talk.position=talk.actor->world;
 talk.window=CALL(0x021887d9,void*(*)(void*,unsigned,void*,void*,unsigned,unsigned))(bg,1,&talk.position,talk.string,0,0);
 return talk.window!=0;
}
static int event_tick(void *event,int *seq,void *work){
 (void)seq;(void)work;
 if(!talk.active||event!=talk.event)return 1;
 if(!valid_actor()||!fwt_owns(talk.field)||U32(talk.field,0x148))return finish_event();
 unsigned held=CALL(0x0203df4d,unsigned(*)(void))(),pressed=CALL(0x0203df29,unsigned(*)(void))();
 if(!(held&3))talk.released=1;
 FollowingTalkDebug[3]=talk.stage;FollowingTalkDebug[11]++;cry();
 switch(talk.stage){
 case 0:
  if(talk.gift){talk.step=(FwrStep){.message=1,.wait=1,.cry=talk.giftGranted?1:0,.bubble=talk.giftGranted?1:0};talk.stage=talk.giftGranted?2:4;break;}
  if(talk.contextual){talk.step=(FwrStep){.message=1,.wait=1};talk.stage=4;break;}
  if(!fwr_step(&data,talk.rule,talk.stepIndex,&talk.step))return finish_event();
  talk.motion=(FwrMotion){.face=(uint8_t)talk.face};talk.stage=1;break;
 case 1:{
  int sound=0;
  if(fwr_motion_tick(&data,talk.step.action,&talk.motion,talk.snapshot.pokemon.species==50||talk.snapshot.pokemon.species==51,&sound)){
   talk.actor->drawOffset=(Vec){talk.offset.x+talk.motion.x,talk.offset.y+talk.motion.y,talk.offset.z+talk.motion.z};
   CALL(0x02167099,void(*)(Actor*,unsigned))(talk.actor,talk.motion.face);
   fwr_anchor(talk.actor,talk.motion.face);
   if(sound){talk.cryPending=talk.step.cry;cry();}
   break;
  }
  talk.actor->drawOffset=talk.offset;CALL(0x02167099,void(*)(Actor*,unsigned))(talk.actor,talk.face);fwr_anchor(talk.actor,talk.face);
  talk.stage=2;break;
 }
 case 2:
  talk.bubbleIndex=talk.bubbleAge=0;talk.age=0;
  if(talk.step.bubble&&emotesValid){const uint8_t *b=data.bytes+data.bubbles+(talk.step.bubble-1)*16;
   if(fwfx_emote_begin(talk.actor,fwr_u16(b+2))){talk.stage=3;break;}}
  talk.stage=4;break;
 case 3:{
  const uint8_t *b=data.bytes+data.bubbles+(talk.step.bubble-1)*16;
  if(talk.bubbleIndex<4){fwfx_emote_frame(talk.actor,b[12+talk.bubbleIndex]);if(++talk.bubbleAge>=fwr_u16(b+4+talk.bubbleIndex*2)){talk.bubbleAge=0;++talk.bubbleIndex;}}
  else if(++talk.age>=2){fwfx_emote_end();talk.stage=4;}
  break;
 }
 case 4:
  if(talk.step.message){if(!message()){FollowingTalkDebug[10]=2;return finish_event();}talk.stage=5;}
  else{talk.age=0;talk.stage=8;}break;
 case 5:
  if(CALL(0x021888c5,int(*)(void*))(talk.window)){CALL(0x02188a09,void(*)(void*))(talk.window);talk.stage=6;talk.released=0;}
  break;
 case 6:
  CALL(0x02188a09,void(*)(void*))(talk.window);
  if(talk.released&&(pressed&3)){CALL(0x02188815,void(*)(void*))(talk.window);talk.closing=1;talk.age=0;talk.stage=7;talk.released=0;}break;
 case 7:
  if(CALL(0x02188835,int(*)(void*))(talk.window)){talk.window=0;CALL(0x02048591,void(*)(void*))(talk.string);talk.string=0;talk.age=0;talk.stage=8;}
  else if(++talk.age>120){FollowingTalkDebug[10]=3;return finish_event();}
  break;
 case 8:
  if(talk.contextual||talk.gift)return finish_event();
  if(++talk.age>=talk.step.wait){++talk.stepIndex;talk.stage=0;}break;
 default:return finish_event();
 }
 return 0;
}
void *fwt_begin(FwFollower *f,Actor *player,Actor *actor,void *field,void *game,const FwrSnapshot *snapshot){
 if(talk.active||needRelease||!load()||!fwt_reach(f,player,actor,field)||PTR(game,0x18))return 0;
 if(CALL(0x0203a2d5,unsigned(*)(unsigned))(4)<16384)return 0;
 FwrSnapshot current=*snapshot;
 int dx=player->world.x-actor->world.x,dz=player->world.z-actor->world.z;
 unsigned face=abs32(dx)>abs32(dz)?(dx<0?2u:3u):(dz<0?0u:1u);
 current.direction=(uint8_t)face;
 void *gameData=PTR(field,8);
 int giftRule=-1,contextRule=-1,rule=-1;uint16_t claims=0;FwrItemChoice choice={0};
 int in=file_read("rom:/following/contextual-items.narc",contextBytes,sizeof(contextBytes));
 FollowingGiftDebug[2]++;FollowingGiftDebug[3]=(uint32_t)in;
 int itemsValid=in&&fwr_items_validate(&items,contextBytes,(unsigned)in);FollowingGiftDebug[4]=(uint32_t)itemsValid;
 int claimsValid=itemsValid&&gameData&&fwg_claims(gameData,&current,&claims);FollowingGiftDebug[5]=(uint32_t)claimsValid;FollowingGiftDebug[6]=claims;
 int giftChosen=claimsValid&&fwr_item_choose(&items,&current,claims,&choice);FollowingGiftDebug[7]=(uint32_t)giftChosen;
 FollowingGiftDebug[8]=giftChosen?choice.rule:0xffffffffu;FollowingGiftDebug[9]=0;FollowingGiftDebug[10]=giftChosen?choice.item:0;FollowingGiftDebug[11]=giftChosen?((uint32_t)choice.slot<<16)|choice.quantity:0;
 if(giftChosen)giftRule=(int)choice.rule;
 if(giftRule<0){int cn=file_read("rom:/following/contextual-dialogues.narc",contextBytes,sizeof(contextBytes));context=(FwrContext){0};if(cn)fwr_context_validate(&context,contextBytes,(unsigned)cn);contextRule=fwr_context_choose(&context,&current,&rng);rule=contextRule<0?fwr_choose(&data,&current,&rng):0;if(contextRule<0&&rule<0)return 0;}
 if(!fw_interact(f))return 0;
 talk.f=f;talk.callbacks=actor->callbacks;talk.system=actor->system;talk.actor=actor;talk.player=player;talk.field=field;talk.game=game;talk.snapshot=current;
 talk.generation=f->generation;talk.offset=actor->drawOffset;talk.face=(uint16_t)face;
 talk.rule=(unsigned)(rule<0?0:rule);talk.contextRule=(unsigned)(contextRule<0?0:contextRule);talk.itemRule=(unsigned)(giftRule<0?0:giftRule);talk.contextual=contextRule>=0;talk.gift=giftRule>=0;talk.item=choice;talk.giftGranted=talk.gift?fwg_grant(gameData,&current,&choice):0;FollowingGiftDebug[9]=(uint32_t)talk.giftGranted; if(talk.gift&&talk.giftGranted<0){fw_end_interaction(f);return 0;}talk.stage=talk.stepIndex=talk.age=0;talk.window=talk.string=0;talk.released=talk.cryPending=talk.closing=talk.finished=0;
 talk.event=CALL(0x02016cb5,void*(*)(void*,void*,void*,unsigned))(game,0,event_tick,4);
 if(!talk.event){fw_end_interaction(f);return 0;}
 talk.active=1;actor->flags|=16;CALL(0x02167099,void(*)(Actor*,unsigned))(actor,talk.face);fwr_anchor(actor,talk.face);
 CALL(0x0219a5d9,void(*)(void*))(PTR(field,0x94));
 FollowingTalkDebug[2]=1;FollowingTalkDebug[4]=talk.gift?(0x4000u|talk.itemRule):(talk.contextual?0x8000u|talk.contextRule:fwr_u16(data.bytes+data.rules+rule*12));FollowingTalkDebug[5]=snapshot->pokemon.species;FollowingTalkDebug[6]++;
 return talk.event;
}
