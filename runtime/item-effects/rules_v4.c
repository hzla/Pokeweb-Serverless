#include <stdint.h>
#define PUBLIC __attribute__((visibility("default")))
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int32_t s32;
typedef void (*Callback)(void *,void *,u8,u32 *);
typedef struct { u32 event; Callback callback; } Event;
/* API entries are supplied only after their ROM signatures have been checked. */
PUBLIC const volatile u32 ItemRuleApi[43]={0};
PUBLIC const volatile u8 *ItemRuleData=(const volatile u8 *)1;
#define FN(i,t) ((t)(uintptr_t)ItemRuleApi[i])
#define VALUE(k) FN(0,u32(*)(u32))(k)
#define MUL(v) FN(1,void(*)(u32,u32))(0x35,v)
#define MON(f,m) FN(2,void*(*)(void*,u8))(f,m)
#define STAT(p,k) FN(3,u32(*)(void*,u32))(p,k)
#define SUB(i) FN(13,u32(*)(void*))(i)
#define SIM(f) FN(7,u32(*)(void*))(f)
#define PREVIEW(f) FN(8,u32(*)(void*))(f)
#define PUSH(f,c,m) FN(9,void*(*)(void*,u32,u8))(f,c,m)
#define POP(f,p) FN(10,void(*)(void*,void*))(f,p)
#define REWRITE(k,v) FN(28,u32(*)(u32,u32))(k,v)
#define CHECK(p,k) FN(30,u32(*)(void*,u32))(p,k)
typedef struct { void *item; u32 cells[16]; u16 isolated; u16 pad; } Slot;
typedef struct NativeContext {
 struct NativeContext *previous;
 void *item,*flow;const volatile u8 *rule,*effect;Slot *slot;
 u32 *work,index,event,command,request,queued,spent,simulation,using;
 u8 owner;u8 padding[3];u8 scratch[64];
} NativeContext;
static Slot slots[132];
static NativeContext *context;
static void *lastFlow;
static u32 currentMove;
static u16 half(const volatile u8 *p){return p[0]|(u16)(p[1]<<8);}
static void put16(u8*p,u16 v){p[0]=v;p[1]=v>>8;}
static void put32(u8*p,u32 v){for(u32 n=0;n<4;++n)p[n]=v>>(n*8);}
static const volatile u8 *record(u32 id){return id<640&&half(ItemRuleData+id*2)?ItemRuleData+half(ItemRuleData+id*2):0;}
static const volatile u8 *effects(const volatile u8*r){return r+4+r[1]*4;}
static u32 divide(u32 n,u32 d){u32 q=0,r=0;if(!d)return 0;for(int i=31;i>=0;--i){r=(r<<1)|((n>>i)&1);if(r>=d){r-=d;q|=1u<<i;}}return q;}
static u32 variable(u32 key,s32 *out){return FN(26,u32(*)(u32,s32*))(key,out);}
static u32 preview(void*f){return SIM(f)||PREVIEW(f);}
static u32 active(const volatile u8*r,void*f,void*mon){
 u8 stack[32];u32 top=0;
 for(u32 i=0;i<r[1];++i){
  const volatile u8*p=r+4+i*4;u32 result=0,v=half(p+2);s32 x;
  if(p[0]>=128){if(p[1]>top)return 0;result=p[0]==128;for(u32 j=0;j<p[1];++j){u32 a=stack[--top];result=p[0]==128?result&&a:result||a;}}
  else if(p[0]==1){u32 hp=STAT(mon,13)*100,max=STAT(mon,14)*v;result=p[1]==0?hp<max:p[1]==1?hp<=max:p[1]==2?hp>max:hp>=max;}
  else if(p[0]==2){u32 pair=FN(4,u32(*)(void*))(mon);result=FN(5,u32(*)(u32,u32))(pair,v)!=0;}
  else if(p[0]==3)result=FN(6,u32(*)(void*))(f)==v;
  else if(p[0]==4)result=FN(29,u32(*)(void*))(mon)==v;
  else if(p[0]==5)result=variable(0x16,&x)&&(u32)x==v;
  else if(p[0]==6){if(variable(0x1a,&x))result=(u32)x==v;else if(variable(0x12,&x))result=FN(17,u32(*)(u32))(x)==v;}
  else if(p[0]==7){if(v)result=CHECK(mon,v);else{result=1;for(u32 n=1;n<=5;++n)if(CHECK(mon,n))result=0;}}
  if(p[0]>=2&&p[0]<128&&p[1])result=!result;
  if(top>=32)return 0;
  stack[top++]=result;
 }
 return top==1&&stack[0];
}
static u32 temporary(void*item){return ((u32*)item)[6]&(1u<<26);}
static void consume(void*item,void*f,u8 owner,u32 conditional){
 if(temporary(item)||preview(f))return;
 u32*p=PUSH(f,0x23,owner);if(conditional)*p|=1u<<24;
 FN(11,void(*)(void*,u32,u32))((u8*)p+8,2,0xdb);
 FN(12,void(*)(void*,u32))((u8*)p+8,owner);
 FN(12,void(*)(void*,u32))((u8*)p+8,SUB(item));POP(f,p);
}
static void mark(NativeContext*c){
 if(!c||!c->rule[2]||c->simulation)return;
 u32 donor=half(c->effect+12);
 if(donor==275||donor==230)return; /* Survival is confirmed by its later use event. */
 u32 mask=c->event==0x13?4:c->event==0x3c||c->event==0x12||c->event==0x3e?2:c->event==0x34&&VALUE(4)==c->owner?2:c->event==0x0b?16:1;
 if(c->event==0x7c||c->event==0x9f||c->event==0x22)mask=4;
 if(c->event==0x7b)mask=3;
 c->work[0]|=mask;
}
PUBLIC u32 RuleNativeParam(void*item,u32 param){
 (void)item;
 NativeContext*c=context;if(!c)return 0;
 u16 value=half(c->effect+2);
 if(param==2&&value!=65535)return value;
 return FN(19,u32(*)(u16,u32))(half(c->effect+12),param);
}
PUBLIC void RuleNativeRecall(void*item){(void)item;}
PUBLIC void RuleNativeRequest(void*item,void*f,u8 owner){
 (void)item;(void)f;if(context&&owner==context->owner&&!context->simulation)context->request=1;
}
PUBLIC void RuleNativeIsolate(void*item){(void)item;if(context)context->slot->isolated|=1u<<context->index;}
PUBLIC u32 RuleNativeIsIsolated(void*item){(void)item;return context&&(context->slot->isolated&(1u<<context->index));}
PUBLIC void RuleNativeMultiply(u32 key,u32 value){FN(1,void(*)(u32,u32))(key,value);if(value!=4096)mark(context);}
PUBLIC u32 RuleNativeRewrite(u32 key,u32 value){u32 ok=REWRITE(key,value);if(ok)mark(context);return ok;}
PUBLIC void *RuleNativePush(void*f,u32 command,u8 owner){
 NativeContext*c=context;
 if(!c)return PUSH(f,command,owner);
 c->command=command;
 u32 donor=half(c->effect+12);
 if(c->simulation||command==0||(command==0x23&&(!c->rule[2]||c->event==0x81))||(command==0x20&&donor==541&&!c->rule[2])){
  for(u32 n=0;n<sizeof(c->scratch);++n)c->scratch[n]=0;
  return c->scratch;
 }
 return PUSH(f,command,owner);
}
PUBLIC void RuleNativePop(void*f,void*p){
 NativeContext*c=context;
 if(c&&p==c->scratch){
  if(!c->simulation&&c->command==0)c->request=1;
  if(!c->simulation&&c->command==0x23&&c->rule[2]&&c->event==0x81)c->work[0]|=8;
  return;
 }
 if(c){if(c->command!=4||c->using)c->queued++;if(c->command==0x23||c->command==0x20&&half(c->effect+12)==541)c->spent=1;}
 POP(f,p);
}
PUBLIC void RuleNativePushRun(void*f,u32 command,u8 owner){void*p=RuleNativePush(f,command,owner);RuleNativePop(f,p);}
static void nativeCallback(NativeContext*c,u32 event){
 const Event*table=*(const Event*const*)(c->effect+8);
 for(u32 n=0;n<c->effect[14];++n)if(table[n].event==event){
  /* Native temporary berry callbacks also read work[6]. Preserve that ABI
     without exposing another primitive's persistent state as their work. */
  volatile u32 state[7];for(u32 j=0;j<7;++j)state[j]=0;
  state[0]=c->slot->cells[c->index];state[6]=c->work[6];
  table[n].callback(c->item,c->flow,c->owner,(u32*)state);
  c->slot->cells[c->index]=state[0];return;
 }
}
static u32 runNative(void*item,void*f,u8 owner,u32*work,Slot*slot,const volatile u8*r,const volatile u8*e,u32 index,u32 event,u32 enabled){
 u16 original=*(u16*)((u8*)item+0x38);*(u16*)((u8*)item+0x38)=half(e+12);
 u32 skipped=FN(32,u32(*)(void*,void*,u32))(f,item,event);
 *(u16*)((u8*)item+0x38)=original;if(skipped)return 0;
 NativeContext c;c.previous=context;c.item=item;c.flow=f;c.owner=owner;c.work=work;c.slot=slot;c.rule=r;c.effect=e;c.index=index;c.event=event;c.simulation=preview(f);
 c.command=0;c.request=0;c.queued=0;c.spent=0;c.using=0;
 u32 before=slot->cells[index];u16 isolated=slot->isolated;context=&c;
 nativeCallback(&c,event);
 if(c.request&&!c.simulation){
  c.request=0;c.using=1;FN(20,void(*)(u32))(0);FN(22,void(*)(u32,u32))(2,owner);
  nativeCallback(&c,0x72);FN(21,void(*)(u32))(0);
  if(enabled&&r[2]&&c.queued&&!c.spent)consume(item,f,owner,1);
 }
 else if(enabled&&r[2]&&c.queued&&!c.spent&&!c.simulation&&event!=0x9c)consume(item,f,owner,1);
 if(event==0x88&&slot->cells[index]==2)slot->isolated&=~(1u<<index);
 if(c.simulation){slot->cells[index]=before;slot->isolated=isolated;}
 context=c.previous;return enabled&&r[2]&&(c.spent||c.queued)&&!c.simulation;
}
static u32 typeMatch(void*mon,u32 type){return FN(5,u32(*)(u32,u32))(FN(4,u32(*)(void*))(mon),type);}
static u32 trigger(const volatile u8*e,void*f,u8 owner,u32 event){
 (void)f;
 u32 which=e[4];s32 x;
 if(which==0)return event==0x55&&VALUE(2)==owner;
 if(which==1)return event==0x77&&VALUE(2)==owner;
 if(which==2)return event==0x85&&VALUE(3)==owner&&variable(0x32,&x)&&x>0;
 if(which==3||which==4)return event==0x4b&&VALUE(4)==owner&&VALUE(0x46)==0&&VALUE(0x32)>0&&(which==3||FN(31,u32(*)(u32,u32))(VALUE(0x12),0));
 return event==0x91&&VALUE(2)==owner;
}
static u32 action(void*item,void*f,u8 owner,const volatile u8*e,u8 target){
 void*mon=MON(f,target);u32 kind=e[0],v=half(e+2);
 if(!STAT(mon,13))return 0;
 if(kind==11&&!FN(23,u32(*)(void*,u32,s32))(mon,e[1],(int16_t)v))return 0;
 if(kind==10){
  u32 condition=v==7?5:v;
  if(CHECK(mon,condition))return 0;
  if(condition<=5){for(u32 n=1;n<=5;++n)if(CHECK(mon,n))return 0;}
  if(condition==4&&typeMatch(mon,9)||condition==3&&typeMatch(mon,14)||condition==5&&(typeMatch(mon,3)||typeMatch(mon,8)))return 0;
 }
 if(e[6]<100&&!FN(27,u32(*)(u8))(e[6]))return 0;
 if(kind==10){
  u8*p=PUSH(f,0xc,owner);put32(p+4,v==7?5:v);
  put32(p+8,v==7?FN(25,u32(*)(void))():FN(24,u32(*)(u32))(v));p[12]=0;p[15]=target;POP(f,p);
 }else if(kind==11){
  u8*p=PUSH(f,0xe,owner);put32(p+4,e[1]);p[12]=(u8)(int16_t)v;p[15]=1;p[16]=target;POP(f,p);
 }else{
  u32 amount=divide(STAT(mon,14)*v,10000);if(!amount)amount=1;
  u8*p=PUSH(f,7,owner);put16(p+4,amount);p[6]=target;POP(f,p);
 }
 (void)item;return 1;
}
static u32 customAction(void*item,void*f,u8 owner,const volatile u8*r,const volatile u8*e,u32 event){
 if(preview(f)||!trigger(e,f,owner,event))return 0;
 u32 queued=0;
 if(e[5]==0)queued=action(item,f,owner,e,owner);
 else if(e[5]==1)queued=action(item,f,owner,e,(u8)VALUE(3));
 else if(event==0x85){u32 count=VALUE(5);for(u32 n=0;n<count&&n<12;++n)queued|=action(item,f,owner,e,(u8)VALUE(6+n));}
 else queued=action(item,f,owner,e,(u8)VALUE(4));
 if(queued&&r[2])consume(item,f,owner,1);
 return queued&&r[2];
}
static void healing(void*item,void*f,u8 owner,u32*w,const volatile u8*r,u32 enabled){
 if(VALUE(2)!=owner||preview(f))return;
 void*mon=MON(f,owner);u32 hp=STAT(mon,13),maximum=STAT(mon,14),amount=0;
 if(!hp||hp>=maximum||!enabled)goto no_heal;
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){u32 v=half(e+2),a=0;if(e[0]==7)a=divide(maximum*v,10000);if(e[0]==8)a=v;if(e[0]==9)a=divide(maximum,v);if(e[0]>=7&&e[0]<=9)amount+=a?a:1;}
 if(!amount)goto no_heal;
 if(amount>maximum-hp)amount=maximum-hp;
 u8*p=PUSH(f,5,owner);put16(p+4,amount);p[6]=owner;
 FN(11,void(*)(void*,u32,u32))(p+8,2,0x392);FN(12,void(*)(void*,u32))(p+8,owner);FN(12,void(*)(void*,u32))(p+8,SUB(item));POP(f,p);
 if(r[2]){u32 speed=w[0]&4;w[0]=0;consume(item,f,owner,!speed);}return;
no_heal:if(r[2]&&(w[0]&4))consume(item,f,owner,0);w[0]=0;
}
static void modifiers(void*item,void*f,u8 owner,u32*w,const volatile u8*r,u32 event){
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){
  u32 kind=e[0],v=half(e+2),mask=0;
  if(event==0x3b&&VALUE(3)==owner){u32 category=FN(17,u32(*)(u32))(VALUE(0x12));if(kind==1&&category==1||kind==2&&category==2)mask=1;}
  if(event==0x3c&&VALUE(4)==owner&&(kind==3&&VALUE(0x1a)==1||kind==4&&VALUE(0x1a)==2))mask=2;
  if(event==0x13&&VALUE(2)==owner&&kind==5)mask=4;
  if(event==0x47&&VALUE(3)==owner&&kind==6)mask=1;
  if(event==0x34&&(kind==15&&VALUE(3)==owner||kind==16&&VALUE(4)==owner))mask=kind==15?1:2;
  if(mask){MUL(v);if(r[2]&&v!=4096&&!preview(f))w[0]|=mask;}
  if(event==0x36&&kind==14&&VALUE(3)==owner){REWRITE(0x2c,VALUE(0x2c)+v);if(r[2]&&!preview(f))w[0]|=1;}
  if(event==0x28&&kind==17&&VALUE(2)==owner&&(!half(e+12)||half(e+12)==currentMove))if(REWRITE(0x16,v)&&r[2]&&!preview(f))w[0]|=1;
  if(event==0x9c&&kind==18&&VALUE(2)==owner&&r[2])consume(item,f,owner,0);
 }
 (void)item;
}
static void finish(void*item,void*f,u8 owner,u32*w,u32 event){
 if(preview(f))return;
 u32 used=w[0],yes=0;
 if(event==0x85&&VALUE(3)==owner&&(used&1))yes=1;
 if(event==0x44&&(used&2)){u32 count=VALUE(5);for(u32 n=0;n<count&&n<12;++n)if(VALUE(6+n)==owner)yes=1;}
 if(event==0x88&&VALUE(3)==owner&&(used&(4|8)))yes=1;
 if(event==0x0d&&VALUE(2)==owner&&(used&16))yes=1;
 if(yes){w[0]=0;consume(item,f,owner,0);}
}
static void dispatch(void*item,void*f,u8 owner,u32*w,u32 event){
 const volatile u8*r=record(SUB(item));if(!r)return;lastFlow=f;
 Slot*slot=(Slot*)(uintptr_t)w[5];if(!slot)return;
 u32 enabled=active(r,f,MON(f,owner));
 if(enabled)modifiers(item,f,owner,w,r,event);
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){
  if(e[0]==128&&(enabled||event==0x9c||event==0x88||event==2)){
   if(runNative(item,f,owner,w,slot,r,e,n,event,enabled))break;
  }else if(enabled&&e[0]>=10&&e[0]<=12){if(customAction(item,f,owner,r,e,event))break;}
 }
 if(!enabled&&(event==0x91||event==0x77||event==0x55)&&VALUE(2)==owner&&CHECK(MON(f,owner),0x1b)){
  e=effects(r);for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==128){const Event*t=*(const Event*const*)(e+8);for(u32 j=0;j<e[14];++j)if(t[j].event==0x22){u8*p=PUSH(f,0xb,owner);put32(p+4,0x1b);p[8]=owner;p[20]=1;POP(f,p);break;}}
 }
 finish(item,f,owner,w,event);
 if(event==0x76)healing(item,f,owner,w,r,enabled);
}
#define E(n) PUBLIC void RuleEvent_##n(void*i,void*f,u8 m,u32*w){dispatch(i,f,m,w,0x##n);}
E(02) E(04) E(0b) E(0d) E(0f) E(12) E(13) E(22) E(28) E(34) E(36) E(38) E(3b) E(3c) E(3e) E(44) E(47) E(4b) E(4f) E(55) E(57) E(58) E(62) E(69) E(6c) E(72) E(73) E(74) E(75) E(76) E(77) E(7b) E(7c) E(81) E(83) E(85) E(88) E(8c) E(91) E(94) E(97) E(9c) E(9d) E(9f)
#undef E
#define E(n) {0x##n,RuleEvent_##n},
PUBLIC const Event ItemRuleEvents[]={E(02) E(04) E(0b) E(0d) E(0f) E(12) E(13) E(22) E(28) E(34) E(36) E(38) E(3b) E(3c) E(3e) E(44) E(47) E(4b) E(4f) E(55) E(57) E(58) E(62) E(69) E(6c) E(72) E(73) E(74) E(75) E(76) E(77) E(7b) E(7c) E(81) E(83) E(85) E(88) E(8c) E(91) E(94) E(97) E(9c) E(9d) E(9f)};
#undef E
PUBLIC void *RuleDispatch(void*mon,u16 id){
 if(record(id)){
  void*item=FN(14,void*(*)(u32,u32,u32,u32,u32,const Event*,u32))(5,id,6,FN(16,u32(*)(void*,u32))(mon,12),FN(15,u32(*)(void*))(mon),ItemRuleEvents,sizeof(ItemRuleEvents)/sizeof(ItemRuleEvents[0]));
  if(item)for(u32 n=0;n<132;++n)if(slots[n].item==item||!slots[n].item){slots[n].item=item;slots[n].isolated=0;for(u32 j=0;j<16;++j)slots[n].cells[j]=0;((u32*)item)[7+5]=(u32)(uintptr_t)&slots[n];break;}
  return item;
 }
 return FN(18,void*(*)(void*,u16))(mon,id);
}
static u32 has(void*mon,u32 opcode,u32 donor){
 const volatile u8*r=record(FN(33,u32(*)(void*))(mon));if(!r||!lastFlow||!active(r,lastFlow,mon))return 0;
 const volatile u8*e=effects(r);for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==opcode&&(opcode!=128||half(e+12)==donor))return 1;return 0;
}
PUBLIC u32 RuleClientHeldItem(void*mon){u32 id=FN(33,u32(*)(void*))(mon);if(!record(id))return id;return has(mon,128,228)?228:0;}
PUBLIC u32 RuleClientTrapped(void*client,void*mon,u8*trapper,u16*ability){
 u16*held=(u16*)((u8*)mon+0x12);u16 original=*held;const volatile u8*r=record(original);
 if(!r)return FN(36,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);
 u16 identity=0;
 if(lastFlow&&active(r,lastFlow,mon)){
  const volatile u8*e=effects(r);
  for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==128&&(half(e+12)==278||half(e+12)==541)){identity=half(e+12);break;}
 }
 /* This native client query is synchronous and read-only apart from its two
    output arguments. Give its identity checks the selected battle behavior. */
 *held=identity;u32 result=FN(36,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);*held=original;return result;
}
PUBLIC u32 RuleCanSwitch(void*client,void*mon,u8*trapper,u16*ability){
 if(!record(FN(33,u32(*)(void*))(mon)))return FN(34,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);
 if(has(mon,18,0)&&FN(35,u32(*)(void*,void*))(client,mon)){*trapper=31;*ability=0;return 4;}
 return RuleClientTrapped(client,mon,trapper,ability);
}
PUBLIC u32 RuleEscapeBlocked(void*client,u8*trapper,u16*ability){return FN(37,u32(*)(void*,u8*,u16*))(client,trapper,ability);}
PUBLIC void RuleMoveTyping(void*item,void*f,u8 owner,u32*w){
 u32 move=currentMove;void*mon=MON(f,owner);u32 id=FN(33,u32(*)(void*))(mon);const volatile u8*r=record(id);
 if(!r){FN(move==449?39:40,Callback)(item,f,owner,w);return;}
 if(VALUE(2)!=owner)return;
 u32 type=0;
 if(FN(41,u32(*)(void*,u8))(f,owner)&&active(r,f,mon)){
  const volatile u8*e=effects(r);
  for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==17&&(!half(e+12)||half(e+12)==move))type=half(e+2);
 }
 if(REWRITE(0x16,type)&&r[2]&&type&&!preview(f))for(u32 n=0;n<132;++n){void*held=slots[n].item;if(held&&((u32*)held)[12]==(u32)(uintptr_t)&slots[n]&&*(u8*)((u8*)held+0x3a)==owner&&SUB(held)==id)((u32*)held)[7]|=1;}
 if(move==546)FN(38,void(*)(void*,u32))(f,type==10?1:type==12?2:type==9?3:type==14?4:0);
}
PUBLIC void RuleGetMoveParam(void*f,u16 move,void*mon,void*param){
 u32 previous=currentMove;currentMove=move;
 FN(42,void(*)(void*,u16,void*,void*))(f,move,mon,param);currentMove=previous;
}
