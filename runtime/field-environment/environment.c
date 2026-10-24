#include <stdint.h>
typedef uint32_t u32; typedef uint16_t u16; typedef uint8_t u8;
#define WORD(p,n) (*(u32 *)((u8 *)(p)+(n)))
#define CALL(addr,type) ((type)(addr))
volatile u32 field_environment_file=0xfeedface;
struct Cache {void *resource;u32 program;};
struct Upload {u32 kind,dest;void *source;u32 length;};
struct State {u32 magic;u8 *blob;void *field;u32 frame,started,completed,uploads,errors,resources;u32 lastLevel,lastTint;struct Cache cache[64];u32 replayReady,lastPair,audioOwned,audioPlaying;void *task;volatile u32 ready;u32 count;struct Upload transfers[48];u32 scan,treeCount,lastTreeFrame;u8 *trees[4];u32 mapActorsReady,baseFov,npcAgingActive;};
struct State field_environment_state={.magic=0x53455750,.lastLevel=0xffffffff,.lastTint=0xffffffff};
__attribute__((target("arm"),noinline)) static int32_t mul_fx(int32_t a,int32_t b){return (int32_t)((int64_t)a*b>>12);}
static int valid(const void *p){return (u32)p>=0x02000000&&(u32)p<0x02400000;}
__attribute__((target("arm"),noinline)) static u32 irq_lock(void){u32 before,after;__asm__ volatile("mrs %0,cpsr\norr %1,%0,#128\nmsr cpsr_c,%1":"=r"(before),"=r"(after)::"memory");return before;}
__attribute__((target("arm"),noinline)) static void irq_restore(u32 before){__asm__ volatile("msr cpsr_c,%0"::"r"(before):"memory");}
__attribute__((target("arm"),noinline)) static void code_sync(void){u32 zero=0;__asm__ volatile("mcr p15,0,%0,c7,c10,4\nmcr p15,0,%0,c7,c5,0"::"r"(zero):"memory");}
// Retail animation transfers share this queue with the scene's resources.
// Retain its FIFO and accounting, but leave late texture work for the next
// blank instead of temporarily unmapping a bank during 3D rendering.
static void safe_queue(void){
 u8 *q=(u8 *)0x02141a80;struct State *s=&field_environment_state;
 while(*(u16 *)(q+12)){
  u32 *t=CALL(0x0205f999,u32 *(*)(void *))(q),line=*(volatile u16 *)0x04000006;
  if(s->started&&!s->completed&&t[0]<2&&(line<192||line>202))return;
  if(!CALL(0x0205f9b1,int(*)(void *))(q))return;
  u32 irq=0,locked=s->started&&!s->completed&&t[0]<2;if(locked)irq=irq_lock();
  CALL(0x0205f941,void(*)(void *))(t);if(locked)irq_restore(irq);WORD(q,16)-=t[3];
 }
}
static u32 projection_move(void *vm,void *context){
 struct State *s=&field_environment_state;void *camera=valid(s->field)?(void *)WORD(s->field,16):0;
 if(s->blob&&valid(camera)&&WORD(s->blob,92)){
  u16 *a=(u16 *)WORD(vm,0x20);int32_t pose[6]={(int32_t)((u32)a[4]|(u32)a[5]<<16),(int32_t)((u32)a[6]|(u32)a[7]<<16),(int32_t)((u32)a[8]|(u32)a[9]<<16),(int32_t)((u32)a[2]|(u32)a[3]<<16),a[0],a[1]};
  if(!s->baseFov){s->baseFov=*(u16 *)((u8 *)camera+0x80);}
  u32 want=s->baseFov;
  for(u32 i=0;i<WORD(s->blob,92);i++){int32_t *p=(int32_t *)(s->blob+WORD(s->blob,96)+i*64);int same=1;for(u32 k=0;k<6;k++){int32_t end=p[k]+p[6+k];if(k>=4)end&=65535;if(pose[k]!=end){same=0;break;}}if(same)want=(u32)p[13];}
  CALL(0x0218642d,void(*)(void *,u32))(camera,want);
 }
 return CALL(0x021ae82d,u32(*)(void *,void *))(vm,context);
}
static void queue_hook(int install){
 u32 irq=irq_lock();u32 *entry=(u32 *)0x0205f9fc;
 if(install){entry[0]=0x47184b00;entry[1]=(u32)safe_queue;}
 else{entry[0]=0x4e0eb570;entry[1]=0xf7ff1c30;}
 *(u32 *)0x0216ba84=install?(u32)projection_move:0x021ae82d;CALL(0x0207b0d8,void(*)(void *,u32))((void *)0x0216ba84,4);
 CALL(0x0207b0d8,void(*)(void *,u32))(entry,8);code_sync();irq_restore(irq);
}
static void clear_cache(void){for(u32 i=0;i<64;i++){field_environment_state.cache[i].resource=0;field_environment_state.cache[i].program=0;}}
static u32 hash_dictionary(u8 *dict,u32 hash){
 u32 count=dict[1];u8 *entry=dict+*(u16 *)(dict+6);u32 stride=*(u16 *)entry;u8 *names=entry+*(u16 *)(entry+2);
 for(u32 i=0;i<count;i++){for(u32 k=0;k<16;k++)hash=(hash^names[i*16+k])*16777619;for(u32 k=0;k<stride;k++)hash=(hash^entry[4+i*stride+k])*16777619;}return hash;
}
static u32 *program_for(void *resource,u8 *tex){
 struct State *s=&field_environment_state;u32 freeSlot=64;
 for(u32 i=0;i<64;i++){if(s->cache[i].resource==resource)return s->cache[i].program?(u32 *)(s->blob+s->cache[i].program):0;if(!s->cache[i].resource&&freeSlot==64)freeSlot=i;}
 u32 hash=hash_dictionary(tex+*(u16 *)(tex+14),2166136261);hash=hash_dictionary(tex+WORD(tex,52),hash);u32 offset=0;
 for(u32 i=0;i<WORD(s->blob,12);i++){u32 at=WORD(s->blob,48)+i*40;if(WORD(s->blob,at)==hash){offset=at;s->resources++;break;}}
 if(freeSlot<64){s->cache[freeSlot].resource=resource;s->cache[freeSlot].program=offset;}return offset?(u32 *)(s->blob+offset):0;
}
static void transfer(u32 kind,u32 dest,void *source,u32 length){
 struct State *s=&field_environment_state;
 for(u32 i=0;i<s->count;i++)if(s->transfers[i].kind==kind&&s->transfers[i].dest==dest)return;
 if(s->count==48){s->errors++;return;}
 CALL(0x0207b0d8,void(*)(void *,u32))(source,length);
 s->transfers[s->count++]=(struct Upload){kind,dest,source,length};
}
// Keep each VRAM bank mapped away from the renderer only once per batch. The
// native per-transfer queue remaps all texture banks for every small span and
// can extend beyond the 3D engine's scanline-214 rendering deadline.
static void upload(void *task,void *unused){
 (void)task;(void)unused;struct State *s=&field_environment_state;
 u32 line=*(volatile u16 *)0x04000006;if(!s->ready||line<192||line>196)return;
 u32 irq=irq_lock();
 for(u32 kind=0;kind<2;kind++){
  int opened=0;
  for(u32 i=0;i<s->count;i++){struct Upload *t=&s->transfers[i];if(t->kind!=kind)continue;
   if(!opened){CALL(kind?0x020762e1:0x02076165,void(*)(void))();opened=1;}
   CALL(kind?0x02076301:0x0207619d,void(*)(void *,u32,u32))(t->source,t->dest,t->length);s->uploads++;
  }
  if(opened)CALL(kind?0x02076361:0x020762a5,void(*)(void))();
 }
 s->ready=0;irq_restore(irq);
}
static void resource(void *res,int changed){
 if(!valid(res))return;
 u8 *tex=CALL(0x0204964d,u8 *(*)(void *))(res);if(!valid(tex))return;
 u32 *p=program_for(res,tex);if(!p)return;u8 *blob=field_environment_state.blob;
 u32 palKey=WORD(tex,44),texKey=WORD(tex,8);if(!palKey)return;
 // NNS keys store VRAM offsets in their low 16 bits, in eight-byte units.
 transfer(1,(palKey&65535)<<3,blob+p[4],p[1]);
 if(changed)for(u32 i=0;i<p[5];i++){
  u32 *t=(u32 *)(blob+p[6]+i*32),*dirty=(u32 *)(blob+t[7]);if(!dirty[0])continue;
  u32 first=dirty[1]&~31u,end=first+32;
  for(u32 j=1;j<dirty[0];j++){
   u32 next=dirty[j+1]&~31u;if(next<end)continue;
   if(next>end+96){transfer(0,((texKey&65535)<<3)+t[0]+first,blob+t[5]+first,end-first);first=next;}
   end=next+32;
  }
  transfer(0,((texKey&65535)<<3)+t[0]+first,blob+t[5]+first,end-first);
 }
}

static void recolor(u32 level,u32 tint,int alphaChanged,u32 from,u32 to){
 struct State *s=&field_environment_state;u8 *blob=s->blob;static const u8 bayer[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
 for(u32 i=0;i<WORD(blob,12);i++){u32 *p=(u32 *)(blob+WORD(blob,48)+i*40);u32 *banks=(u32 *)(blob+p[7]);u16 *a=(u16 *)(blob+banks[from]),*b=(u16 *)(blob+banks[to]),*out=(u16 *)(blob+p[8]);
  u8 *mix=blob+WORD(blob,56)+(level<<10),*red=blob+WORD(blob,60)+((tint&31)<<5),*green=blob+WORD(blob,60)+(((tint>>5)&31)<<5),*blue=blob+WORD(blob,60)+((tint>>10)<<5);
  for(u32 j=0;j<p[3];j++){
   u32 x=a[j],y=b[j],r=x&31,g=(x>>5)&31,c=x>>10;
   if(x!=y){r=mix[(r<<5)|(y&31)];g=mix[(g<<5)|((y>>5)&31)];c=mix[(c<<5)|(y>>10)];}
   out[j]=red[r]|(green[g]<<5)|(blue[c]<<10);
  }
  u16 *mapping=(u16 *)(blob+p[2]),*work=(u16 *)(blob+p[4]);for(u32 j=0;j<p[1]/2;j++)work[j]=out[mapping[j]];
  if(alphaChanged)for(u32 k=0;k<p[5];k++){u32 *t=(u32 *)(blob+p[6]+k*32);u8 *indices=blob+t[3],*masks=blob+t[4],*pixels=blob+t[5];u32 shift=0;while((1u<<shift)<t[1])shift++;u32 *dirty=(u32 *)(blob+t[7]);for(u32 n=0;n<dirty[0];n++){u32 j=dirty[n+1];u32 x=j&(t[1]-1),y=j>>shift,target=level>bayer[(y&3)*4+(x&3)]*2,mask=masks[j];if(t[6]==4)pixels[j]=(mask&(1u<<(target?to:from)))?indices[j]:0;else{u32 x=masks[j*4+from],y=masks[j*4+to],alpha=blob[WORD(blob,56)+(level<<10)+(x<<5)+y];pixels[j]=indices[j]|(alpha<<(t[6]==1?5:3));}}}
 }
}
static void music_stop(void){
 struct State *s=&field_environment_state;if(!s->audioPlaying)return;
 CALL(0x02007091,void(*)(void))();CALL(0x02005f95,void(*)(u32,int))(65535,127);s->audioPlaying=0;
}
static void music_start(void *field){
 struct State *s=&field_environment_state;u32 id=WORD(s->blob,72);if(!id)return;
 if(!CALL(0x02007041,u32(*)(void))()){CALL(0x02006fc9,void(*)(u32))(CALL(0x02180501,u32(*)(void *))(field));s->audioOwned=1;}
 CALL(0x02005f95,void(*)(u32,int))(65535,0);CALL(0x02007055,void(*)(u32))(id-1);s->audioPlaying=1;
}
static void extras(void *props,u32 step){
 if(!valid(props)||!step)return;
 u32 count=WORD(props,0x244);u8 *instances=(u8 *)WORD(props,0x248);if(count>512||!valid(instances))return;
 for(u32 i=0;i<count;i++){u8 *instance=instances+i*24;void *actor=(void *)WORD(instance,0),*r=(void *)WORD(instance,4);if(!valid(actor)||!valid(r))continue;
  for(u32 a=0;a<4;a++){void *anm=(void *)WORD(r,8+a*4);if(!valid(anm))continue;u8 *data=CALL(0x0204945d,u8 *(*)(void *))(anm);if(!valid(data))continue;u32 stamp=WORD(data,0);if(stamp==0x30415442||stamp==0x30505442)CALL(0x02049a91,void(*)(void *,u32,u32))(actor,a,step);}
 }
}
static void grow_trees(void){
 struct State *s=&field_environment_state;if(!WORD(s->blob,76))return;
 if(s->treeCount<WORD(s->blob,76)){
  u32 end=s->scan+65536;if(end>0x023ffff0)end=0x023ffff0;
  for(u32 at=s->scan;at<end;at+=4){u8 *p=(u8 *)at;if(WORD(p,0)!=0x52545750||WORD(p,4)!=0x32574f52)continue;u32 back=WORD(p,8),size=WORD(p,12);if(back>at-0x02000000||size>65536||size!=back+16)continue;u8 *model=p-back;if(WORD(model,0)!=0x30444d42||WORD(model,8)!=size)continue;s->trees[s->treeCount++]=model;s->lastTreeFrame=0xffffffff;if(s->treeCount==WORD(s->blob,76))break;}
  s->scan=end>=0x023ffff0?0x02000000:end;
 }
 if(s->lastTreeFrame==s->frame)return;
 s->lastTreeFrame=s->frame;
 for(u32 i=0;i<s->treeCount;i++){u8 *p=s->blob+WORD(s->blob,80),*model=s->trees[i];if(WORD(model,0)!=0x30444d42||WORD(model,8)!=WORD(p,12))continue;u32 count=WORD(p,16),frame=s->frame;if(frame>WORD(p,20))frame=WORD(p,20);u32 low=0xffffffff,high=0;
  for(u32 j=0;j<count;j++){u8 *v=p+WORD(p,24)+j*20;u32 offset=WORD(v,0);u8 *curve=p+WORD(v,4);u32 start=WORD(curve,0),duration=WORD(curve,4),sample=frame>start?frame-start:0;if(sample>duration)sample=duration;u32 scale=*(u16 *)(p+WORD(curve,8)+sample*2);if(offset+8>=WORD(p,8)){s->errors++;break;}int16_t *full=(int16_t *)(v+8),*anchor=(int16_t *)(v+14),*out=(int16_t *)(model+offset);for(u32 k=0;k<3;k++)out[k]=(int16_t)(anchor[k]+(((int32_t)full[k]-anchor[k])*(int32_t)scale>>12));if(offset<low)low=offset;if(offset+8>high)high=offset+8;}
  if(high>low)CALL(0x0207b0d8,void(*)(void *,u32))(model+low,high-low);
 }
}
// Match the native shot transform, rather than a wall-clock frame. Native
// text printing can extend a dialogue block without desynchronizing its FOV.
static void shot_projection(void *camera,u32 unbound){
 struct State *s=&field_environment_state;if(!WORD(s->blob,92))return;
 if(!s->baseFov)s->baseFov=*(u16 *)((u8 *)camera+0x80);
 u32 want=s->baseFov;
 if(s->started&&unbound){int32_t live[6]={(int32_t)WORD(camera,0x48),(int32_t)WORD(camera,0x4c),(int32_t)WORD(camera,0x50),(int32_t)WORD(camera,0x7c),*(u16 *)((u8 *)camera+0x78),*(u16 *)((u8 *)camera+0x7a)};
  for(u32 i=0;i<WORD(s->blob,92);i++){int32_t *p=(int32_t *)(s->blob+WORD(s->blob,96)+i*64);u32 axis=(u32)p[12],t=0;int32_t delta=p[6+axis],at=live[axis]-p[axis];
   if(delta){if(delta<0){delta=-delta;at=-at;}if(at< -20||at>delta+20)continue;for(u32 bit=2048;bit;bit>>=1)if(t+bit<=4096&&mul_fx(delta,(int32_t)(t+bit))<=at)t+=bit;if(at>=delta)t=4096;}
   if(!p[14]&&!t)continue;
   int match=1;for(u32 k=0;k<6;k++){int32_t difference=live[k]-p[k];if(k>=4)difference=(int16_t)difference;int32_t expected=mul_fx(p[6+k],(int32_t)t),error=difference-expected,tolerance=k>=4?2:512;if(error< -tolerance||error>tolerance){match=0;break;}}
   if(match)want=(u32)p[13];
  }
 }
 if(*(u16 *)((u8 *)camera+0x80)!=want)CALL(0x0218642d,void(*)(void *,u32))(camera,want);
}
// Continue may restore NPCs from an older save instead of the edited zone
// records. Synchronize only this scene's reserved actors before player input.
static void restore_map_actors(void){
 struct State *s=&field_environment_state;if(s->mapActorsReady||!WORD(s->blob,84))return;
 void *system=(void *)WORD(s->field,0x40);if(!valid(system))return;
 u32 capacity=*(u16 *)((u8 *)system+4);u8 *actors=(u8 *)WORD(system,0x1c);if(!valid(actors)||!capacity||capacity>256)return;
 int player=0;for(u32 i=0;i<capacity;i++)if((WORD(actors+i*256,0)&1)&&*(u16 *)(actors+i*256+8)==255)player=1;if(!player)return;
 for(u32 j=0;j<WORD(s->blob,84);j++){u32 *p=(u32 *)(s->blob+WORD(s->blob,88)+j*20);int found=0;
  for(u32 i=0;i<capacity;i++)if((WORD(actors+i*256,0)&1)&&*(u16 *)(actors+i*256+8)==p[0])found=1;
  if(found)continue;
  u32 heap=CALL(0x02180519,u32(*)(void *))(s->field);
  void *actor=CALL(0x021668c1,void *(*)(void *,int,int,u32,u32,u32,u32,u32))(system,(int)p[2],(int)p[3],p[4],p[0],p[1],0,heap);
  if(actor)CALL(0x02167629,void(*)(void *))(actor);else s->errors++;
 }
 s->mapActorsReady=1;
}
// Change only the native renderer/appearance, retaining the actor and its
// movement, facing and event binding. No persistent aging flag is written.
static void age_map_npcs(void){
 struct State *s=&field_environment_state;if(!WORD(s->blob,100))return;
 void *system=(void *)WORD(s->field,0x40);if(!valid(system))return;
 u32 capacity=*(u16 *)((u8 *)system+4);u8 *actors=(u8 *)WORD(system,0x1c);if(!valid(actors)||!capacity||capacity>256)return;
 if(s->started&&s->frame>=WORD(s->blob,108))s->npcAgingActive=1;
 for(u32 i=0;i<capacity;i++){u8 *actor=actors+i*256;if(!(WORD(actor,0)&1))continue;u32 id=*(u16 *)(actor+8);if(id>=254)continue;
  for(u32 j=0;j<WORD(s->blob,100);j++){u32 *p=(u32 *)(s->blob+WORD(s->blob,104)+j*12);if(id!=p[0])continue;
   u32 from=p[s->npcAgingActive?1:2],to=p[s->npcAgingActive?2:1];
   // A native save can cache actors. Before a new tour, restore their ordinary
   // map appearance as well as starting with an inactive effect on re-entry.
   if(*(u16 *)(actor+12)==from)CALL(0x02167e29,void(*)(void *,u32))(actor,to);
  }
 }
}
void field_environment_init(void *field){
 CALL(0x021eecc1,void(*)(void *))(field);struct State *s=&field_environment_state;clear_cache();s->field=field;s->frame=s->started=s->completed=s->uploads=s->errors=s->resources=s->replayReady=0;s->lastLevel=s->lastTint=s->lastPair=0xffffffff;s->audioOwned=s->audioPlaying=0;
 u32 heap=CALL(0x02180501,u32(*)(void *))(field);s->blob=CALL(0x0204a961,u8 *(*)(u32,u32,u32))(69,field_environment_file,heap);
 if(!valid(s->blob)||WORD(s->blob,0)!=0x45465750){s->errors++;s->blob=0;return;}
 s->ready=s->count=0;s->task=CALL(0x020056fd,void *(*)(void *,void *,u32))((void *)upload,0,0);if(!s->task)s->errors++;
 queue_hook(1);
 s->baseFov=0;s->mapActorsReady=0;s->npcAgingActive=0;s->scan=0x02000000;s->treeCount=0;s->lastTreeFrame=0xffffffff;
 if(CALL(0x020173ad,u32(*)(void *))((void *)WORD(field,8))==WORD(s->blob,40))s->frame=WORD(s->blob,44);
}
void field_environment_update(void *field){
 CALL(0x021eed21,void(*)(void *))(field);struct State *s=&field_environment_state;if(!s->blob||field!=s->field)return;
 restore_map_actors();age_map_npcs();
 u8 *blob=s->blob;void *camera=(void *)WORD(field,0x10),*mapper=(void *)WORD(field,0x50);if(!valid(camera)||!valid(mapper))return;
 void *area=(void *)WORD(field,0x48);u32 unbound=WORD(camera,0x1c)==0;shot_projection(camera,unbound);
 if(s->completed&&!unbound){s->replayReady=1;if(valid((void *)WORD(field,0x48)))WORD((void *)WORD(field,0x48),0x18)=1;grow_trees();return;}
 if(unbound&&valid(area))WORD(area,0x18)=0;else if(valid(area))WORD(area,0x18)=1;
 if(s->completed&&unbound&&s->replayReady){s->started=0;s->completed=0;s->replayReady=0;}
 if(!s->started&&unbound&&CALL(0x02154111,u32(*)(u32))(0)){int32_t *position=(int32_t *)WORD(camera,0x18);if(valid(position)&&position[0]==(int32_t)WORD(blob,32)&&position[2]==(int32_t)WORD(blob,36)){s->started=1;s->frame=0;music_start(field);}}
 if(s->started&&s->frame<WORD(blob,44)){s->frame++;if(s->frame==WORD(blob,44))s->completed=1;}
 grow_trees();
 u32 f=s->frame;u16 *sample=(u16 *)(blob+WORD(blob,52)+f*16);u32 level=sample[0],tint=sample[1],from=sample[2],to=sample[3],pair=from|(to<<8);int alphaChanged=level!=s->lastLevel||pair!=s->lastPair,changed=alphaChanged||tint!=s->lastTint;
 if(s->ready)changed=0;
 if(changed){s->count=0;recolor(level,tint,alphaChanged,from,to);s->lastLevel=level;s->lastTint=tint;s->lastPair=pair;}
 if(s->started&&f>=WORD(blob,20)){void *gameData=(void *)WORD(field,8);CALL(0x020173b5,void(*)(void *,u32))(gameData,WORD(blob,40));if(!WORD(blob,64))CALL(0x020175f1,void(*)(void *,u32))(gameData,1);if(WORD(blob,64)){void *work=CALL(0x02017395,void *(*)(void *))(gameData);u16 *saved=CALL(0x020192c1,u16 *(*)(void *,u32))(work,WORD(blob,64));*saved=(u16)(WORD(blob,68)|WORD(blob,40));}}
 void *props=(void *)WORD(mapper,0x64),*animator=(void *)WORD(mapper,0x68);u32 speed=s->started?WORD(sample,8):4096;
 if(valid(animator))WORD(animator,4)=speed;
 if(valid(props)){if(s->started&&f>=WORD(blob,20))*((u8 *)props+0x15)=(u8)WORD(blob,40);extras(props,speed-4096);}
 if(s->completed)music_stop();
 // Requeue palette buffers: time-of-day prop animations may select other palettes.
 if(changed)resource((void *)WORD(mapper,0x60),alphaChanged);
 if(changed&&valid(props)){resource((void *)WORD(props,0x240),alphaChanged);u32 count=WORD(props,0x238);u8 *resources=(u8 *)WORD(props,0x23c);if(count<512&&valid(resources))for(u32 i=0;i<count;i++)resource((void *)WORD(resources+i*24,4),alphaChanged);}
 if(changed)s->ready=1;
}
void field_environment_free(void *field){
 struct State *s=&field_environment_state;queue_hook(0);s->ready=0;if(s->task){CALL(0x0203a6d5,void(*)(void *))(s->task);s->task=0;}music_stop();if(s->audioOwned){CALL(0x0200700d,void(*)(void))();s->audioOwned=0;}if(s->blob){CALL(0x0203a279,void(*)(void *))(s->blob);s->blob=0;}s->field=0;clear_cache();CALL(0x021eecf9,void(*)(void *))(field);
}
