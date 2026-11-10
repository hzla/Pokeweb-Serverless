/* v15: source-aware status handling and narrow redirection/charge adapters.
 * No timer polling, extra event dispatches or cached effective weather. */
PUBLIC const volatile u32 AbilityStatusApi[5]={0}; /* native type check, move type, factor lookup, random, duration */
#define CEX(i,t) ((t)(uintptr_t)AbilityStatusApi[i])
typedef struct {u16 ratio;u8 type,armed;} MoveCharge;
static MoveCharge charges[24],usingCharge[24];
static u8 chargeTypeSeen[24];
#ifdef ABILITY_STATUS_TEST
static struct {u32 magic,count;struct {u8 event,a,d,x;u16 move,y;u32 value;} entries[128];} statusLog={.magic=0x4c545343};
static u8 lastDamageTarget[24]={31};
static void statusRecord(void*f,u32 event){
 if(preview(f))return;
 u32 a=0,d=0,x=0,move=0,y=0,value=0;
 if(event==3){a=VALUE(3);if(a<24)lastDamageTarget[a]=31;move=VALUE(0x12);void*mon=MON(f,a);for(u32 n=1;n<=6;++n)if(CHECK(mon,n))d|=1u<<n;y=STAT(mon,13);value=STAT(mon,17);}
 else if(event==0x29||event==0x2a||event==0x2d){a=VALUE(3);d=VALUE(4);move=VALUE(0x12);value=STAT(MON(f,a),17);}
 else if(event==4){a=VALUE(2);move=VALUE(0x12);d=a<24?lastDamageTarget[a]:31;if(d<24){y=STAT(MON(f,d),13);value=STAT(MON(f,d),14);}}
 else if(event==0x38){a=VALUE(3);d=VALUE(4);if(a<24)lastDamageTarget[a]=(u8)d;move=VALUE(0x12);x=VALUE(0x16);value=VALUE(0x31);}
 else if(event==0x4b){a=VALUE(3);d=VALUE(4);move=VALUE(0x12);value=VALUE(0x32);y=STAT(MON(f,d),13);}
 else if(event==0x68||event==0x69){a=VALUE(3);d=VALUE(4);x=VALUE(0x1d);value=CHECK(MON(f,d),x);}
 else return;
 statusLog.magic=0x4c545343;u32 i=statusLog.count++;if(i>=128)return;
 statusLog.entries[i].event=(u8)event;statusLog.entries[i].a=(u8)a;statusLog.entries[i].d=(u8)d;statusLog.entries[i].x=(u8)x;statusLog.entries[i].move=(u16)move;statusLog.entries[i].y=(u16)y;statusLog.entries[i].value=value;
}
#endif

static const volatile u8*extensionRecord(void*f,u32 owner,u32 kind){
 if(owner>=24)return 0;
 void*mon=MON(f,owner);
 const volatile u8*r=record(STAT(mon,17));if(!r||r[0]>ABILITY_EFFECT_SLOTS)return 0;
 const volatile u8*e=effects(r);for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==kind)return active(r,f,mon)?r:0;
 return 0;
}
static void extensionsInit(void){
#ifdef ABILITY_STATUS_TEST
 statusLog.count=0;statusLog.magic=0;
#endif
statusScope=0;memset(chargeTypeSeen,0,sizeof(chargeTypeSeen));memset(charges,0,sizeof(charges));memset(usingCharge,0,sizeof(usingCharge));memset(&statusAttempt,0,sizeof(statusAttempt));}
static u32 extensionsRedirect(void*f,u32 event){
 if(event!=0x29&&event!=0x2a)return 0;
 s32 user,move;if(!variable(3,&user)||!variable(0x12,&move)||move<=0)return 0;
 const volatile u8*r=extensionRecord(f,(u32)user,174);
#ifdef ABILITY_STATUS_TEST
 statusRecord(f,event);
#endif
 if(r){const volatile u8*e=effects(r);for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==174&&conversionMatch(e[1],(u32)move,e[7]))return 1;}
 return 0;
}
/* The source is in r7 at the checked call site. Preserve the original fifth
 * stack argument while forwarding it and the source to the typed adapter. */
PUBLIC __attribute__((naked)) void AbilityStatusCheckSite(void){
 __asm__ volatile(".syntax unified\n push {r4, lr}\n sub sp, #8\n ldr r4, [sp, #16]\n str r4, [sp]\n str r7, [sp, #4]\n bl AbilityStatusCheck\n add sp, #8\n pop {r4, pc}\n .syntax divided\n");
}
PUBLIC u32 AbilityStatusCheck(void*f,void*target,u32 condition,u32 cont,u32 mode,void*source){
 u32 result=CEX(0,u32(*)(void*,void*,u32,u32,u32))(f,target,condition,cont,mode);
 u32 owner=source?FN(15,u32(*)(void*))(source):31,id=FN(15,u32(*)(void*))(target);
 if(result==2){
  const volatile u8*r=extensionRecord(f,owner,176);
  if(r){
   u32 allowed=1,found=0;
   for(u32 type=0;type<18;++type)if((condition==5&&(type==3||type==8)||condition==4&&type==9||condition==3&&type==14)&&typeMatch(target,type)){
    found=1;u32 covered=0;const volatile u8*e=effects(r);
    for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==176&&e[1]==condition&&(type==e[4]||type==e[5]))covered=1;
    if(!covered)allowed=0;
   }
   if(found&&allowed)result=0;
  }
 }
 statusAttempt.flow=f;statusAttempt.source=(u8)owner;statusAttempt.target=(u8)id;statusAttempt.condition=(u8)condition;
 statusAttempt.moveOrigin=!result&&owner==actionUser&&actionMove&&(!abilityOrigin||abilityOrigin->factor!=4)&&!popupGroup;
 return result;
}
static void extensionsBefore(void*f,u32 event){
 if(event!=3&&event!=4&&event!=0x54)return;
 if(preview(f))return;
 if(event==0x54){u32 id=VALUE(2);if(id<24){charges[id].armed=0;usingCharge[id].armed=0;}}
 if(event==3){u32 id=VALUE(3);if(id<24){usingCharge[id].armed=0;chargeTypeSeen[id]=0;}}
 if(event==4){u32 id=VALUE(2);if(id<24){if(charges[id].armed&&!chargeTypeSeen[id]&&CEX(1,u32(*)(u32))(VALUE(0x12))==charges[id].type)charges[id].armed=0;usingCharge[id].armed=0;}statusAttempt.moveOrigin=0;}
}
static void extensionsAfter(void*f,u32 event){
 if(event==0x68)statusAttempt.moveOrigin=0;
 if(event==0x28&&!preview(f)){u32 id=VALUE(3);if(id<24){chargeTypeSeen[id]=1;if(charges[id].armed&&VALUE(0x16)==charges[id].type){usingCharge[id]=charges[id];charges[id].armed=0;}}}
 if(event==0x38){u32 id=VALUE(3);if(id<24){
  if(!usingCharge[id].armed&&charges[id].armed&&VALUE(0x16)==charges[id].type&&!preview(f)){usingCharge[id]=charges[id];charges[id].armed=0;}
  MoveCharge*c=usingCharge[id].armed?&usingCharge[id]:&charges[id];
  if(c->armed&&VALUE(0x16)==c->type){
   u32 ratio=c->ratio;
   /* Native Charge is another provider of the same boost, not a stack. */
   if(c->type==12){
    for(u8*p=CEX(2,u8*(*)(u32,u32))(0,id);p;p=*(u8**)(p+4)){
     if(*(u32*)(p+0x10)==0&&p[0x3a]==id&&half(p+0x38)==268&&!(*(u32*)(p+0x18)&((1u<<27)|(1u<<30)))&&*(u32*)(p+0x1c)==2&&*(u32*)(p+0x34)==1){ratio=divide(ratio,2);break;}
    }
   }
   POWER_MUL(ratio);
  }
 }}
#ifdef ABILITY_STATUS_TEST
 statusRecord(f,event);
#endif
}
static void extensionEffect(void*f,u8 owner,const volatile u8*e,u32 event){
 if(preview(f))return;
 const AbilityStatusReceipt*receipt=statusScope?&statusScope->receipt:0;
 if(e[0]==175&&event==0x68&&receipt&&receipt->flow==f&&receipt->moveOrigin&&receipt->source==owner&&receipt->condition==VALUE(0x1d)&&VALUE(3)==owner&&VALUE(4)==receipt->target&&VALUE(0x1d)==e[1]){
  u32 target=VALUE(4),condition=e[4];if(target>=24)return;void*mon=MON(f,target);
  if(!STAT(mon,13)||CHECK(mon,condition)||half(e+2)<100&&!FN(27,u32(*)(u8))((u8)half(e+2)))return;
  /* Native queued status work validates ability/condition prevention first,
   * and only then opens/closes the source ability popup. */
  u8*p=PUSH(f,12,owner);p[2]|=0x80;put32(p+4,condition);put32(p+8,CEX(4,u32(*)(u8))((u8)(e[5]+CEX(3,u32(*)(u32))(e[6]-e[5]+1))));p[15]=(u8)target;POP(f,p);
 }
 if(e[0]==177){
  u32 hit=event==0x4b&&VALUE(4)==owner&&VALUE(3)!=owner&&!VALUE(0x46)&&(s32)VALUE(0x32)>0&&conversionMatch(e[1],VALUE(0x12),e[7]);
  u32 forced=event==0x8b&&VALUE(4)==owner&&actionUser!=owner&&actionMove&&conversionMatch(e[1],actionMove,e[7]);
  u32 tail=e[5]&&event==0x9f&&VALUE(0x53)==4&&VALUE(0x52)==side(owner)&&!RX(12,u32(*)(void*,u8,u32))(f,side(owner),4);
  if(!hit&&!tail&&!forced)return;
  charges[owner].ratio=half(e+2);charges[owner].type=e[4];charges[owner].armed=1;
  abilityNotice(f,owner,33,owner,0);
 }
}
