using u8=unsigned char;using u16=unsigned short;using u32=unsigned int;
#include "profiles.generated.h"
template<class T>T& at(void* p,u32 n){return *reinterpret_cast<T*>(static_cast<u8*>(p)+n);}
template<class F>F api(u32 a){return reinterpret_cast<F>(nativeAddress(a)|1);}
template<class F>F ov(u32 a){return reinterpret_cast<F>(overlayAddress(a)|1);}
constexpr u32 INVALID=0xffffffff;
struct Session {u32 magic;void* work;void* unit;void* actors[8];u32 chars[8],palette,animation;void* art[8];void* task;u8 held,edge,hp,slot,candy,visible,pressed,error;u16 repeat;u8 dirty,nativePrompt;u16 oldItem;u32 oldMode;void* request;u16 frame[92];u8 frameSaved,frameHidden,hasCandy,nav,navItem,reserved,border,confirm;void* confirmText;u16 colors[48];void* restoreActor;void* restoreArt;u32 restoreChar;} session;
static_assert(__builtin_offsetof(Session,hp)==122);
static_assert(__builtin_offsetof(Session,hasCandy)==330);
static_assert(__builtin_offsetof(Session,confirmText)==336);
static_assert(__builtin_offsetof(Session,colors)==340);
static_assert(__builtin_offsetof(Session,restoreActor)==436);
constexpr u32 BUTTONS=9,RESTORE=8;
void*& actor(u32 i){return i==RESTORE?session.restoreActor:session.actors[i];}
void*& art(u32 i){return i==RESTORE?session.restoreArt:session.art[i];}
u32& character(u32 i){return i==RESTORE?session.restoreChar:session.chars[i];}
u32 order(u32 i){return i==0?0:i==RESTORE?1:i+1;}
u32 button(u32 position){return position==0?0:position==1?RESTORE:position-1;}
u32 centerX(u32 i){return 13+20*order(i);}
void* evolutionOwner;
void* flagRequest;
void* flagWork;
void* fallbackWork;
void clear(void* p,u32 n){for(u32 i=0;i<n;i++)at<u8>(p,i)=0;}
void* request(void* w){return at<void*>(w,0x28c);}
bool eligible(void* w){return w&&at<u32>(request(w),0x44)==0;}
bool ownsCandy(void* w){void* bag=at<void*>(request(w),4);return bag&&api<u32(*)(void*,u32,u32,u32)>(0x2008474)(bag,622,1,at<u16>(w,0));}
u32 get(void* p,u32 f){return api<u32(*)(void*,u32,void*)>(0x201cd24)(p,f,nullptr);}
void* selected(void* w,u32 slot){void* p=at<void*>(request(w),0);if(slot>=6||slot>=api<u32(*)(void*)>(0x201fe24)(p))return nullptr;void* mon=api<void*(*)(void*,u32)>(0x201ff34)(p,slot);return get(mon,76)?nullptr:mon;}
void hideCancel(void* w){for(u32 offset=0x1e8;offset<=0x1ec;offset+=4){void* actor=at<void*>(w,offset);if(actor)api<void(*)(void*,u32)>(0x204c150)(actor,0);}}
void sound(){api<void(*)(u32)>(0x2006254)(1356);}
void moveSound(){api<void(*)(u32)>(0x2006254)(1352);}
void promptHidden(void* w,bool hide){
 if(session.work!=w||hide==bool(session.frameHidden))return;
 void* prompt=at<void*>(w,0x154);if(!prompt)return;
 void* window=at<void*>(prompt,4);if(!window)return;
 // This verified 256px BG0 map owns the prompt's 23x4 tile rectangle.
 // Edit its native RAM buffer and queue its normal VBlank screen upload.
 if(at<u8>(window,2)!=0||at<u8>(window,3)!=1||at<u8>(window,4)!=21||at<u8>(window,7)!=21||at<u8>(window,8)!=2)return;
 u16* map=api<u16*(*)(u32)>(0x2045840)(0);if(!map)return;
 for(u32 y=0;y<4;y++)for(u32 x=0;x<23;x++){
  u32 index=y*23+x,offset=(20+y)*32+x;
  if(hide){if(!session.frameSaved)session.frame[index]=map[offset];map[offset]=0;}
  else if(session.frameSaved)map[offset]=session.frame[index];
 }
 session.frameSaved=1;session.frameHidden=hide;api<void(*)(u32)>(0x2045ba8)(0);
}
void blank(void* w,void* prompt){if(!prompt||!at<void*>(prompt,4))return;api<void(*)(void*)>(0x2021c70)(at<void*>(prompt,40));at<u32>(prompt,36)=0;ov<void(*)(void*,void*)>(0x219fac4)(w,prompt);if(session.work==w){session.frameHidden=0;session.nativePrompt=0;}}
void restoreCandy(){if(!session.candy||!session.request)return;at<u32>(session.request,0x44)=session.oldMode;at<u16>(session.request,0x54)=session.oldItem;session.candy=0;}
void dispose(){
 if(session.confirmText){if(session.work)api<void(*)(void*)>(0x2021c70)(at<void*>(at<void*>(session.work,0x154),40));api<void(*)(void*)>(0x2048590)(session.confirmText);session.confirmText=nullptr;}
 if(session.work)promptHidden(session.work,false);
 if(session.task)api<void(*)(void*)>(0x203a6d4)(session.task);
 session.task=nullptr;
 for(u32 i=0;i<BUTTONS;i++){if(actor(i))api<void(*)(void*)>(0x204c134)(actor(i));if(art(i))api<void(*)(void*)>(0x203a278)(art(i));if(character(i)!=INVALID)api<void(*)(u32)>(0x204b9b8)(character(i));}
 if(session.unit)api<void(*)(void*)>(0x204bfc4)(session.unit);
 if(session.palette!=INVALID)api<void(*)(u32)>(0x204bcfc)(session.palette);
 if(session.animation!=INVALID)api<void(*)(u32)>(0x204be90)(session.animation);
 clear(&session,sizeof(session));session.palette=session.animation=INVALID;for(u32 i=0;i<BUTTONS;i++)character(i)=INVALID;
}
void upload(void*,void*){
 if(!session.work)return;
 // Reuse the native selector's animated teal shade, including its 64-frame
 // sine fade. Persistent data goes through the native palette upload queue.
 // Only unused selector entries change; the HP underline keeps its own color.
 u16 color=session.nav&&session.border!=255?at<u16>(session.work,0xac):0x7fe0;
 if(session.palette!=INVALID&&(session.colors[15]!=color||session.colors[25]!=color||session.colors[47]!=color)){
  session.colors[15]=session.colors[25]=session.colors[47]=color;
  struct Palette{u32 format,extended,size;void* data;}p={3,0,96,session.colors};
  api<void(*)(u32,const void*,u32)>(0x204bd3c)(session.palette,&p,0);
 }
 for(u32 i=0;i<BUTTONS;i++){
  if(session.dirty&&art(i)){struct Character{u16 h,w;u32 format,mapping,character,size;void* data;}c={0xffff,0xffff,3,16,0,512,art(i)};api<void(*)(u32,const void*)>(0x204ba6c)(character(i),&c);}
  if(actor(i))api<void(*)(void*,u32)>(0x204c150)(actor(i),session.visible&&(i||session.hasCandy));
 }
 session.dirty=0;
}
void hpMode(bool active){
 session.hp=active;session.repeat=0;
 if(!session.art[1])return;
 // Keep the native HP glyph unchanged; a teal underline marks HP mode.
 for(u32 y=22;y<24;y++)for(u32 x=8;x<24;x++){u32 offset=((y/8)*4+x/8)*32+(y%8)*4+x%8/2;u8& pixel=at<u8>(session.art[1],offset);u32 shift=(x%2)*4;pixel=(pixel&~(15<<shift))|((active?15:0)<<shift);}
 session.dirty=1;
}
bool configuredOn(void* w,void* c){
 if(!c||at<u32>(c,0)!=0x51415050||at<u32>(c,12)!=1)return false;
 if(at<u32>(c,4)==1)return at<u32>(c,8)==20&&at<u32>(c,16)==(0x51415050^1);
 if(at<u32>(c,4)!=2||at<u32>(c,8)!=24)return false;
 u32 flag=at<u32>(c,16);if(flag>3059||at<u32>(c,20)!=(0x51415050^1^flag))return false;
 if(!flag)return true;
 // Capture EventWork from GameData while the native field application builds
 // this exact party request. Its lifetime belongs to the native field event.
 // A missing/mismatched owner leaves the vanilla menu available.
 return flagRequest==request(w)&&flagWork&&!api<u32(*)(void*,u16)>(0x20191d8)(flagWork,static_cast<u16>(flag));
}
bool enabledArchive(void* w){u32 heap=at<u16>(w,0);void* h=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(heap,80,1,"party-tools",0);if(!h)return false;api<void(*)(void*)>(0x2070ca8)(h);if(!api<u32(*)(void*,const char*)>(0x2070ecc)(h,"rom:/party-tools/ui.narc")){api<void(*)(void*)>(0x203a278)(h);return false;}api<void(*)(void*)>(0x204aac8)(h);void* c=api<void*(*)(void*,u32,u32)>(0x204ab48)(h,0,heap);bool on=configuredOn(w,c);if(c)api<void(*)(void*)>(0x203a278)(c);api<void(*)(void*)>(0x204ab38)(h);return on;}
bool capacity(u32 heap){void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));if(!sys)return false;u32 free=0;void* chars=at<void*>(sys,0x10c);for(u32 i=0;i<at<u16>(sys,0x118);i++)if(at<u32>(chars,i*64+60)&0x80000000)free++;if(free<BUTTONS)return false;void* palettes=at<void*>(sys,0x110);bool pal=false;for(u32 i=0;i<at<u16>(sys,0x11a);i++){u32 size=at<u32>(palettes,i*24+20),start=at<u32>(palettes,i*24+12);if(size&0x80000000)pal=true;else if(start!=INVALID&&start<512&&start+(size?size:32)>416)return false;}void* anim=at<void*>(sys,0x114);bool animation=false;for(u32 i=0;i<at<u16>(sys,0x11c);i++)if(at<u32>(anim,i*20+16))animation=true;return pal&&animation&&api<u32(*)(u32)>(0x2039f8c)(heap)>=18432&&api<u32(*)(u32)>(0x2039fbc)(heap)>=8192;}
void attach(void* w){
 // BSS starts zero before the first initialization; never free handle zero then.
 if(session.magic==0x53504150)dispose();else{clear(&session,sizeof(session));session.palette=session.animation=INVALID;for(u32 i=0;i<BUTTONS;i++)character(i)=INVALID;}
 if(!eligible(w))return;
 session.magic=0x53504150;session.work=w;session.error=1;session.pressed=session.border=255;
 u32 heap=at<u16>(w,0);void* h=api<void*(*)(u32,u32,u32,const char*,u32)>(0x203a228)(heap,80,1,"party-tools",0);if(!h){dispose();return;}
 api<void(*)(void*)>(0x2070ca8)(h);
 if(!api<u32(*)(void*,const char*)>(0x2070ecc)(h,"rom:/party-tools/ui.narc")){api<void(*)(void*)>(0x203a278)(h);dispose();return;}
 api<void(*)(void*)>(0x204aac8)(h);
 void* config=api<void*(*)(void*,u32,u32)>(0x204ab48)(h,0,heap);bool on=configuredOn(w,config);
 if(config)api<void(*)(void*)>(0x203a278)(config);
 if(on&&!capacity(heap))on=false;
 if(on){
  void* colors=api<void*(*)(void*,u32,u32)>(0x204ab48)(h,1,heap);
  on=colors&&at<u32>(colors,0)==0x4e434c52&&at<u32>(colors,32)==96&&at<u32>(colors,36)==16;
  if(on)for(u32 i=0;i<48;i++)session.colors[i]=at<u16>(colors,40+i*2);
  if(colors)api<void(*)(void*)>(0x203a278)(colors);
 }
 if(on){
  session.error=2;session.palette=api<u32(*)(void*,u32,u32,u32,u32)>(0x204bbcc)(h,1,0,416,heap);session.animation=api<u32(*)(void*,u32,u32,u32)>(0x204be0c)(h,2,3,heap);session.unit=api<void*(*)(u32,u32,u32)>(0x204bf48)(BUTTONS,BUTTONS,heap);
  on=session.palette!=INVALID&&session.animation!=INVALID&&session.unit;
  for(u32 i=0;on&&i<BUTTONS;i++){
   session.error=3+i;art(i)=api<void*(*)(void*,u32,u32)>(0x204ab48)(h,4+i,heap);character(i)=api<u32(*)(u32,u32,u32)>(0x204b8e8)(512,0,heap);on=art(i)&&character(i)!=INVALID;
   if(on){void* sys=*reinterpret_cast<void**>(nativeAddress(0x214197c));void* resource=static_cast<u8*>(at<void*>(sys,0x10c))+character(i)*64;on=!api<u32(*)(void*)>(0x203cb14)(static_cast<u8*>(resource)+0x2c);}
   if(on){struct ActorData{u16 x,y,sequence;u8 priority,bg;}data={static_cast<u16>(centerX(i)),180,static_cast<u16>(i),0,0};actor(i)=api<void*(*)(void*,u32,u32,u32,const void*,u32,u32)>(0x204c06c)(session.unit,character(i),session.palette,session.animation,&data,0,heap);on=actor(i);if(on){api<void(*)(void*,u32)>(0x204c54c)(actor(i),1);api<void(*)(void*,u32)>(0x204c150)(actor(i),0);}}
  }
 }
 api<void(*)(void*)>(0x204ab38)(h);
 if(on){session.dirty=1;session.task=api<void*(*)(void*,void*,u32)>(0x20056fc)(reinterpret_cast<void*>(upload),nullptr,2);on=session.task;}
 if(!on){dispose();return;}session.error=0;session.hasCandy=ownsCandy(w);blank(w,at<void*>(w,0x154));promptHidden(w,true);hideCancel(w);
}
void redraw(void* w,u32 slot){void* t=at<void*>(w,0x164+slot*4);void* mon=selected(w,slot);if(!t||!mon)return;u16 hp=get(mon,160);at<u16>(t,6)=at<u16>(t,8)=hp;ov<void(*)(void*,void*)>(0x219f350)(w,t);ov<void(*)(void*,void*,u32)>(0x219f0e0)(w,t,hp?0:6);}
void candy(void* w,void* mon,u32 slot){
 if(!ownsCandy(w)||get(mon,158)>=100)return;
 promptHidden(w,false);
 session.request=request(w);session.oldMode=at<u32>(session.request,0x44);session.oldItem=at<u16>(session.request,0x54);session.candy=1;
 at<u32>(session.request,0x44)=5;at<u16>(session.request,0x54)=622;at<u32>(session.request,0x4c)=slot;at<void*>(w,0x3c)=mon;
 // Enter the native medicine route after its selection check. It owns level
 // changes, stats, friendship, learned moves, messages and evolution checks.
 ov<void(*)(void*)>(0x219b30c)(w);
}
extern "C" u32 PaInit(void* w){u32 r=ov<u32(*)(void*)>(0x2199bc8)(w);if(r){attach(w);fallbackWork=eligible(w)&&session.work!=w?w:nullptr;if(fallbackWork)ov<void(*)(void*,void*,u32)>(0x219f880)(w,at<void*>(w,0x154),9);}return r;}
extern "C" void* PaRequest(void* game,u32 mode,void* party,u32 heap){void* r=api<void*(*)(void*,u32,void*,u32)>(0x2034c80)(game,mode,party,heap);flagRequest=r;flagWork=r?api<void*(*)(void*)>(0x2017394)(game):nullptr;return r;}
extern "C" u32 PaEnd(void* w){if(session.work==w){if(session.candy&&(at<u32>(request(w),0x50)==5||at<u32>(request(w),0x50)==9))evolutionOwner=request(w);restoreCandy();dispose();}if(flagRequest==request(w)){flagRequest=nullptr;flagWork=nullptr;}if(fallbackWork==w)fallbackWork=nullptr;return ov<u32(*)(void*)>(0x2199de8)(w);}
extern "C" void PaPrompt(void* w,void* p,u32 message){if(fallbackWork!=w&&eligible(w)&&message==9&&enabledArchive(w))blank(w,p);else{if(session.work==w)session.nativePrompt=1;promptHidden(w,false);ov<void(*)(void*,void*,u32)>(0x219f880)(w,p,message);}}
extern "C" void PaSubtract(void* w,u32 item){if(session.work!=w||!session.candy)ov<void(*)(void*,u32)>(0x219e688)(w,item);}
extern "C" u32 PaTick(void* w){
 if(session.work==w){u32 x=0,y=0;bool down=api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);session.edge=down&&!session.held;session.held=down;session.visible=eligible(w)&&at<u8>(w,12)==2&&at<u8>(w,14)==1&&!session.confirm;if(eligible(w))session.hasCandy=ownsCandy(w);
  if(session.candy&&at<u8>(w,12)==2){restoreCandy();at<u32>(request(w),0x50)=0;blank(w,at<void*>(w,0x154));session.visible=1;}
 }
 u32 r=ov<u32(*)(void*)>(0x2199ed0)(w);if(session.work==w){session.visible=eligible(w)&&at<u8>(w,12)==2&&at<u8>(w,14)==1&&!session.confirm;promptHidden(w,eligible(w)&&!session.candy&&!session.confirm&&!session.nativePrompt);hideCancel(w);}return r;
}
void pixel(void* art,u32 x,u32 y,u32 value){u32 offset=((y/8)*4+x/8)*32+(y%8)*4+x%8/2;u8& p=at<u8>(art,offset);u32 shift=(x%2)*4;p=(p&~(15<<shift))|(value<<shift);}
void navBorder(bool on){
 u32 next=on?session.navItem:255;if(next==session.border)return;
 for(u32 i=0;i<BUTTONS;i++)if(art(i)&&(i==next||i==session.border))for(u32 y=3;y<29;y++)for(u32 x=3;x<29;x++){
  if(x>6&&x<26&&y>5&&y<26)continue;
  u32 color=0;if(i==next){bool edge=(x==6||x==26||y==4||y==27)&&x>=6&&x<=26&&y>=4&&y<=27;color=edge?(i<3?9:15):0;}
  pixel(art(i),x,y,color);
 }
 session.border=next;session.dirty=1;
}
void navExit(){session.nav=0;navBorder(false);}
u32 nextExp(void* mon){u32 level=get(mon,158);return level<100?api<u32(*)(u32,u32,u32)>(0x201d5e0)(get(mon,5),get(mon,111),level+1):0;}
void printOwned(void* w,const u16* chars){
 void* p=at<void*>(w,0x154);blank(w,p);
 api<void(*)(void*,const u16*)>(0x2048640)(session.confirmText,chars);
 void* bitmap=api<void*(*)(void*)>(0x2048520)(at<void*>(p,4));
 api<void(*)(void*,void*,u32,u32,void*,void*,u32)>(0x2021ca8)(at<void*>(p,40),bitmap,1,1,session.confirmText,at<void*>(w,0x13c),0x440);at<u32>(p,36)=1;
}
void fullRestore(void* w);
void confirmClose(void* w,bool accept){
 bool heal=session.confirm==3&&accept;
 void* mon=selected(w,session.slot);if(session.confirm==1&&accept&&mon){u32 limit=nextExp(mon);if(limit&&get(mon,8)<limit){
  api<void(*)(void*,u32,u32)>(0x201cd48)(mon,8,limit-1);
  u16 nickname[11],chars[32];for(u32 i=0;i<11;i++)nickname[i]=0xffff;
  api<u32(*)(void*,u32,void*)>(0x201cd24)(mon,0x74,nickname);
  u32 n=0;for(;n<10&&nickname[n]&&nickname[n]!=0xffff;n++)chars[n]=nickname[n];
  const char* suffix="'s xp was edged!";for(u32 i=0;suffix[i];i++)chars[n++]=suffix[i];chars[n]=0xffff;
  session.confirm=2;printOwned(w,chars);sound();return;
 }}
 void* p=at<void*>(w,0x154);blank(w,p);if(session.confirmText)api<void(*)(void*)>(0x2048590)(session.confirmText);session.confirmText=nullptr;session.confirm=0;session.visible=1;promptHidden(w,true);if(heal)fullRestore(w);else sound();
}
bool openConfirm(void* w,u32 slot,const char* label,u32 state){
 void* p=at<void*>(w,0x154);if(!p||!at<void*>(p,4))return false;
 // A native, owned string remains alive until the printer is reset on cancel,
 // confirmation or shutdown. Opening a question never changes party data.
 void* text=api<void*(*)(u32,u32)>(0x204855c)(32,at<u16>(w,0));if(!text)return false;
 u16 chars[32];u32 i=0;for(;label[i];i++)chars[i]=label[i];chars[i]=0xffff;
 session.slot=slot;session.confirmText=text;session.confirm=state;session.visible=0;navBorder(false);promptHidden(w,false);printOwned(w,chars);return true;
}
void xp(void* w,void* mon,u32 slot){
 if(nextExp(mon))openConfirm(w,slot,"Edge XP? A:YES B:NO",1);
}
void fullRestore(void* w){
 hpMode(false);
 u32 count=api<u32(*)(void*)>(0x201fe24)(at<void*>(request(w),0));
 for(u32 i=0;i<count&&i<6;i++){
  void* mon=selected(w,i);if(!mon||!get(mon,160))continue;
  api<void(*)(void*,u32,u32)>(0x201cd48)(mon,160,get(mon,161));
  api<void(*)(void*,u32,u32)>(0x201cd48)(mon,157,0);
  void* tile=at<void*>(w,0x164+i*4);if(tile){ov<void(*)(void*,void*,void*,u32)>(0x219f290)(w,tile,mon,0);ov<void(*)(void*,void*,u32)>(0x219f008)(w,tile,i==at<u32>(w,0x30));}
 }
 api<void(*)(u32)>(0x2006254)(1391);
}
void activate(void* w,u32 hit){
 if(hit==RESTORE){u32 slot=session.hp||session.nav?session.slot:at<u32>(w,0x30);hpMode(false);if(openConfirm(w,slot,"Heal Party? A:Yes B:No",3))sound();return;}
 u32 slot=session.hp||session.nav?session.slot:at<u32>(w,0x30);void* mon=selected(w,slot);if(!mon)return;
 if(hit==0&&!ownsCandy(w))return;
 sound();if(hit==0)candy(w,mon,slot);else if(hit==1){session.slot=slot;hpMode(!session.hp);}else if(hit==2){hpMode(false);xp(w,mon,slot);}else {
  hpMode(false);const u32 statuses[5]={2,5,4,3,1};u32 status=statuses[hit-3];bool remove=get(mon,157)==status;
  if(remove||get(mon,160)){api<void(*)(void*,u32,u32)>(0x201cd48)(mon,157,remove?0:status);ov<void(*)(void*,void*,void*,u32)>(0x219f290)(w,at<void*>(w,0x164+slot*4),mon,0);ov<void(*)(void*,void*,u32)>(0x219f008)(w,at<void*>(w,0x164+slot*4),1);}
 }
}
extern "C" void PaIdle(void* w){
 if(session.work!=w||(!session.visible&&!session.confirm)||at<u8>(w,14)!=1){ov<void(*)(void*)>(0x219bb48)(w);return;}
 u32 pressed=api<u32(*)()>(0x203df28)(),held=api<u32(*)()>(0x203df4c)();u32 x=0,y=0;bool down=api<u32(*)(u32*,u32*)>(0x203dab0)(&x,&y);int hit=-1;
 if(down&&y>=168&&y<192)for(u32 i=0;i<BUTTONS;i++)if(x>=centerX(i)-10&&x<centerX(i)+10)hit=i;
 if(hit==0&&!session.hasCandy)hit=-1;
 // The native Cancel and checkmark sprites are removed; their old touch area
 // cannot become an invisible way to cancel the party screen.
 if(!session.confirm&&down&&y>=168&&y<192&&x>=184&&x<228)return;
 if(session.confirm){at<u32>(w,0x30)=session.slot;if(session.confirm==2){if((pressed&3)||(session.edge&&down&&y>=168&&y<192))confirmClose(w,false);}else if(pressed&2)confirmClose(w,false);else if(pressed&1)confirmClose(w,true);else if(session.edge&&down&&y>=168&&y<192){u32 yes=session.confirm==3?74:54,no=session.confirm==3?106:90;if(x>=yes&&x<no)confirmClose(w,true);else if(x>=no&&x<184)confirmClose(w,false);}return;}
 if(pressed&0x200){hpMode(false);if(session.nav)navExit();else{session.nav=1;session.slot=at<u32>(w,0x30);session.navItem=session.hasCandy?0:RESTORE;navBorder(true);}sound();return;}
 if(session.nav){at<u32>(w,0x30)=session.slot;if(pressed&2){hpMode(false);navExit();sound();return;}navBorder(true);}
 if(session.hp){
  at<u32>(w,0x30)=session.slot;
  if((pressed&3)||(session.edge&&hit==1)){hpMode(false);sound();return;}
  if(session.edge&&hit>=2)hpMode(false);
  else {
   void* mon=selected(w,session.slot);if(!mon){hpMode(false);return;}
   u32 direction=held&0x30;if(!direction||direction==0x30){session.repeat=0;return;}
   bool step=(pressed&0x30)||session.repeat==0||session.repeat>=12;
   if(step){u32 hp=get(mon,160),max=get(mon,161);u32 next=direction==0x10?(hp<max?hp+1:hp):(hp?hp-1:0);if(next!=hp){api<void(*)(void*,u32,u32)>(0x201cd48)(mon,160,next);redraw(w,session.slot);}}
   if(session.repeat<12){session.repeat++;}
   return;
  }
 }
 if(hit>=0){if(session.edge){if(session.nav){session.navItem=hit;navBorder(true);}activate(w,hit);}return;}
 if(session.nav){
  u32 direction=held&0x30;if(!direction||direction==0x30)session.repeat=0;
  else{bool step=(pressed&0x30)||session.repeat==0||session.repeat>=16;if(step){do{u32 p=order(session.navItem);p=direction==0x10?(p==BUTTONS-1?0:p+1):(p?p-1:BUTTONS-1);session.navItem=button(p);}while(!session.hasCandy&&session.navItem==0);session.repeat=12;navBorder(true);moveSound();}else session.repeat++;}
  if(pressed&1){activate(w,session.navItem);}
  return;
 }
 ov<void(*)(void*)>(0x219bb48)(w);
}
extern "C" u32 PaPartyReturn(void* w,void* data){if(evolutionOwner==data)evolutionOwner=w;return ov<u32(*)(void*,void*)>(0x215ba0c)(w,data);}
extern "C" u32 PaEvolutionReturn(void* w){u32 r=ov<u32(*)(void*)>(0x215c3e4)(w);if(evolutionOwner==w){evolutionOwner=nullptr;at<u32>(w,4)=0;at<u32>(w,12)=0;return 4;}return r;}
