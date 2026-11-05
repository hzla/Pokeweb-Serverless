/* Parameterized item effects. Native work queues retain stat/consumption rules. */
static u32 recipeMoveClass(u32 move,u32 filter){
 if(filter==1||filter==2||filter==5)return FN(31,u32(*)(u32,u32))(move,filter==1?0:filter==2?7:8);
 u32 bit=filter==3?1:filter==4?2:filter==6?4:filter==7?8:filter==8?16:filter==13?32:filter==12?64:0;
 const volatile u8*p=ItemRecipeMoveData;u32 low=0,high=half(p);
 while(low<high){u32 mid=(low+high)/2,id=half(p+2+mid*4);if(id<move)low=mid+1;else high=mid;}
 return low<half(p)&&half(p+2+low*4)==move&&(half(p+4+low*4)&bit);
}
static u32 recipeStages(void*item,void*f,u8 owner,const volatile u8*e){
 u32 queued=0;
 for(u32 n=0;n<7;++n){
  s32 delta=(int8_t)e[5+n];if(!delta)continue;
  u8 stage[16];for(u32 k=0;k<16;++k)stage[k]=0;
  stage[0]=11;stage[1]=(u8)(n+1);put16(stage+2,(u16)delta);stage[6]=100;
  queued|=action(item,f,owner,stage,owner);
 }
 return queued;
}
static u32 mirrorDepth;
/* A successful change reports its requested delta. Snapshot the pre-change
 * stage so capped boosts copy the actual gain, once per holder and event. */
typedef struct {u32 seen;u16 turn;u8 before,valid;} MirrorStage;
static MirrorStage mirrorStages[24][7];
static u32 mirrorTurn(void*f){return *(u32*)((u8*)f+16)&65535;}
static void mirrorFinished(void*f,u8 owner,u32 event){
 if(event!=0x5d||mirrorDepth||preview(f))return;
 u32 target=VALUE(2),stat=VALUE(0x1f);if(target<24&&stat>=1&&stat<=7){MirrorStage*t=&mirrorStages[target][stat-1];if(t->valid&&t->turn==mirrorTurn(f))t->seen|=1u<<owner;}
}
static void itemNotice(void*item,void*f,u8 owner,u32 index){
 if(!ItemRecipeMessages[index])return;
 u8*p=PUSH(f,4,owner);FN(11,void(*)(void*,u32,u32))(p+4,2,ItemRecipeMessages[index]);
 FN(12,void(*)(void*,u32))(p+4,owner);FN(12,void(*)(void*,u32))(p+4,SUB(item));POP(f,p);
}
static void itemRecipe(void*item,void*f,u8 owner,u32*w,Slot*slot,const volatile u8*r,const volatile u8*e,u32 index,u32 event){
 u32 kind=e[0],v=half(e+2);void*mon=MON(f,owner);
 if(kind==134){if(event==0x57&&(w[0]&32)&&!preview(f)){w[0]&=~32u;if(r[2])consume(item,f,owner,0);}return;}
 if(kind==135){
  if(event==0x85||event==0x57){slot->cells[index]=0;return;}
  if(event==0x5b&&VALUE(2)==owner&&VALUE(3)!=owner&&(s32)VALUE(0x20)<0&&(!e[1]||VALUE(0x1f)==e[1])){
   if(REWRITE(0x41,1)&&!preview(f))slot->cells[index]|=0x80000000u;
  }
  if(event==0x5c&&VALUE(2)==owner&&(slot->cells[index]&0x80000000u)&&!preview(f)){
   u32 move=VALUE(0x19)&0xffff;if(!(slot->cells[index]&0x40000000u)||(slot->cells[index]&0xffff)!=move){itemNotice(item,f,owner,0);slot->cells[index]=0x40000000u|move;if(r[2])consume(item,f,owner,1);}
   else slot->cells[index]&=~0x80000000u;
  }
  return;
 }
 if(kind==136){
  if(e[1]&&event==0x64&&VALUE(4)==owner&&VALUE(3)!=owner&&VALUE(0x1d)&&VALUE(0x1d)!=8&&VALUE(0x26)||e[2]&&event==0x51&&VALUE(4)==owner&&VALUE(3)!=owner&&VALUE(0x26)||e[3]&&event==0x6d&&VALUE(4)==owner&&VALUE(0x26)){
   if(REWRITE(0x41,1)&&r[2]&&!preview(f))consume(item,f,owner,1);
  }
  /* Keep the native secondary-effect skip flag, including its multi-target gate. */
  if(!r[2]&&e[1]&&e[2]&&e[3]&&(event==0x4a&&VALUE(4)==owner||event==0x82&&FN(46,u32(*)(u8))(owner)&&VALUE(5)==1))REWRITE(0x47,1);
  return;
 }
 if(kind==137){
  if(event!=0x35||VALUE(3)!=owner||VALUE(0x29)!=5||VALUE(0x51))return;
  u32 count=e[1];if(!preview(f)&&e[1]<5)count+=FN(47,u32(*)(u32))(6-e[1]);
  if(REWRITE(0x2a,count)&&r[2]&&!preview(f))w[0]|=1;
  return;
 }
 if(kind==138){
  if(preview(f)||!STAT(mon,13))return;
  u32 target=0,stat=0;
  if(event==0x5b||event==0x5d){
   target=VALUE(2);stat=VALUE(0x1f);
   if(mirrorDepth||target==owner||target>=24||stat<1||stat>7||FN(45,u32(*)(u8))((u8)target)==FN(45,u32(*)(u8))(owner)||(s32)VALUE(0x20)<=0)return;
   MirrorStage*t=&mirrorStages[target][stat-1];
   if(event==0x5b){t->before=((u8*)MON(f,target))[0xfc+stat-1];t->turn=mirrorTurn(f);t->valid=1;t->seen=0;return;}
   if(!t->valid||t->turn!=mirrorTurn(f)||(t->seen&(1u<<owner)))return;
   s32 delta=(s32)((u8*)MON(f,target))[0xfc+stat-1]-t->before;
   if(delta>0&&(!e[1]||e[1]==stat)){
    if(slot->pad!=mirrorTurn(f)){const volatile u8*all=effects(r);for(u32 n=0;n<r[0];++n,all+=16)if(all[0]==138)slot->cells[n]=0;slot->pad=mirrorTurn(f);}
    u32 old=(slot->cells[index]>>((stat-1)*4))&15,add=divide(delta*v+2048,4096);if(add<1)add=1;if(old+add>12)add=12-old;
    slot->cells[index]+=add<<((stat-1)*4);
   }return;
  }
  if(event==0x57||event==0x85||event==0x77||event==0x91){
   u32 pending=slot->cells[index];slot->cells[index]=0;if(!pending||slot->pad!=mirrorTurn(f))return;
   u8 stages[16];for(u32 n=0;n<16;++n)stages[n]=0;
   u32 valid=0;for(u32 n=0;n<7;++n){stages[5+n]=(pending>>(n*4))&15;if(stages[5+n]&&FN(23,u32(*)(void*,u32,s32))(mon,n+1,stages[5+n]))valid=1;}
   if(valid){++mirrorDepth;itemNotice(item,f,owner,1);recipeStages(item,f,owner,stages);--mirrorDepth;if(r[2])consume(item,f,owner,3);}
  }return;
 }
 if(kind==129){
  if(preview(f)||!STAT(mon,13))return;
  u32 forced=e[4]&&(event==0x72||event==0x73)&&VALUE(2)==owner;
  if(!forced){
   if(event!=0x4b||VALUE(4)!=owner||VALUE(0x46)||(s32)VALUE(0x32)<=0)return;
   if(e[1]<18&&VALUE(0x16)!=e[1]||e[2]&&FN(17,u32(*)(u32))(VALUE(0x12))!=e[2]||e[3]&&VALUE(0x38)<e[3])return;
  }
  if(recipeStages(item,f,owner,e)&&r[2]&&!forced)consume(item,f,owner,1);
  return;
 }
 if(kind==130||kind==139){
  if(event!=0x38||VALUE(3)!=owner||e[1]<18&&VALUE(0x16)!=e[1]||e[4]&&FN(17,u32(*)(u32))(VALUE(0x12))!=e[4])return;
  if(kind==139&&e[5]&&!recipeMoveClass(VALUE(0x12),e[5]))return;
  FN(1,void(*)(u32,u32))(0x31,v);if(r[2]&&v!=4096&&!preview(f))w[0]|=1;return;
 }
 if(kind==131){
  if(event==0x47&&VALUE(4)==owner&&(e[1]>=18||VALUE(0x16)==e[1])&&(!e[4]||VALUE(0x38)>3)&&!FN(43,u32(*)(void*))(mon)){
   MUL(v);if(!preview(f))slot->cells[index]=v!=4096;
  }
  if(event==0x44&&slot->cells[index]&&!preview(f)){
   u32 found=0;for(u32 n=0;n<VALUE(5)&&n<12;++n)if(VALUE(6+n)==owner)found=1;
   if(found){slot->cells[index]=0;if(r[2])consume(item,f,owner,1);}
  }
  return;
 }
 if(kind==132&&event==0x7f&&VALUE(2)==owner&&(s32)VALUE(0x32)>0&&(!e[1]||VALUE(0x39)==e[1])){
  if(REWRITE(0x41,1)&&r[2]&&!preview(f))consume(item,f,owner,1);
  return;
 }
 if(kind==133&&event==0x2d&&VALUE(4)==owner&&VALUE(3)!=owner&&recipeMoveClass(VALUE(0x12),e[1])){
  if(REWRITE(0x40,1)&&r[2]&&!preview(f))consume(item,f,owner,1);
 }
}
