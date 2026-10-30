/* Optional recipes implemented through existing event variables and battle work.
 * Observers forward native calls unchanged; their state belongs to this DLL. */
PUBLIC const volatile u32 AbilityScopedApi[6]={0};
#define SX(i,t) ((t)(uintptr_t)AbilityScopedApi[i])
typedef struct {u8 source,target,stat,delta,origin,used;} EchoTicket;
static EchoTicket echoes[64];
static u16 entered[32],priorityTurn[32];
static int8_t priorities[32];
static u32 faintSeen,echoOrigin,transferClaim,started;
static u8 fallen[2],fallenInitialized[2];
static u32 turn(void*f){return SX(0,u32(*)(void*))(f);}
static void scopedInit(void){
 memset(echoes,0,sizeof(echoes));memset(entered,255,sizeof(entered));memset(priorityTurn,255,sizeof(priorityTurn));memset(priorities,0,sizeof(priorities));
 faintSeen=echoOrigin=transferClaim=started=0;fallen[0]=fallen[1]=fallenInitialized[0]=fallenInitialized[1]=0;
}
static u32 scopedLive(void*f,u8 id){return present(f,id)&&STAT(MON(f,id),13)&&!CHECK(MON(f,id),16);}
static const volatile u8*scopedRule(void*f,u8 id){
 if(!scopedLive(f,id))return 0;
 const volatile u8*r=record(STAT(MON(f,id),16));return r&&active(r,f,MON(f,id))?r:0;
}
/* Field effects do not stack with duplicate providers. The ordinary callback
 * still controls eligibility of the provider that actually applies a modifier. */
static u32 hasField(void*f,u8 id,u32 kind,u32 parameter){
 const volatile u8*r=scopedRule(f,id);if(!r)return 0;
 const volatile u8*e=effects(r);for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==kind&&(kind==156||e[1]==parameter))return 1;
 return 0;
}
static u32 firstField(void*f,u8 owner,u32 kind,u32 parameter){for(u8 id=0;id<owner;++id)if(hasField(f,id,kind,parameter))return 0;return 1;}
static u32 echoStage(void*item,void*f,u8 source,u8 target,u32 stat,s32 delta,u32 origin){
 if(!delta||!present(f,target)||!STAT(MON(f,target),13)||!FN(23,u32(*)(void*,u32,s32))(MON(f,target),stat,delta))return 0;
 for(u32 n=0;n<64;++n)if(!echoes[n].used){
  echoes[n]=(EchoTicket){source,target,stat,(u8)delta,origin,1};
  if(recipeStage(item,f,source,target,stat,delta,100))return 1;
  echoes[n].used=0;return 0;
 }return 0;
}
static void seedFallen(void*f,u8 owner){
 u32 s=side(owner);if(s>=2||fallenInitialized[s])return;fallenInitialized[s]=1;
 for(u8 id=0;id<24;++id)if(ally(owner,id)){void*m=MON(f,id);if(m&&FN(29,u32(*)(void*))(m)&&!STAT(m,13)){faintSeen|=1u<<id;if(fallen[s]<5)++fallen[s];}}
}
static void scopedBefore(void*f,u32 event){
 if(preview(f))return;
 if(event==0x11||event==0x3)started=1;
 if(event==0x1){memset(echoes,0,sizeof(echoes));echoOrigin=0;}
 if(event==0x55){u8 id=VALUE(2);if(id<32){seedFallen(f,id);entered[id]=started?turn(f):65535;priorityTurn[id]=65535;if(STAT(MON(f,id),13))faintSeen&=~(1u<<id);}}
 if(event==0xa3){u8 id=VALUE(2);if(id<32&&!STAT(MON(f,id),13)&&!(faintSeen&(1u<<id))){faintSeen|=1u<<id;u32 s=side(id);if(s<2&&fallen[s]<5)++fallen[s];}}
 if(event==0x5b){
  echoOrigin=0;for(u32 n=0;n<64;++n){EchoTicket*t=&echoes[n];if(t->used&&t->source==VALUE(3)&&t->target==VALUE(2)&&t->stat==VALUE(0x1f)&&t->delta==(u8)VALUE(0x20)){echoOrigin=t->origin;t->used=0;break;}}
 }
}
static void scopedAfter(void*f,u32 event){
 if(preview(f))return;
 if(event==0x11){u8 id=VALUE(3);if(id<32){priorities[id]=(s32)VALUE(0x18)-7;priorityTurn[id]=turn(f);}}
 if(event==0x5d)echoOrigin=0;
}
static void scopedObserve(void*f,u8 owner,const volatile u8*r,u32 event){
 if(preview(f))return;
 const volatile u8*e=effects(r);for(u32 n=0;n<r[0];++n,e+=16){u32*w=nativeWork[owner][n];
  if(e[0]==158&&event==0x3&&VALUE(3)==owner)w[1]=0;
  if(e[0]==160&&onEntry(event,owner)){u32 s=side(owner);w[0]=s<2?fallen[s]:0;}
 }
}
static void scopedConsume(void*f,u8 owner,u32 old){
 if(preview(f)||!old)return;
 u32 saved=transferClaim;transferClaim=0;recipeEvent(f,0xa7,owner,old);transferClaim=saved;
}
static void scopedEffect(void*item,void*f,u8 owner,const volatile u8*e,u32 event,u32*w){
 u32 kind=e[0],v=half(e+2);void*holder=MON(f,owner);
 if(kind==155){
  if(event!=0x38||VALUE(0x16)!=e[1]||!firstField(f,owner,kind,e[1]))return;
  for(u8 id=0;id<24;++id)if(hasField(f,id,156,0)){v=divide(4096*e[4],100);break;}
  MUL(v);return;
 }
 if(kind==156)return;
 if(kind==157){
  u8 target=event==0x3b?VALUE(3):event==0x3c?VALUE(4):31;
  u32 category=event==0x3b?FN(17,u32(*)(u32))(VALUE(0x12)):event==0x3c?VALUE(0x1a):0;
  if(target==31||!firstField(f,owner,kind,e[1])||hasField(f,target,kind,e[1]))return;
  if(event==0x3b&&(e[1]==1&&category==1||e[1]==3&&category==2)||event==0x3c&&(e[1]==2&&category==1||e[1]==4&&category==2))MUL(v);
  return;
 }
 if(kind==158){
  if(event!=0x28&&event!=0x29)return;
  if(FN(29,u32(*)(void*))(holder)==493)return; /* Native type work excludes Arceus. */
  /* BW2 snapshots the user's type pair in the move parameters before the
   * move execution event. Its existing writable variable supplies STAB's input. */
  if(event==0x28&&VALUE(2)==owner&&(!e[1]||!w[0])){
   u32 type=e[4]==18?VALUE(0x16):e[4];if(type<=17)REWRITE(0x1c,SX(1,u32(*)(u32))(type));return;
  }
  if(event!=0x29||VALUE(3)!=owner||e[1]&&w[0]||w[1]||preview(f))return;
  u32 type=e[4]==18?VALUE(0x16):e[4];if(type>17||typeMatch(holder,type)&&((u8*)holder)[0xf8]==((u8*)holder)[0xf9])return;
  /* Native work updates the committed battle state. Update the current
   * calculation Pokémon through the same native setter before STAB is read. */
  u32 pair=SX(1,u32(*)(u32))(type);SX(5,void(*)(void*,u16))(holder,pair);
  popup(f,2,owner);u8*p=PUSH(f,20,owner);put16(p+4,pair);p[6]=owner;POP(f,p);popup(f,3,owner);w[0]=w[1]=1;return;
 }
 if(kind==159){if(event==0x3b&&VALUE(3)==owner&&VALUE(4)<32&&entered[VALUE(4)]==turn(f))MUL(v);return;}
 if(kind==160){if(event==0x38&&VALUE(3)==owner){u32 count=w[0];if(count>e[1])count=e[1];MUL(4096+divide(4096*v*count+50,100));}return;}
 if(kind==161){
  if(event!=0x2d||VALUE(3)==VALUE(4)||ally(owner,VALUE(3))||!STAT(holder,13)||!(VALUE(4)==owner||e[1]&&ally(owner,VALUE(4))))return;
  u8 source=VALUE(3);s32 priority=0;
  if(!variable(0x18,&priority)){if(source>=32||priorityTurn[source]!=turn(f))return;priority=priorities[source];}else priority-=7;
  if(priority>=(s32)v&&REWRITE(0x40,1)&&!preview(f)){popup(f,2,owner);popup(f,3,owner);}return;
 }
 if(kind==162){
  if((e[1]?event!=0x5d:event!=0x5b)||preview(f)||!STAT(holder,13)||(e[4]&&e[4]!=VALUE(0x1f)))return;
  u8 target=VALUE(2),source=VALUE(3);u32 stat=VALUE(0x1f);s32 delta=(s32)VALUE(0x20);if(stat<1||stat>7)return;
  if(!e[1]&&event==0x5b&&target==owner&&source!=owner&&present(f,source)&&delta<0&&echoOrigin!=1&&FN(23,u32(*)(void*,u32,s32))(holder,stat,delta)){
   s32 reflected=-(s32)divide((u32)-delta*v+2048,4096);if(!reflected)reflected=-1;
   /* Reserve tracking before cancelling. Native work performs the reflected
    * change, including the recipient's ordinary stat guards and reactions. */
   if(VALUE(0x41)==0&&REWRITE(0x41,1)){popup(f,2,owner);echoStage(item,f,owner,source,stat,reflected,1);popup(f,3,owner);}
  }
  if(e[1]&&event==0x5d&&target!=owner&&!ally(owner,target)&&delta>0&&echoOrigin!=2){s32 copied=divide(delta*v+2048,4096);if(!copied)copied=1;popup(f,2,owner);echoStage(item,f,owner,owner,stat,copied,2);popup(f,3,owner);}
  return;
 }
 if(kind==163){
  if((e[1]?event!=0xa7:event!=0x4b)||preview(f)||!STAT(holder,13))return;
  u8 target=e[1]?VALUE(2):VALUE(4);if(!present(f,target)||target==owner)return;
  if(!e[1]){
   if(event!=0x4b||VALUE(3)!=owner||VALUE(0x46)||!VALUE(0x32)||RX(18,u32(*)(void*))(holder)||!RX(18,u32(*)(void*))(MON(f,target))||SX(2,u32(*)(void*,u8,u8))(f,owner,target))return;
   if(e[4]<100&&!FN(27,u32(*)(u8))(e[4]))return;
   u8*p=PUSH(f,36,owner);put32(p,*(u32*)p|0x00800000);p[4]=target;FN(11,void(*)(void*,u32,u32))(p+8,2,460);FN(12,void(*)(void*,u32))(p+8,target);FN(12,void(*)(void*,u32))(p+8,RX(18,u32(*)(void*))(MON(f,target)));POP(f,p);
  }else{
   if(event!=0xa7||!ally(owner,target)||transferClaim&(1u<<target)||RX(18,u32(*)(void*))(MON(f,target)))return;
   u32 held=RX(18,u32(*)(void*))(holder);if(!held||SX(3,u32(*)(void*,u8))(f,owner)||SX(3,u32(*)(void*,u8))(f,target)||SX(4,u32(*)(u32,u32))(FN(29,u32(*)(void*))(MON(f,target)),held)||held>=137&&held<=148)return;
   if(e[4]<100&&!FN(27,u32(*)(u8))(e[4]))return;
   transferClaim|=1u<<target;popup(f,2,owner);
   u8*p=PUSH(f,32,owner);put16(p+4,0);p[6]=owner;POP(f,p);
   p=PUSH(f,32,owner);put16(p+4,held);p[6]=target;FN(11,void(*)(void*,u32,u32))(p+12,2,1111);FN(12,void(*)(void*,u32))(p+12,target);FN(12,void(*)(void*,u32))(p+12,owner);FN(12,void(*)(void*,u32))(p+12,held);POP(f,p);popup(f,3,owner);
  }return;
 }
}
