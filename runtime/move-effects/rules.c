#include <stdint.h>
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int32_t s32;
void*memcpy(void*dst,const void*src,unsigned length){volatile u8*p=dst;const volatile u8*q=src;for(u32 n=0;n<length;++n)p[n]=q[n];return dst;}
#define PUBLIC __attribute__((visibility("default")))
typedef void (*Callback)(void*,void*,u8,u32*);
typedef struct { u32 event; Callback callback; } Event;
PUBLIC const volatile u32 MoveRuleApi[37]={0};
PUBLIC const volatile u32 MoveNativeGetters[20]={0};
PUBLIC const volatile u16 MoveNativeIds[20]={0};
PUBLIC const volatile u8 *MoveRuleData=(const volatile u8*)1;
#define FN(i,t) ((t)(uintptr_t)MoveRuleApi[i])
#define GET(k) FN(0,u32(*)(u32))(k)
#define TRY(k,p) FN(1,u32(*)(u32,s32*))(k,p)
#define SET(k,v) FN(2,u32(*)(u32,u32))(k,v)
#define MUL(k,v) FN(3,void(*)(u32,u32))(k,v)
#define MON(f,id) FN(4,void*(*)(void*,u8))(f,id)
#define STAT(m,k) FN(5,u32(*)(void*,u32))(m,k)
#define PUSH(f,k,o) FN(10,u8*(*)(void*,u32,u8))(f,k,o)
#define POP(f,p) FN(11,void(*)(void*,void*))(f,p)
static u16 half(const volatile u8*p){return p[0]|p[1]<<8;}
static u32 word(const volatile u8*p){return half(p)|(u32)half(p+2)<<16;}
static void put16(u8*p,u32 v){p[0]=v;p[1]=v>>8;}
static void put32(u8*p,u32 v){put16(p,v);put16(p+2,v>>16);}
static u32 divide(u32 n,u32 d){u32 q=0,r=0;if(!d)return 0;if(d==1)return n;if(d==2)return n>>1;if(d==4)return n>>2;if(d==16)return n>>4;for(int i=31;i>=0;--i){r=(r<<1)|((n>>i)&1);if(r>=d){r-=d;q|=1u<<i;}}return q;}
static const volatile u8*entry(u32 id){
 u32 lo=0,hi=half(MoveRuleData);
 while(lo<hi){u32 mid=(lo+hi)>>1;const volatile u8*p=MoveRuleData+4+mid*16;u32 v=half(p);if(v<id)lo=mid+1;else hi=mid;}
 const volatile u8*p=MoveRuleData+4+lo*16;return lo<half(MoveRuleData)&&half(p)==id?p:0;
}
typedef struct {void*flow;u8 owner,target;u16 move;u32 weather,active,groundKnown,grounded;u8 weatherValid,activeValid;} Evaluation;
/* Deliberately evaluation-local: no cross-action cache can outlive a weather change.
 * These callbacks never subscribe to the native weather-query event. */
static u32 weather(Evaluation*x){if(!x->weatherValid){x->weather=FN(8,u32(*)(void*))(x->flow);x->weatherValid=1;}return x->weather;}
static u32 alive(void*f,u8 id){return id<24&&FN(18,u32(*)(void*,u8))(f,id)&&STAT(MON(f,id),13);}
static u32 type(void*m,u32 t){return FN(7,u32(*)(u32,u32))(FN(6,u32(*)(void*))(m),t);}
static u32 effectiveAbility(void*m){return STAT(m,17);}
static u32 pendingPriority(Evaluation*x,u8 target,s32 wanted){
 /* Read-only native action data. No scheduling or priority calculation is changed. */
 u8*f=x->flow;u32 count=f[0x782];if(count>6)return 0;
 for(u32 i=0;i<count;++i){u8*p=f+0x7e0+i*16;void*m=(void*)(uintptr_t)word(p);
  if(m&&FN(19,u32(*)(void*))(m)==target&&!p[13]&&(word(p+4)&15)==1){u32 move=(word(p+4)>>7)&65535;return FN(21,u32(*)(u32))(move)!=0&&((s32)((word(p+8)>>16)&63)-7)==wanted;}
 }return 0;
}
static u32 condition(const volatile u8**cursor,Evaluation*x,u32 evaluate){
 const volatile u8*p=*cursor;*cursor=p+8;u32 op=p[0],v=half(p+4),result=0;
 if(op>=128){result=op==128;for(u32 n=0;n<p[1];++n){u32 run=evaluate&&(op==128?result:!result),c=condition(cursor,x,run);if(run)result=op==128?result&&c:result||c;}return evaluate&&result;}
 if(!evaluate)return 0;
 u8 id=p[1]?x->target:x->owner;void*m=0;
 if(op==1||op==2||op==4||op==5||op==6||op==9||op==10||op==11){m=id<24?MON(x->flow,id):0;if(!m)return 0;}
 if(op==1){u32 hp=STAT(m,13)*100,max=STAT(m,14)*v;result=p[2]==0?hp<max:p[2]==1?hp<=max:p[2]==2?hp>max:hp>=max;return result;}
 if(op==2)result=type(m,v);
 if(op==3)result=weather(x)==v;
 if(op==4)result=FN(20,u32(*)(void*))(m)==v;
 if(op==5){if(v)result=FN(17,u32(*)(void*,u32))(m,v);else{result=1;for(u32 n=1;n<=5;++n)if(FN(17,u32(*)(void*,u32))(m,n))result=0;}}
 if(op==6)result=effectiveAbility(m)==v;
 if(op==7)result=FN(25,u32(*)(u32))(v);
 if(op==8){s32 value;result=TRY(0x38,&value)&&value==(s32)v;}
 if(op==9)result=(FN(22,u32(*)(void*,u32))(m,1)!=0)==(v!=0);
 if(op==10)result=(half((u8*)m+0x146)==0)==(v!=0);
 if(op==11){u32 bit=1u<<id;if(!(x->groundKnown&bit)){if(!FN(26,u32(*)(void*,void*,u32))(x->flow,m,1))x->grounded|=bit;x->groundKnown|=bit;}result=((x->grounded&bit)!=0)==(v!=0);}
 if(op==12)result=(FN(16,u32(*)(u8,u8))(x->owner,id)!=0)==(v!=0);
 if(op==13)result=pendingPriority(x,id,(int16_t)v);
 if(op==14)result=(id==x->owner)==(v!=0);
 return p[2]?!result:result;
}
static u32 match(const volatile u8*p,Evaluation*x){return condition(&p,x,1);}
static u32 preview(void*f){return FN(9,u32(*)(void*))(f)||FN(27,u32(*)(void*))(f);}
static void nativeEvent(u32 id,u32 event,void*item,void*f,u8 owner,u32*w){
 for(u32 n=0;n<20;++n)if(MoveNativeIds[n]==id&&MoveNativeGetters[n]){u32 count=0;const Event*t=((const Event*(*)(u32*))(uintptr_t)MoveNativeGetters[n])(&count);if(count>16)return;for(u32 j=0;t&&j<count;++j)if(t[j].event==event)t[j].callback(item,f,owner,w);return;}
}
static u32 secondary(void*f,u8 owner,u8 target,u32 chance,u32 stat){
 s32 flag=0;if(target!=owner&&(TRY(0x46,&flag)&&flag||TRY(0x47,&flag)&&flag))return 0;
 if(effectiveAbility(MON(f,owner))==125)return 0;
 u32 move=GET(0x12);FN(12,void(*)(u32))(0x601);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(4,target);
 FN(14,void(*)(u32,u32))(0x12,move);FN(15,void(*)(u32,u32))(0x41,0);FN(28,void(*)(u32,u32))(0x26,chance);
 FN(29,void(*)(void*,u32))(f,stat?0x51:0x64);u32 blocked=GET(0x41),value=GET(0x26);FN(13,void(*)(u32))(0x601);
 return !blocked&&value&&FN(23,u32(*)(u8))(value>100?100:value);
}
static u32 actionChance(void*f,u8 owner,u8 target,const volatile u8*e){
 if(e[3])return secondary(f,owner,target,e[4],e[0]==4);
 return e[4]>=100||FN(23,u32(*)(u8))(e[4]);
}
static u32 statWork(void*f,u8 owner,const volatile u8*e,const u8*targets,u32 count){
 if(!count)return 0;u8*p=PUSH(f,14,owner);if(!p)return 0;
 put32(p+4,half(e+8));p[12]=(u8)half(e+6);p[14]=e[1]==6;p[15]=count;
 for(u32 n=0;n<count;++n)p[16+n]=targets[n];POP(f,p);return 1;
}
static u32 action(void*item,void*f,u8 owner,u8 target,const volatile u8*e,u32*w){
 if(!alive(f,target))return 0;void*m=MON(f,target);u32 kind=e[0],v=half(e+6),arg=half(e+8);s32 delta=(int16_t)v;
 if(kind==12){
  s32 flag=0;if(!v||TRY(0x46,&flag)&&flag||TRY(0x47,&flag)&&flag)return 0;
  FN(12,void(*)(u32))(0x602);FN(14,void(*)(u32,u32))(3,owner);FN(14,void(*)(u32,u32))(0x25,v);
  FN(15,void(*)(u32,u32))(0x45,0);FN(15,void(*)(u32,u32))(0x41,0);FN(28,void(*)(u32,u32))(0x26,0);
  FN(29,void(*)(void*,u32))(f,0x6c);u32 blocked=GET(0x41),doubled=GET(0x45);FN(13,void(*)(u32))(0x602);
  if(blocked)return 0;if(doubled)v*=2;if(v>100)v=100;
  u8*p=PUSH(f,43,owner);if(!p)return 0;p[4]=target;p[5]=v;POP(f,p);return 1;
 }
 if(!actionChance(f,owner,target,e))return 0;
 if(kind==4){if(!FN(24,u32(*)(void*,u32,s32))(m,arg,effectiveAbility(m)==126?-delta:delta))return 0;return statWork(f,owner,e,&target,1);}
 if(kind==5){u32 hp=STAT(m,13),max=STAT(m,14),amount=divide(max*v,arg);if(hp>=max)return 0;if(!amount)amount=1;u8*p=PUSH(f,5,owner);if(!p)return 0;put16(p+4,amount);p[6]=target;POP(f,p);return 1;}
 if(kind==6){u32 used=0;for(u32 c=v?v:1;c<=(v?v:5);++c)if(FN(17,u32(*)(void*,u32))(m,c)){u8*p=PUSH(f,11,owner);if(!p)break;put32(p+4,c);p[8]=target;p[20]=1;POP(f,p);used=1;}return used;}
 if(kind==7){u8 values[7];u32 changed=0;for(u32 n=0;n<7;++n){u32 before=STAT(m,n+1);values[n]=arg?12-before:6;if(before!=values[n])changed=1;}if(!changed)return 0;u8*p=PUSH(f,15,owner);if(!p)return 0;p[4]=target;for(u32 n=0;n<7;++n)p[5+n]=values[n];POP(f,p);return 1;}
 if(kind==8){nativeEvent(v,0xa1,item,f,owner,w);return 1;}
 if(kind==11){u8*p=PUSH(f,12,owner);if(!p)return 0;put32(p+4,v);put32(p+8,FN(30,u32(*)(u32))(v));p[12]=0;p[15]=target;POP(f,p);return 1;}
 return 0;
}
static u32 recipients(Evaluation*x,u32 scope){
 if(scope==0)return 1u<<x->owner;
 if(scope==1){s32 count=0,first=0;u32 mask=0;
  if(TRY(4,&first))return first>=0&&first<24?1u<<first:0;
  if(TRY(5,&count))for(s32 n=0;n<count&&n<6;++n){u32 id=GET(6+n);if(id<24)mask|=1u<<id;}
  return mask;
 }
 if(!x->activeValid){for(u8 id=0;id<24;++id)if(alive(x->flow,id))x->active|=1u<<id;x->activeValid=1;}
 u32 result=0;for(u8 id=0;id<24;++id)if(x->active&(1u<<id)){
  u32 ally=scope==4?0:FN(16,u32(*)(u8,u8))(x->owner,id);
  if(scope==4||scope==2&&ally||scope==3&&!ally)result|=1u<<id;
 }return result;
}
static void dispatch(void*item,void*f,u8 owner,u32*w,u32 event){
 u32 move=FN(31,u32(*)(void*))(item);const volatile u8*idx=entry(move);if(!idx||owner>=24)return;
 const volatile u8*r=MoveRuleData+word(idx+4);
 if(half(r+4))nativeEvent(half(r+4),event,item,f,owner,w);
 const volatile u8*global=r+8,*requirements=global+r[1]*8,*effects=requirements+r[2]*8,*scan=effects;
 const u8 events[]={0x37,0x47,0x32,0x1f,0x4b,0x84,0xa0,0x83,0x4d,0x83};u32 needed=event==r[3]&&r[3];
 for(u32 n=0;n<r[0];++n){if(scan[0]==10?(event==0x3a||event==0x33):scan[1]<10&&(event==events[scan[1]]||scan[1]==6&&event==0xa1))needed=1;scan+=32+scan[5]*8;}
 if(!needed)return;
 /* Check the owning battler and actual move before any condition can query weather. */
 s32 actor=-1,actual=-1,target=-1;
 if(!TRY(event==0x1f?2:3,&actor)||actor!=owner)return;
 /* Retail accuracy and defense-stage frames identify the actor, but omit the
  * move ID. Their selected move item supplies identity, as in native handlers. */
 if(TRY(0x12,&actual)?(u32)actual!=move:event!=0x32&&event!=0x33&&event!=0x3a)return;
 if(!TRY(4,&target))(void)TRY(6,&target);Evaluation x={f,owner,target>=0&&target<24?(u8)target:owner,(u16)move,0,0,0,0,0,0};
 if(event==r[3]&&!match(requirements,&x)){SET(event==0x1f?0x22:0x40,event==0x1f?0x1a:1);return;}
 u32 power=0,powerChanged=0;
 for(u32 n=0;n<r[0];++n){const volatile u8*e=effects;effects+=32+e[5]*8;u32 kind=e[0],phase=e[1],v=half(e+6);
  if(kind==10){if((event==0x3a||event==0x33)&&match(global,&x)&&match(e+32,&x)){if(event==0x3a)SET(0x51,1);if(event==0x33)SET(0x4b,1);}continue;}
  if(phase>=10||event!=events[phase]&&!(phase==6&&event==0xa1))continue;
  if(kind<=3||kind==9){if(!match(global,&x)||!match(e+32,&x))continue;
   if(kind==1){if(!powerChanged)power=GET(0x30);powerChanged=1;if(power>65535)power=65535;power=(power*v)>>12;if(power>65535)power=65535;if(!power)power=1;}
   if(kind==2)MUL(0x35,v);
   if(kind==3)SET(0x51,1);
   if(kind==9){void*m=MON(f,e[2]?x.target:owner);u32 p=divide(v*STAT(m,13),STAT(m,14));power=p?p:1;powerChanged=1;}
   continue;
  }
  if(preview(f))continue;
  if(phase==4){s32 damage=0,sub=0;if(!TRY(0x32,&damage)||damage<=0||e[2]!=0&&TRY(0x46,&sub)&&sub)continue;}
  if(phase==7){u32 count=GET(5),ko=0;for(u32 j=0;j<count&&j<6;++j)if(!STAT(MON(f,GET(6+j)),13))ko=1;if(!ko)continue;}
  u32 recipientsMask=recipients(&x,e[2]),statCount=0;u8 statTargets[6];
  for(u8 id=0;id<24;++id)if(recipientsMask&(1u<<id)){x.target=id;if(match(global,&x)&&match(e+32,&x)){
   if(kind==4){if(statCount<6&&alive(f,id)&&actionChance(f,owner,id,e)){void*m=MON(f,id);s32 delta=(int16_t)v;if(FN(24,u32(*)(void*,u32,s32))(m,half(e+8),effectiveAbility(m)==126?-delta:delta))statTargets[statCount++]=id;}}
   else action(item,f,owner,id,e,w);
  }}
  if(kind==4)statWork(f,owner,e,statTargets,statCount);
  x.target=target>=0&&target<24?(u8)target:owner;
 }
 if(powerChanged)SET(0x30,power);
}
#include "build/events.inc"
PUBLIC u32 MoveDispatch(void*mon,u16 move,u32 speed){
 const volatile u8*p=entry(move);if(!p)return FN(32,u32(*)(void*,u16,u32))(mon,move,speed);
 u32 owner=FN(19,u32(*)(void*))(mon);u8 exists=0;
 if(owner>=24||!FN(33,u32(*)(u32,u16,u8*))(owner,move,&exists))return 0;
 if(!half(p+2))return 0;
 return FN(34,u32(*)(u32,u32,u32,u32,u32,const Event*,u32))(0,move,0,speed,owner,(const Event*)(uintptr_t)word(p+8),half(p+2))!=0;
}
PUBLIC u32 MoveSheerForce(u16 move){
 const volatile u8*p=entry(move);if(!p)return FN(35,u32(*)(u16))(move);
 const volatile u8*r=MoveRuleData+word(p+4),*e=r+8+(r[1]+r[2])*8;
 for(u32 n=0;n<r[0];++n){if(e[0]==12?half(e+6)!=0:e[3]&&e[4])return 1;e+=32+e[5]*8;}
 return 0;
}

/* Recipe flinch is queued once per successful hit. Prevent a second native roll,
 * including item-added flinch; unchanged moves retain the original pipeline. */
PUBLIC u32 MoveFlinchChance(void*f,u16 move,void*mon){
 const volatile u8*p=entry(move);
 if(p){const volatile u8*r=MoveRuleData+word(p+4),*e=r+8+(r[1]+r[2])*8;
  for(u32 n=0;n<r[0];++n){if(e[0]==12&&half(e+6))return 0;e+=32+e[5]*8;}}
 return FN(36,u32(*)(void*,u16,void*))(f,move,mon);
}
