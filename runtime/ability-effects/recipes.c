/* Freestanding compiler-generated aggregate initialization. */
void*memset(void*dst,int value,unsigned length){volatile u8*p=dst;for(u32 n=0;n<length;++n)p[n]=value;return dst;}
void*memcpy(void*dst,const void*src,unsigned length){volatile u8*p=dst;const volatile u8*q=src;for(u32 n=0;n<length;++n)p[n]=q[n];return dst;}
/* Small event-driven recipe operations; native services retain battle work,
 * suppression, stat/status guards, messages and side-condition handling. */
PUBLIC const volatile u32 AbilityRecipeApi[23]={0};
#define RX(i,t) ((t)(uintptr_t)AbilityRecipeApi[i])
static u32 entryUsed[32][8];
static u32 recipeMove,recipeCritical,recipeEffectiveness,entrySource;
static u32 ally(u8 a,u8 b){return RX(10,u32(*)(u8,u8))(a,b);}
static u32 present(void*f,u8 id){return id<24&&RX(11,u32(*)(void*,u8))(f,id);}
static u32 side(u8 id){return RX(13,u32(*)(u8))(id);}
static u32 onEntry(u32 event,u8 owner){return (event==0x55||event==0x8a)&&VALUE(2)==owner;}
static u32 inScope(void*f,u8 owner,u8 target,u32 scope){
 if(!present(f,target))return 0;
 if(scope==0)return target==owner;
 if(scope==1)return target!=owner&&ally(owner,target);
 if(scope==2)return !ally(owner,target);
 if(scope==3)return target!=owner;
 return target==VALUE(3);
}
static void recipeEvent(void*f,u32 event,u8 owner,u32 item){
 RX(7,void(*)(u32))(0x501);RX(9,void(*)(u32,u32))(2,owner);RX(9,void(*)(u32,u32))(0x2d,item);
 RX(6,void(*)(void*,u32))(f,event);RX(8,void(*)(u32))(0x501);
}
PUBLIC void AbilityRecipeInit(void){
 for(u32 n=0;n<32;++n)for(u32 k=0;k<8;++k)entryUsed[n][k]=0;
 recipeMove=recipeCritical=recipeEffectiveness=0;entrySource=31;RX(0,void(*)(void))();
}
PUBLIC void AbilityRecipeHandlers(void*f,u32 event,u32 factor,u32 check){
 u32 previous=entrySource;if(event==0x55||event==0x8a)entrySource=VALUE(2);
 RX(22,void(*)(void*,u32,u32,u32))(f,event,factor,check);entrySource=previous;
}
PUBLIC void AbilityRecipeMoveParam(void*f,u16 move,void*mon,void*param){
 u32 previous=recipeMove;recipeMove=move;RX(1,void(*)(void*,u16,void*,void*))(f,move,mon,param);recipeMove=previous;
}
PUBLIC void AbilityRecipeCriticalHandlers(void*f,u32 event){
 RX(6,void(*)(void*,u32))(f,event);if(event==0x36&&VALUE(0x41))recipeCritical=0;
}
PUBLIC u32 AbilityRecipeCritical(void*f,void*a,void*t,u16 move){
 u32 previous=recipeCritical;recipeCritical=0;u32 result=RX(2,u32(*)(void*,void*,void*,u16))(f,a,t,move);result=result||recipeCritical;recipeCritical=previous;return result;
}
PUBLIC u32 AbilityRecipeEffectiveness(void*f,void*a,void*t,void*param,u32 flag){
 u32 previous=recipeEffectiveness;recipeEffectiveness=0;u32 result=RX(3,u32(*)(void*,void*,void*,void*,u32))(f,a,t,param,flag);
 if(result&&recipeEffectiveness){result=recipeEffectiveness;}recipeEffectiveness=previous;return result;
}
PUBLIC void AbilityRecipeChangeItem(void*f,void*mon,u16 item,u32 consume){
 u32 old=RX(18,u32(*)(void*))(mon);RX(4,void(*)(void*,void*,u16,u32))(f,mon,item,consume);
 if(consume&&RX(14,u32(*)(u32))(old)&&!preview(f))recipeEvent(f,0xa6,FN(15,u32(*)(void*))(mon),old);
}
PUBLIC u32 AbilityRecipeForceItem(void*f,u8*param){
 u32 result=RX(5,u32(*)(void*,void*))(f,param);
 if(result&&RX(14,u32(*)(u32))(half(param+6))&&!preview(f))recipeEvent(f,0xa6,param[4],half(param+6));
 return result;
}
static u32 recipeMatch(const volatile u8*e,u32 classAt,u32 typeAt,u32 categoryAt,u32 move){
 u8 filter[16]={0};filter[1]=e[classAt];filter[4]=e[typeAt];filter[5]=e[categoryAt];
 (void)move;return libraryMatch(filter);
}
static u32 conversionMatch(u32 filter,u32 move){
 if(!filter)return 1;
 if(filter==1||filter==2||filter==5)return FN(31,u32(*)(u32,u32))(move,filter==1?0:filter==2?7:8);
 u32 bit=filter==3?1:filter==4?2:filter==6?4:filter==7?8:filter==8?16:filter==13?32:filter==12?64:0;
 for(u32 n=0;n<sizeof(abilityMoveClasses)/sizeof(abilityMoveClasses[0]);++n)if(abilityMoveClasses[n][0]==move)return (abilityMoveClasses[n][1]&bit)!=0;
 return 0;
}
static u32 recipeStage(void*item,void*f,u8 owner,u8 target,u32 stat,s32 value,u32 chance){
 u8 staged[16]={11,0,0,0,0,0,100};staged[1]=stat;put16(staged+2,value);staged[6]=chance;return action(item,f,owner,staged,target);
}
static void recipeHeal(void*f,u8 owner,u8 target,const volatile u8*e){
 void*m=MON(f,target);u32 hp=STAT(m,13),max=STAT(m,14),amount=e[1]?divide(max*100,half(e+2)):divide(max*half(e+2),10000);
 if(!hp||hp>=max){return;}if(amount>max-hp){amount=max-hp;}if(!amount){amount=1;}
 popup(f,2,owner);u8*p=PUSH(f,5,owner);put16(p+4,amount);p[6]=target;POP(f,p);popup(f,3,owner);
}
static u32 protect(void*f,u8 owner,u8 target,const volatile u8*e,u32 scopeAt,u32 typeAt){
 return STAT(MON(f,owner),13)&&present(f,target)&&(target==owner||e[scopeAt]&&ally(owner,target))&&(e[typeAt]==18||typeMatch(MON(f,target),e[typeAt]));
}
static u32 highest(void*m){
 u32 best=0,stat=1;for(u32 n=0;n<5;++n){u32 v=half((u8*)m+0xee +n*2);if(v>best){best=v;stat=n+1;}}return stat;
}
static void recipeWeather(void*f,u8 owner,const volatile u8*e){
 if(RX(16,u32(*)(void))()==e[4])return;
 popup(f,2,owner);u8*p=PUSH(f,29,owner);p[4]=e[4];p[5]=e[5];p[6]=1;POP(f,p);popup(f,3,owner);
}
static void recipeObserve(void*f,u8 owner,const volatile u8*r,u32 event){
 if(owner>=32||preview(f))return;
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){u32*w=nativeWork[owner][n];
  if(e[0]==136&&e[1]==2){
   if(event==0x81){w[0]=0;w[1]=0;}
   if(event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0){w[1]=1;w[0]+=VALUE(0x32);}
  }
 }
}
static void recipeEffect(void*item,void*f,u8 owner,const volatile u8*e,u32 event,u32*w,u32 used){
 u32 kind=e[0],v=half(e+2),hp=STAT(MON(f,owner),13);s32 signedValue=(int16_t)v;
 if(kind==135){
  u32 move=event==0x28?recipeMove:VALUE(0x12);if(!move)return;
  u32 original=FN(35,u32(*)(u32,u32))(move,0);
  /* These moves choose their type after the initial move-parameter event. */
  if(move==237||move==311||move==363||move==449||move==546||e[4]!=18&&original!=e[4])return;
  if(!conversionMatch(e[1],move))return;
  if(event==0x28&&VALUE(2)==owner)REWRITE(0x16,e[5]);
  if(event==0x38&&VALUE(3)==owner&&VALUE(0x16)==e[5])MUL(v);
  return;
 }
 if(kind==136){
  u32 fire=0,t=e[1];
  if(t==0)fire=onEntry(event,owner)&&(!e[9]||!used);
  if(t==1)fire=event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0&&(!e[12]||FN(17,u32(*)(u32))(VALUE(0x12))==e[12])&&recipeMatch(e,10,11,12,VALUE(0x12));
  if(t==2)fire=event==0x84&&w[1]&&hp&&hp*100<=STAT(MON(f,owner),14)*e[8]&&(hp+w[0])*100>STAT(MON(f,owner),14)*e[8]&&(!e[12]||FN(17,u32(*)(u32))(VALUE(0x12))==e[12])&&recipeMatch(e,10,11,12,VALUE(0x12));
  if(t==3)fire=event==0xa3&&VALUE(2)!=owner&&!STAT(MON(f,VALUE(2)),13);
  if(t==4&&event==0x83&&VALUE(3)==owner){for(u32 n=0;n<VALUE(5)&&n<12;++n)if(!STAT(MON(f,VALUE(6+n)),13))++fire;}
  if(!fire||preview(f)||!hp&&t!=1)return;
  popup(f,2,owner);
  for(u32 k=0;k<fire;++k)for(u8 id=0;id<24;++id)if(inScope(f,owner,id,e[5])){
   if(e[13]&&RX(19,u32(*)(void*,u8,u8,u16))(f,owner,id,0))continue;
   if(t==0&&e[5]==2&&RX(20,u32(*)(void*))(MON(f,id)))continue;
   recipeStage(item,f,owner,id,e[4]==8?highest(MON(f,owner)):e[4],signedValue,e[6]);
  }
  popup(f,3,owner);return;
 }
 if(kind==137){
  if(event==0x65&&(!e[8]||VALUE(3)!=VALUE(4))&&VALUE(0x1d)==e[1]&&protect(f,owner,VALUE(4),e,4,5))REWRITE(0x41,1);
  if(e[6]&&!preview(f)&&(onEntry(event,owner)||event==0x88||event==0x77&&VALUE(2)==owner||event==0x55&&protect(f,owner,VALUE(2),e,4,5)))for(u8 id=0;id<24;++id)if(protect(f,owner,id,e,4,5))RX(15,void(*)(void*,u8,u32))(f,id,e[1]);
  return;
 }
 if(kind==138){if(event==0x5b&&protect(f,owner,VALUE(2),e,4,5)&&VALUE(3)!=VALUE(2)&&(e[1]==8||VALUE(0x1f)==e[1])&&(s32)VALUE(0x20)<0)REWRITE(0x41,1);return;}
 if(kind==139){if(hp&&event==0x38&&(VALUE(3)!=owner||e[1])&&ally(owner,VALUE(3))&&(!e[6]||FN(17,u32(*)(u32))(VALUE(0x12))==e[6])&&recipeMatch(e,4,5,6,VALUE(0x12))){MUL(v);}return;}
 if(kind==140&&onEntry(event,owner)&&!preview(f)){
  if(!e[1]){for(u8 id=0;id<24;++id)if(inScope(f,owner,id,1)&&STAT(MON(f,id),13)&&(!e[4]||!RX(19,u32(*)(void*,u8,u8,u16))(f,owner,id,0))){popup(f,2,owner);u8*p=PUSH(f,15,owner);p[4]=owner;for(u32 n=0;n<7;++n)p[5+n]=*((u8*)MON(f,id)+0xfc+n);POP(f,p);if(e[5]){u8*flag=PUSH(f,RX(21,u32(*)(void*,u32))(MON(f,id),9)?23:24,owner);put32(flag+4,9);flag[8]=owner;POP(f,flag);}popup(f,3,owner);break;}}
  else{u8*p=PUSH(f,16,owner);u32 count=0;for(u8 id=0;id<24&&count<6;++id)if(inScope(f,owner,id,1)&&(!e[4]||!RX(19,u32(*)(void*,u8,u8,u16))(f,owner,id,0)))p[5+count++]=id;p[4]=count;POP(f,p);}return;
 }
 if(kind==141&&onEntry(event,owner)&&!preview(f)){for(u32 s=0;s<2;++s)if(!e[1]||s==(e[1]==1?side(owner):1-side(owner))){u8*p=PUSH(f,26,owner);p[4]=3;p[5]=3;p[7]=s;POP(f,p);}return;}
 if(kind==142&&!preview(f)&&(e[1]?event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0:onEntry(event,owner))){recipeWeather(f,owner,e);return;}
 if(kind==143&&(event==0x13||event==0x3b)&&FN(6,u32(*)(void*))(f)==e[4]){
  if(e[1]==5&&event==0x13&&VALUE(2)==owner||event==0x3b&&VALUE(3)==owner&&(e[1]==1&&FN(17,u32(*)(u32))(VALUE(0x12))==1||e[1]==3&&FN(17,u32(*)(u32))(VALUE(0x12))==2)){MUL(v);}return;
 }
 if(kind==144&&!preview(f)&&(e[4]?event==0xa6&&VALUE(2)==owner:onEntry(event,owner))){for(u8 id=0;id<24;++id)if(inScope(f,owner,id,e[5])&&(!e[6]||!RX(19,u32(*)(void*,u8,u8,u16))(f,owner,id,0)))recipeHeal(f,owner,id,e);return;}
 if(kind==145&&event==0x36&&VALUE(3)==owner&&CHECK(MON(f,VALUE(4)),e[1])){recipeCritical=1;return;}
 if(kind==146&&event==0x33&&VALUE(3)==owner){REWRITE(0x28,6);return;}
 if(kind==147&&event==0x3e&&VALUE(4)==owner&&hp*100>=STAT(MON(f,owner),14)*e[1]){recipeEffectiveness=v==1024?1:v==2048?2:v==4096?3:v==8192?4:5;return;}
 if(kind==148&&event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0&&(!e[4]||FN(17,u32(*)(u32))(VALUE(0x12))==e[4])&&!preview(f)){
  popup(f,2,owner);u8*p=PUSH(f,25,owner);put32(p+4,e[1]);put32(p+8,1);p[12]=1-side(owner);POP(f,p);popup(f,3,owner);return;
 }
 if(kind==149&&event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0&&!hp&&VALUE(3)!=owner&&!preview(f)){
  /* The engine passes actual HP damage, capped before damage reactions. */
  u32 amount=divide(VALUE(0x32)*v,4096);if(!amount)amount=1;popup(f,2,owner);u8*p=PUSH(f,7,owner);put16(p+4,amount);p[6]=VALUE(3);POP(f,p);popup(f,3,owner);return;
 }
 if(kind==150&&event==0x4b&&VALUE(4)==owner&&!VALUE(0x46)&&VALUE(0x32)>0&&recipeMatch(e,1,4,5,VALUE(0x12))&&!preview(f)){
  popup(f,2,owner);u8 ids[2]={owner,VALUE(3)};for(u32 n=0;n<2;++n)if(STAT(MON(f,ids[n]),13)&&!CHECK(MON(f,ids[n]),20)){u8*p=PUSH(f,12,owner);put32(p+4,20);put32(p+8,RX(17,u32(*)(u8,u16))(v,0));p[15]=ids[n];POP(f,p);}popup(f,3,owner);return;
 }
 if(kind==151&&event==0x5b&&entrySource==VALUE(3)&&VALUE(0x1f)==e[5]&&VALUE(2)==owner&&(s32)VALUE(0x20)<0&&VALUE(3)!=owner&&present(f,VALUE(3))&&STAT(MON(f,VALUE(3)),16)==e[4]){
  if(REWRITE(0x41,1)&&!preview(f)){popup(f,2,owner);recipeStage(item,f,owner,owner,e[1],signedValue,100);popup(f,3,owner);}return;
 }
 if(kind==152){
  u32 activate=0;
  if(event==0x2d&&VALUE(4)==owner&&VALUE(3)!=owner&&recipeMatch(e,4,5,6,VALUE(0x12)))activate=REWRITE(0x40,1);
  if(e[5]&&(onEntry(event,owner)&&RX(12,u32(*)(void*,u8,u32))(f,side(owner),4)||event==0x9f&&VALUE(0x53)==4&&VALUE(0x52)==side(owner)&&!RX(12,u32(*)(void*,u8,u32))(f,side(owner),4)))activate=1;
  if(activate&&!preview(f)){popup(f,2,owner);recipeStage(item,f,owner,owner,e[1],signedValue,100);popup(f,3,owner);}return;
 }
 if(kind==153&&event==0x2d&&VALUE(4)==owner&&(!e[6]||VALUE(3)!=owner)&&recipeMatch(e,1,4,5,VALUE(0x12)))REWRITE(0x40,1);
}
